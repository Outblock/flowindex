# FlowScan.io 功能测试与截图（2026-02-04）

说明：
- 使用 Playwright 逐页点击、截图。截图文件位于 `output/playwright/`。
- 本文只记录从页面上可见的功能与交互，不推断内部实现。

## 全局导航与通用组件
可见功能：
- 网络切换：Mainnet / Testnet。
- Flow / EVM 视图切换。
- Network Surge Factor（拥塞指数）提示。
- 顶部全局搜索（地址 / 交易 / 域名等）。
- 左侧导航：Home、Scheduled、Transactions、Blocks、Contracts、Accounts、Nodes、Analytics、Tokenomics、NFT、FT。
- 资源链接：Resources / Telegram。

## 覆盖页面清单
- 首页
- Transactions 列表
- Transaction 详情
- Blocks 列表
- Block 详情
- Accounts 列表
- Contracts 页面
- Nodes 页面
- Analytics 页面
- Tokenomics 页面
- NFT 页面
- FT 页面
- Scheduled 页面

## 首页
![FlowScan Home](./assets/flowscan/flowscan-home.png)

可见功能：
- Flow Pulse：价格与历史走势摘要（可见加载提示/价格卡片）。
- Epoch 进度区块（epoch 相关数据）。
- Analytics 概览卡片：Block Height、Transactions Total、Nodes Total、Staked Total、Validators Total、Delegators Total、Payout Total、APY。
- Recently Scheduled Transactions 列表（“View More”跳转）。
- Recent Transactions 列表（“View More”跳转）。
- 侧边栏导航与全局搜索。

## Transactions 列表
![FlowScan Transactions](./assets/flowscan/flowscan-transactions.png)

可见功能：
- 标题区：Recent Transactions + Filter 入口。
- 分页控制：Per page 选择、Prev/Next。
- 列表项字段：区块高度与时间戳、交易类型标签（FT / NFT / EVM / Flow）、交易状态（SEALED / CODE_ERROR / CANNOT_PAY 等）、交易哈希（可点击）、多签提示（Multisig）、关联合约/Token 入口（如 NFT/FT 合约名）。

## Transaction 详情
![FlowScan Transaction Detail](./assets/flowscan/flowscan-tx-detail.png)

可见功能：
- 交易基础信息卡片（类型、状态、交易哈希、网络标签）。
- 交易参数/脚本/事件的展示区域（按区块或事件展开）。
- 关联区块、合约、账户的跳转入口。
- 失败交易会显示错误原因。

## Blocks 列表
![FlowScan Blocks](./assets/flowscan/flowscan-blocks.png)

可见功能：
- 标题区：Recent Blocks + Filter 入口。
- 分页控制：Per page 选择、Prev/Next。
- 列表项字段：区块高度与时间戳、Flow / Empty Flow block 标记、交易数量提示（Number of transactions）、Gas 消耗提示（Gas: N）、进入详情链接。

## Block 详情
![FlowScan Block Detail](./assets/flowscan/flowscan-block-detail.png)

可见功能：
- 区块头部信息（高度、时间、ID、是否空块等）。
- 交易列表与跳转。
- 关联集合与事件信息入口。

## Accounts 列表
![FlowScan Accounts](./assets/flowscan/flowscan-accounts.png)

可见功能：
- 标题区：Top Accounts。
- 分页控制：Per page 选择、Prev/Next。
- 列表项字段：账户地址、余额（Balance）、创建时间（Account created at）、创建交易（Created in: tx hash）、标签（Big Fish / Staker / Delegator）。

## Contracts 页面
![FlowScan Contracts](./assets/flowscan/flowscan-contracts.png)

可见功能：
- 合约目录视图（可跳转至合约详情）。
- 合约名称 / 地址等基础信息展示。

## Nodes 页面
![FlowScan Nodes](./assets/flowscan/flowscan-nodes.png)

可见功能：
- 节点列表与状态信息。
- 节点角色/类型分类视图。

## Analytics 页面
![FlowScan Analytics](./assets/flowscan/flowscan-analytics.png)

可见功能：
- 多图表统计面板。
- 时间区间维度切换。

## Tokenomics 页面
![FlowScan Tokenomics](./assets/flowscan/flowscan-tokenomics.png)

可见功能：
- 供应/流通等宏观指标卡片。
- 代币经济学图表与趋势。

## NFT 页面
![FlowScan NFT](./assets/flowscan/flowscan-nft.png)

可见功能：
- NFT 集合列表（可进入集合详情）。
- 集合相关指标展示入口（如 volume/floor 等）。

## FT 页面
![FlowScan FT](./assets/flowscan/flowscan-ft.png)

可见功能：
- FT 代币列表与详情入口。
- 代币基本信息与统计入口。

## Scheduled 页面
![FlowScan Scheduled](./assets/flowscan/flowscan-scheduled.png)

可见功能：
- Scheduled Transactions 列表。
- 跳转到详情页的入口。

## 运行时观察（非阻断）
- NFT 页面存在少量图片资源加载失败（页面仍可浏览）。
- FT 页面出现少量控制台错误，但页面主体功能可用。
- Home 页请求 `status` 接口出现 401 的控制台错误（不影响页面结构加载，但可能影响实时数据）。
