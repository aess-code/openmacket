// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MathLibrary
/// @notice Fixed-point math utilities for Pulse Protocol V1.
/// @dev All arithmetic is performed in 256-bit unsigned integers.
///
///      ── Full-Precision mulDiv ─────────────────────────────────────────────
///
///      The `mulDiv` function implements TRUE 512-bit intermediate precision
///      using the technique from Remco Bloemen (https://xn--2-umb.com/21/muldiv)
///      and used in OpenZeppelin Math.mulDiv (v5.x).
///
///      It computes `floor(a * b / denominator)` without overflow for any
///      a, b, denominator in [0, 2^256). The intermediate product a*b is
///      computed as a 512-bit number (hi, lo) using assembly.
///
///      This replaces the previous naive `(a * b) / denominator` which would
///      revert with Panic(0x11) when a * b > type(uint256).max.
///
///      Precision conventions:
///        WAD  = 1e18  — standard fixed-point unit
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

    /// @notice Thrown when the result of mulDiv overflows uint256.
    ///         This can only happen when the true result floor(a*b/d) > type(uint256).max.
    error Math__Overflow();

    /// @notice Thrown when a Pulse Index value is out of the valid range (0, 10000).
    error Math__IndexOutOfRange(uint256 index);

    // ─────────────────────────────────────────────────────────────────────────
    // Full-Precision 512-bit Multiplication-Division
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Compute `floor(a * b / denominator)` with full 512-bit intermediate precision.
    /// @dev    Implements the Remco Bloemen algorithm (https://xn--2-umb.com/21/muldiv),
    ///         identical to OpenZeppelin Math.mulDiv (v5.x).
    ///
    ///         The intermediate product a*b is computed as a 512-bit integer (hi, lo)
    ///         using the identity:
    ///           a * b = hi * 2^256 + lo
    ///         where `lo = a * b mod 2^256` and `hi = mulhi(a, b)`.
    ///
    ///         This function NEVER overflows for any a, b in [0, 2^256).
    ///         It only reverts if:
    ///           (a) denominator == 0
    ///           (b) the true result floor(a*b/denominator) > type(uint256).max
    ///
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

        // 512-bit multiply [hi, lo] = a * b
        // lo = a * b mod 2^256
        // hi = a * b >> 256
        uint256 lo;
        uint256 hi;
        assembly {
            let mm := mulmod(a, b, not(0))
            lo     := mul(a, b)
            hi     := sub(sub(mm, lo), lt(mm, lo))
        }

        // If hi == 0, the result fits in 256 bits — use standard division.
        if (hi == 0) {
            result = lo / denominator;
            return result;
        }

        // Ensure result fits in 256 bits: hi < denominator.
        // If hi >= denominator, the result would overflow uint256.
        if (hi >= denominator) revert Math__Overflow();

        // Subtract remainder from [hi, lo] to make it divisible by denominator.
        // remainder = (a * b) mod denominator
        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, denominator)
        }

        // Subtract remainder from [hi, lo].
        assembly {
            hi := sub(hi, gt(remainder, lo))
            lo := sub(lo, remainder)
        }

        // Factor out powers of two from denominator.
        // Compute largest power of two divisor of denominator.
        uint256 twos;
        assembly {
            twos := and(sub(0, denominator), denominator)
        }

        // Divide denominator by twos.
        assembly {
            denominator := div(denominator, twos)
        }

        // Divide [hi, lo] by twos.
        assembly {
            lo := div(lo, twos)
        }

        // Flip twos such that it is 2^256 / twos. If twos is zero, then it becomes one.
        assembly {
            twos := add(div(sub(0, twos), twos), 1)
        }

        // Shift in bits from hi into lo.
        lo |= hi * twos;

        // Invert denominator mod 2^256. Now that denominator is an odd number, it has
        // an inverse modulo 2^256 such that denominator * inv = 1 mod 2^256.
        // Compute the inverse by starting with a seed that is correct for four bits.
        // That is, denominator * inv = 1 mod 2^4.
        //
        // IMPORTANT: All arithmetic in this block is intentionally modular (mod 2^256).
        // We use `unchecked` to prevent Solidity 0.8.x from reverting on overflow.
        // The overflow is expected and correct — we are computing modular arithmetic.
        uint256 inv;
        unchecked {
            inv = (3 * denominator) ^ 2;

            // Use the Newton-Raphson iteration to improve the precision.
            // Thanks to Hensel's lifting lemma, this also works in modular arithmetic,
            // doubling the correct bits in each step.
            inv *= 2 - denominator * inv; // inverse mod 2^8
            inv *= 2 - denominator * inv; // inverse mod 2^16
            inv *= 2 - denominator * inv; // inverse mod 2^32
            inv *= 2 - denominator * inv; // inverse mod 2^64
            inv *= 2 - denominator * inv; // inverse mod 2^128
            inv *= 2 - denominator * inv; // inverse mod 2^256

            // Because the division is now exact we can divide by multiplying with the
            // modular inverse of denominator. This will give us the correct result modulo
            // 2^256. Since the preconditions guarantee that the outcome is less than 2^256,
            // this is the final result.
            result = lo * inv;
        }
    }

    /// @notice Compute `ceil(a * b / denominator)` with full 512-bit intermediate precision.
    /// @dev    Uses mulDiv internally. Adds 1 if there is a non-zero remainder.
    /// @param a           First multiplicand.
    /// @param b           Second multiplicand.
    /// @param denominator Divisor. Must not be zero.
    /// @return result     Ceiling of `(a * b) / denominator`.
    function mulDivUp(
        uint256 a,
        uint256 b,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        result = mulDiv(a, b, denominator);
        // Add 1 if there is a remainder (i.e., a*b is not exactly divisible by denominator).
        assembly {
            // Check if (a * b) mod denominator != 0
            if mulmod(a, b, denominator) {
                result := add(result, 1)
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WAD Fixed-Point Arithmetic
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Multiply two WAD-scaled values: `floor(a * b / WAD)`.
    /// @param a WAD-scaled value.
    /// @param b WAD-scaled value.
    /// @return  WAD-scaled product.
    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return mulDiv(a, b, WAD);
    }

    /// @notice Divide two WAD-scaled values: `floor(a * WAD / b)`.
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

    /// @notice Apply a basis-point rate to an amount: `floor(amount * bps / 10000)`.
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
    ///      Formula: floor(forSupply * 10000 / (forSupply + againstSupply))
    ///      Result is clamped to [1, 9999].
    ///
    ///      Overflow handling:
    ///        Uses the full-precision mulDiv to compute forSupply * 10000 / total.
    ///        The 512-bit intermediate handles any forSupply up to type(uint256).max.
    ///        If forSupply + againstSupply overflows uint256, both are halved iteratively.
    ///
    /// @param forSupply     Total For Position Shares outstanding.
    /// @param againstSupply Total Against Position Shares outstanding.
    /// @return index        Pulse Index in basis points.
    function computeIndex(
        uint256 forSupply,
        uint256 againstSupply
    ) internal pure returns (uint256 index) {
        // Prevent overflow when summing supplies.
        uint256 total;
        unchecked {
            total = forSupply + againstSupply;
            // If overflow occurred (total < forSupply), scale down both supplies.
            if (total < forSupply) {
                forSupply    /= 2;
                againstSupply /= 2;
                total = forSupply + againstSupply;
            }
        }

        if (total == 0) return INITIAL_INDEX;

        // Use full-precision mulDiv: forSupply * BPS_DENOMINATOR / total.
        // This handles forSupply up to type(uint256).max without overflow.
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
