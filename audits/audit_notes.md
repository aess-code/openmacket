# Cross Module Audit Notes (Independent Auditor)

## CRITICAL FINDINGS

### C-01: MathLibrary.mulDiv() is NOT Full-Precision — It Uses Native Overflow
**Location:** MathLibrary.sol line 69
**Code:** `result = (a * b) / denominator;`
**Issue:** The NatSpec claims "full 512-bit intermediate precision" and references the "Uniswap V3 FullMath approach". However, the actual implementation is a plain `(a * b) / denominator` which will REVERT on overflow (Solidity 0.8.x). This is NOT the same as the Uniswap V3 FullMath which uses assembly to handle 512-bit intermediates. 
**Impact:** For large values of `a` and `b`, this will revert instead of computing correctly. In PriceEngine, `sharesOut = mulDiv(amountIn, BPS, sidePrice)`. If `amountIn` is very large (e.g., near MaxUint256 / 10000), `amountIn * BPS` will overflow and revert. This is a silent DoS for large trades.
**Attack Path:** Attacker or legitimate user submits a very large buy order. Transaction reverts with arithmetic overflow, not a meaningful error.
**Fix:** Replace with actual 512-bit full-precision mulDiv (Uniswap V3 FullMath pattern using assembly).

### C-02: PriceEngine Solvency Invariant is Incorrect — min() is Wrong for CSM
**Location:** PriceEngine.sol lines 248-249 and 344-345
**Code:** `uint256 minSupply = MathLibrary.min(newForSupply, newAgainstSupply); if (minSupply > newReserveBalance) revert PriceEngine__SolvencyViolation();`
**Issue:** The comment says "The maximum possible payout from the Vault is the MINIMUM of the two supplies". This is WRONG. In a CSM, if the For side wins, ALL For holders redeem at 1:1. The payout is `forSupply` shares × 1 collateral = `forSupply`. The maximum payout is `max(forSupply, againstSupply)`, NOT `min`. The correct invariant is `max(forSupply, againstSupply) <= reserveBalance`.
**Why min() was chosen:** The developer changed from `max` to `min` during test debugging because tests were failing. The tests were then adjusted to match the wrong invariant.
**Impact:** The protocol can be put into an undercollateralised state. Example: If forSupply = 1,000,000 and againstSupply = 1, reserve = 2, the min check passes (1 <= 2), but if For wins, the protocol owes 1,000,000 and only has 2.
**Attack Path:** Buy a large amount of For shares to create extreme imbalance. The min() solvency check passes. For side wins at settlement. Protocol cannot pay out.

### C-03: TWAPLibrary.getFinalTWAP() Uses require() Instead of Custom Error
**Location:** TWAPLibrary.sol line 238
**Code:** `require(state.locked, "TWAP: not finalised");`
**Issue:** The Protocol Security Standard mandates Custom Errors throughout. This is a string-based require, which is inconsistent and wastes gas.
**Impact:** Minor gas waste, inconsistency with protocol standards.
**Fix:** Replace with `if (!state.locked) revert TWAP__NotFinalised();` and add the custom error.

## HIGH FINDINGS

### H-01: Vault.deposit() Pulls Tokens FROM TradingEngine, Not FROM User
**Location:** MarketVault.sol line 190
**Code:** `IERC20(token).safeTransferFrom(msg.sender, address(this), amount);`
**Issue:** The Vault pulls tokens from `msg.sender` which is the TradingEngine. This means the TradingEngine must have already pulled tokens from the user AND approved the Vault to pull from itself. The comment at line 169-172 acknowledges this ambiguity. This creates a hidden coupling: the TradingEngine must implement a specific two-step pattern (pull from user → approve Vault → Vault pulls from TradingEngine), which is not documented in the ITradingEngine interface.
**Impact:** If TradingEngine is implemented incorrectly (e.g., pulls from user directly to Vault without the intermediate step), the accounting will be wrong.
**Fix:** The deposit flow should be clarified in the interface. The recommended pattern is: TradingEngine pulls from user directly to Vault, then calls deposit() with amount for accounting only (no second transfer). This requires changing deposit() to not do a transfer.

### H-02: No Market Status Validation in Vault — Vault Accepts Deposits/Withdrawals Regardless of Market Status
**Location:** MarketVault.sol (all three functions)
**Issue:** The Vault has no knowledge of market status. It will accept `deposit()` calls even if the market is LOCKED or CLAIMABLE. The TradingEngine is supposed to enforce this, but the Vault provides no defense-in-depth. If the TradingEngine has a bug that allows trading in a LOCKED market, the Vault will silently accept the funds.
**Impact:** Defense-in-depth violation. The Vault should be the last line of defense.
**Mitigation:** This is acceptable IF TradingEngine is correct. But it means a single point of failure.

### H-03: TWAP Zero-Snapshot Fallback Returns 5000 (Draw) — Exploitable by Market Manipulation
**Location:** TWAPLibrary.sol lines 155-160
**Issue:** If a market has zero activity in the 30-minute settlement window, `finaliseTWAP()` returns 5000 (Draw). An attacker who controls the market can ensure no trades happen in the last 30 minutes to force a Draw outcome, regardless of the actual market state.
**Attack Path:** Attacker has a large position on the losing side. In the last 30 minutes, they prevent any trades (e.g., by front-running all trades to make them revert, or simply by the market being illiquid). TWAP defaults to 5000. Draw is declared. Attacker gets a proportional refund instead of losing.
**Impact:** Economic manipulation of settlement outcome.
**Fix:** Consider using the last recorded Pulse Index (before the settlement window) as the fallback, rather than 5000.

### H-04: PriceEngine.quoteBuy() NatSpec Contradicts Implementation (Step 8)
**Location:** PriceEngine.sol lines 160 and 246-249
**Issue:** The NatSpec at line 160 says "Verify solvency: max(newForSupply, newAgainstSupply) <= newReserve". But the implementation at line 248 uses `min`. This is a documentation/implementation mismatch, which is a critical audit red flag.

## MEDIUM FINDINGS

### M-01: computeIndex() Scale-Down is Lossy and Non-Deterministic
**Location:** MathLibrary.sol lines 166-188
**Issue:** The scale-down logic for overflow prevention divides both `forSupply` and `total` by the same `scale` factor. However, `total = forSupply + againstSupply`, and dividing `total` by `scale` is not the same as dividing `forSupply` by `scale` and `againstSupply` by `scale` separately. This can introduce precision errors. Additionally, the single-pass scale-down may not be sufficient for extreme values.
**Impact:** Index calculation may be slightly inaccurate for very large supplies.

### M-02: TWAPLibrary.finaliseTWAP() Potential Overflow in weightedSum
**Location:** TWAPLibrary.sol line 184
**Code:** `weightedSum += state.pulseIndexSnapshots[i] * duration;`
**Issue:** `pulseIndex` can be up to 9999 and `duration` can be up to 1800 seconds (30 minutes). `9999 * 1800 = 17,998,200`. With 30 snapshots, `weightedSum` can be up to `17,998,200 * 30 = 539,946,000`. This is well within uint256 range. However, this is NOT using `mulDiv` — it uses direct multiplication, which violates the Protocol Security Standard §5 ("All calculations... must use Full Precision mulDiv").
**Impact:** Minor violation of protocol standard. Not a practical overflow risk given current values.

### M-03: IMarketVault.sol Missing Events in Interface Definition
**Location:** IMarketVault.sol
**Issue:** The interface defines events `Deposited`, `Withdrawn`, `Settled`, but does not include the `indexed` keyword specification for all parameters. The actual implementation may differ from what indexers expect.

### M-04: Factory ViewRecord Does Not Include Settlement Rule Version
**Location:** IPulseFactory.sol ViewRecord struct
**Issue:** The ViewRecord stores `priceEngine` as a version snapshot, but does not store a `settlementRuleVersion`. If the SettlementManager is upgraded and the settlement rules change (e.g., TWAP threshold changes from 5000), existing Views would use the new rules, not the rules at creation time.
**Impact:** Historical Views could have their settlement rules silently changed by a SettlementManager upgrade.

### M-05: No Minimum EndTime Constraint in Factory Interface
**Location:** IPulseFactory.sol
**Issue:** The `createView()` function accepts any `endTime > startTime`. There is no minimum duration enforced. A creator could create a View with `endTime = startTime + 1 second`, making the settlement window (30 minutes) impossible to enter, resulting in zero TWAP snapshots and a forced Draw.
**Impact:** Creators can create markets that always result in Draw, potentially as a griefing attack.

## LOW FINDINGS

### L-01: TWAPLibrary Constants Not Configurable Per View
**Location:** TWAPLibrary.sol lines 33-39
**Issue:** `SNAPSHOT_INTERVAL`, `SETTLEMENT_WINDOW`, and `MAX_SNAPSHOTS` are hardcoded constants. If the protocol needs to support different settlement windows for different View types in the future, this will require a library upgrade.

### L-02: MarketVaultFactory Does Not Validate Token is a Contract
**Location:** MarketVaultFactory.sol deployVault()
**Issue:** The factory validates `token != address(0)` but does not check if the token address is actually a contract with ERC20 interface. A non-contract address would pass validation but fail at the first `safeTransfer` call.

### L-03: PriceEngine quoteSell() Returns amountOut=0 for Dust Sells Without Reverting
**Location:** PriceEngine.sol quoteSell()
**Issue:** If `sharesIn` is very small, `amountOut = mulDiv(sharesIn, sidePrice, BPS)` can return 0 due to integer division. The function does not revert on `amountOut == 0`. The TradingEngine is expected to handle this, but this is not enforced at the PriceEngine level.

### L-04: ISettlementManager.claimReward() Does Not Specify Who Receives the Payout
**Location:** ISettlementManager.sol line 87
**Issue:** The NatSpec says "Anyone may call on behalf of a user (payout always goes to the position holder)." However, the function signature `claimReward(uint256 viewId)` uses `msg.sender` as the claimant. If someone calls on behalf of another user, the payout goes to `msg.sender`, not the position holder. This is a design ambiguity.

## INFORMATIONAL

### I-01: Protocol Security Standard Claims mulDiv is "Full 512-bit" but Implementation is Not
**Location:** Protocol_Security_Standard.md and MathLibrary.sol
**Issue:** The standard says "Full Precision mulDiv" but the implementation is a simple `a * b / c`. These are different things.

### I-02: PriceEngine Solvency Comment Contradicts Implementation
**Location:** PriceEngine.sol line 160 vs 248
**Issue:** NatSpec says `max()` but code uses `min()`. This will confuse future auditors.

### I-03: Master Specification Section D States Wrong Solvency Invariant
**Location:** Master Specification, Section D
**Issue:** States "min(ForSupply, AgainstSupply) <= VaultReserve" as the solvency invariant. This is the wrong invariant (see C-02). The correct invariant is `max(ForSupply, AgainstSupply) <= VaultReserve`.
