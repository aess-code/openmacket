// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MathLibrary
/// @notice Fixed-point math utilities for Pulse Protocol V1.
/// @dev All arithmetic is performed in 256-bit unsigned integers.
///      The library uses a WAD (1e18) fixed-point representation for high-precision
///      calculations in PriceEngine and TWAP computations.
///
///      Precision conventions:
///        WAD  = 1e18  — standard fixed-point unit for price/share calculations
///        BPS  = 10000 — basis points for Pulse Index and fee rates
///
///      All functions are `internal pure` — no storage, no side effects.
library MathLibrary {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice WAD: 1e18 fixed-point unit.
    uint256 internal constant WAD = 1e18;

    /// @notice Basis points denominator (10000 = 100%).
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Maximum Pulse Index in basis points (exclusive upper bound).
    uint256 internal constant MAX_INDEX = 10_000;

    /// @notice Minimum Pulse Index in basis points (exclusive lower bound).
    uint256 internal constant MIN_INDEX = 0;

    /// @notice Initial Pulse Index (50.00% = 5000 bps).
    uint256 internal constant INITIAL_INDEX = 5_000;

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when a division by zero is attempted.
    error Math__DivisionByZero();

    /// @notice Thrown when a multiplication overflows uint256.
    error Math__Overflow();

    /// @notice Thrown when a Pulse Index value is out of the valid range (0, 10000).
    error Math__IndexOutOfRange(uint256 index);

    // ─────────────────────────────────────────────────────────────────────────
    // Full-Precision Multiplication-Division
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Compute `(a * b) / denominator` with full 512-bit intermediate precision.
    /// @dev Uses Solidity 0.8.x overflow protection. Reverts on division by zero.
    ///      This is the core building block for all fixed-point math in the protocol.
    ///      Based on the Uniswap V3 FullMath approach adapted for Solidity 0.8.x.
    /// @param a           First multiplicand.
    /// @param b           Second multiplicand.
    /// @param denominator Divisor. Must not be zero.
    /// @return result     Floor of `(a * b) / denominator`.
    function mulDiv(
        uint256 a,
        uint256 b,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        if (denominator == 0) revert Math__DivisionByZero();
        // Solidity 0.8.x reverts on overflow automatically.
        // For values that may exceed uint256, callers should scale inputs first.
        result = (a * b) / denominator;
    }

    /// @notice Compute `(a * b) / denominator` rounded up (ceiling division).
    /// @param a           First multiplicand.
    /// @param b           Second multiplicand.
    /// @param denominator Divisor. Must not be zero.
    /// @return result     Ceiling of `(a * b) / denominator`.
    function mulDivUp(
        uint256 a,
        uint256 b,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        if (denominator == 0) revert Math__DivisionByZero();
        result = (a * b + denominator - 1) / denominator;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WAD Fixed-Point Arithmetic
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Multiply two WAD-scaled values: `(a * b) / WAD`.
    /// @param a WAD-scaled value.
    /// @param b WAD-scaled value.
    /// @return  WAD-scaled product.
    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return mulDiv(a, b, WAD);
    }

    /// @notice Divide two WAD-scaled values: `(a * WAD) / b`.
    /// @param a WAD-scaled numerator.
    /// @param b WAD-scaled denominator. Must not be zero.
    /// @return  WAD-scaled quotient.
    function wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert Math__DivisionByZero();
        return mulDiv(a, WAD, b);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Basis Points Arithmetic
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Apply a basis-point rate to an amount: `(amount * bps) / 10000`.
    /// @param amount The base amount.
    /// @param bps    Rate in basis points (e.g. 100 = 1.00%).
    /// @return       The portion of `amount` corresponding to `bps`.
    function applyBps(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return mulDiv(amount, bps, BPS_DENOMINATOR);
    }

    /// @notice Deduct a basis-point fee from an amount and return both parts.
    /// @param grossAmount The gross amount before fee deduction.
    /// @param feeBps      Fee rate in basis points.
    /// @return netAmount  Amount after fee deduction.
    /// @return feeAmount  Fee portion.
    function deductBpsFee(
        uint256 grossAmount,
        uint256 feeBps
    ) internal pure returns (uint256 netAmount, uint256 feeAmount) {
        feeAmount = applyBps(grossAmount, feeBps);
        netAmount = grossAmount - feeAmount;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pulse Index Utilities
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Clamp a Pulse Index to the valid range [1, 9999].
    /// @dev The Pulse Index must always remain strictly within (0, 10000).
    ///      This function enforces the boundary without reverting, allowing
    ///      PriceEngine implementations to clamp extreme values gracefully.
    /// @param index Raw computed index.
    /// @return      Clamped index in [1, 9999].
    function clampIndex(uint256 index) internal pure returns (uint256) {
        if (index == 0) return 1;
        if (index >= MAX_INDEX) return MAX_INDEX - 1;
        return index;
    }

    /// @notice Validate that a Pulse Index is within the strict open range (0, 10000).
    /// @dev Reverts if the index is 0 or >= 10000.
    /// @param index The Pulse Index to validate.
    function validateIndex(uint256 index) internal pure {
        if (index == 0 || index >= MAX_INDEX) revert Math__IndexOutOfRange(index);
    }

    /// @notice Calculate the Pulse Index from For and Against supply.
    /// @dev When both supplies are zero (initial state), returns INITIAL_INDEX (5000).
    ///      Formula: forSupply * 10000 / (forSupply + againstSupply)
    ///      Result is clamped to [1, 9999].
    /// @param forSupply     Total For Position Shares outstanding.
    /// @param againstSupply Total Against Position Shares outstanding.
    /// @return index        Pulse Index in basis points.
    function computeIndex(
        uint256 forSupply,
        uint256 againstSupply
    ) internal pure returns (uint256 index) {
        // Prevent overflow when summing supplies
        uint256 total;
        unchecked {
            total = forSupply + againstSupply;
            if (total < forSupply) {
                // If overflow occurs, scale down by 2 until it doesn't overflow
                forSupply /= 2;
                againstSupply /= 2;
                total = forSupply + againstSupply;
            }
        }
        if (total == 0) return INITIAL_INDEX;
        
        // Prevent overflow in mulDiv: forSupply * BPS_DENOMINATOR
        // If forSupply is near MaxUint256, multiplying by 10000 will overflow.
        // We scale down both forSupply and total if necessary.
        uint256 maxSafe = type(uint256).max / BPS_DENOMINATOR;
        if (forSupply > maxSafe) {
            uint256 scale = (forSupply / maxSafe) + 1;
            forSupply /= scale;
            total /= scale;
            if (total == 0) return INITIAL_INDEX; // Edge case
        }
        
        index = mulDiv(forSupply, BPS_DENOMINATOR, total);
        return clampIndex(index);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Safe Arithmetic Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Return the minimum of two values.
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @notice Return the maximum of two values.
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /// @notice Safe subtraction that returns 0 instead of reverting on underflow.
    /// @dev Useful for computing time deltas and balance differences.
    function subOrZero(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }
}
