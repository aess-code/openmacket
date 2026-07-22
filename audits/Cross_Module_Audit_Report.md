# Pulse Protocol V1 — Cross Module Audit Report

**Date:** July 21, 2026  
**Auditor:** Independent Protocol Auditor (Manus AI)  
**Scope:** `PulseFactory`, `TradingEngine` (Interfaces), `FeeManager` (Interfaces), `SettlementManager` (Interfaces), `MarketVault`, `MarketVaultFactory`, `PriceEngine`, `TWAPLibrary`, `MathLibrary`, and all existing Protocol Specifications.

## Executive Summary

An independent, zero-trust architecture and code review was conducted on the completed components of Pulse Protocol V1 prior to the commencement of Stage 5 (`TradingEngine`). The audit focused on cross-module integration, state machine integrity, economic invariants, and attack surfaces. 

**Conclusion:** The protocol is **NOT READY** to proceed to Stage 5. The audit identified **2 Critical**, **4 High**, and **5 Medium** severity issues. Most notably, the fundamental solvency invariant in `PriceEngine` is mathematically incorrect, allowing the protocol to become undercollateralized. Additionally, the `MathLibrary` claims full 512-bit precision but uses native division, creating a silent DoS vector for large trades. 

All findings must be remediated before `TradingEngine` development begins.

---

## 1. Critical Findings

### [C-01] PriceEngine Solvency Invariant is Mathematically Incorrect (Protocol Insolvency)
- **Component:** `PriceEngine.sol` (lines 248, 344), Master Specification
- **Description:** The Continuous Scoring Market (CSM) model requires that the protocol can pay out the winning side at 1:1. Therefore, the maximum liability of the protocol is `max(forSupply, againstSupply)`. However, the code and the Master Specification incorrectly enforce `min(forSupply, againstSupply) <= reserveBalance`. 
- **Impact:** In an imbalanced market, the protocol can easily pass the `min()` check while being massively undercollateralized against the `max()` supply. If the heavily favored side wins, the Vault will not have enough funds to settle, resulting in a catastrophic bank run.
- **Proof of Concept:** Verified via `Audit_PoC.test.cjs`. A state with `forSupply = 1M`, `againstSupply = 1`, and `reserve = 2` passes the current check (`min(1M, 1) <= 2`), but leaves a 999,998 USDT deficit.
- **Recommendation:** Update `PriceEngine.sol` and the Master Specification to enforce `max(newForSupply, newAgainstSupply) <= newReserveBalance`.

### [C-02] MathLibrary.mulDiv() is Not Full-Precision, Causing DoS for Large Trades
- **Component:** `MathLibrary.sol` (line 69)
- **Description:** The NatSpec explicitly claims the function uses "full 512-bit intermediate precision" based on the Uniswap V3 FullMath approach. However, the implementation is a simple `(a * b) / denominator`. 
- **Impact:** Because `PriceEngine` scales inputs by `BPS` (10,000), any `amountIn` greater than `type(uint256).max / 10000` (approx. $1.15 \times 10^{67}$ USDT) will revert with a `Panic(0x11)` arithmetic overflow. While the threshold is high for 6-decimal USDT, it breaks the mathematical guarantee of the protocol and creates a silent DoS vector for tokens with 18 decimals or large supplies.
- **Proof of Concept:** Verified via `Audit_PoC.test.cjs`.
- **Recommendation:** Replace the implementation with a true 512-bit intermediate `mulDiv` using assembly (e.g., OpenZeppelin's `Math.mulDiv`).

---

## 2. High Findings

### [H-01] Vault.deposit() Creates Hidden Coupling with TradingEngine
- **Component:** `MarketVault.sol` (line 190), `ITradingEngine.sol`
- **Description:** `MarketVault.deposit()` calls `safeTransferFrom(msg.sender, address(this), amount)`. Since `msg.sender` is the `TradingEngine`, this requires the `TradingEngine` to first pull tokens from the user, and then approve the Vault to pull from itself. 
- **Impact:** This two-step transfer is gas-inefficient and creates a hidden integration requirement not documented in the interfaces. If `TradingEngine` pulls directly from the user to the Vault (the standard pattern), calling `deposit()` will fail.
- **Recommendation:** Modify `MarketVault.deposit()` to accept no token transfers itself. The `TradingEngine` should transfer tokens directly from the user to the Vault, and then call `deposit(amount)` purely to update the Vault's internal accounting (`totalDeposits += amount`).

### [H-02] TWAP Zero-Snapshot Fallback Enables Settlement Manipulation
- **Component:** `TWAPLibrary.sol` (lines 155-160)
- **Description:** If zero snapshots are recorded during the 30-minute settlement window, `finaliseTWAP()` defaults to `5000` (a Draw). 
- **Impact:** An attacker with a large losing position can manipulate the network (e.g., via DoS, front-running, or simply exploiting an illiquid market) to prevent any trades in the final 30 minutes. This forces a Draw, allowing the attacker to receive a proportional refund instead of losing their collateral.
- **Recommendation:** Instead of defaulting to `5000`, the TWAP should fall back to the last recorded `Pulse Index` prior to the settlement window. If no trades ever occurred, then defaulting to `5000` is acceptable.

### [H-03] Missing Minimum EndTime Constraint in Factory
- **Component:** `IPulseFactory.sol`
- **Description:** The interface allows creating a View with `endTime` just 1 second after `startTime`. 
- **Impact:** A 1-second duration means the 30-minute settlement window begins in the past. No TWAP snapshots can ever be recorded, guaranteeing a Draw outcome. This can be used for griefing or farming protocol activity metrics risk-free.
- **Proof of Concept:** Verified via `Audit_PoC.test.cjs`.
- **Recommendation:** Enforce `endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION` in `PulseFactory`.

### [H-04] PriceEngine Documentation Contradicts Implementation
- **Component:** `PriceEngine.sol`
- **Description:** The NatSpec for `quoteBuy` explicitly states `max(newForSupply, newAgainstSupply) <= newReserve`, but the code executes `min()`. 
- **Impact:** Documentation mismatches on critical invariants lead to flawed downstream integrations (e.g., TradingEngine trusting the NatSpec instead of the code).
- **Recommendation:** Fix the code to match the `max()` NatSpec (resolves C-01).

---

## 3. Medium Findings

### [M-01] computeIndex() Scale-Down Introduces Precision Loss
- **Component:** `MathLibrary.sol` (lines 166-188)
- **Description:** To prevent overflow, `forSupply` and `total` are divided by a `scale` factor. However, dividing `total` directly loses the relationship `total = forSupply + againstSupply`. 
- **Recommendation:** Scale `forSupply` and `againstSupply` individually, then recompute `total`.

### [M-02] Missing Settlement Rule Versioning in Factory Registry
- **Component:** `IPulseFactory.sol` (ViewRecord struct)
- **Description:** The `ViewRecord` freezes the `FeeConfig` and `PriceEngine`, but does not freeze the settlement rules. If `SettlementManager` is upgraded, historical Views will be evaluated under new rules.
- **Recommendation:** Add a `settlementRuleVersion` or `settlementManager` snapshot to `ViewRecord`.

### [M-03] Vault Lacks Defense-in-Depth for Market Status
- **Component:** `MarketVault.sol`
- **Description:** The Vault blindly accepts `deposit()` and `withdraw()` calls regardless of whether the market is `LOCKED` or `CLAIMABLE`. It relies entirely on `TradingEngine` to enforce status checks.
- **Recommendation:** While architecturally acceptable under the "Shared Logic" model, it represents a single point of failure. Consider adding a status check callback, though this increases gas. Acknowledged as a design trade-off.

### [M-04] TWAPLibrary weightedSum Uses Native Multiplication
- **Component:** `TWAPLibrary.sol` (line 184)
- **Description:** `weightedSum += pulseIndex * duration` uses native multiplication, violating the Protocol Security Standard §5 which mandates `mulDiv` for all math. While practically safe from overflow, it breaks protocol consistency.
- **Recommendation:** Standardize arithmetic operations.

### [M-05] ISettlementManager.claimReward() Payout Ambiguity
- **Component:** `ISettlementManager.sol`
- **Description:** NatSpec claims "Anyone may call on behalf of a user (payout always goes to the position holder)." However, the signature `claimReward(uint256 viewId)` implies the caller (`msg.sender`) is the claimant. 
- **Recommendation:** Change signature to `claimReward(uint256 viewId, address user)` to allow true permissionless cranking.

---

## 4. Invariant List (Updated & Corrected)

The following invariants MUST hold permanently. The current codebase violates #1.

1. **Strict Solvency:** `max(ForSupply, AgainstSupply) <= VaultReserve`
2. **Capital Conservation:** `Vault.balance() >= Vault.totalDeposits - Vault.totalWithdrawals - Vault.totalSettled`
3. **Pulse Index Bounds:** `0 < PulseIndex < 10000`
4. **TWAP Monotonicity:** `TWAPState.count <= 30` and timestamps must be strictly increasing.
5. **Fee Pull-Only:** `FeeManager` never initiates `transfer()`.
6. **Immutable Registry:** `PulseFactory.getView(id)` returns identical data from creation to eternity.

---

## 5. Integration Readiness Conclusion

**Status:** REJECTED for Stage 5.

If `TradingEngine` development begins now, it will integrate with a mathematically flawed `PriceEngine` and an ambiguous `MarketVault` deposit flow. This will result in massive rework once the insolvency bug is triggered in integration testing.

**Mandatory Action Plan before Stage 5:**
1. Fix `PriceEngine.sol` solvency check (`min` → `max`).
2. Fix `MathLibrary.sol` to use true 512-bit `mulDiv`.
3. Fix `MarketVault.sol` deposit flow to not execute `transferFrom`.
4. Fix `TWAPLibrary.sol` zero-snapshot fallback logic.
5. Update the Master Specification to reflect these architectural corrections.
6. Re-run all tests to ensure fixes do not break existing coverage.
