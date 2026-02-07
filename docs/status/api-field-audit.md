# API Field Audit (OpenAPI v2 spec)

- Generated: `2026-02-07T16:42:52Z`
- Base: `https://flowscan.up.railway.app/api`
- Spec: `openapi-v2.json`

Legend:
- `OK`: field exists and JSON type matches (integer allowed where spec says number)
- `NULL`: field exists but value is null
- `MISSING`: field absent in observed payload
- `TYPE_MISMATCH`: field exists but JSON type differs from spec
- `UNVERIFIED_EMPTY_ARRAY`: field is inside an array item, but the array was empty in sample payload

Sample Seeds (for path params):
- `address`: `0xe4cf4bdc1751c65d`
- `height`: `141454400`
- `tx_id`: `3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621`
- `token`: `05b67ba314000b2d`
- `nft_type`: `1d7e57aa55817448`
- `nft_item_id`: `null`
- `identifier`: `A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT`
- `evm_hash`: `e29a6f3a6a69ac112fcddb198624600cfb4c7d27c46f0475724d877e4d10235f`
- `evm_token_address`: `null`

## Summary

| Endpoint | HTTP | ms | expected | ok | missing | null | type_mismatch | unverified | extra | skip |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `GET /accounting/v1/account/{address}` | 200 | 1220 | 44 | 17 | 27 | 0 | 0 | 0 | 0 |  |
| `GET /accounting/v1/account/{address}/ft` | 200 | 2061 | 12 | 8 | 4 | 0 | 0 | 0 | 0 |  |
| `GET /accounting/v1/account/{address}/ft/transfer` | 200 | 1383 | 25 | 2 | 4 | 0 | 0 | 19 | 0 |  |
| `GET /accounting/v1/account/{address}/nft` | 200 | 888 | 13 | 4 | 9 | 0 | 0 | 0 | 8 |  |
| `GET /accounting/v1/account/{address}/tax-report` | 501 | 852 | 18 | 1 | 17 | 0 | 0 | 0 | 1 |  |
| `GET /accounting/v1/account/{address}/transaction` | 200 | 993 | 45 | 17 | 26 | 2 | 0 | 0 | 1 |  |
| `GET /accounting/v1/nft/transfer` | 200 | 1531 | 28 | 2 | 4 | 0 | 0 | 22 | 0 |  |
| `GET /accounting/v1/transaction` | 200 | 1463 | 40 | 17 | 21 | 2 | 0 | 0 | 1 |  |
| `GET /accounting/v1/transaction/{id}` | 200 | 1437 | 45 | 16 | 28 | 1 | 0 | 0 | 23 |  |
| `GET /defi/v1/asset` | 501 | 740 | 12 | 0 | 12 | 0 | 0 | 0 | 2 |  |
| `GET /defi/v1/events` | 501 | 676 | 21 | 0 | 21 | 0 | 0 | 0 | 2 |  |
| `GET /defi/v1/latest-block` | 501 | 689 | 3 | 0 | 3 | 0 | 0 | 0 | 2 |  |
| `GET /defi/v1/latest-swap` | 501 | 693 | 12 | 0 | 12 | 0 | 0 | 0 | 2 |  |
| `GET /defi/v1/pair` | 501 | 701 | 8 | 0 | 8 | 0 | 0 | 0 | 2 |  |
| `GET /flow/v1/account` | 200 | 694 | 17 | 13 | 4 | 0 | 0 | 0 | 1 |  |
| `GET /flow/v1/account/{address}` | 200 | 772 | 44 | 17 | 27 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/account/{address}/ft` | 200 | 1970 | 12 | 8 | 4 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/account/{address}/ft/holding` | 200 | 689 | 11 | 7 | 4 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/account/{address}/ft/transfer` | 200 | 1418 | 25 | 2 | 4 | 0 | 0 | 19 | 0 |  |
| `GET /flow/v1/account/{address}/ft/{token}` | 200 | 793 | 14 | 1 | 5 | 0 | 0 | 8 | 0 |  |
| `GET /flow/v1/account/{address}/ft/{token}/transfer` | 200 | 746 | 25 | 2 | 4 | 0 | 0 | 19 | 0 |  |
| `GET /flow/v1/account/{address}/nft` | 200 | 734 | 13 | 4 | 9 | 0 | 0 | 0 | 8 |  |
| `GET /flow/v1/account/{address}/nft/{nft_type}` | 200 | 699 | 25 | 8 | 16 | 0 | 1 | 0 | 2 |  |
| `GET /flow/v1/account/{address}/tax-report` | 501 | 679 | 18 | 1 | 17 | 0 | 0 | 0 | 1 |  |
| `GET /flow/v1/account/{address}/transaction` | 200 | 874 | 45 | 17 | 26 | 2 | 0 | 0 | 1 |  |
| `GET /flow/v1/block` | 200 | 675 | 23 | 12 | 11 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/block/{height}` | 200 | 695 | 23 | 11 | 12 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/block/{height}/service-event` | 200 | 788 | 11 | 2 | 4 | 0 | 0 | 5 | 0 |  |
| `GET /flow/v1/block/{height}/transaction` | 200 | 1381 | 42 | 17 | 23 | 2 | 0 | 0 | 0 |  |
| `GET /flow/v1/contract` | 200 | 689 | 26 | 20 | 6 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/contract/{identifier}` | 200 | 711 | 26 | 20 | 6 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/contract/{identifier}/{id}` | 200 | 712 | 26 | 20 | 6 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/evm/token` | 200 | 734 | 16 | 2 | 4 | 0 | 0 | 10 | 0 |  |
| `GET /flow/v1/evm/token/{address}` |  |  |  |  |  |  |  |  |  | `missing path param address` |
| `GET /flow/v1/evm/transaction` | 200 | 676 | 25 | 16 | 9 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/evm/transaction/{hash}` | 200 | 714 | 18 | 0 | 18 | 0 | 0 | 0 | 15 |  |
| `GET /flow/v1/ft` | 200 | 923 | 30 | 11 | 19 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/ft/transfer` | 200 | 1332 | 25 | 2 | 4 | 0 | 0 | 19 | 0 |  |
| `GET /flow/v1/ft/{token}` | 200 | 697 | 29 | 9 | 20 | 0 | 0 | 0 | 1 |  |
| `GET /flow/v1/ft/{token}/account/{address}` | 200 | 698 | 14 | 1 | 5 | 0 | 0 | 8 | 0 |  |
| `GET /flow/v1/ft/{token}/holding` | 200 | 688 | 11 | 7 | 4 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/nft` | 200 | 794 | 30 | 12 | 18 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/nft/transfer` | 200 | 1289 | 28 | 2 | 4 | 0 | 0 | 22 | 0 |  |
| `GET /flow/v1/nft/{nft_type}` | 200 | 729 | 30 | 11 | 19 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/nft/{nft_type}/holding` | 200 | 745 | 11 | 7 | 4 | 0 | 0 | 0 | 0 |  |
| `GET /flow/v1/nft/{nft_type}/item/{id}` |  |  |  |  |  |  |  |  |  | `missing path param id` |
| `GET /flow/v1/node` | 501 | 939 | 27 | 1 | 26 | 0 | 0 | 0 | 1 |  |
| `GET /flow/v1/node/{node_id}` | 501 | 711 | 26 | 1 | 25 | 0 | 0 | 0 | 1 |  |
| `GET /flow/v1/node/{node_id}/reward/delegation` | 501 | 677 | 13 | 1 | 12 | 0 | 0 | 0 | 1 |  |
| `GET /flow/v1/scheduled-transaction` | 501 | 676 | 27 | 1 | 26 | 0 | 0 | 0 | 1 |  |
| `GET /flow/v1/transaction` | 200 | 1342 | 40 | 17 | 21 | 2 | 0 | 0 | 1 |  |
| `GET /flow/v1/transaction/{id}` | 200 | 1374 | 45 | 16 | 28 | 1 | 0 | 0 | 23 |  |
| `GET /staking/v1/account/{address}/ft/transfer` | 501 | 752 | 25 | 1 | 24 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/account/{address}/transaction` | 501 | 690 | 45 | 1 | 44 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/delegator` | 501 | 676 | 12 | 1 | 11 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/epoch/stats` | 501 | 682 | 16 | 1 | 15 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/epoch/{epoch}/nodes` | 501 | 713 | 20 | 1 | 19 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/epoch/{epoch}/role/{role}/nodes/aggregate` | 501 | 673 | 9 | 1 | 8 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/epoch/{epoch}/role/{role}/nodes/count` | 501 | 700 | 8 | 1 | 7 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/epoch/{epoch}/role/{role}/nodes/grouped` | 501 | 720 | 10 | 1 | 9 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/ft_transfer/{address}` | 501 | 672 | 15 | 1 | 14 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/node/{node_id}/event` | 501 | 665 | 14 | 1 | 13 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/rewards/paid` | 501 | 876 | 8 | 1 | 7 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/rewards/staking` | 501 | 686 | 13 | 1 | 12 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/tokenomics` | 501 | 674 | 20 | 1 | 19 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/transaction/address/{address}` | 501 | 679 | 10 | 1 | 9 | 0 | 0 | 0 | 1 |  |
| `GET /staking/v1/transaction/{transaction_id}` | 501 | 722 | 10 | 1 | 9 | 0 | 0 | 0 | 1 |  |
| `GET /status/v1/count` | 200 | 674 | 9 | 2 | 7 | 0 | 0 | 0 | 3 |  |
| `GET /status/v1/epoch/stat` | 200 | 677 | 16 | 1 | 5 | 0 | 0 | 10 | 0 |  |
| `GET /status/v1/epoch/status` | 200 | 734 | 17 | 1 | 5 | 0 | 0 | 11 | 0 |  |
| `GET /status/v1/flow/stat` | 200 | 713 | 12 | 2 | 10 | 0 | 0 | 0 | 4 |  |
| `GET /status/v1/stat` | 200 | 718 | 11 | 3 | 8 | 0 | 0 | 0 | 4 |  |
| `GET /status/v1/stat/{timescale}/trend` | 200 | 733 | 14 | 3 | 11 | 0 | 0 | 0 | 4 |  |
| `GET /status/v1/tokenomics` | 200 | 730 | 24 | 1 | 5 | 0 | 0 | 18 | 0 |  |

## Details

### `GET /accounting/v1/account/{address}`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/account/0xe4cf4bdc1751c65d`
- HTTP: `200`
- Latency: `1220ms`
- Counts: expected=44 ok=17 missing=27 null=0 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,contracts,flowBalance,flowStorage,keys,storageAvailable,storageUsed)` | `` |
| `data[].accountInfo` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.delegatedBalance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.primaryAcctBalance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.primaryAddress` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.secondaryAcctBalance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.secondaryAddress` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.stakedBalance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].contracts` | false | `array` | `array` | `OK` | `array(len=2)` | `` |
| `data[].contracts[]` | false | `string` | `string` | `OK` | `AllDay` | `` |
| `data[].flowBalance` | false | `number` | `number` | `OK` | `4966.91982129` | `` |
| `data[].flowStorage` | false | `number` | `number` | `OK` | `473682.3865213394` | `` |
| `data[].keys` | false | `array` | `array` | `OK` | `array(len=202)` | `` |
| `data[].keys[]` | false | `object` | `object` | `OK` | `object(keys=hashAlgorithm,index,key,revoked,signatureAlgorithm,weight)` | `` |
| `data[].keys[].hashAlgorithm` | false | `string` | `string` | `OK` | `SHA2_256` | `` |
| `data[].keys[].index` | false | `string` | `string` | `OK` | `0` | `` |
| `data[].keys[].key` | false | `string` | `string` | `OK` | `b3e7876da8ed96cb40def1d4836e3556a8e4f394730c420d1bf81ed0ff5e7861fbc18dee67c6adae95bd5ce7a6a1fa9ec4e9934e33b71f56ddfb9...` | `` |
| `data[].keys[].revoked` | false | `boolean` | `boolean` | `OK` | `False` | `` |
| `data[].keys[].signatureAlgorithm` | false | `string` | `string` | `OK` | `ECDSA_P256` | `` |
| `data[].keys[].weight` | false | `integer` | `integer` | `OK` | `1000` | `` |
| `data[].storageAvailable` | false | `number` | `number` | `OK` | `471074.57773303986` | `` |
| `data[].storageUsed` | false | `number` | `number` | `OK` | `2607.8087882995605` | `` |
| `data[].vaults` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.balance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.identifier` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.path` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.short_path` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.socials` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.socials.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.symbol` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.tags` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.token` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.uuid` | false | `integer` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /accounting/v1/account/{address}/ft`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/account/0xe4cf4bdc1751c65d/ft?limit=1&offset=0`
- HTTP: `200`
- Latency: `2061ms`
- Counts: expected=12 ok=8 missing=4 null=0 type_mismatch=0 unverified=0 extra=0
- Semantic warnings:
  - `data[].token`: `cadence_type_format` (sample=`A.1654653399040a61.FlowToken.Vault`)

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,balance,path,token,vault_id)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].balance` | false | `string` | `string` | `OK` | `-48.872100000000000000` | `` |
| `data[].path` | false | `string` | `string` | `OK` | `/storage/flowTokenVault` | `` |
| `data[].token` | false | `string` | `string` | `OK` | `A.1654653399040a61.FlowToken.Vault` | `cadence_type_format` |
| `data[].vault_id` | false | `integer` | `integer` | `OK` | `0` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /accounting/v1/account/{address}/ft/transfer`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/account/0xe4cf4bdc1751c65d/ft/transfer?limit=1&offset=0`
- HTTP: `200`
- Latency: `1383ms`
- Counts: expected=25 ok=2 missing=4 null=0 type_mismatch=0 unverified=19 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].address` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].amount` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].approx_usd_price` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].classifier` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].direction` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].is_primary` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver_balance` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].sender` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.logo` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.symbol` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.token` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].verified` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /accounting/v1/account/{address}/nft`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/account/0xe4cf4bdc1751c65d/nft?limit=1&offset=0`
- HTTP: `200`
- Latency: `888ms`
- Counts: expected=13 ok=4 missing=9 null=0 type_mismatch=0 unverified=0 extra=8

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,contract_name,display_name,id,name,number_of_tokens,status,timestamp,...)` | `` |
| `data[].banner` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].nft_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].nft_type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].owner` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].address` | `string` | `0x1d7e57aa55817448` |
| `data[].contract_name` | `string` | `` |
| `data[].display_name` | `string` | `` |
| `data[].id` | `string` | `1d7e57aa55817448` |
| `data[].number_of_tokens` | `integer` | `126927` |
| `data[].status` | `string` | `` |
| `data[].timestamp` | `string` | `2026-02-07T16:42:40Z` |
| `data[].updated_at` | `string` | `2026-02-07T16:42:40Z` |

</details>

### `GET /accounting/v1/account/{address}/tax-report`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/account/0xe4cf4bdc1751c65d/tax-report?limit=1&offset=0`
- HTTP: `501`
- Latency: `852ms`
- Counts: expected=18 ok=1 missing=17 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].abs_amount` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].amount` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].direction` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].otherside` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].time` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].token` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].type` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /accounting/v1/account/{address}/transaction`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/account/0xe4cf4bdc1751c65d/transaction?limit=1&offset=0`
- HTTP: `200`
- Latency: `993ms`
- Counts: expected=45 ok=17 missing=26 null=2 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=authorizers,block_height,contract_imports,contract_outputs,error,event_count,events,fee,...)` | `` |
| `data[].authorizers` | false | `array` | `array` | `OK` | `array(len=3)` | `` |
| `data[].authorizers[]` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].block_height` | false | `integer` | `integer` | `OK` | `141453895` | `` |
| `data[].contract_imports` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].contract_imports[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].contract_outputs[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].entitlements` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].entitlements[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `string` | `OK` | `` | `` |
| `data[].error_code` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].event_count` | false | `integer` | `integer` | `OK` | `28` | `` |
| `data[].events` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].events[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].events[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].event_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].fields` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].events[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `number` | `OK` | `0.00354` | `` |
| `data[].gas_used` | false | `integer` | `integer` | `OK` | `86` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `1e1d0eaa327e45fc17735370d264d94ce2f2b6a7e246dbee1888d54cbfd9c7a5` | `` |
| `data[].payer` | false | `string` | `string` | `OK` | `0x18eb4ee6b3c026d2` | `` |
| `data[].proposer` | false | `string` | `string` | `OK` | `0xace5257fa9b2f260` | `` |
| `data[].raw_roles` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].raw_roles[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].roles` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].roles[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `SEALED` | `` |
| `data[].tags` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].tags[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].tags[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:35:40Z` | `` |
| `data[].transaction_body_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].transaction_index` | `integer` | `0` |

</details>

### `GET /accounting/v1/nft/transfer`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/nft/transfer?limit=1&offset=0`
- HTTP: `200`
- Latency: `1531ms`
- Counts: expected=28 ok=2 missing=4 null=0 type_mismatch=0 unverified=22 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].address` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].classifier` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].collection_image` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].collection_name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].current_owner` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].direction` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].display_name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].edition` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].external_url` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].is_primary` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].max_edition` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].nft_id` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].nft_type` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].sender` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].serial` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].thumbnail` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].verified` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /accounting/v1/transaction`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/transaction?limit=1&offset=0`
- HTTP: `200`
- Latency: `1463ms`
- Counts: expected=40 ok=17 missing=21 null=2 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=authorizers,block_height,contract_imports,contract_outputs,error,event_count,events,fee,...)` | `` |
| `data[].authorizers` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[].authorizers[]` | false | `string` | `string` | `OK` | `0xe467b9dd11fa00df` | `` |
| `data[].block_height` | false | `integer` | `integer` | `OK` | `141454409` | `` |
| `data[].contract_imports` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].contract_imports[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].contract_outputs[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `string` | `OK` | `` | `` |
| `data[].error_code` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].event_count` | false | `integer` | `integer` | `OK` | `1` | `` |
| `data[].events` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].events[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].events[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].event_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].fields` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].events[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].gas_used` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621` | `` |
| `data[].payer` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].proposer` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `SEALED` | `` |
| `data[].surge_factor` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].tags` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].tags[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].tags[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:42:31Z` | `` |
| `data[].transaction_body_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].transaction_index` | `integer` | `2` |

</details>

### `GET /accounting/v1/transaction/{id}`
- URL: `https://flowscan.up.railway.app/api/accounting/v1/transaction/3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621`
- HTTP: `200`
- Latency: `1437ms`
- Counts: expected=45 ok=16 missing=28 null=1 type_mismatch=0 unverified=0 extra=23

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=authorizers,block_height,contract_imports,contract_outputs,error,event_count,events,fee,...)` | `` |
| `data[].argument` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].argument[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].argument[].key` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].argument[].value` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].authorizers` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[].authorizers[]` | false | `string` | `string` | `OK` | `0xe467b9dd11fa00df` | `` |
| `data[].block_height` | false | `integer` | `integer` | `OK` | `141011927` | `` |
| `data[].block_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_imports` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].contract_imports[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].contract_outputs[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `string` | `OK` | `` | `` |
| `data[].error_code` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[].events[]` | false | `object` | `object` | `OK` | `object(keys=block_height,event_index,payload,timestamp,transaction,type)` | `` |
| `data[].events[].fields` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].events[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].error_code` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].error_message` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].evm_block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].evm_transaction_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].execution_effort` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].gas_used` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621` | `` |
| `data[].payer` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].proposer` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].proposer_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].proposer_sequence_number` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `SEALED` | `` |
| `data[].surge_factor` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-03T14:17:14Z` | `` |
| `data[].transaction_body` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_body_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].event_count` | `integer` | `1` |
| `data[].events[].block_height` | `integer` | `141011927` |
| `data[].events[].event_index` | `integer` | `0` |
| `data[].events[].payload` | `object` | `object(keys=hash,height,timestamp,parentHash,prevrandao,receiptRoot,totalSupply,totalGasUsed,...)` |
| `data[].events[].payload.hash` | `array` | `array(len=32)` |
| `data[].events[].payload.hash[]` | `string` | `6` |
| `data[].events[].payload.height` | `string` | `55006764` |
| `data[].events[].payload.parentHash` | `array` | `array(len=32)` |
| `data[].events[].payload.parentHash[]` | `string` | `3` |
| `data[].events[].payload.prevrandao` | `array` | `array(len=32)` |
| `data[].events[].payload.prevrandao[]` | `string` | `64` |
| `data[].events[].payload.receiptRoot` | `array` | `array(len=32)` |
| `data[].events[].payload.receiptRoot[]` | `string` | `86` |
| `data[].events[].payload.timestamp` | `string` | `1770128233` |
| `data[].events[].payload.totalGasUsed` | `string` | `0` |
| `data[].events[].payload.totalSupply` | `string` | `146127973032890790000000000` |
| `data[].events[].payload.transactionHashRoot` | `array` | `array(len=32)` |
| `data[].events[].payload.transactionHashRoot[]` | `string` | `86` |
| `data[].events[].timestamp` | `string` | `2026-02-03T14:17:14Z` |
| `data[].events[].transaction` | `string` | `3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621` |
| `data[].events[].type` | `string` | `A.e467b9dd11fa00df.EVM.BlockExecuted` |
| `data[].tags` | `null` | `null` |
| `data[].transaction_index` | `integer` | `2` |

</details>

### `GET /defi/v1/asset`
- URL: `https://flowscan.up.railway.app/api/defi/v1/asset?id=0`
- HTTP: `501`
- Latency: `740ms`
- Counts: expected=12 ok=0 missing=12 null=0 type_mismatch=0 unverified=0 extra=2

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].circulatingSupply` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].coinGeckoId` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].coinMarketCapId` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].metadata` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].metadata.socials` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].metadata.tags` | false | `array` | `None` | `MISSING` | `` | `` |
| `[].metadata.tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].symbol` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].totalSupply` | false | `string` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error` | `object` | `object(keys=message)` |
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /defi/v1/events`
- URL: `https://flowscan.up.railway.app/api/defi/v1/events?fromBlock=141454400&toBlock=141454400`
- HTTP: `501`
- Latency: `676ms`
- Counts: expected=21 ok=0 missing=21 null=0 type_mismatch=0 unverified=0 extra=2

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].amount0` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].amount1` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].asset0In` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].asset0Out` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].asset1In` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].asset1Out` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].block` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].block.blockNumber` | false | `integer` | `None` | `MISSING` | `` | `` |
| `[].block.blockTimestamp` | false | `integer` | `None` | `MISSING` | `` | `` |
| `[].eventIndex` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].eventType` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].maker` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].metadata` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].pairId` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].priceNative` | false | `number` | `None` | `MISSING` | `` | `` |
| `[].reserves` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].reserves.asset0` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].reserves.asset1` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].txnId` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].txnIndex` | false | `string` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error` | `object` | `object(keys=message)` |
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /defi/v1/latest-block`
- URL: `https://flowscan.up.railway.app/api/defi/v1/latest-block`
- HTTP: `501`
- Latency: `689ms`
- Counts: expected=3 ok=0 missing=3 null=0 type_mismatch=0 unverified=0 extra=2

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].blockNumber` | false | `integer` | `None` | `MISSING` | `` | `` |
| `[].blockTimestamp` | false | `integer` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error` | `object` | `object(keys=message)` |
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /defi/v1/latest-swap`
- URL: `https://flowscan.up.railway.app/api/defi/v1/latest-swap?id=0&direction=in`
- HTTP: `501`
- Latency: `693ms`
- Counts: expected=12 ok=0 missing=12 null=0 type_mismatch=0 unverified=0 extra=2

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].amounts` | false | `object` | `None` | `MISSING` | `` | `` |
| `[].amounts.asset0In` | false | `number` | `None` | `MISSING` | `` | `` |
| `[].amounts.asset0Out` | false | `number` | `None` | `MISSING` | `` | `` |
| `[].amounts.asset1In` | false | `number` | `None` | `MISSING` | `` | `` |
| `[].amounts.asset1Out` | false | `number` | `None` | `MISSING` | `` | `` |
| `[].asset0Id` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].asset1Id` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].direction` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].priceNative` | false | `number` | `None` | `MISSING` | `` | `` |
| `[].swapType` | false | `string` | `None` | `MISSING` | `` | `` |
| `[].timestamp` | false | `integer` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error` | `object` | `object(keys=message)` |
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /defi/v1/pair`
- URL: `https://flowscan.up.railway.app/api/defi/v1/pair?id=0`
- HTTP: `501`
- Latency: `701ms`
- Counts: expected=8 ok=0 missing=8 null=0 type_mismatch=0 unverified=0 extra=2

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `asset0Id` | false | `string` | `None` | `MISSING` | `` | `` |
| `asset1Id` | false | `string` | `None` | `MISSING` | `` | `` |
| `createdAtBlockNumber` | false | `integer` | `None` | `MISSING` | `` | `` |
| `createdAtBlockTimestamp` | false | `integer` | `None` | `MISSING` | `` | `` |
| `createdAtTxnId` | false | `string` | `None` | `MISSING` | `` | `` |
| `dexKey` | false | `string` | `None` | `MISSING` | `` | `` |
| `feeBps` | false | `integer` | `None` | `MISSING` | `` | `` |
| `id` | false | `string` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error` | `object` | `object(keys=message)` |
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /flow/v1/account`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account?limit=1&offset=0`
- HTTP: `200`
- Latency: `694ms`
- Counts: expected=17 ok=13 missing=4 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,height,limit,offset,sort_by)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,creator,data,find_name,flow_balance,flow_storage,height,storage_available,...)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].creator` | false | `string` | `string` | `OK` | `` | `` |
| `data[].data` | false | `object` | `object` | `OK` | `object(keys=)` | `` |
| `data[].flow_balance` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].flow_storage` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].height` | false | `integer` | `integer` | `OK` | `141453999` | `` |
| `data[].storage_available` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].storage_used` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:37:14Z` | `` |
| `data[].transaction_hash` | false | `string` | `string` | `OK` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].find_name` | `string` | `` |

</details>

### `GET /flow/v1/account/{address}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d`
- HTTP: `200`
- Latency: `772ms`
- Counts: expected=44 ok=17 missing=27 null=0 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,contracts,flowBalance,flowStorage,keys,storageAvailable,storageUsed)` | `` |
| `data[].accountInfo` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.delegatedBalance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.primaryAcctBalance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.primaryAddress` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.secondaryAcctBalance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.secondaryAddress` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].accountInfo.stakedBalance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].contracts` | false | `array` | `array` | `OK` | `array(len=2)` | `` |
| `data[].contracts[]` | false | `string` | `string` | `OK` | `AllDay` | `` |
| `data[].flowBalance` | false | `number` | `number` | `OK` | `4966.91982129` | `` |
| `data[].flowStorage` | false | `number` | `number` | `OK` | `473682.3865213394` | `` |
| `data[].keys` | false | `array` | `array` | `OK` | `array(len=202)` | `` |
| `data[].keys[]` | false | `object` | `object` | `OK` | `object(keys=hashAlgorithm,index,key,revoked,signatureAlgorithm,weight)` | `` |
| `data[].keys[].hashAlgorithm` | false | `string` | `string` | `OK` | `SHA2_256` | `` |
| `data[].keys[].index` | false | `string` | `string` | `OK` | `0` | `` |
| `data[].keys[].key` | false | `string` | `string` | `OK` | `b3e7876da8ed96cb40def1d4836e3556a8e4f394730c420d1bf81ed0ff5e7861fbc18dee67c6adae95bd5ce7a6a1fa9ec4e9934e33b71f56ddfb9...` | `` |
| `data[].keys[].revoked` | false | `boolean` | `boolean` | `OK` | `False` | `` |
| `data[].keys[].signatureAlgorithm` | false | `string` | `string` | `OK` | `ECDSA_P256` | `` |
| `data[].keys[].weight` | false | `integer` | `integer` | `OK` | `1000` | `` |
| `data[].storageAvailable` | false | `number` | `number` | `OK` | `471074.57773303986` | `` |
| `data[].storageUsed` | false | `number` | `number` | `OK` | `2607.8087882995605` | `` |
| `data[].vaults` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.balance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.identifier` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.path` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.short_path` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.socials` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.socials.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.symbol` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.tags` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.token` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].vaults.*.uuid` | false | `integer` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/account/{address}/ft`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/ft?limit=1&offset=0`
- HTTP: `200`
- Latency: `1970ms`
- Counts: expected=12 ok=8 missing=4 null=0 type_mismatch=0 unverified=0 extra=0
- Semantic warnings:
  - `data[].token`: `cadence_type_format` (sample=`A.1654653399040a61.FlowToken.Vault`)

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,balance,path,token,vault_id)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].balance` | false | `string` | `string` | `OK` | `-48.872100000000000000` | `` |
| `data[].path` | false | `string` | `string` | `OK` | `/storage/flowTokenVault` | `` |
| `data[].token` | false | `string` | `string` | `OK` | `A.1654653399040a61.FlowToken.Vault` | `cadence_type_format` |
| `data[].vault_id` | false | `integer` | `integer` | `OK` | `0` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/account/{address}/ft/holding`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/ft/holding?limit=1&offset=0`
- HTTP: `200`
- Latency: `689ms`
- Counts: expected=11 ok=7 missing=4 null=0 type_mismatch=0 unverified=0 extra=0
- Semantic warnings:
  - `data[].token`: `cadence_type_expected` (sample=`1654653399040a61`)

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,balance,percentage,token)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].balance` | false | `number` | `number` | `OK` | `-47.04716` | `` |
| `data[].percentage` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].token` | false | `string` | `string` | `OK` | `1654653399040a61` | `cadence_type_expected` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/account/{address}/ft/transfer`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/ft/transfer?limit=1&offset=0`
- HTTP: `200`
- Latency: `1418ms`
- Counts: expected=25 ok=2 missing=4 null=0 type_mismatch=0 unverified=19 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].address` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].amount` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].approx_usd_price` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].classifier` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].direction` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].is_primary` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver_balance` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].sender` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.logo` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.symbol` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.token` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].verified` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/account/{address}/ft/{token}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/ft/05b67ba314000b2d?limit=1&offset=0`
- HTTP: `200`
- Latency: `793ms`
- Counts: expected=14 ok=1 missing=5 null=0 type_mismatch=0 unverified=8 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].address` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].balance` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].id` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].path` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].vault_id` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/account/{address}/ft/{token}/transfer`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/ft/05b67ba314000b2d/transfer?limit=1&offset=0`
- HTTP: `200`
- Latency: `746ms`
- Counts: expected=25 ok=2 missing=4 null=0 type_mismatch=0 unverified=19 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].address` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].amount` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].approx_usd_price` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].classifier` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].direction` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].is_primary` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver_balance` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].sender` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.logo` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.symbol` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.token` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].verified` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/account/{address}/nft`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/nft?limit=1&offset=0`
- HTTP: `200`
- Latency: `734ms`
- Counts: expected=13 ok=4 missing=9 null=0 type_mismatch=0 unverified=0 extra=8

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,contract_name,display_name,id,name,number_of_tokens,status,timestamp,...)` | `` |
| `data[].banner` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].nft_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].nft_type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].owner` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].address` | `string` | `0x1d7e57aa55817448` |
| `data[].contract_name` | `string` | `` |
| `data[].display_name` | `string` | `` |
| `data[].id` | `string` | `1d7e57aa55817448` |
| `data[].number_of_tokens` | `integer` | `126927` |
| `data[].status` | `string` | `` |
| `data[].timestamp` | `string` | `2026-02-07T16:42:44Z` |
| `data[].updated_at` | `string` | `2026-02-07T16:42:44Z` |

</details>

### `GET /flow/v1/account/{address}/nft/{nft_type}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/nft/1d7e57aa55817448?limit=1&offset=0&valid_only=False&sort_by=desc`
- HTTP: `200`
- Latency: `699ms`
- Counts: expected=25 ok=8 missing=16 null=0 type_mismatch=1 unverified=0 extra=2

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=block_height,id,live,nft_id,owner,status,timestamp,type)` | `` |
| `data[].block_height` | false | `integer` | `integer` | `OK` | `141212039` | `` |
| `data[].collection_image` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].collection_name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].edition` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].external_url` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `10000248` | `` |
| `data[].max_edition` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].nft_id` | false | `integer` | `string` | `TYPE_MISMATCH` | `10000248` | `` |
| `data[].nft_type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].owner` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].path` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].serial` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `` | `` |
| `data[].thumbnail` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T04:29:18Z` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].uuid` | false | `integer` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].live` | `boolean` | `False` |
| `data[].type` | `string` | `1d7e57aa55817448` |

</details>

### `GET /flow/v1/account/{address}/tax-report`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/tax-report?limit=1&offset=0`
- HTTP: `501`
- Latency: `679ms`
- Counts: expected=18 ok=1 missing=17 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].abs_amount` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].amount` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].direction` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].otherside` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].time` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].token` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].type` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /flow/v1/account/{address}/transaction`
- URL: `https://flowscan.up.railway.app/api/flow/v1/account/0xe4cf4bdc1751c65d/transaction?limit=1&offset=0`
- HTTP: `200`
- Latency: `874ms`
- Counts: expected=45 ok=17 missing=26 null=2 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=authorizers,block_height,contract_imports,contract_outputs,error,event_count,events,fee,...)` | `` |
| `data[].authorizers` | false | `array` | `array` | `OK` | `array(len=3)` | `` |
| `data[].authorizers[]` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].block_height` | false | `integer` | `integer` | `OK` | `141454415` | `` |
| `data[].contract_imports` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].contract_imports[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].contract_outputs[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].entitlements` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].entitlements[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `string` | `OK` | `` | `` |
| `data[].error_code` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].event_count` | false | `integer` | `integer` | `OK` | `29` | `` |
| `data[].events` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].events[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].events[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].event_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].fields` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].events[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].gas_used` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `07f7b7aee34d786bf8e8ef09bcd416e42fd744c7c359f47a2dee7472ff8f46d3` | `` |
| `data[].payer` | false | `string` | `string` | `OK` | `0x18eb4ee6b3c026d2` | `` |
| `data[].proposer` | false | `string` | `string` | `OK` | `0x51783784424cedec` | `` |
| `data[].raw_roles` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].raw_roles[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].roles` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].roles[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `SEALED` | `` |
| `data[].tags` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].tags[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].tags[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:42:36Z` | `` |
| `data[].transaction_body_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].transaction_index` | `integer` | `0` |

</details>

### `GET /flow/v1/block`
- URL: `https://flowscan.up.railway.app/api/flow/v1/block?limit=1&offset=0`
- HTTP: `200`
- Latency: `675ms`
- Counts: expected=23 ok=12 missing=11 null=0 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=evm_tx_count,fees,height,id,surge_factor,system_event_count,timestamp,total_gas_used,...)` | `` |
| `data[].evm` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].evm.base_fee_per_gas` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm.gas_limit` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm.gas_used` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm.hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm.height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm.miner` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_tx_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].fees` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].height` | false | `integer` | `integer` | `OK` | `141454416` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `8bf16ddf001e433e10233d8acc4ae32816c59f1ea509629f601f315cd3763983` | `` |
| `data[].surge_factor` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].system_event_count` | false | `integer` | `integer` | `OK` | `27` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:42:37Z` | `` |
| `data[].total_gas_used` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].tx` | false | `integer` | `integer` | `OK` | `3` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/block/{height}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/block/141454400`
- HTTP: `200`
- Latency: `695ms`
- Counts: expected=23 ok=11 missing=12 null=0 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=evm_tx_count,fees,height,id,surge_factor,system_event_count,timestamp,total_gas_used,...)` | `` |
| `data[].evm` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].evm.base_fee_per_gas` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm.gas_limit` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm.gas_used` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm.hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm.height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm.miner` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_tx_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].fees` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].height` | false | `integer` | `integer` | `OK` | `141454400` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `f1ebee0b158cf02f21949decf8187e8d6ccbbe29a981c8f6b88ca6191cca55d0` | `` |
| `data[].surge_factor` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].system_event_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:42:24Z` | `` |
| `data[].total_gas_used` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].tx` | false | `integer` | `integer` | `OK` | `3` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/block/{height}/service-event`
- URL: `https://flowscan.up.railway.app/api/flow/v1/block/141454400/service-event?limit=1&offset=0`
- HTTP: `200`
- Latency: `788ms`
- Counts: expected=11 ok=2 missing=4 null=0 type_mismatch=0 unverified=5 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].fields` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/block/{height}/transaction`
- URL: `https://flowscan.up.railway.app/api/flow/v1/block/141454400/transaction`
- HTTP: `200`
- Latency: `1381ms`
- Counts: expected=42 ok=17 missing=23 null=2 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=3)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=authorizers,block_height,contract_imports,contract_outputs,error,event_count,events,fee,...)` | `` |
| `data[].authorizers` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].authorizers[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `integer` | `OK` | `141454400` | `` |
| `data[].contract_imports` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].contract_imports[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].contract_outputs[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `string` | `OK` | `[Error Code: 1101] error caused by: 1 error occurred:
	* transaction execute failed: [Error Code: 1101] cadence runti...` | `` |
| `data[].error_code` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].event_count` | false | `integer` | `integer` | `OK` | `5` | `` |
| `data[].events` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].events[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].events[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].event_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].fields` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].events[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_transaction_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].gas_used` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `7f63c543009bb9b99c9675b805e1f948a6f51607e57e1788b716d7d2ed87cf4b` | `` |
| `data[].payer` | false | `string` | `string` | `OK` | `0xd8b172a3ec29a634` | `` |
| `data[].proposer` | false | `string` | `string` | `OK` | `0xd8b172a3ec29a634` | `` |
| `data[].proposer_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `SEALED` | `` |
| `data[].tags` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].tags[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].tags[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:42:24Z` | `` |
| `data[].transaction_body_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_index` | false | `integer` | `integer` | `OK` | `0` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/contract`
- URL: `https://flowscan.up.railway.app/api/flow/v1/contract?limit=1&offset=0&status=deployed&valid_only=False`
- HTTP: `200`
- Latency: `689ms`
- Counts: expected=26 ok=20 missing=6 null=0 type_mismatch=0 unverified=0 extra=0
- Semantic warnings:
  - `data[].identifier`: `cadence_type_format` (sample=`A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT`)

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset,valid_from,warning)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,body,created_at,deployments,diff,id,identifier,import_count,...)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x82ed1b9cba5bb1b3` | `` |
| `data[].body` | false | `string` | `string` | `OK` | `` | `` |
| `data[].created_at` | false | `string` | `string` | `OK` | `2026-02-07T04:07:44Z` | `` |
| `data[].deployments` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].diff` | false | `string` | `string` | `OK` | `` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT` | `` |
| `data[].identifier` | false | `string` | `string` | `OK` | `A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT` | `cadence_type_format` |
| `data[].import_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].imported_by` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].imported_by[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].imported_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `KARAT2WRXTQSBT` | `` |
| `data[].parent_contract_id` | false | `string` | `string` | `OK` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `` | `` |
| `data[].tags` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_hash` | false | `string` | `string` | `OK` | `` | `` |
| `data[].valid_from` | false | `integer` | `integer` | `OK` | `141284125` | `` |
| `data[].valid_to` | false | `integer` | `integer` | `OK` | `0` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/contract/{identifier}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/contract/A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT?limit=1&offset=0`
- HTTP: `200`
- Latency: `711ms`
- Counts: expected=26 ok=20 missing=6 null=0 type_mismatch=0 unverified=0 extra=0
- Semantic warnings:
  - `data[].identifier`: `cadence_type_format` (sample=`A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT`)

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset,valid_from)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,body,created_at,deployments,diff,id,identifier,import_count,...)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x82ed1b9cba5bb1b3` | `` |
| `data[].body` | false | `string` | `string` | `OK` | `` | `` |
| `data[].created_at` | false | `string` | `string` | `OK` | `2026-02-07T04:07:44Z` | `` |
| `data[].deployments` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].diff` | false | `string` | `string` | `OK` | `` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT` | `` |
| `data[].identifier` | false | `string` | `string` | `OK` | `A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT` | `cadence_type_format` |
| `data[].import_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].imported_by` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].imported_by[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].imported_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `KARAT2WRXTQSBT` | `` |
| `data[].parent_contract_id` | false | `string` | `string` | `OK` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `` | `` |
| `data[].tags` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_hash` | false | `string` | `string` | `OK` | `` | `` |
| `data[].valid_from` | false | `integer` | `integer` | `OK` | `141284125` | `` |
| `data[].valid_to` | false | `integer` | `integer` | `OK` | `0` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/contract/{identifier}/{id}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/contract/A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT/A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT`
- HTTP: `200`
- Latency: `712ms`
- Counts: expected=26 ok=20 missing=6 null=0 type_mismatch=0 unverified=0 extra=0
- Semantic warnings:
  - `data[].identifier`: `cadence_type_format` (sample=`A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT`)

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset,valid_from)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,body,created_at,deployments,diff,id,identifier,import_count,...)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x82ed1b9cba5bb1b3` | `` |
| `data[].body` | false | `string` | `string` | `OK` | `` | `` |
| `data[].created_at` | false | `string` | `string` | `OK` | `2026-02-07T04:07:44Z` | `` |
| `data[].deployments` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].diff` | false | `string` | `string` | `OK` | `` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT` | `` |
| `data[].identifier` | false | `string` | `string` | `OK` | `A.82ed1b9cba5bb1b3.KARAT2WRXTQSBT` | `cadence_type_format` |
| `data[].import_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].imported_by` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].imported_by[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].imported_count` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `KARAT2WRXTQSBT` | `` |
| `data[].parent_contract_id` | false | `string` | `string` | `OK` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `` | `` |
| `data[].tags` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_hash` | false | `string` | `string` | `OK` | `` | `` |
| `data[].valid_from` | false | `integer` | `integer` | `OK` | `141284125` | `` |
| `data[].valid_to` | false | `integer` | `integer` | `OK` | `0` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/evm/token`
- URL: `https://flowscan.up.railway.app/api/flow/v1/evm/token?limit=1&offset=0`
- HTTP: `200`
- Latency: `734ms`
- Counts: expected=16 ok=2 missing=4 null=0 type_mismatch=0 unverified=10 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].contract_address_hash` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].decimals` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].holders` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].icon_url` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].symbol` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].total_supply` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].transfers` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].type` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/evm/token/{address}`
- SKIP: `missing path param address`

### `GET /flow/v1/evm/transaction`
- URL: `https://flowscan.up.railway.app/api/flow/v1/evm/transaction?limit=1&offset=0`
- HTTP: `200`
- Latency: `676ms`
- Counts: expected=25 ok=16 missing=9 null=0 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=block_number,from,gas_limit,gas_price,gas_used,hash,nonce,position,...)` | `` |
| `data[].block_number` | false | `integer` | `integer` | `OK` | `141453979` | `` |
| `data[].from` | false | `string` | `string` | `OK` | `` | `` |
| `data[].gas_limit` | false | `string` | `string` | `OK` | `0` | `` |
| `data[].gas_price` | false | `string` | `string` | `OK` | `0` | `` |
| `data[].gas_used` | false | `string` | `string` | `OK` | `0` | `` |
| `data[].has_error_in_internal_transactions` | false | `boolean` | `None` | `MISSING` | `` | `` |
| `data[].hash` | false | `string` | `string` | `OK` | `e29a6f3a6a69ac112fcddb198624600cfb4c7d27c46f0475724d877e4d10235f` | `` |
| `data[].max_fee_per_gas` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].max_priority_fee_per_gas` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].nonce` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].position` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].raw_input` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].revert_reason` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `SEALED` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:36:48Z` | `` |
| `data[].to` | false | `string` | `string` | `OK` | `` | `` |
| `data[].type` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].value` | false | `string` | `string` | `OK` | `0` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/evm/transaction/{hash}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/evm/transaction/e29a6f3a6a69ac112fcddb198624600cfb4c7d27c46f0475724d877e4d10235f`
- HTTP: `200`
- Latency: `714ms`
- Counts: expected=18 ok=0 missing=18 null=0 type_mismatch=0 unverified=0 extra=15

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `block_number` | false | `integer` | `None` | `MISSING` | `` | `` |
| `from` | false | `string` | `None` | `MISSING` | `` | `` |
| `gas_limit` | false | `string` | `None` | `MISSING` | `` | `` |
| `gas_price` | false | `string` | `None` | `MISSING` | `` | `` |
| `gas_used` | false | `string` | `None` | `MISSING` | `` | `` |
| `has_error_in_internal_transactions` | false | `boolean` | `None` | `MISSING` | `` | `` |
| `hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `max_fee_per_gas` | false | `string` | `None` | `MISSING` | `` | `` |
| `max_priority_fee_per_gas` | false | `string` | `None` | `MISSING` | `` | `` |
| `nonce` | false | `integer` | `None` | `MISSING` | `` | `` |
| `position` | false | `integer` | `None` | `MISSING` | `` | `` |
| `raw_input` | false | `string` | `None` | `MISSING` | `` | `` |
| `revert_reason` | false | `string` | `None` | `MISSING` | `` | `` |
| `status` | false | `string` | `None` | `MISSING` | `` | `` |
| `timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `to` | false | `string` | `None` | `MISSING` | `` | `` |
| `type` | false | `integer` | `None` | `MISSING` | `` | `` |
| `value` | false | `string` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data` | `array` | `array(len=1)` |
| `data[]` | `object` | `object(keys=block_number,from,gas_limit,gas_price,gas_used,hash,nonce,position,...)` |
| `data[].block_number` | `integer` | `141453979` |
| `data[].from` | `string` | `` |
| `data[].gas_limit` | `string` | `0` |
| `data[].gas_price` | `string` | `0` |
| `data[].gas_used` | `string` | `0` |
| `data[].hash` | `string` | `e29a6f3a6a69ac112fcddb198624600cfb4c7d27c46f0475724d877e4d10235f` |
| `data[].nonce` | `integer` | `0` |
| `data[].position` | `integer` | `0` |
| `data[].status` | `string` | `SEALED` |
| `data[].timestamp` | `string` | `2026-02-07T16:36:48Z` |
| `data[].to` | `string` | `` |
| `data[].type` | `integer` | `0` |
| `data[].value` | `string` | `0` |

</details>

### `GET /flow/v1/ft`
- URL: `https://flowscan.up.railway.app/api/flow/v1/ft?limit=1&offset=0`
- HTTP: `200`
- Latency: `923ms`
- Counts: expected=30 ok=11 missing=19 null=0 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,contract_name,decimals,id,name,symbol,timestamp,updated_at)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x05b67ba314000b2d` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].circulating_supply` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].coingecko` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].coinmarketcap` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].decimals` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `05b67ba314000b2d` | `` |
| `data[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].path` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].path.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].socials` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].socials.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].stats` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].stats.owner_counts` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].stats.total_balance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].symbol` | false | `string` | `string` | `OK` | `` | `` |
| `data[].tags` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].updated_at` | false | `string` | `string` | `OK` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/ft/transfer`
- URL: `https://flowscan.up.railway.app/api/flow/v1/ft/transfer?limit=1&offset=0`
- HTTP: `200`
- Latency: `1332ms`
- Counts: expected=25 ok=2 missing=4 null=0 type_mismatch=0 unverified=19 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].address` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].amount` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].approx_usd_price` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].classifier` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].direction` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].is_primary` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver_balance` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].sender` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.logo` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.symbol` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token.token` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].verified` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/ft/{token}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/ft/05b67ba314000b2d`
- HTTP: `200`
- Latency: `697ms`
- Counts: expected=29 ok=9 missing=20 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,contract_name,decimals,id,name,symbol,timestamp,updated_at)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x05b67ba314000b2d` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].circulating_supply` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].coingecko` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].coinmarketcap` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].decimals` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `05b67ba314000b2d` | `` |
| `data[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].path` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].path.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].socials` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].socials.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].stats` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].stats.owner_counts` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].stats.total_balance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].symbol` | false | `string` | `string` | `OK` | `` | `` |
| `data[].tags` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].updated_at` | `string` | `` |

</details>

### `GET /flow/v1/ft/{token}/account/{address}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/ft/05b67ba314000b2d/account/0xe4cf4bdc1751c65d?limit=1&offset=0`
- HTTP: `200`
- Latency: `698ms`
- Counts: expected=14 ok=1 missing=5 null=0 type_mismatch=0 unverified=8 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].address` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].balance` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].id` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].path` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].token` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].vault_id` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/ft/{token}/holding`
- URL: `https://flowscan.up.railway.app/api/flow/v1/ft/05b67ba314000b2d/holding?limit=1&offset=0`
- HTTP: `200`
- Latency: `688ms`
- Counts: expected=11 ok=7 missing=4 null=0 type_mismatch=0 unverified=0 extra=0
- Semantic warnings:
  - `data[].token`: `cadence_type_expected` (sample=`05b67ba314000b2d`)

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,balance,percentage,token)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x3a00312fd54d466e` | `` |
| `data[].balance` | false | `number` | `integer` | `OK` | `990` | `` |
| `data[].percentage` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].token` | false | `string` | `string` | `OK` | `05b67ba314000b2d` | `cadence_type_expected` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/nft`
- URL: `https://flowscan.up.railway.app/api/flow/v1/nft?limit=1&offset=0`
- HTTP: `200`
- Latency: `794ms`
- Counts: expected=30 ok=12 missing=18 null=0 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,contract_name,display_name,id,name,number_of_tokens,status,timestamp,...)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x1d7e57aa55817448` | `` |
| `data[].banner` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].banner_content_type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].contract_name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].description` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].display_name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].external_url` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `1d7e57aa55817448` | `` |
| `data[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].logo_content_type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].number_of_tokens` | false | `integer` | `integer` | `OK` | `447787` | `` |
| `data[].path` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].path.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].socials` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].socials.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `` | `` |
| `data[].tags` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:42:47Z` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].updated_at` | false | `string` | `string` | `OK` | `2026-02-07T16:42:47Z` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/nft/transfer`
- URL: `https://flowscan.up.railway.app/api/flow/v1/nft/transfer?limit=1&offset=0`
- HTTP: `200`
- Latency: `1289ms`
- Counts: expected=28 ok=2 missing=4 null=0 type_mismatch=0 unverified=22 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].address` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].classifier` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].collection_image` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].collection_name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].current_owner` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].direction` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].display_name` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].edition` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].external_url` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].is_primary` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].max_edition` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].nft_id` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].nft_type` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].receiver` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].sender` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].serial` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].thumbnail` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].verified` | false | `boolean` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/nft/{nft_type}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/nft/1d7e57aa55817448`
- HTTP: `200`
- Latency: `729ms`
- Counts: expected=30 ok=11 missing=19 null=0 type_mismatch=0 unverified=0 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=address,contract_name,display_name,id,name,number_of_tokens,status,timestamp,...)` | `` |
| `data[].address` | false | `string` | `string` | `OK` | `0x1d7e57aa55817448` | `` |
| `data[].banner` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].banner_content_type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].contract_name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].description` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].display_name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].external_url` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `1d7e57aa55817448` | `` |
| `data[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].logo_content_type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `string` | `OK` | `` | `` |
| `data[].number_of_tokens` | false | `integer` | `integer` | `OK` | `447787` | `` |
| `data[].path` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].path.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].socials` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].socials.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `` | `` |
| `data[].tags` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].tags[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:42:48Z` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].updated_at` | false | `string` | `string` | `OK` | `2026-02-07T16:42:48Z` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/nft/{nft_type}/holding`
- URL: `https://flowscan.up.railway.app/api/flow/v1/nft/1d7e57aa55817448/holding?limit=1&offset=0`
- HTTP: `200`
- Latency: `745ms`
- Counts: expected=11 ok=7 missing=4 null=0 type_mismatch=0 unverified=0 extra=0
- Semantic warnings:
  - `data[].nft_type`: `cadence_type_expected` (sample=`1d7e57aa55817448`)

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=count,nft_type,owner,percentage)` | `` |
| `data[].count` | false | `integer` | `integer` | `OK` | `126927` | `` |
| `data[].nft_type` | false | `string` | `string` | `OK` | `1d7e57aa55817448` | `cadence_type_expected` |
| `data[].owner` | false | `string` | `string` | `OK` | `0xe4cf4bdc1751c65d` | `` |
| `data[].percentage` | false | `number` | `number` | `OK` | `0.283453963603231` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /flow/v1/nft/{nft_type}/item/{id}`
- SKIP: `missing path param id`

### `GET /flow/v1/node`
- URL: `https://flowscan.up.railway.app/api/flow/v1/node?limit=1&offset=0`
- HTTP: `501`
- Latency: `939ms`
- Counts: expected=27 ok=1 missing=26 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].city` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].country` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].country_flag` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].delegators` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].delegators_staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].epoch` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].image` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].ip_address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].isp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].latitude` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].longitude` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].node_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].organization` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].role` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].role_id` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].tokens_staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /flow/v1/node/{node_id}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/node/0`
- HTTP: `501`
- Latency: `711ms`
- Counts: expected=26 ok=1 missing=25 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].city` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].country` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].country_flag` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].delegators` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].delegators_staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].epoch` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].image` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].ip_address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].isp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].latitude` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].longitude` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].node_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].organization` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].role` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].role_id` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].tokens_staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /flow/v1/node/{node_id}/reward/delegation`
- URL: `https://flowscan.up.railway.app/api/flow/v1/node/0/reward/delegation?limit=1&offset=0&sort_by=timestamp`
- HTTP: `501`
- Latency: `677ms`
- Counts: expected=13 ok=1 missing=12 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].amount` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].delegator_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].node_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /flow/v1/scheduled-transaction`
- URL: `https://flowscan.up.railway.app/api/flow/v1/scheduled-transaction?id=0&limit=1&offset=0&priority=low&status=scheduled`
- HTTP: `501`
- Latency: `676ms`
- Counts: expected=27 ok=1 missing=26 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].args` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].completed_at` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].completed_block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].completed_transaction` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].created_at` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].execution_effort` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].fees` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].handler` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].handler_contract` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].handler_uuid` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].is_completed` | false | `boolean` | `None` | `MISSING` | `` | `` |
| `data[].owner` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].pin_changed` | false | `boolean` | `None` | `MISSING` | `` | `` |
| `data[].priority` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].scheduled_at` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].scheduled_transaction` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /flow/v1/transaction`
- URL: `https://flowscan.up.railway.app/api/flow/v1/transaction?limit=1&offset=0`
- HTTP: `200`
- Latency: `1342ms`
- Counts: expected=40 ok=17 missing=21 null=2 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count,limit,offset)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=authorizers,block_height,contract_imports,contract_outputs,error,event_count,events,fee,...)` | `` |
| `data[].authorizers` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[].authorizers[]` | false | `string` | `string` | `OK` | `0xe467b9dd11fa00df` | `` |
| `data[].block_height` | false | `integer` | `integer` | `OK` | `141454419` | `` |
| `data[].contract_imports` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].contract_imports[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].contract_outputs[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `string` | `OK` | `` | `` |
| `data[].error_code` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].event_count` | false | `integer` | `integer` | `OK` | `1` | `` |
| `data[].events` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].events[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].events[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].event_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].fields` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].events[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].gas_used` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621` | `` |
| `data[].payer` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].proposer` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `SEALED` | `` |
| `data[].surge_factor` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].tags` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].tags[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].tags[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-07T16:42:40Z` | `` |
| `data[].transaction_body_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].transaction_index` | `integer` | `2` |

</details>

### `GET /flow/v1/transaction/{id}`
- URL: `https://flowscan.up.railway.app/api/flow/v1/transaction/3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621`
- HTTP: `200`
- Latency: `1374ms`
- Counts: expected=45 ok=16 missing=28 null=1 type_mismatch=0 unverified=0 extra=23

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=authorizers,block_height,contract_imports,contract_outputs,error,event_count,events,fee,...)` | `` |
| `data[].argument` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].argument[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].argument[].key` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].argument[].value` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].authorizers` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[].authorizers[]` | false | `string` | `string` | `OK` | `0xe467b9dd11fa00df` | `` |
| `data[].block_height` | false | `integer` | `integer` | `OK` | `141011927` | `` |
| `data[].block_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_imports` | false | `array` | `null` | `NULL` | `null` | `` |
| `data[].contract_imports[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[].contract_outputs[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `string` | `OK` | `` | `` |
| `data[].error_code` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[].events[]` | false | `object` | `object` | `OK` | `object(keys=block_height,event_index,payload,timestamp,transaction,type)` | `` |
| `data[].events[].fields` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].events[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].error_code` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].error_message` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].evm_block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].evm_transaction_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].evm_transactions[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].execution_effort` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `integer` | `OK` | `0` | `` |
| `data[].gas_used` | false | `integer` | `integer` | `OK` | `0` | `` |
| `data[].id` | false | `string` | `string` | `OK` | `3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621` | `` |
| `data[].payer` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].proposer` | false | `string` | `string` | `OK` | `0x0000000000000000` | `` |
| `data[].proposer_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].proposer_sequence_number` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `string` | `OK` | `SEALED` | `` |
| `data[].surge_factor` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `string` | `OK` | `2026-02-03T14:17:14Z` | `` |
| `data[].transaction_body` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_body_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].event_count` | `integer` | `1` |
| `data[].events[].block_height` | `integer` | `141011927` |
| `data[].events[].event_index` | `integer` | `0` |
| `data[].events[].payload` | `object` | `object(keys=hash,height,timestamp,parentHash,prevrandao,receiptRoot,totalSupply,totalGasUsed,...)` |
| `data[].events[].payload.hash` | `array` | `array(len=32)` |
| `data[].events[].payload.hash[]` | `string` | `6` |
| `data[].events[].payload.height` | `string` | `55006764` |
| `data[].events[].payload.parentHash` | `array` | `array(len=32)` |
| `data[].events[].payload.parentHash[]` | `string` | `3` |
| `data[].events[].payload.prevrandao` | `array` | `array(len=32)` |
| `data[].events[].payload.prevrandao[]` | `string` | `64` |
| `data[].events[].payload.receiptRoot` | `array` | `array(len=32)` |
| `data[].events[].payload.receiptRoot[]` | `string` | `86` |
| `data[].events[].payload.timestamp` | `string` | `1770128233` |
| `data[].events[].payload.totalGasUsed` | `string` | `0` |
| `data[].events[].payload.totalSupply` | `string` | `146127973032890790000000000` |
| `data[].events[].payload.transactionHashRoot` | `array` | `array(len=32)` |
| `data[].events[].payload.transactionHashRoot[]` | `string` | `86` |
| `data[].events[].timestamp` | `string` | `2026-02-03T14:17:14Z` |
| `data[].events[].transaction` | `string` | `3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621` |
| `data[].events[].type` | `string` | `A.e467b9dd11fa00df.EVM.BlockExecuted` |
| `data[].tags` | `null` | `null` |
| `data[].transaction_index` | `integer` | `2` |

</details>

### `GET /staking/v1/account/{address}/ft/transfer`
- URL: `https://flowscan.up.railway.app/api/staking/v1/account/0xe4cf4bdc1751c65d/ft/transfer?limit=1&offset=0`
- HTTP: `501`
- Latency: `752ms`
- Counts: expected=25 ok=1 missing=24 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].amount` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].approx_usd_price` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].classifier` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].direction` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].is_primary` | false | `boolean` | `None` | `MISSING` | `` | `` |
| `data[].receiver` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].receiver_balance` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].sender` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].token` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].token.logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].token.name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].token.symbol` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].token.token` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].verified` | false | `boolean` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/account/{address}/transaction`
- URL: `https://flowscan.up.railway.app/api/staking/v1/account/0xe4cf4bdc1751c65d/transaction?limit=1&offset=0`
- HTTP: `501`
- Latency: `690ms`
- Counts: expected=45 ok=1 missing=44 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].authorizers` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].authorizers[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].contract_imports` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].contract_imports[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].contract_outputs[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].entitlements` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].entitlements[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].error_code` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].event_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].events[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].events[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].event_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].events[].fields` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data[].events[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].events[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].gas_used` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].payer` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].proposer` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].raw_roles` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].raw_roles[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].roles` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].roles[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].status` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].tags[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].tags[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].logo` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tags[].type` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_body_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/delegator`
- URL: `https://flowscan.up.railway.app/api/staking/v1/delegator?limit=1&offset=0`
- HTTP: `501`
- Latency: `676ms`
- Counts: expected=12 ok=1 missing=11 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].delegatorid` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].nodeid` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/epoch/stats`
- URL: `https://flowscan.up.railway.app/api/staking/v1/epoch/stats`
- HTTP: `501`
- Latency: `682ms`
- Counts: expected=16 ok=1 missing=15 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].apy` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].epoch` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].payout` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].stake_apy` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].total_delegators` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].total_nodes` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].total_validators` | false | `integer` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/epoch/{epoch}/nodes`
- URL: `https://flowscan.up.railway.app/api/staking/v1/epoch/current/nodes?limit=1&offset=0`
- HTTP: `501`
- Latency: `713ms`
- Counts: expected=20 ok=1 missing=19 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].delegators` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].delegators_staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].epoch` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].ip_address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].isp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].node_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].node_name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].node_organization` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].raw_role` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].role` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].tokens_staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/epoch/{epoch}/role/{role}/nodes/aggregate`
- URL: `https://flowscan.up.railway.app/api/staking/v1/epoch/current/role/collection/nodes/aggregate`
- HTTP: `501`
- Latency: `673ms`
- Counts: expected=9 ok=1 missing=8 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].epoch` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].sum` | false | `integer` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/epoch/{epoch}/role/{role}/nodes/count`
- URL: `https://flowscan.up.railway.app/api/staking/v1/epoch/current/role/collection/nodes/count`
- HTTP: `501`
- Latency: `700ms`
- Counts: expected=8 ok=1 missing=7 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/epoch/{epoch}/role/{role}/nodes/grouped`
- URL: `https://flowscan.up.railway.app/api/staking/v1/epoch/current/role/collection/nodes/grouped`
- HTTP: `501`
- Latency: `720ms`
- Counts: expected=10 ok=1 missing=9 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].epoch` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].organization` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/ft_transfer/{address}`
- URL: `https://flowscan.up.railway.app/api/staking/v1/ft_transfer/0xe4cf4bdc1751c65d?start_date=2020-01-01&end_date=2020-01-01&limit=1&offset=0`
- HTTP: `501`
- Latency: `672ms`
- Counts: expected=15 ok=1 missing=14 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].amount` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].counterparties` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].counterparties[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].token` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/node/{node_id}/event`
- URL: `https://flowscan.up.railway.app/api/staking/v1/node/0/event?start_date=2020-01-01&end_date=2020-01-01&events=Flow.AccountCreated&limit=1&offset=0`
- HTTP: `501`
- Latency: `665ms`
- Counts: expected=14 ok=1 missing=13 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].event_index` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].fields` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].name` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transaction_hash` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/rewards/paid`
- URL: `https://flowscan.up.railway.app/api/staking/v1/rewards/paid`
- HTTP: `501`
- Latency: `876ms`
- Counts: expected=8 ok=1 missing=7 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].total_sum` | false | `number` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/rewards/staking`
- URL: `https://flowscan.up.railway.app/api/staking/v1/rewards/staking?limit=1&offset=0`
- HTTP: `501`
- Latency: `686ms`
- Counts: expected=13 ok=1 missing=12 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].address` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].amount` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].block_height` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].node_id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/tokenomics`
- URL: `https://flowscan.up.railway.app/api/staking/v1/tokenomics`
- HTTP: `501`
- Latency: `674ms`
- Counts: expected=20 ok=1 missing=19 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].circulating_supply` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].delegator_apy` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].delegator_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].delegator_staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].inflation_rate` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].rewards_cumulative` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].rewards_last_epoch` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].tokens_issued_cumulative` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].tokens_issued_last_epoch` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].total_supply` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].validator_apy` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].validator_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].validator_staked` | false | `number` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/transaction/address/{address}`
- URL: `https://flowscan.up.railway.app/api/staking/v1/transaction/address/0xe4cf4bdc1751c65d?start_date=2020-01-01&end_date=2020-01-01&limit=1&offset=0`
- HTTP: `501`
- Latency: `679ms`
- Counts: expected=10 ok=1 missing=9 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].fee` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /staking/v1/transaction/{transaction_id}`
- URL: `https://flowscan.up.railway.app/api/staking/v1/transaction/3408f8b1aa1b33cfc3f78c3f15217272807b14cec4ef64168bcf313bc4174621`
- HTTP: `501`
- Latency: `722ms`
- Counts: expected=10 ok=1 missing=9 null=0 type_mismatch=0 unverified=0 extra=1

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[]` | false | `object` | `None` | `MISSING` | `` | `` |
| `data[].events` | false | `array` | `None` | `MISSING` | `` | `` |
| `data[].events[]` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].id` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `object` | `OK` | `object(keys=message)` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `error.message` | `string` | `endpoint not implemented yet; see /docs/api for status` |

</details>

### `GET /status/v1/count`
- URL: `https://flowscan.up.railway.app/api/status/v1/count`
- HTTP: `200`
- Latency: `674ms`
- Counts: expected=9 ok=2 missing=7 null=0 type_mismatch=0 unverified=0 extra=3

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=block_count,max_height,transaction_count)` | `` |
| `data[].blocks_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].tx_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].block_count` | `integer` | `548150` |
| `data[].max_height` | `integer` | `141454424` |
| `data[].transaction_count` | `integer` | `2229583` |

</details>

### `GET /status/v1/epoch/stat`
- URL: `https://flowscan.up.railway.app/api/status/v1/epoch/stat`
- HTTP: `200`
- Latency: `677ms`
- Counts: expected=16 ok=1 missing=5 null=0 type_mismatch=0 unverified=10 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].apy` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].epoch` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].payout` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].stake_apy` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].staked` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].total_delegators` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].total_nodes` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].total_validators` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /status/v1/epoch/status`
- URL: `https://flowscan.up.railway.app/api/status/v1/epoch/status`
- HTTP: `200`
- Latency: `734ms`
- Counts: expected=17 ok=1 missing=5 null=0 type_mismatch=0 unverified=11 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].duration` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].endView` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].epoch` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].height` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].left` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].percentageLeft` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].stakingView` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].startView` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].timestamp` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].view` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

### `GET /status/v1/flow/stat`
- URL: `https://flowscan.up.railway.app/api/status/v1/flow/stat`
- HTTP: `200`
- Latency: `713ms`
- Counts: expected=12 ok=2 missing=10 null=0 type_mismatch=0 unverified=0 extra=4

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=1)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=block_count,max_height,min_height,tx_count)` | `` |
| `data[].blocks_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].latest_block` | false | `integer` | `None` | `MISSING` | `` | `` |
| `data[].surge_factor` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].timestamp` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].transactions_count` | false | `integer` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].block_count` | `integer` | `548150` |
| `data[].max_height` | `integer` | `141454424` |
| `data[].min_height` | `integer` | `140900000` |
| `data[].tx_count` | `integer` | `2229583` |

</details>

### `GET /status/v1/stat`
- URL: `https://flowscan.up.railway.app/api/status/v1/stat?from=2020-01-01`
- HTTP: `200`
- Latency: `718ms`
- Counts: expected=11 ok=3 missing=8 null=0 type_mismatch=0 unverified=0 extra=4

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=6)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=date,tx_count,active_accounts,new_contracts)` | `` |
| `data[].metric` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].number` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].time` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].timescale` | false | `string` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].active_accounts` | `integer` | `0` |
| `data[].date` | `string` | `2026-02-02` |
| `data[].new_contracts` | `integer` | `0` |
| `data[].tx_count` | `integer` | `202916` |

</details>

### `GET /status/v1/stat/{timescale}/trend`
- URL: `https://flowscan.up.railway.app/api/status/v1/stat/daily/trend?timescale=daily`
- HTTP: `200`
- Latency: `733ms`
- Counts: expected=14 ok=3 missing=11 null=0 type_mismatch=0 unverified=0 extra=4

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `object` | `OK` | `object(keys=count)` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=6)` | `` |
| `data[]` | false | `object` | `object` | `OK` | `object(keys=date,tx_count,active_accounts,new_contracts)` | `` |
| `data[].current_time` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].current_value` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].diff` | false | `number` | `None` | `MISSING` | `` | `` |
| `data[].end_time` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].metric` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].previous_time` | false | `string` | `None` | `MISSING` | `` | `` |
| `data[].previous_value` | false | `number` | `None` | `MISSING` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

<details><summary>Extra Observed Fields (not in spec)</summary>

| Field | Observed | Sample |
|---|---|---|
| `data[].active_accounts` | `integer` | `0` |
| `data[].date` | `string` | `2026-02-02` |
| `data[].new_contracts` | `integer` | `0` |
| `data[].tx_count` | `integer` | `202916` |

</details>

### `GET /status/v1/tokenomics`
- URL: `https://flowscan.up.railway.app/api/status/v1/tokenomics`
- HTTP: `200`
- Latency: `730ms`
- Counts: expected=24 ok=1 missing=5 null=0 type_mismatch=0 unverified=18 extra=0

<details><summary>Field-Level Report (expected vs observed)</summary>

| Field | Required | Expected | Observed | Status | Sample | Warnings |
|---|---:|---|---|---|---|---|
| `_links` | false | `object` | `None` | `MISSING` | `` | `` |
| `_links.*` | false | `string` | `None` | `MISSING` | `` | `` |
| `_meta` | false | `object` | `None` | `MISSING` | `` | `` |
| `_meta.*` | false | `unknown` | `None` | `MISSING` | `` | `` |
| `data` | false | `array` | `array` | `OK` | `array(len=0)` | `` |
| `data[]` | false | `object` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].accounts_storage_flow` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].accounts_storage_used` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].accounts_total` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].circulating_supply` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].delegator_apy` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].delegator_count` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].delegator_staked` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].inflation_rate` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].locked_supply` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].rewards_cumulative` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].rewards_last_epoch` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].tokens_issued_cumulative` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].tokens_issued_last_epoch` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].total_supply` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].validator_apy` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].validator_count` | false | `integer` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `data[].validator_staked` | false | `number` | `None` | `UNVERIFIED_EMPTY_ARRAY` | `` | `` |
| `error` | false | `unknown` | `None` | `MISSING` | `` | `` |

</details>

