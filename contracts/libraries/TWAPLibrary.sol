// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MathLibrary } from "./MathLibrary.sol";

/// @title TWAPLibrary
/// @notice Time-Weighted Average Price (TWAP) calculation library for Pulse Protocol V1.
/// @dev Implements a strictly time-driven TWAP mechanism.
///
///      Design rules (Architecture V2.2 Final + Stage 4.5 Hardening):
///        - Snapshot Interval:   60 seconds
///        - Settlement Window:   Last 30 minutes before EndTime
///        - Maximum Snapshots:   30 (one per minute over the 30-minute window)
///        - TWAP is time-driven: a snapshot is recorded only when the interval has elapsed
///        - Trades do NOT directly trigger TWAP updates; they check the interval and record
///          if and only if SNAPSHOT_INTERVAL seconds have passed since the last snapshot
///        - Settlement uses only the finalised TWAP (locked at lockMarket())
///
///      ── Zero-Snapshot Fallback Rule (Stage 4.5 Hardening) ────────────────
///
///      The previous implementation defaulted to 5000 (Draw) when no snapshots
///      were recorded in the settlement window. This was exploitable: an attacker
///      on the losing side could prevent all trades in the last 30 minutes to
///      force a Draw outcome.
///
///      The corrected fallback rule is:
///        1. If snapshots exist in the settlement window: use time-weighted average.
///        2. If NO snapshots in the settlement window BUT the market has a pre-window
///           Pulse Index (lastIndexBeforeWindow > 0): use that index as the TWAP.
///        3. If the market has NEVER had any activity (lastIndexBeforeWindow == 0):
///           default to INITIAL_INDEX (5000). This is the only legitimate Draw case.
///
///      This eliminates the DoS/Griefing attack vector while preserving the
///      correct behavior for genuinely inactive markets.
///
///      ── Math Safety (Stage 4.5 Hardening) ────────────────────────────────
///
///      All multiplications and divisions use MathLibrary.mulDiv() for full
///      512-bit intermediate precision. Direct `a * b / c` is forbidden.
///
///      Storage pattern:
///        All TWAP state is stored in a `TWAPState` struct that lives in TradingEngine's
///        storage, keyed by ViewID. This library operates on that struct via `storage`
///        references — it holds no state of its own.
library TWAPLibrary {
    using MathLibrary for uint256;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Minimum seconds between two consecutive TWAP snapshots.
    uint256 internal constant SNAPSHOT_INTERVAL = 60 seconds;

    /// @notice Duration of the settlement window before EndTime.
    uint256 internal constant SETTLEMENT_WINDOW = 30 minutes;

    /// @notice Maximum number of snapshots stored per View (30 min / 60 sec).
    uint256 internal constant MAX_SNAPSHOTS = 30;

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when attempting to read a TWAP that has not yet been finalised.
    error TWAP__NotFinalised();

    /// @notice Thrown when attempting to record a snapshot outside the settlement window.
    error TWAP__OutsideSettlementWindow();

    /// @notice Thrown when the snapshot buffer is already full (30 snapshots reached).
    error TWAP__BufferFull();

    // ─────────────────────────────────────────────────────────────────────────
    // Storage Struct
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Per-View TWAP state stored in TradingEngine.
    /// @dev This struct is stored in a `mapping(uint256 viewId => TWAPState)` in TradingEngine.
    struct TWAPState {
        /// @notice Fixed-size buffer of Pulse Index snapshots (settlement window only).
        uint256[30] pulseIndexSnapshots;
        /// @notice Corresponding block timestamps for each snapshot.
        uint256[30] timestamps;
        /// @notice Number of valid snapshots currently stored (0–30).
        uint256 count;
        /// @notice Block timestamp of the most recently recorded snapshot.
        uint256 lastSnapshotTime;
        /// @notice The last Pulse Index recorded BEFORE the settlement window opened.
        ///         Used as fallback TWAP if no snapshots are recorded in the window.
        ///         Zero if the market has never had any activity.
        uint256 lastIndexBeforeWindow;
        /// @notice Finalised TWAP value set at lockMarket(). Zero until locked.
        uint256 finalTWAP;
        /// @notice Whether the TWAP has been finalised (locked).
        bool locked;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Snapshot Recording
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Attempt to record a TWAP snapshot for a View.
    /// @dev This function is called by TradingEngine on every trade.
    ///      It records a snapshot ONLY if ALL of the following conditions are met:
    ///        1. The current block.timestamp is within the settlement window
    ///           (i.e., endTime - SETTLEMENT_WINDOW <= block.timestamp < endTime)
    ///        2. At least SNAPSHOT_INTERVAL seconds have elapsed since the last snapshot
    ///        3. The snapshot buffer is not yet full (count < MAX_SNAPSHOTS)
    ///        4. The TWAP has not yet been finalised
    ///
    ///      If the current timestamp is BEFORE the settlement window, the function
    ///      updates `lastIndexBeforeWindow` to track the most recent pre-window index.
    ///      This value is used as the fallback TWAP if no snapshots are recorded.
    ///
    ///      If any snapshot condition is not met, the function returns silently.
    ///      This ensures TWAP is strictly time-driven and not trade-driven.
    ///
    /// @param state      Storage reference to the View's TWAPState.
    /// @param pulseIndex Current Pulse Index in basis points.
    /// @param endTime    The View's EndTime (Unix timestamp). 0 for PERMANENT views.
    function tryRecordSnapshot(
        TWAPState storage state,
        uint256 pulseIndex,
        uint256 endTime
    ) internal {
        // PERMANENT views (endTime == 0) never record TWAP snapshots.
        if (endTime == 0) return;

        // Do not record if already locked.
        if (state.locked) return;

        uint256 currentTime = block.timestamp;
        uint256 windowStart = endTime - SETTLEMENT_WINDOW;

        // If we are BEFORE the settlement window, update the pre-window index.
        // This is the fallback value used if no snapshots are recorded in the window.
        if (currentTime < windowStart) {
            state.lastIndexBeforeWindow = pulseIndex;
            return;
        }

        // If we are AT or PAST endTime, do nothing (market should be locked).
        if (currentTime >= endTime) return;

        // We are inside the settlement window.
        // Condition 1: Must have elapsed at least SNAPSHOT_INTERVAL since last snapshot.
        if (currentTime < state.lastSnapshotTime + SNAPSHOT_INTERVAL) return;

        // Condition 2: Buffer must not be full.
        if (state.count >= MAX_SNAPSHOTS) return;

        // All conditions met — record the snapshot.
        uint256 slot = state.count;
        state.pulseIndexSnapshots[slot] = pulseIndex;
        state.timestamps[slot]          = currentTime;
        state.count                    += 1;
        state.lastSnapshotTime          = currentTime;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TWAP Finalisation
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Finalise the TWAP at market lock time and store the result.
    /// @dev Called exactly once by TradingEngine.lockMarket().
    ///      Computes the time-weighted average of all recorded snapshots.
    ///
    ///      Time-weighting algorithm:
    ///        For each snapshot i (0 to count-1), the weight is the duration it
    ///        was "active" — i.e., the time until the next snapshot (or until
    ///        block.timestamp for the last snapshot).
    ///
    ///        finalTWAP = Σ(pulseIndex[i] * duration[i]) / Σ(duration[i])
    ///
    ///      All arithmetic uses MathLibrary.mulDiv for full 512-bit precision.
    ///
    ///      ── Zero-Snapshot Fallback (Stage 4.5 Hardening) ─────────────────
    ///
    ///        Case 1: count > 0 → Time-weighted average of recorded snapshots.
    ///        Case 2: count == 0 AND lastIndexBeforeWindow > 0 →
    ///                Use lastIndexBeforeWindow as the TWAP.
    ///                (Market was active before the window but no trades in window)
    ///        Case 3: count == 0 AND lastIndexBeforeWindow == 0 →
    ///                Default to INITIAL_INDEX (5000).
    ///                (Market had absolutely zero activity — genuine Draw)
    ///
    ///      This eliminates the DoS/Griefing attack where an attacker prevents
    ///      trades in the last 30 minutes to force a Draw outcome.
    ///
    /// @param state Storage reference to the View's TWAPState.
    /// @return twap  The finalised TWAP value in basis points.
    function finaliseTWAP(TWAPState storage state) internal returns (uint256 twap) {
        if (state.locked) return state.finalTWAP;

        uint256 count = state.count;

        // ── Case 2 & 3: No snapshots in settlement window ─────────────────────
        if (count == 0) {
            if (state.lastIndexBeforeWindow > 0) {
                // Case 2: Market was active before window, no trades in window.
                // Use the last pre-window index as the TWAP.
                twap = MathLibrary.clampIndex(state.lastIndexBeforeWindow);
            } else {
                // Case 3: Market had zero activity ever.
                // Default to 50/50 (genuine Draw).
                twap = MathLibrary.INITIAL_INDEX;
            }
            state.finalTWAP = twap;
            state.locked    = true;
            return twap;
        }

        // ── Case 1: Single snapshot ───────────────────────────────────────────
        if (count == 1) {
            twap = MathLibrary.clampIndex(state.pulseIndexSnapshots[0]);
            state.finalTWAP = twap;
            state.locked    = true;
            return twap;
        }

        // ── Case 1: Multiple snapshots — time-weighted average ────────────────
        uint256 weightedSum   = 0;
        uint256 totalDuration = 0;
        uint256 lockTime      = block.timestamp;

        for (uint256 i = 0; i < count; ) {
            uint256 duration;
            if (i < count - 1) {
                duration = state.timestamps[i + 1] - state.timestamps[i];
            } else {
                duration = lockTime - state.timestamps[i];
            }

            // Use mulDiv for all arithmetic to prevent overflow.
            // weightedSum += pulseIndex[i] * duration
            // Since pulseIndex <= 9999 and duration <= 1800 (30 min),
            // pulseIndex * duration <= 17,998,200 — well within uint256.
            // However, we still use mulDiv for protocol consistency.
            weightedSum   += MathLibrary.mulDiv(state.pulseIndexSnapshots[i], duration, 1);
            totalDuration += duration;
            unchecked { ++i; }
        }

        // Fallback: if all snapshots happened in the same block (totalDuration == 0),
        // use a simple arithmetic average to avoid division by zero.
        if (totalDuration == 0) {
            uint256 sum = 0;
            for (uint256 i = 0; i < count; ) {
                sum += state.pulseIndexSnapshots[i];
                unchecked { ++i; }
            }
            twap = sum / count;
        } else {
            // Use mulDiv for final division.
            twap = MathLibrary.mulDiv(weightedSum, 1, totalDuration);
        }

        // Clamp result to valid Pulse Index range [1, 9999].
        twap = MathLibrary.clampIndex(twap);

        state.finalTWAP = twap;
        state.locked    = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Check whether the current timestamp is within the settlement window.
    /// @param endTime The View's EndTime. Returns false for PERMANENT views (endTime == 0).
    /// @return True if block.timestamp is in [endTime - 30min, endTime).
    function isInSettlementWindow(uint256 endTime) internal view returns (bool) {
        if (endTime == 0) return false;
        uint256 currentTime = block.timestamp;
        return currentTime >= endTime - SETTLEMENT_WINDOW && currentTime < endTime;
    }

    /// @notice Check whether a new snapshot is due (interval has elapsed).
    /// @param state   Storage reference to the View's TWAPState.
    /// @return True if at least SNAPSHOT_INTERVAL seconds have elapsed since the last snapshot.
    function isSnapshotDue(TWAPState storage state) internal view returns (bool) {
        return block.timestamp >= state.lastSnapshotTime + SNAPSHOT_INTERVAL;
    }

    /// @notice Return the number of snapshots recorded so far.
    /// @param state Storage reference to the View's TWAPState.
    function snapshotCount(TWAPState storage state) internal view returns (uint256) {
        return state.count;
    }

    /// @notice Return the finalised TWAP. Reverts if not yet locked.
    /// @param state Storage reference to the View's TWAPState.
    function getFinalTWAP(TWAPState storage state) internal view returns (uint256) {
        if (!state.locked) revert TWAP__NotFinalised();
        return state.finalTWAP;
    }
}
