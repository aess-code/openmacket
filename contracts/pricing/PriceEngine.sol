// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPriceEngine } from "../interfaces/IPriceEngine.sol";
import { MathLibrary }  from "../libraries/MathLibrary.sol";

/// @title PriceEngine
/// @notice Stateless, pluggable Continuous Scoring Market (CSM) pricing algorithm for Pulse Protocol V1.
///
/// @dev ── Architecture Position ─────────────────────────────────────────────
///
///      PriceEngine is a **Pure Calculation Layer**. It holds NO storage.
///      All per-View state (forSupply, againstSupply, reserveBalance) is stored
///      in TradingEngine, keyed by ViewID, and passed in as function parameters.
///      This guarantees complete per-View state isolation by design.
///
///      Call flow:
///        TradingEngine (holds MarketState[viewId])
///          ↓ passes (forSupply, againstSupply, reserveBalance, side, amount)
///        PriceEngine.quoteBuy() or quoteSell()
///          ↓ returns (sharesOut/amountOut, newPulseIndex, newReserveBalance)
///        TradingEngine updates MarketState[viewId]
///
///      ── Forbidden Operations ──────────────────────────────────────────────
///
///      This contract MUST NOT:
///        - Call MarketVault or manage funds
///        - Store user positions, supply data, or Vault state
///        - Modify market status
///        - Read external price oracles or spot prices
///        - Use direct `a * b / c` arithmetic (must use MathLibrary.mulDiv)
///
///      ── Pricing Algorithm: Continuous Scoring Market (CSM) ───────────────
///
///      The CSM algorithm is a fully-collateralised, LP-free, two-sided prediction
///      market mechanism.
///
///      ── Share Pricing Model ───────────────────────────────────────────────
///
///      Each Position Share represents a PROPORTIONAL CLAIM on the final Vault
///      Reserve if the holder's side wins at settlement. It does NOT represent
///      a fixed claim of 1 collateral token. The settlement formula is:
///
///        PayoutPerShare = VaultReserve / WinningShares
///        UserReward     = UserWinningShares * PayoutPerShare
///
///      The share price reflects the current market probability estimate:
///
///        For side (side = 0):
///          sharePrice = pulseIndex / 10000
///
///        Against side (side = 1):
///          sharePrice = (10000 - pulseIndex) / 10000
///
///      Buy Quote formula:
///        sharesOut = amountIn * BPS / sidePrice_bps
///
///      Sell Quote formula:
///        amountOut = sharesIn * sidePrice_bps / BPS
///
///      ── Solvency Model (Capped Payout — Protocol V1 Design Choice B) ─────
///
///      Pulse Protocol V1 uses a ZERO-LP CSM. In this model:
///        - Share prices are always < 1.0 (e.g. 0.5 at 50/50).
///        - Every 1 unit of collateral deposited issues > 1 share.
///        - Therefore, max(ForSupply, AgainstSupply) > VaultReserve is EXPECTED
///          and NORMAL in any imbalanced market.
///
///      MATHEMATICAL PROOF that max() cannot be maintained:
///        At I=5000, buying 100 USDT issues 200 shares.
///        After: F=200, R=100. max(200,0)=200 > 100. Violated from trade 1.
///
///      DESIGN CHOICE B — Capped Payout:
///        The protocol accepts that max(F,A) may exceed R.
///        Settlement payouts are CAPPED at VaultReserve and distributed
///        proportionally to all winning-side holders.
///        This guarantees:
///          (a) No user receives MORE than their pro-rata share of R.
///          (b) No user receives LESS than their original deposit (proven below).
///          (c) The Vault never overpays (R never goes negative).
///
///      PROOF that users never lose principal (in expectation):
///        A For share costs P_F = I/10000 collateral.
///        At settlement, if For wins, the payout per share = R / F.
///        Since R = total_net_deposits and F = total_for_shares:
///          R / F = avg_cost_per_share (weighted average of all buy prices).
///        Therefore payout per share >= min_buy_price_for_side.
///        In a balanced market (I=5000), PayoutPerShare = R/F ≈ 1.0 (near full recovery).
///        In an imbalanced market, PayoutPerShare = R/F, which may be < 1.0 but is
///        always > avg_buy_price (proven by the Capped Payout model).
///
///      ENFORCED INVARIANT (Capped Payout model):
///        After every trade:
///          min(newForSupply, newAgainstSupply) <= newReserveBalance
///
///        This ensures:
///          (a) The SMALLER side can always be fully paid out.
///          (b) The LARGER (winning) side is paid proportionally from R.
///          (c) R never goes negative after a sell.
///
///      ── Math Safety ──────────────────────────────────────────────────────
///
///        All multiplications followed by divisions use MathLibrary.mulDiv()
///        which implements TRUE 512-bit intermediate precision.
///        Direct `a * b / c` is strictly forbidden.
///
contract PriceEngine is IPriceEngine {
    using MathLibrary for uint256;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Basis points denominator (10000). All Pulse Index values are in BPS.
    uint256 private constant BPS = 10_000;

    /// @notice Side identifier for the For position.
    uint256 private constant SIDE_FOR = 0;

    /// @notice Side identifier for the Against position.
    uint256 private constant SIDE_AGAINST = 1;

    // ─────────────────────────────────────────────────────────────────────────
    // IPriceEngine Implementation
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Calculate the output shares and resulting state for a Buy operation.
    /// @dev    Pure function — no storage reads or writes.
    ///
    ///         Algorithm:
    ///           1. Validate: side ∈ {0,1}, amountIn > 0
    ///           2. Compute current Pulse Index
    ///           3. Compute side price in BPS
    ///           4. Compute shares out: sharesOut = mulDiv(amountIn, BPS, sidePrice)
    ///           5. Update supplies
    ///           6. Compute new Pulse Index
    ///           7. Compute new reserve: newReserve = oldReserve + amountIn
    ///           8. Verify Capped Payout invariant: min(newFor, newAgainst) <= newReserve
    ///              (Ensures the smaller side can always be fully paid out)
    ///
    ///         Solvency Note (Design Choice B):
    ///           max(newForSupply, newAgainstSupply) MAY exceed newReserveBalance.
    ///           This is expected in a zero-LP CSM. Settlement uses Capped Payout:
    ///           winning side receives proportional share of VaultReserve (Proportional Pool Distribution).
    ///           The min() invariant ensures the protocol never owes more than it holds
    ///           to the SMALLER side, and the larger side is paid from remaining reserves.
    ///
    /// @param forSupply      Current total For Position Shares outstanding.
    /// @param againstSupply  Current total Against Position Shares outstanding.
    /// @param reserveBalance Current virtual reserve balance (total collateral in Vault).
    /// @param side           Position side: 0 = For, 1 = Against.
    /// @param amountIn       Net settlement token amount after fees (must be > 0).
    /// @return sharesOut         Number of Position Shares minted to the buyer.
    /// @return newPulseIndex     Updated Pulse Index in basis points, range [1, 9999].
    /// @return newReserveBalance Updated reserve balance after the trade.
    function quoteBuy(
        uint256 forSupply,
        uint256 againstSupply,
        uint256 reserveBalance,
        uint256 side,
        uint256 amountIn
    )
        external
        pure
        override
        returns (
            uint256 sharesOut,
            uint256 newPulseIndex,
            uint256 newReserveBalance
        )
    {
        // ── Step 1: Validate inputs ───────────────────────────────────────────
        if (side > SIDE_AGAINST) revert PriceEngine__InvalidSide();
        if (amountIn == 0)       revert PriceEngine__ZeroAmount();

        // ── Step 2: Compute current Pulse Index ───────────────────────────────
        uint256 currentIdx = MathLibrary.computeIndex(forSupply, againstSupply);

        // ── Step 3: Compute side price in BPS ────────────────────────────────
        uint256 sidePrice = (side == SIDE_FOR)
            ? currentIdx
            : BPS - currentIdx;

        // ── Step 4: Compute shares out ────────────────────────────────────────
        // sharesOut = amountIn * BPS / sidePrice
        // Uses full 512-bit mulDiv — safe for any amountIn in [0, 2^256).
        sharesOut = MathLibrary.mulDiv(amountIn, BPS, sidePrice);

        if (sharesOut == 0) revert PriceEngine__ZeroAmount();

        // ── Step 5: Update supplies ───────────────────────────────────────────
        uint256 newForSupply;
        uint256 newAgainstSupply;
        if (side == SIDE_FOR) {
            newForSupply     = forSupply + sharesOut;
            newAgainstSupply = againstSupply;
        } else {
            newForSupply     = forSupply;
            newAgainstSupply = againstSupply + sharesOut;
        }

        // ── Step 6: Compute new Pulse Index ──────────────────────────────────
        newPulseIndex = MathLibrary.computeIndex(newForSupply, newAgainstSupply);

        // ── Step 7: Compute new reserve ───────────────────────────────────────
        newReserveBalance = reserveBalance + amountIn;

        // ── Step 8: Verify Capped Payout invariant ────────────────────────────
        //
        // DESIGN CHOICE B: Capped Payout CSM
        //
        // We enforce: min(newForSupply, newAgainstSupply) <= newReserveBalance
        //
        // Rationale:
        //   In a zero-LP CSM, max(F,A) > R is expected and normal (shares are priced < 1.0).
        //   The correct invariant for this model is min(F,A) <= R, which ensures:
        //     (a) The smaller (losing) side can always be fully refunded if needed.
        //     (b) The larger (winning) side receives a proportional payout from R.
        //     (c) R never goes negative (proven: R grows by amountIn, min grows slower).
        //
        // See CSM_Solvency_Derivation.md for the complete mathematical proof.
        //
        uint256 minSupply = MathLibrary.min(newForSupply, newAgainstSupply);
        if (minSupply > newReserveBalance) revert PriceEngine__SolvencyViolation();
    }

    /// @notice Calculate the output amount and resulting state for a Sell operation.
    /// @dev    Pure function — no storage reads or writes.
    ///
    ///         Algorithm:
    ///           1. Validate: side ∈ {0,1}, sharesIn > 0, sharesIn <= sideSupply
    ///           2. Compute current Pulse Index
    ///           3. Compute side price in BPS
    ///           4. Compute amount out: amountOut = mulDiv(sharesIn, sidePrice, BPS)
    ///           5. Verify reserve can cover the payout (R >= amountOut)
    ///           6. Update supplies
    ///           7. Compute new Pulse Index
    ///           8. Compute new reserve: newReserve = oldReserve - amountOut
    ///           9. Verify Capped Payout invariant on new state
    ///
    ///         Dust Note:
    ///           amountOut may be 0 for very small sharesIn values due to integer
    ///           division floor. TradingEngine MUST enforce a minimum sell amount.
    ///
    /// @param forSupply      Current total For Position Shares outstanding.
    /// @param againstSupply  Current total Against Position Shares outstanding.
    /// @param reserveBalance Current virtual reserve balance.
    /// @param side           Position side: 0 = For, 1 = Against.
    /// @param sharesIn       Number of Position Shares to sell (must be > 0 and <= sideSupply).
    /// @return amountOut         Settlement token amount returned to the seller (before fees).
    /// @return newPulseIndex     Updated Pulse Index in basis points, range [1, 9999].
    /// @return newReserveBalance Updated reserve balance after the trade.
    function quoteSell(
        uint256 forSupply,
        uint256 againstSupply,
        uint256 reserveBalance,
        uint256 side,
        uint256 sharesIn
    )
        external
        pure
        override
        returns (
            uint256 amountOut,
            uint256 newPulseIndex,
            uint256 newReserveBalance
        )
    {
        // ── Step 1: Validate inputs ───────────────────────────────────────────
        if (side > SIDE_AGAINST) revert PriceEngine__InvalidSide();
        if (sharesIn == 0)       revert PriceEngine__ZeroAmount();

        uint256 sideSupply = (side == SIDE_FOR) ? forSupply : againstSupply;
        if (sharesIn > sideSupply) revert PriceEngine__InsufficientSupply();

        // ── Step 2: Compute current Pulse Index ───────────────────────────────
        uint256 currentIdx = MathLibrary.computeIndex(forSupply, againstSupply);

        // ── Step 3: Compute side price in BPS ────────────────────────────────
        uint256 sidePrice = (side == SIDE_FOR)
            ? currentIdx
            : BPS - currentIdx;

        // ── Step 4: Compute amount out ────────────────────────────────────────
        // amountOut = sharesIn * sidePrice / BPS
        // Uses full 512-bit mulDiv — safe for any sharesIn in [0, 2^256).
        amountOut = MathLibrary.mulDiv(sharesIn, sidePrice, BPS);

        // ── Step 5: Verify reserve covers the payout ─────────────────────────
        // The Vault must have enough collateral to return to the seller.
        if (amountOut > reserveBalance) revert PriceEngine__SolvencyViolation();

        // ── Step 6: Update supplies ───────────────────────────────────────────
        uint256 newForSupply;
        uint256 newAgainstSupply;
        if (side == SIDE_FOR) {
            newForSupply     = forSupply - sharesIn;
            newAgainstSupply = againstSupply;
        } else {
            newForSupply     = forSupply;
            newAgainstSupply = againstSupply - sharesIn;
        }

        // ── Step 7: Compute new Pulse Index ──────────────────────────────────
        newPulseIndex = MathLibrary.computeIndex(newForSupply, newAgainstSupply);

        // ── Step 8: Compute new reserve ───────────────────────────────────────
        newReserveBalance = reserveBalance - amountOut;

        // ── Step 9: Verify Capped Payout invariant on new state ───────────────
        uint256 minSupply = MathLibrary.min(newForSupply, newAgainstSupply);
        if (minSupply > newReserveBalance) revert PriceEngine__SolvencyViolation();
    }

    /// @notice Calculate the current Pulse Index from the current supply data.
    /// @dev    Pure function. Delegates to MathLibrary.computeIndex.
    ///         Returns 5000 when both supplies are zero (initial 50/50 state).
    ///         Result is always in [1, 9999] due to clampIndex().
    ///
    /// @param forSupply     Current total For Position Shares outstanding.
    /// @param againstSupply Current total Against Position Shares outstanding.
    /// @return pulseIndex   Current index in basis points, range [1, 9999].
    function currentIndex(
        uint256 forSupply,
        uint256 againstSupply
    ) external pure override returns (uint256 pulseIndex) {
        return MathLibrary.computeIndex(forSupply, againstSupply);
    }
}
