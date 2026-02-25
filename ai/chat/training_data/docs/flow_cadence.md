# Flow Cadence Script Reference

## Overview
Cadence is the smart contract language for the Flow blockchain. Scripts are read-only Cadence code
that can query on-chain state without signatures or fees — analogous to `eth_call` on Ethereum.

## Script Syntax
Every script must have an `access(all) fun main()` entry point:

```cadence
access(all) fun main(): String {
    return "Hello, Flow!"
}
```

Scripts can accept typed arguments:
```cadence
access(all) fun main(addr: Address): UFix64 {
    // query something about addr
}
```

## Core Contract Addresses (Mainnet)

| Contract | Address | Description |
|---|---|---|
| FungibleToken | `0xf233dcee88fe0abe` | FT standard interface |
| NonFungibleToken | `0x1d7e57aa55817448` | NFT standard interface |
| MetadataViews | `0x1d7e57aa55817448` | Standard metadata views |
| FlowToken | `0x1654653399040a61` | Native FLOW token |
| FlowFees | `0xf919ee77447b7497` | Transaction fee collection |
| FlowStorageFees | `0xe467b9dd11fa00df` | Storage fee logic |
| FlowServiceAccount | `0xe467b9dd11fa00df` | Service account contract |
| FlowIDTableStaking | `0x8624b52f9ddcd04a` | Node staking |
| FlowEpoch | `0x8624b52f9ddcd04a` | Epoch management |
| LockedTokens | `0x8d0e87b65159ae63` | Token locking for staking |
| FlowStakingCollection | `0x8d0e87b65159ae63` | Staking collection |
| RandomBeaconHistory | `0xe467b9dd11fa00df` | On-chain randomness |
| NodeVersionBeacon | `0xe467b9dd11fa00df` | Node version tracking |
| FungibleTokenMetadataViews | `0xf233dcee88fe0abe` | FT metadata views |
| FungibleTokenSwitchboard | `0xf233dcee88fe0abe` | Multi-vault receiver |
| ViewResolver | `0x1d7e57aa55817448` | View resolution interface |
| Burner | `0xf233dcee88fe0abe` | Token burn helper |

## Well-Known Community Contracts (Mainnet)

| Contract | Address | Description |
|---|---|---|
| NFTStorefrontV2 | `0x4eb8a10cb9f87357` | NFT marketplace standard |
| TopShot | `0x0b2a3299cc857e29` | NBA Top Shot moments |
| FLOAT | `0x2d4c3caffbeab845` | Proof of attendance |
| FlowIDTableStaking | `0x8624b52f9ddcd04a` | Staking info |

## Common Script Patterns

### Get FLOW balance of an address
```cadence
import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

access(all) fun main(addr: Address): UFix64 {
    let account = getAccount(addr)
    let vaultRef = account.capabilities
        .borrow<&{FungibleToken.Balance}>(/public/flowTokenBalance)
        ?? panic("Could not borrow balance reference")
    return vaultRef.balance
}
```

### Get total supply of FLOW
```cadence
import FlowToken from 0x1654653399040a61

access(all) fun main(): UFix64 {
    return FlowToken.totalSupply
}
```

### Check if an account exists and get its info
```cadence
access(all) fun main(addr: Address): {String: AnyStruct} {
    let account = getAccount(addr)
    return {
        "address": account.address,
        "balance": account.balance,
        "availableBalance": account.availableBalance,
        "storageUsed": account.storage.used,
        "storageCapacity": account.storage.capacity
    }
}
```

### Get current block info
```cadence
access(all) fun main(): {String: AnyStruct} {
    let block = getCurrentBlock()
    return {
        "height": block.height,
        "id": block.id,
        "timestamp": block.timestamp
    }
}
```

### Get staking info for a node
```cadence
import FlowIDTableStaking from 0x8624b52f9ddcd04a

access(all) fun main(): UFix64 {
    return FlowIDTableStaking.getTotalStaked()
}
```

### Get staking info details
```cadence
import FlowIDTableStaking from 0x8624b52f9ddcd04a

access(all) fun main(): {String: AnyStruct} {
    return {
        "totalStaked": FlowIDTableStaking.getTotalStaked(),
        "stakingEnabled": FlowIDTableStaking.getStakingEnabled(),
        "currentEpochCounter": FlowIDTableStaking.getEpochTokenPayout()
    }
}
```

### Check FT balance of any fungible token
```cadence
import FungibleToken from 0xf233dcee88fe0abe

access(all) fun main(addr: Address, storagePath: String): UFix64 {
    let account = getAccount(addr)
    // Note: storagePath must be a valid public path like /public/flowTokenBalance
    // This is a simplified example; real usage requires knowing the vault's public path
    return 0.0
}
```

### List NFTs in an account (generic pattern)
```cadence
import NonFungibleToken from 0x1d7e57aa55817448

access(all) fun main(addr: Address, collectionPath: PublicPath): [UInt64] {
    let account = getAccount(addr)
    let collectionRef = account.capabilities
        .borrow<&{NonFungibleToken.Collection}>(collectionPath)
        ?? panic("Could not borrow collection reference")
    return collectionRef.getIDs()
}
```

## Cadence Type Reference

### Primitive Types
- `Int`, `Int8`, `Int16`, `Int32`, `Int64`, `Int128`, `Int256`
- `UInt`, `UInt8`, `UInt16`, `UInt32`, `UInt64`, `UInt128`, `UInt256`
- `Fix64` (signed fixed-point, 8 decimal places)
- `UFix64` (unsigned fixed-point, 8 decimal places — used for token amounts)
- `Bool`, `String`, `Address`, `Character`
- `Path`, `StoragePath`, `PublicPath`, `PrivatePath`

### Collection Types
- `[T]` — Array
- `{K: V}` — Dictionary
- `{T}` — when used as type restriction (interface conformance)

### Special Types
- `AnyStruct` — any value type
- `AnyResource` — any resource type
- `Void` — no return

## Important Notes
- All token amounts in Cadence use `UFix64` (8 decimal places). `1.0` = 1 FLOW.
- Addresses are prefixed with `0x` and are 16 hex characters (8 bytes).
- Scripts have a compute limit of ~100,000 gas units.
- Scripts can only read state from the last ~100 blocks.
- Use `getAccount(addr)` to access any account's public state.
- Use `getCurrentBlock()` to get current block info.

## JSON-Cadence Argument Format
When calling scripts with arguments, each argument must be encoded as JSON-Cadence:
```json
{"type": "Address", "value": "0x1654653399040a61"}
{"type": "UFix64", "value": "100.00000000"}
{"type": "String", "value": "hello"}
{"type": "UInt64", "value": "42"}
{"type": "Bool", "value": true}
{"type": "Array", "value": [{"type": "String", "value": "a"}]}
```
