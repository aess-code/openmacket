// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ISettlementManager
/// @notice Interface for the protocol's market settlement and reward claim module.
/// @dev SettlementManager reads the finalised TWAP from TradingEngine and determines
///      the winner. It does not calculate prices, modify trading state, or alter rules.
///
///      Settlement rules (immutable per protocol V1):
///        TWAP > 5000 → For Wins
///        TWAP < 5000 → Against Wins
///        TWAP = 5000 → Draw (proportional refund)
interface ISettlementManager {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Possible settlement outcomes for a Fixed View.
    enum SettlementResult {
        NONE,           // Not yet settled
        FOR_WINS,       // For position holders win
        AGAINST_WINS,   // Against position holders win
        DRAW            // Proportional refund to all holders
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a market is successfully settled.
    /// @param viewId     The ViewID that was settled.
    /// @param result     The settlement outcome.
    /// @param finalTWAP  The TWAP value used to determine the result.
    event MarketSettled(
        uint256 indexed viewId,
        SettlementResult result,
        uint256 finalTWAP
    );

    /// @notice Emitted when a user claims their reward or refund.
    /// @param viewId   The ViewID the claim is for.
    /// @param user     Address of the claimant.
    /// @param amount   Amount of settlement token transferred.
    event RewardClaimed(
        uint256 indexed viewId,
        address indexed user,
        uint256 amount
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when the market is not in SETTLEMENT status.
    error Settlement__MarketNotInSettlement(uint256 viewId);

    /// @notice Thrown when the market is not in CLAIMABLE status.
    error Settlement__MarketNotClaimable(uint256 viewId);

    /// @notice Thrown when the market has already been settled.
    error Settlement__AlreadySettled(uint256 viewId);

    /// @notice Thrown when the user has already claimed their reward.
    error Settlement__AlreadyClaimed(uint256 viewId, address user);

    /// @notice Thrown when the user has no position to claim.
    error Settlement__NoPositionToClaim(uint256 viewId, address user);

    /// @notice Thrown when the TWAP data is invalid or unavailable.
    error Settlement__InvalidTWAP(uint256 viewId);

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Execute settlement for a Fixed View that has been locked.
    /// @dev Reads the finalised TWAP from TradingEngine. Determines the result
    ///      and transitions the market to CLAIMABLE. Anyone may call this.
    /// @param viewId The ViewID to settle.
    function settleMarket(uint256 viewId) external;

    /// @notice Claim reward or refund after settlement on behalf of any user.
    /// @dev Uses Checks-Effects-Interactions: claimed flag set before Vault payout.
    ///
    ///      Permissionless Crank Design (Stage 4.5 Hardening):
    ///        Anyone (Keeper, Bot, third party) may call this function for any user.
    ///        The payout is ALWAYS sent to `user` (the position holder), never to msg.sender.
    ///        This enables automated settlement bots without requiring the user to be online.
    ///
    /// @param viewId The ViewID to claim from.
    /// @param user   Address of the position holder to claim for.
    function claimReward(uint256 viewId, address user) external;

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the settlement result for a given ViewID.
    /// @param viewId The ViewID to query.
    function getSettlementResult(uint256 viewId) external view returns (SettlementResult);

    /// @notice Returns whether a specific user has already claimed their reward.
    /// @param viewId The ViewID to query.
    /// @param user   Address of the user.
    function hasClaimed(uint256 viewId, address user) external view returns (bool);

    /// @notice Calculate the claimable amount for a user without executing the claim.
    /// @param viewId The ViewID to query.
    /// @param user   Address of the user.
    /// @return amount Claimable settlement token amount. Returns 0 if nothing to claim.
    function getClaimableAmount(uint256 viewId, address user) external view returns (uint256 amount);
}
