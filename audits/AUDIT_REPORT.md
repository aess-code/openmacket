# Macket 项目代码审计报告

**版本节点**：v1
**日期**：2026-07-18

本报告对 Macket 项目的架构、代码质量、死代码、性能、安全及 Web3 交互进行了全面审查。在开始重构之前，请确认本报告中指出的问题和重构建议。

---

## 1. 架构摘要

Macket 是一个基于 Next.js 14（App Router）构建的去中心化信心市场应用。

- **框架与路由**：使用 Next.js App Router，目前有三个核心路由：首页 (`/`)、市场详情页 (`/market/[id]`)、个人主页 (`/profile`)。
- **状态管理与 Web3 交互**：使用 `wagmi` + `viem` 处理链上交互，结合 `@tanstack/react-query` 进行状态缓存和数据轮询。
- **UI 库**：使用 Tailwind CSS 进行样式编写，`lucide-react` 提供图标，`sonner` 提供 Toast 提示。没有使用复杂的 UI 组件库，均为手写原生组件。
- **合约架构**：
  - `MarketFactory.sol`：工厂合约，负责创建新市场。
  - `Market.sol`：基于 ERC1155 的二元期权市场，支持买入（Buy）、卖出（Sell）、发起结算倒计时（initiateClose）、结算（settle）和领奖（claim）。包含 `totalVolume` 和 `participantCount` 等权重字段。
  - `MockUSDT.sol`：用于测试的 ERC20 代币。

---

## 2. 死代码检测

在审计过程中发现了以下未使用的代码，建议在重构时移除：

1. **未使用的组件**：
   - `components/CreateModal.tsx`：这是一个旧版的创建市场弹窗组件，功能与 `components/CreateMarketModal.tsx` 高度重复，且在整个项目中没有任何文件导入或使用它。
2. **构建配置屏蔽**：
   - `next.config.mjs` 中设置了 `typescript.ignoreBuildErrors: true` 和 `eslint.ignoreDuringBuilds: true`。这掩盖了项目中可能存在的类型和语法错误，建议在清理完类型问题后移除这些配置。

---

## 3. 代码质量审查

1. **TypeScript 类型问题**：
   - 项目中存在多处 `as` 断言（如 `as bigint`、`as Address`），绕过了 TypeScript 的严格检查。如果合约返回 `undefined`，直接转换可能导致运行时错误。
2. **Hooks 依赖问题**：
   - `app/market/[id]/page.tsx` 中 `useEffect` 依赖数组包含 `eslint-disable-line react-hooks/exhaustive-deps`，虽然使用了 `useRef` 来避免闭包陷阱，但这种做法增加了代码的维护成本，不符合 React 最佳实践。
3. **常量管理**：
   - 费率（0.5%）、等待期天数（21天）在前端代码中多处硬编码，而这些值实际上应该从合约常量中读取（如 `FEE_CREATOR / FEE_DENOM`）。

---

## 4. 性能优化

1. **N+1 查询问题**：
   - **首页**：在"即将结算" Tab 下，通过循环对所有市场地址发起 `status` 查询。如果市场数量庞大，将导致严重的 RPC 请求雪崩。
   - **MarketCard**：每个卡片组件内部独立发起 `useReadContracts` 读取市场详情。首页渲染 50 个市场时，将产生 50 次独立的 RPC 批量请求。
   - **个人主页**：在循环中为每个市场读取 `[creator, getUserPosition, totalVolume]`。
   - **建议**：合约层面应提供批量读取接口（如 `getMarketsWithDetails`），或者在前端使用全局状态/索引器（如 The Graph）聚合数据。
2. **全局刷新粒度过粗**：
   - 交易成功后，多次调用 `queryClient.invalidateQueries()`，这会导致页面上所有 `useReadContract` 重新发起请求，浪费带宽。应精确失效相关的 query key。

---

## 5. Web3 / 智能合约集成审查

1. **ABI 与合约源码不同步**：
   - `constants/index.ts` 中的 `MARKET_ABI` 与 `contracts/Market.sol` 存在偏差。例如，ABI 中存在 `requestClose`，但新版合约中已更名为 `initiateClose`。虽然之前做过修复，但仍需全面比对。
2. **网络硬编码**：
   - 多处文案和链接（如 Etherscan 链接）硬编码了 `sepolia`，在切换到主网或其他网络时将导致链接错误。
3. **未处理的错误状态**：
   - 交易被用户拒绝（User rejected transaction）时，会抛出长串错误信息，UI 处理不够友好。

---

## 6. 安全审查

1. **环境变量**：
   - `constants/index.ts` 已经改为硬编码合约地址，但 `.env.example` 中仍保留了相关变量说明，容易引起误导。
2. **无限授权风险**：
   - 买入时的 USDT 授权使用了 `MaxUint256`（虽然代码里写的是 `amountBigInt * 2n`，但逻辑上有混淆）。建议只授权本次交易所需的金额，或让用户选择。

---

## 7. UI / UX 审查

1. **首页排序逻辑缺失**：
   - "最热市场"（hot）目前只是沿用了"最新市场"的原始顺序，并未真正实现按 `totalVolume`、`TVL` 和 `participantCount` 加权排序的逻辑。
   - "即将结算"（closing）只过滤了状态，并未按剩余时间（`timeUntilSettlement`）排序。
2. **搜索体验**：
   - 首页的搜索框目前是按合约地址过滤，而不是按市场问题文本过滤，这对普通用户来说毫无意义。
3. **加载状态**：
   - 数据加载时的骨架屏（Skeleton）缺失，只有简单的 `Loader2` 旋转图标，页面布局在数据加载前后会发生跳动。

---

## 8. 重构建议（下一步执行计划）

基于以上审计结果，建议按以下步骤进行重构：

1. **清理死代码**：删除 `components/CreateModal.tsx`，清理 `next.config.mjs` 中的忽略配置。
2. **优化数据获取**：重构首页和 MarketCard 的数据读取逻辑，减少 RPC 请求次数。
3. **实现真实排序与搜索**：
   - 首页"最热市场"：批量读取所需权重字段并进行加权排序。
   - 首页"即将结算"：按 `timeUntilSettlement` 升序排序。
   - 首页搜索：修改为按市场问题（`question`）文本进行模糊匹配。
4. **修复 Web3 细节**：动态生成区块链浏览器链接，统一费率等常量的读取来源。
5. **UI 优化**：添加骨架屏，优化错误提示。

---

请确认以上审计报告和重构建议。确认后，我将逐步执行重构。
