// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 }          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }        from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IMarketVault }     from "../interfaces/IMarketVault.sol";

/// @title MarketVault
/// @notice Per-View isolated collateral custody vault for Pulse Protocol V1.
///
/// @dev One MarketVault is deployed per View by MarketVaultFactory.
///      It is the ONLY contract that holds user collateral.
///
///      ── Responsibility Boundary ──────────────────────────────────────────
///
///      This contract IS responsible for:
///        - Receiving collateral when users buy positions (deposit)
///        - Returning collateral when users sell positions (withdraw)
///        - Paying out settlement rewards to winners (settle)
///
///      This contract is NOT responsible for (and contains NO logic for):
///        - Position Share balances or accounting  → TradingEngine
///        - Pulse Index calculation or storage     → TradingEngine / PriceEngine
///        - TWAP recording or reading              → TradingEngine / TWAPLibrary
///        - Price Engine interaction               → TradingEngine
///        - Market state machine                  → TradingEngine
///        - Settlement decision logic             → SettlementManager
///
///      ── Authorization Model (immutable) ──────────────────────────────────
///
///        deposit() / withdraw()  → only authorizedTradingEngine
///        settle()                → only authorizedSettlementManager
///
///      Forbidden (no code path exists for):
///        - owner withdrawal
///        - admin withdrawal
///        - emergency rescue
///        - arbitrary operator
///        - upgrade proxy
///        - pause / unpause
///
///      ── Collateral Token Constraint ──────────────────────────────────────
///
///      V1 ONLY supports standard ERC20 collateral (e.g. USDT, USDC).
///      The following token types are explicitly NOT supported:
///        - Fee-on-transfer tokens: received amount != sent amount → accounting drift
///        - Rebasing tokens: balance changes without transfer → invariant violation
///        - ERC777 / callback tokens: reentrancy risk via transfer hooks
///
///      The capital conservation invariant will detect and revert on any
///      accounting drift caused by unsupported token behaviour.
///
///      ── Capital Conservation Invariant ───────────────────────────────────
///
///      After every state change, the following MUST hold:
///
///        IERC20(token).balanceOf(address(this))
///          >= totalDeposits - totalWithdrawals - totalSettled
///
///      If the actual ERC20 balance is less than the tracked net assets,
///      the transaction reverts with Vault__InvariantViolation.
///      There is no admin override or rescue mechanism.
contract MarketVault is IMarketVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable State
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IMarketVault
    /// @dev Set at construction. Immutable. Used for event indexing and audit traceability.
    uint256 public immutable override viewId;

    /// @inheritdoc IMarketVault
    /// @dev Immutable collateral token address. Cannot be changed after construction.
    ///      V1 only supports standard ERC20. Fee-on-transfer, rebasing, and callback
    ///      tokens are NOT supported.
    address public immutable override token;

    /// @notice The authorised TradingEngine address.
    /// @dev Immutable. Only this address may call deposit() and withdraw().
    ///      Set at construction by MarketVaultFactory. Cannot be changed.
    address public immutable authorizedTradingEngine;

    /// @notice The authorised SettlementManager address.
    /// @dev Immutable. Only this address may call settle().
    ///      Set at construction by MarketVaultFactory. Cannot be changed.
    address public immutable authorizedSettlementManager;

    // ─────────────────────────────────────────────────────────────────────────
    // Mutable Accounting State
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IMarketVault
    /// @dev Cumulative total of all collateral deposited via deposit().
    ///      Monotonically increasing. Never decremented.
    uint256 public override totalDeposits;

    /// @inheritdoc IMarketVault
    /// @dev Cumulative total of all collateral withdrawn via withdraw().
    ///      Monotonically increasing. Never decremented.
    uint256 public override totalWithdrawals;

    /// @inheritdoc IMarketVault
    /// @dev Cumulative total of all settlement payouts via settle().
    ///      Monotonically increasing. Never decremented.
    uint256 public override totalSettled;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deploy a new MarketVault for a specific View.
    /// @dev Called exclusively by MarketVaultFactory.
    ///      All address parameters are validated; any zero address reverts immediately.
    ///      After construction, all four immutable fields are permanently fixed.
    ///      There is no initialiser, no proxy, and no upgrade path.
    ///
    /// @param _viewId                  Unique ViewID this Vault belongs to.
    /// @param _token                   Immutable collateral token address (standard ERC20 only).
    /// @param _authorizedTradingEngine Address of the shared TradingEngine (immutable).
    /// @param _authorizedSettlement    Address of the shared SettlementManager (immutable).
    constructor(
        uint256 _viewId,
        address _token,
        address _authorizedTradingEngine,
        address _authorizedSettlement
    ) {
        if (_token                   == address(0)) revert Vault__ZeroAddress();
        if (_authorizedTradingEngine == address(0)) revert Vault__ZeroAddress();
        if (_authorizedSettlement    == address(0)) revert Vault__ZeroAddress();

        viewId                      = _viewId;
        token                       = _token;
        authorizedTradingEngine     = _authorizedTradingEngine;
        authorizedSettlementManager = _authorizedSettlement;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Restricts the function to the authorised TradingEngine only.
    ///      Reverts with Vault__UnauthorisedEngine for any other caller.
    modifier onlyTradingEngine() {
        if (msg.sender != authorizedTradingEngine) revert Vault__UnauthorisedEngine();
        _;
    }

    /// @dev Restricts the function to the authorised SettlementManager only.
    ///      Reverts with Vault__UnauthorisedSettlement for any other caller.
    modifier onlySettlementManager() {
        if (msg.sender != authorizedSettlementManager) revert Vault__UnauthorisedSettlement();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IMarketVault
    /// @dev Accounting-only function. Does NOT execute a token transfer.
    ///
    ///      ── Deposit Flow (Stage 4.5 Hardening) ──────────────────────────────
    ///
    ///      The correct deposit flow is:
    ///        1. TradingEngine calls IERC20(token).safeTransferFrom(user, vault, netAmount)
    ///           (User → Vault direct transfer)
    ///        2. TradingEngine calls vault.deposit(netAmount)
    ///           (Vault updates internal accounting: totalDeposits += amount)
    ///
    ///      This eliminates the double-transfer pattern (User → Engine → Vault) and
    ///      the hidden coupling where the Vault needed to pull from the TradingEngine.
    ///
    ///      The invariant check after accounting update verifies that the actual
    ///      ERC20 balance reflects the expected amount (detects fee-on-transfer tokens).
    ///
    ///      Checks-Effects-Interactions:
    ///        1. CHECK  — caller is TradingEngine, amount > 0
    ///        2. EFFECT — increment totalDeposits
    ///        3. VERIFY — _assertInvariant() confirms actual ERC20 balance >= tracked assets
    ///           (No Interactions step — transfer was already done by TradingEngine)
    function deposit(uint256 amount)
        external
        override
        nonReentrant
        onlyTradingEngine
    {
        // --- Checks ---
        if (amount == 0) revert Vault__ZeroAmount();

        // --- Effects ---
        totalDeposits += amount;

        // --- Verify invariant ---
        // The TradingEngine must have already transferred `amount` tokens directly
        // from the user to this Vault address before calling deposit().
        // If the actual balance does not reflect this, _assertInvariant() reverts.
        _assertInvariant();

        emit Deposited(viewId, msg.sender, amount);
    }

    /// @inheritdoc IMarketVault
    /// @dev Checks-Effects-Interactions pattern:
    ///      1. CHECK  — caller is TradingEngine, to != zero, amount > 0, balance sufficient
    ///      2. EFFECT — increment totalWithdrawals
    ///      3. INTERACT — safeTransfer(this Vault → to)
    ///      4. VERIFY — _assertInvariant()
    ///
    ///      Called by TradingEngine when a user sells their position shares.
    ///      The amount to transfer is determined by TradingEngine based on the
    ///      PriceEngine quote; this Vault does not compute or validate the amount.
    function withdraw(address to, uint256 amount)
        external
        override
        nonReentrant
        onlyTradingEngine
    {
        // --- Checks ---
        if (to     == address(0)) revert Vault__InvalidRecipient();
        if (amount == 0)          revert Vault__ZeroAmount();
        if (amount > balance())   revert Vault__InsufficientBalance();

        // --- Effects ---
        totalWithdrawals += amount;

        // --- Interactions ---
        IERC20(token).safeTransfer(to, amount);

        // --- Verify invariant ---
        _assertInvariant();

        emit Withdrawn(viewId, to, amount);
    }

    /// @inheritdoc IMarketVault
    /// @dev Checks-Effects-Interactions pattern:
    ///      1. CHECK  — caller is SettlementManager, to != zero, amount > 0, balance sufficient
    ///      2. EFFECT — increment totalSettled
    ///      3. INTERACT — safeTransfer(this Vault → to)
    ///      4. VERIFY — _assertInvariant()
    ///
    ///      Settlement idempotency (no double-claim per user) is enforced by SettlementManager
    ///      via its own claimed[user][viewId] flag. This Vault does not track per-user claims.
    ///      If SettlementManager calls settle() twice for the same user, it is SettlementManager's
    ///      bug — this Vault will simply revert on the second call if balance is insufficient.
    function settle(address to, uint256 amount)
        external
        override
        nonReentrant
        onlySettlementManager
    {
        // --- Checks ---
        if (to     == address(0)) revert Vault__InvalidRecipient();
        if (amount == 0)          revert Vault__ZeroAmount();
        if (amount > balance())   revert Vault__InsufficientBalance();

        // --- Effects ---
        totalSettled += amount;

        // --- Interactions ---
        IERC20(token).safeTransfer(to, amount);

        // --- Verify invariant ---
        _assertInvariant();

        emit Settled(viewId, to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IMarketVault
    /// @dev Returns the actual ERC20 balance held by this contract via balanceOf().
    ///      This is the ground-truth figure used by _assertInvariant().
    ///      Accounting fields (totalDeposits, totalWithdrawals, totalSettled) are for
    ///      audit and off-chain verification only.
    function balance() public view override returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Verify the capital conservation invariant after every state change.
    ///
    ///      Invariant:
    ///        actualBalance >= trackedNetAssets
    ///        where trackedNetAssets = totalDeposits - totalWithdrawals - totalSettled
    ///
    ///      The actual ERC20 balance (from balanceOf) is compared against the
    ///      tracked net assets. If actualBalance < trackedNetAssets, the transaction
    ///      reverts with Vault__InvariantViolation.
    ///
    ///      Acceptable condition: actualBalance > trackedNetAssets
    ///        This occurs when tokens are sent directly to the Vault address (donation).
    ///        Such "extra" tokens are permanently locked in the Vault — there is no
    ///        mechanism to recover them. This is intentional and acceptable for V1.
    ///
    ///      Unacceptable condition: actualBalance < trackedNetAssets
    ///        This indicates either:
    ///          (a) A fee-on-transfer or rebasing token was used (unsupported in V1)
    ///          (b) A critical accounting bug in this contract
    ///        In either case, the transaction reverts. No admin override exists.
    function _assertInvariant() internal view {
        // Invariant: balance() >= totalDeposits - totalWithdrawals - totalSettled
        //
        // Rewritten as addition to avoid Solidity 0.8.x checked-arithmetic underflow.
        // The subtraction form can panic when totalWithdrawals + totalSettled is
        // incremented (Effects) before the transfer reduces balance (Interactions),
        // because the accounting update temporarily makes the subtraction underflow.
        //
        // The addition form is mathematically equivalent and overflow-safe because
        // balance(), totalWithdrawals, and totalSettled are all bounded by the actual
        // ERC20 token supply (max uint256 / 2 in practice).
        if (balance() + totalWithdrawals + totalSettled < totalDeposits) {
            revert Vault__InvariantViolation();
        }
    }
}
