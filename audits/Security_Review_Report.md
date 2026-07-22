# Pulse Protocol V1 — MarketVault Security Review Report

## 1. 修改内容列表 (Hardening Updates)
根据 Stage 3 Final Security Hardening 要求，对 `MarketVault.sol` 与 `IMarketVault.sol` 进行了以下 V1 级别加固：
- **Events 完善**：重写了 `Deposited`, `Withdrawn`, `Settled` 事件，增加了 `indexed viewId` 和 `indexed caller/receiver`，并确保记录 `amount`。
- **ERC20 限制明确**：在 NatSpec 中明确声明 V1 仅支持标准 ERC20，显式拒绝 Fee-on-transfer、Rebasing 和 Callback tokens。
- **Invariant 加强**：在 `_assertInvariant()` 中，强制使用 `IERC20(token).balanceOf(address(this))` 对比 `totalDeposits - totalWithdrawals - totalSettled`，若真实余额不足则直接 `revert Vault__InvariantViolation()`。
- **NatSpec 完整化**：为所有 public/external 函数补充了 `@notice`, `@dev`, `@param`, `@return`，并明确了 Vault 与 Position/Price/TWAP 的责任边界。
- **权限模型确认**：确认无任何 owner、admin、rescue、pause 或 upgrade 后门，四个核心依赖地址均为 `immutable`。

## 2. 新增安全保护
- **Accounting Drift 防护**：通过强制的 `balanceOf` 检查，彻底杜绝了 Fee-on-transfer 造成的内部记账与真实余额脱节。
- **Rebasing Token 阻断**：若余额发生负向 Rebase，下一次状态变更操作将立即触发 Invariant 保护并回滚，防止亏空扩大。
- **事件可追溯性**：强制绑定 `viewId` 到所有资金事件，使得链下 Indexer 和审计方可以严格追踪单 View 的资金流向。

## 3. 测试数量
- **总测试数**：35 个（针对 Hardening 专门重写了 `MarketVault.hardened.test.cjs`，涵盖 6 类攻击场景 + 边界测试）。
- **Mock 攻击合约**：新增 4 个专用的恶意 Mock Token（Fee-on-transfer, Rebasing, Reentrant Withdraw, Reentrant Settle）。

## 4. 测试结果
**35 / 35 全部通过 (100% Pass Rate)**。
测试涵盖了权限控制、ERC20 异常行为、重入攻击、多次结算拦截以及工厂合约安全性。

## 5. 攻击模拟结果

| 攻击场景 | 模拟手段 | 协议响应 | 状态 |
|---|---|---|---|
| **Attack 1: Unauthorized Access** | 恶意地址调用 deposit/withdraw/settle | `revert Vault__UnauthorisedEngine` / `Settlement` | ✅ 防御成功 |
| **Attack 2: Fake Token** | 部署后尝试更改 collateral token | 无 setter 函数，无法更改 | ✅ 防御成功 |
| **Attack 3: Accounting Drift** | 使用扣除 5% 手续费的 Mock Token | `_assertInvariant()` 发现差额，`revert Vault__InvariantViolation()` | ✅ 防御成功 |
| **Attack 3: Negative Rebase** | 外部 Slash Vault 余额 | 下一次操作触发 `Vault__InvariantViolation()` | ✅ 防御成功 |
| **Attack 4: Reentrancy** | 恶意 Token 在 transfer 钩子中重入 | `ReentrancyGuard` 拦截内层调用，资金守恒 | ✅ 防御成功 |
| **Attack 5: Multiple Settlement** | 对同一目标连续两次调用 settle() | 余额不足或被 SettlementManager 拦截，第二笔 `revert` | ✅ 防御成功 |
| **Attack 6: Duplicate Factory Init**| 重复部署同一 ViewID | `revert VaultFactory__AlreadyDeployed` | ✅ 防御成功 |

## 6. 剩余风险
- **Token 暴雷/冻结**：若选定的 ERC20（如 USDT）在合约级别冻结了 Vault 地址，资金将无法取出。这是 ERC20 本身的中心化风险，协议层无法规避。
- **正向 Rebase / 捐赠资金锁定**：直接转入 Vault 的资金（不通过 deposit）会被永久锁定在 Vault 中，无法被提出。这符合 V1 的设计预期，不影响正常用户的资金安全。

## 7. 结论与下一步建议
**结论**：MarketVault 已达到资金隔离、权限最小化、无管理员滥用、Accounting 可验证的 V1 安全标准。
**建议**：安全审查已通过，**可以进入 Stage 4：PriceEngine.sol 的开发**。
