# FlowScan.io Functional Review and Screenshots (2026-02-04)

Notes:
- Pages were clicked and captured with Playwright. Screenshots are in `docs/assets/flowscan/`.
- This document records visible functionality only; it does not infer internal implementation.

## Global Navigation and Shared Components
Visible features:
- Network switch: Mainnet / Testnet
- Flow / EVM view toggle
- Network Surge Factor indicator
- Global search (address / tx / domain, etc.)
- Left nav: Home, Scheduled, Transactions, Blocks, Contracts, Accounts, Nodes, Analytics, Tokenomics, NFT, FT
- Resource links: Resources / Telegram

## Pages Covered
- Home
- Transactions list
- Transaction detail
- Blocks list
- Block detail
- Accounts list
- Contracts
- Nodes
- Analytics
- Tokenomics
- NFT
- FT
- Scheduled

## Home
![FlowScan Home](../assets/flowscan/flowscan-home.png)

Visible features:
- Flow Pulse: price + historical trend (loading states + price card)
- Epoch progress panel
- Analytics overview cards: Block Height, Transactions Total, Nodes Total, Staked Total, Validators Total, Delegators Total, Payout Total, APY
- Recently Scheduled Transactions (with "View More")
- Recent Transactions (with "View More")
- Sidebar navigation + global search

## Transactions List
![FlowScan Transactions](../assets/flowscan/flowscan-transactions.png)

Visible features:
- Title area: Recent Transactions + Filter entry
- Pagination: per-page selector, Prev/Next
- Row fields: block height + timestamp, type tags (FT / NFT / EVM / Flow), status (SEALED / CODE_ERROR / CANNOT_PAY), tx hash (clickable), multisig hint, related contract/token entry

## Transaction Detail
![FlowScan Transaction Detail](../assets/flowscan/flowscan-tx-detail.png)

Visible features:
- Transaction info card (type, status, hash, network tag)
- Params/script/events sections (expandable)
- Links to related block/contract/account
- Failed tx shows error reason

## Blocks List
![FlowScan Blocks](../assets/flowscan/flowscan-blocks.png)

Visible features:
- Title area: Recent Blocks + Filter entry
- Pagination: per-page selector, Prev/Next
- Row fields: block height + timestamp, Flow/Empty Flow marker, tx count, gas usage, detail link

## Block Detail
![FlowScan Block Detail](../assets/flowscan/flowscan-block-detail.png)

Visible features:
- Block header info (height, time, ID, empty flag)
- Transactions list and links
- Links to collections and events

## Accounts List
![FlowScan Accounts](../assets/flowscan/flowscan-accounts.png)

Visible features:
- Title: Top Accounts
- Pagination: per-page selector, Prev/Next
- Row fields: address, balance, created time, created tx hash, labels (Big Fish / Staker / Delegator)

## Contracts
![FlowScan Contracts](../assets/flowscan/flowscan-contracts.png)

Visible features:
- Contract catalog view (links to detail)
- Contract name / address and basic info

## Nodes
![FlowScan Nodes](../assets/flowscan/flowscan-nodes.png)

Visible features:
- Node list and status
- Node role/type categories

## Analytics
![FlowScan Analytics](../assets/flowscan/flowscan-analytics.png)

Visible features:
- Multi-chart analytics dashboard
- Time range selector

## Tokenomics
![FlowScan Tokenomics](../assets/flowscan/flowscan-tokenomics.png)

Visible features:
- Supply/circulation cards
- Tokenomics charts and trends

## NFT
![FlowScan NFT](../assets/flowscan/flowscan-nft.png)

Visible features:
- NFT collection list (links to detail)
- Collection metrics (volume/floor, etc.)

## FT
![FlowScan FT](../assets/flowscan/flowscan-ft.png)

Visible features:
- FT token list with detail links
- Token metadata and stats

## Scheduled
![FlowScan Scheduled](../assets/flowscan/flowscan-scheduled.png)

Visible features:
- Scheduled Transactions list
- Links to detail pages

## Runtime Observations (Non-blocking)
- NFT page had a few image load failures (page still usable).
- FT page had a few console errors; main functionality still worked.
- Home page requested `status` and got 401 in console (page layout still loaded, but real-time data may be impacted).
