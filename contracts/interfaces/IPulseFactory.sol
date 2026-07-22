// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPulseFactory
/// @notice Interface for the Pulse Protocol V1 factory and global Registry.
/// @dev PulseFactory is the sole entry point for creating Views.
///      It maintains the global Registry (Single Source of Truth) for all Views.
///      Factory does not handle trading, pricing, fees, or settlement.
///
///      Creation is atomic: any failure in initialization reverts the entire transaction.
///      Once created, a View's immutable fields (creator, type, endTime, feeConfig, etc.)
///      cannot be modified. Only the MarketStatus may advance through its lifecycle.
interface IPulseFactory {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The two supported View types in V1.
    enum ViewType {
        FIXED,      // Has a fixed EndTime; enters Settlement after EndTime
        PERMANENT   // No EndTime; never enters Settlement
    }

    /// @notice Snapshot of the fee configuration at View creation time.
    /// @dev Immutable per View. Upgrades to FeeManager do not affect existing Views.
    struct FeeConfig {
        uint256 totalBps;    // Total fee in basis points (e.g. 100 = 1.00%)
        uint256 creatorBps;  // Creator share (e.g. 50 = 0.50%)
        uint256 treasuryBps; // Treasury share (e.g. 30 = 0.30%)
        uint256 teamBps;     // Team share (e.g. 20 = 0.20%)
    }

    /// @notice Complete on-chain record for a registered View.
    /// @dev All fields except `viewId` are immutable after creation.
    ///      This record is the single source of truth for a View's economic rules.
    struct ViewRecord {
        uint256    viewId;
        address    creator;
        ViewType   viewType;
        string     metadataURI;
        bytes32    metadataHash;
        uint256    createdAt;
        uint256    startTime;
        uint256    endTime;               // 0 for PERMANENT views
        address    vault;                 // Address of the View's MarketVault
        address    priceEngine;           // Immutable PriceEngine version snapshot at creation
        address    settlementManager;     // Immutable SettlementManager snapshot at creation
        FeeConfig  feeConfig;             // Immutable fee snapshot at creation
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a new View is successfully created and registered.
    /// @param viewId    Unique identifier assigned to the View.
    /// @param creator   Address of the View creator.
    /// @param viewType  FIXED or PERMANENT.
    /// @param vault     Address of the newly deployed MarketVault.
    /// @param endTime   EndTime for FIXED views; 0 for PERMANENT views.
    event ViewCreated(
        uint256 indexed viewId,
        address indexed creator,
        ViewType        viewType,
        address         vault,
        uint256         endTime
    );

    /// @notice Emitted when a Creator registers their first View.
    /// @param creator Address of the new Creator.
    event CreatorRegistered(address indexed creator);

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when the creator address is the zero address.
    error Factory__InvalidCreator();

    /// @notice Thrown when the metadataURI is empty.
    error Factory__InvalidMetadata();

    /// @notice Thrown when the ViewType is not a valid enum value.
    error Factory__InvalidViewType();

    /// @notice Thrown when endTime <= startTime for a FIXED view, or when the
    ///         total duration is less than SETTLEMENT_WINDOW + MIN_TRADING_DURATION.
    ///         Minimum required: endTime >= startTime + 30 minutes + 30 minutes = 1 hour.
    error Factory__InvalidTimeRange();

    /// @notice Thrown when the market duration is too short to guarantee a valid settlement window.
    ///         endTime must be at least startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION.
    error Factory__DurationTooShort();

    /// @notice Thrown when endTime is non-zero for a PERMANENT view.
    error Factory__PermanentViewMustHaveZeroEndTime();

    /// @notice Thrown when a required module address (engine, settlement, etc.) is zero.
    error Factory__InvalidModuleAddress();

    /// @notice Thrown when the Vault deployment fails.
    error Factory__VaultDeploymentFailed();

    /// @notice Thrown when querying a ViewID that does not exist.
    error Factory__ViewNotFound(uint256 viewId);

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Create a new View and register it in the protocol Registry.
    /// @dev Atomically: validates parameters, generates ViewID, deploys MarketVault,
    ///      registers the View, and emits ViewCreated. Any failure reverts entirely.
    ///
    ///      Minimum Duration Constraint (Stage 4.5 Hardening):
    ///        For FIXED views, endTime must satisfy:
    ///          endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION
    ///        where SETTLEMENT_WINDOW = 30 minutes and MIN_TRADING_DURATION = 30 minutes.
    ///        This guarantees the settlement window (last 30 min) is always reachable
    ///        and there is at least 30 minutes of active trading before it.
    ///
    /// @param viewType    FIXED or PERMANENT.
    /// @param metadataURI URI pointing to off-chain metadata (IPFS/Arweave recommended).
    /// @param metadataHash Keccak256 hash of the metadata for on-chain integrity verification.
    /// @param startTime   Unix timestamp when trading opens.
    /// @param endTime     Unix timestamp when trading closes. Must be 0 for PERMANENT views.
    /// @return viewId     The unique ViewID assigned to the new View.
    function createView(
        ViewType viewType,
        string  calldata metadataURI,
        bytes32          metadataHash,
        uint256          startTime,
        uint256          endTime
    ) external returns (uint256 viewId);

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the complete ViewRecord for a given ViewID.
    /// @param viewId The ViewID to query.
    function getView(uint256 viewId) external view returns (ViewRecord memory);

    /// @notice Returns whether a ViewID exists in the Registry.
    /// @param viewId The ViewID to check.
    function exists(uint256 viewId) external view returns (bool);

    /// @notice Returns the Vault address for a given ViewID.
    /// @param viewId The ViewID to query.
    function getVault(uint256 viewId) external view returns (address vault);

    /// @notice Returns the FeeConfig snapshot for a given ViewID.
    /// @dev Used by FeeManager to apply the correct fee rates for a View.
    /// @param viewId The ViewID to query.
    function getFeeConfig(uint256 viewId) external view returns (FeeConfig memory);

    /// @notice Returns all ViewIDs created by a specific Creator.
    /// @param creator Address of the Creator.
    function getCreatorViews(address creator) external view returns (uint256[] memory viewIds);

    /// @notice Returns the total number of Views ever created.
    function totalViews() external view returns (uint256);

    /// @notice Returns the total number of unique Creators registered.
    function totalCreators() external view returns (uint256);
}
