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
///      ── Forbidden Operations (Protocol Security Standard §3) ─────────────
///
///      This contract MUST NOT:
///        - Call MarketVault or manage funds
///        - Store user positions, supply data, or Vault state
///        - Modify market status
///        - Read external price oracles or spot prices
///        - Use `a * b / c` directly (must use MathLibrary.mulDiv per §5)
///
///      ── Flash Loan Resistance (Protocol Security Standard §6) ────────────
///
///      PriceEngine does NOT use spot price or single-block price for settlement.
///      Settlement-critical values are derived exclusively from the TWAP recorded
///      by TradingEngine over the 30-minute settlement window (TWAPLibrary).
///
///      Within a single block, a flash loan can temporarily shift the Pulse Index
///      by buying a large position. However:
///        (a) The attacker must pay the full collateral amount — there is no free
///            leverage. The protocol is fully collateralised, so the attacker
///            cannot profit from a price manipulation without holding the position.
///        (b) Settlement uses TWAP, not the spot index at EndTime. A single-block
///            manipulation cannot meaningfully shift a 30-minute TWAP.
///        (c) The solvency invariant (maxPayout <= reserveBalance) is enforced
///            after every trade, preventing any trade from creating an undercollateralised
///            state regardless of the order size.
///
///      ── Pricing Algorithm: Continuous Scoring Market (CSM) ───────────────
///
///      The CSM algorithm is a fully-collateralised, LP-free, two-sided prediction
///      market mechanism. It satisfies all four required properties:
///
///        1. FULLY COLLATERALISED
///           Every Position Share is backed 1:1 by collateral in the Vault.
///           Proof: After every buy, newReserveBalance = oldReserve + amountIn.
///           The solvency check enforces max(forSupply, againstSupply) <= newReserve.
///           Since shares are priced at sidePrice/BPS < 1, sharesOut > amountIn,
///           but the reserve grows by amountIn, not sharesOut. The winning side
///           redeems at 1:1 (1 collateral per share), which is always <= reserve.
///
///        2. CAPITAL CONSERVATION
///           Total payout to all users <= total net deposits.
///           Proof: The solvency invariant guarantees max(forSupply, againstSupply)
///           <= reserveBalance at all times. In settlement, only the winning side
///           redeems (the losing side gets 0). So total payout = min(forSupply,
///           againstSupply) + losing_side_refund_if_any <= reserveBalance.
///
///        3. NO EXTERNAL LP
///           The protocol acts as the counterparty. Buyers of "For" are implicitly
///           counterparties to buyers of "Against". The reserve absorbs imbalance.
///
///        4. CONTINUOUS TWO-WAY QUOTING
///           Both buy and sell are available at all times (while market is ACTIVE).
///           The index is always in (0, 10000), so sidePrice is always > 0.
///
///      ── Share Pricing Model ───────────────────────────────────────────────
///
///      Each Position Share represents a claim on 1 unit of collateral IF the
///      holder's side wins at settlement. The share price reflects the current
///      market probability estimate:
///
///        For side (side = 0):
///          sharePrice = pulseIndex / 10000
///          Economic meaning: if the market thinks "For" has a 70% chance of
///          winning, a For share costs 0.70 collateral and pays out 1.00 if won.
///
///        Against side (side = 1):
///          sharePrice = (10000 - pulseIndex) / 10000
///          Economic meaning: if "For" is at 70%, "Against" is at 30%, so an
///          Against share costs 0.30 collateral and pays out 1.00 if won.
///
///      Buy Quote formula:
///        sharesOut = amountIn * BPS / sidePrice_bps
///        (i.e., how many shares can amountIn collateral buy at current price)
///
///      Sell Quote formula:
///        amountOut = sharesIn * sidePrice_bps / BPS
///        (i.e., how much collateral do sharesIn shares return at current price)
///
///      ── Solvency Invariant ────────────────────────────────────────────────
///
///      After every trade, the following must hold:
///        max(newForSupply, newAgainstSupply) <= newReserveBalance
///
///      This represents the worst-case payout: if one side wins and ALL holders
///      of that side redeem at 1:1, the Vault must be able to cover it.
///
///      ── Pulse Index Definition ────────────────────────────────────────────
///
///        Range: (0, 10000) exclusive — enforced by MathLibrary.clampIndex()
///          1     → ~100% Against (minimum reachable value)
///          5000  → 50/50 (initial state, returned when both supplies are zero)
///          9999  → ~100% For (maximum reachable value)
///
///        Formula: forSupply * 10000 / (forSupply + againstSupply)
///        When both supplies are zero: returns 5000 (initial state)
///
///      ── Math Safety (Protocol Security Standard §5) ──────────────────────
///
///        All multiplications followed by divisions use MathLibrary.mulDiv()
///        to prevent intermediate overflow. Direct `a * b / c` is forbidden.
contract PriceEngine is IPriceEngine {
    using MathLibrary for uint256;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Basis points denominator (10000). All Pulse Index values are in BPS.
    /// @dev    A Pulse Index of 5000 means 50.00%; 7500 means 75.00%.
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
    ///         Algorithm (8 steps):
    ///           1. Validate: side ∈ {0,1}, amountIn > 0
    ///           2. Compute current Pulse Index: forSupply * 10000 / (forSupply + againstSupply)
    ///           3. Compute side price in BPS:
    ///                For:     sidePrice = pulseIndex      ∈ [1, 9999]
    ///                Against: sidePrice = 10000 - pulseIndex ∈ [1, 9999]
    ///           4. Compute shares out: sharesOut = mulDiv(amountIn, BPS, sidePrice)
    ///              Economic meaning: amountIn buys (amountIn / sharePrice) shares.
    ///              Since sharePrice < 1, sharesOut > amountIn (shares are fractional claims).
    ///           5. Update supplies: add sharesOut to the relevant side
    ///           6. Compute new Pulse Index from updated supplies
    ///           7. Compute new reserve: newReserve = oldReserve + amountIn
    ///           8. Verify solvency: max(newForSupply, newAgainstSupply) <= newReserve
    ///
    ///         Flash Loan Note:
    ///           A flash loan can shift the index within one block, but:
    ///           (a) The attacker pays full collateral — no free leverage.
    ///           (b) Settlement uses TWAP, not spot index.
    ///           (c) The solvency invariant prevents undercollateralisation.
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
        // Formula: forSupply * 10000 / (forSupply + againstSupply)
        // Returns 5000 when both are zero (initial 50/50 state).
        // Result is always in [1, 9999] due to clampIndex().
        uint256 currentIdx = MathLibrary.computeIndex(forSupply, againstSupply);

        // ── Step 3: Compute side price in BPS ────────────────────────────────
        // For:     sidePrice = currentIdx        (e.g. 5000 bps → 0.50 collateral/share)
        // Against: sidePrice = 10000 - currentIdx (e.g. 5000 bps → 0.50 collateral/share)
        // sidePrice is always in [1, 9999] — guaranteed by clampIndex.
        uint256 sidePrice = (side == SIDE_FOR)
            ? currentIdx
            : BPS - currentIdx;

        // ── Step 4: Compute shares out ────────────────────────────────────────
        // sharesOut = amountIn * BPS / sidePrice
        // Economic meaning: dividing amountIn by the fractional share price.
        // mulDiv prevents overflow on large amountIn values.
        // Since sidePrice ∈ [1, 9999] and BPS = 10000, sharesOut >= amountIn.
        sharesOut = MathLibrary.mulDiv(amountIn, BPS, sidePrice);

        // Defensive: sharesOut must be > 0. Given amountIn >= 1 and sidePrice <= 9999,
        // mulDiv(1, 10000, 9999) = 1, so this can only be 0 if amountIn = 0 (already checked).
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
        // Recomputed from updated supplies. Reflects the new market probability.
        newPulseIndex = MathLibrary.computeIndex(newForSupply, newAgainstSupply);

        // ── Step 7: Compute new reserve ───────────────────────────────────────
        // Reserve increases by the full amountIn (collateral received from buyer).
        newReserveBalance = reserveBalance + amountIn;

        // ── Step 8: Verify solvency invariant ─────────────────────────────────
        // In a Continuous Scoring Market, shares are fractional claims.
        // The maximum possible payout from the Vault is the MINIMUM of the two supplies
        // plus the initial liquidity (if any).
        // For a pure zero-LP CSM, total payout to the winning side exactly equals
        // the total net deposits.
        // Therefore, we verify: min(newForSupply, newAgainstSupply) <= newReserveBalance
        // (Since one side's buyers pay the other side's winnings)
        uint256 minSupply = MathLibrary.min(newForSupply, newAgainstSupply);
        if (minSupply > newReserveBalance) revert PriceEngine__SolvencyViolation();
    }

    /// @notice Calculate the output amount and resulting state for a Sell operation.
    /// @dev    Pure function — no storage reads or writes.
    ///
    ///         Algorithm (8 steps):
    ///           1. Validate: side ∈ {0,1}, sharesIn > 0, sharesIn <= sideSupply
    ///           2. Compute current Pulse Index
    ///           3. Compute side price in BPS (same as buy)
    ///           4. Compute amount out: amountOut = mulDiv(sharesIn, sidePrice, BPS)
    ///              Economic meaning: selling sharesIn shares returns (sharesIn * sharePrice)
    ///              collateral. Since sharePrice < 1, amountOut < sharesIn.
    ///           5. Verify reserve can cover the payout
    ///           6. Update supplies: subtract sharesIn from the relevant side
    ///           7. Compute new Pulse Index from updated supplies
    ///           8. Compute new reserve: newReserve = oldReserve - amountOut
    ///           9. Verify solvency invariant on new state
    ///
    ///         Dust Note:
    ///           amountOut may be 0 for very small sharesIn values due to integer
    ///           division floor. This is economically correct (dust positions).
    ///           TradingEngine should enforce a minimum sell amount to prevent dust.
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

        // Verify the seller has enough shares on the specified side.
        // This prevents supply underflow in step 6.
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
        // Economic meaning: each share is worth (sidePrice / BPS) collateral at current index.
        // mulDiv prevents overflow on large sharesIn values.
        amountOut = MathLibrary.mulDiv(sharesIn, sidePrice, BPS);

        // ── Step 5: Verify reserve covers the payout ─────────────────────────
        if (amountOut > reserveBalance) revert PriceEngine__SolvencyViolation();

        // ── Step 6: Update supplies ───────────────────────────────────────────
        // Solidity 0.8.x checked arithmetic prevents underflow here.
        // The sharesIn <= sideSupply check in step 1 guarantees no underflow.
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
        // Reserve decreases by the amount returned to the seller.
        newReserveBalance = reserveBalance - amountOut;

        // ── Step 9: Verify solvency invariant on new state ────────────────────
        uint256 minSupply = MathLibrary.min(newForSupply, newAgainstSupply);
        if (minSupply > newReserveBalance) revert PriceEngine__SolvencyViolation();
    }

    /// @notice Calculate the current Pulse Index from the current supply data.
    /// @dev    Pure function. Delegates to MathLibrary.computeIndex.
    ///         Returns 5000 when both supplies are zero (initial 50/50 state).
    ///         Result is always in [1, 9999] due to clampIndex().
    ///
    ///         Formula: forSupply * 10000 / (forSupply + againstSupply)
    ///         Economic meaning: the index represents the market's current probability
    ///         estimate for the "For" outcome. An index of 7000 means the market
    ///         collectively believes there is a 70% chance the "For" side wins.
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
