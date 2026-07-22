// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPriceEngine
/// @notice Interface for the pluggable, stateless continuous pricing algorithm.
/// @dev The PriceEngine holds NO storage. All per-View state (forSupply, againstSupply,
///      reserveBalance) is stored in TradingEngine keyed by ViewID and passed in as
///      parameters. This guarantees complete per-View state isolation by design.
///
///      Any implementation must satisfy:
///      - Initial Pulse Index: 5000 (50.00%)
///      - Continuous two-way quoting at all times (no price lockup)
///      - No external LP required
///      - Proportional Pool Distribution: Winning Shares represent a proportional claim
///        on the final Vault Reserve, NOT a fixed 1:1 redemption. Settlement formula:
///        PayoutPerShare = VaultReserve / WinningShares
///        UserReward = UserWinningShares * PayoutPerShare
///      - Capital Conservation: total payout <= total net deposits (Vault never overpays)
///      - Pulse Index always in range (0, 10000) exclusive
interface IPriceEngine {

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when the input amount is zero.
    error PriceEngine__ZeroAmount();

    /// @notice Thrown when the specified side is invalid (must be 0 or 1).
    error PriceEngine__InvalidSide();

    /// @notice Thrown when the computed output would violate the solvency invariant.
    error PriceEngine__SolvencyViolation();

    /// @notice Thrown when the user attempts to sell more shares than available supply.
    error PriceEngine__InsufficientSupply();

    // ─────────────────────────────────────────────────────────────────────────
    // Pure Computation Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Calculate the output shares and resulting state for a Buy operation.
    /// @dev Pure function — no storage reads or writes.
    /// @param forSupply      Current total For Position Shares outstanding.
    /// @param againstSupply  Current total Against Position Shares outstanding.
    /// @param reserveBalance Current virtual reserve balance used by the algorithm.
    /// @param side           Position side: 0 = For, 1 = Against.
    /// @param amountIn       Net settlement token amount after fees.
    /// @return sharesOut         Number of Position Shares minted to the buyer.
    /// @return newPulseIndex     Updated Pulse Index in basis points (0–10000).
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
        returns (
            uint256 sharesOut,
            uint256 newPulseIndex,
            uint256 newReserveBalance
        );

    /// @notice Calculate the output amount and resulting state for a Sell operation.
    /// @dev Pure function — no storage reads or writes.
    /// @param forSupply      Current total For Position Shares outstanding.
    /// @param againstSupply  Current total Against Position Shares outstanding.
    /// @param reserveBalance Current virtual reserve balance used by the algorithm.
    /// @param side           Position side: 0 = For, 1 = Against.
    /// @param sharesIn       Number of Position Shares to sell.
    /// @return amountOut         Settlement token amount returned to the seller (before fees).
    /// @return newPulseIndex     Updated Pulse Index in basis points (0–10000).
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
        returns (
            uint256 amountOut,
            uint256 newPulseIndex,
            uint256 newReserveBalance
        );

    /// @notice Calculate the current Pulse Index from the current supply data.
    /// @dev Pure function. Returns 5000 when both supplies are zero (initial state).
    /// @param forSupply     Current total For Position Shares outstanding.
    /// @param againstSupply Current total Against Position Shares outstanding.
    /// @return pulseIndex   Current index in basis points (0–10000).
    function currentIndex(
        uint256 forSupply,
        uint256 againstSupply
    ) external pure returns (uint256 pulseIndex);
}
