/**
 * Cadence 1.0 transaction templates for Flow blockchain operations.
 * All templates use `access(all)` syntax and mainnet contract addresses.
 */

/** Mainnet contract addresses */
export const MAINNET_CONTRACTS = {
  FungibleToken: '0xf233dcee88fe0abe',
  FlowToken: '0x1654653399040a61',
  NonFungibleToken: '0x1d7e57aa55817448',
  FlowIDTableStaking: '0x8624b52f9ddcd04a',
  FlowStakingCollection: '0x8d0e87b65159ae63',
} as const

/** Testnet contract addresses */
export const TESTNET_CONTRACTS = {
  FungibleToken: '0x9a0766d93b6608b7',
  FlowToken: '0x7e60df042a9c0868',
  NonFungibleToken: '0x631e88ae7f1d7c20',
  FlowIDTableStaking: '0x9eca2b38b18b5dfe',
  FlowStakingCollection: '0x95e019a17d0e23d7',
} as const

export function getContracts(network: string) {
  return network === 'testnet' ? TESTNET_CONTRACTS : MAINNET_CONTRACTS
}

/** Transfer FLOW tokens */
export function transferFlowCadence(network: string): string {
  const c = getContracts(network)
  return `
import FungibleToken from ${c.FungibleToken}
import FlowToken from ${c.FlowToken}

transaction(amount: UFix64, to: Address) {
    let sentVault: @{FungibleToken.Vault}

    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow reference to the owner's Vault!")

        self.sentVault <- vaultRef.withdraw(amount: amount)
    }

    execute {
        let receiverRef = getAccount(to)
            .capabilities.borrow<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            ?? panic("Could not borrow receiver reference to the recipient's Vault!")

        receiverRef.deposit(from: <-self.sentVault)
    }
}
`
}

/** Transfer generic fungible tokens */
export function transferFtCadence(network: string, vaultPath: string, receiverPath: string): string {
  const c = getContracts(network)
  return `
import FungibleToken from ${c.FungibleToken}

transaction(amount: UFix64, to: Address) {
    let sentVault: @{FungibleToken.Vault}

    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &{FungibleToken.Vault}>(
            from: ${vaultPath}
        ) ?? panic("Could not borrow reference to the owner's Vault!")

        self.sentVault <- vaultRef.withdraw(amount: amount)
    }

    execute {
        let receiverRef = getAccount(to)
            .capabilities.borrow<&{FungibleToken.Receiver}>(${receiverPath})
            ?? panic("Could not borrow receiver reference to the recipient's Vault!")

        receiverRef.deposit(from: <-self.sentVault)
    }
}
`
}

/** Transfer an NFT */
export function transferNftCadence(
  network: string,
  collectionStoragePath: string,
  collectionPublicPath: string
): string {
  const c = getContracts(network)
  return `
import NonFungibleToken from ${c.NonFungibleToken}

transaction(recipient: Address, withdrawID: UInt64) {
    let withdrawRef: auth(NonFungibleToken.Withdraw) &{NonFungibleToken.Collection}
    let depositRef: &{NonFungibleToken.Collection}

    prepare(signer: auth(BorrowValue) &Account) {
        self.withdrawRef = signer.storage.borrow<auth(NonFungibleToken.Withdraw) &{NonFungibleToken.Collection}>(
            from: ${collectionStoragePath}
        ) ?? panic("Could not borrow a reference to the owner's collection!")

        self.depositRef = getAccount(recipient)
            .capabilities.borrow<&{NonFungibleToken.Collection}>(${collectionPublicPath})
            ?? panic("Could not borrow a reference to the recipient's collection!")
    }

    execute {
        let nft <- self.withdrawRef.withdraw(withdrawID: withdrawID)
        self.depositRef.deposit(token: <-nft)
    }
}
`
}

/** Stake FLOW tokens (delegator) */
export function stakeDelegatorCadence(network: string): string {
  const c = getContracts(network)
  return `
import FlowStakingCollection from ${c.FlowStakingCollection}

transaction(nodeID: String, amount: UFix64) {
    let stakingCollectionRef: auth(FlowStakingCollection.CollectionOwner) &FlowStakingCollection.StakingCollection

    prepare(account: auth(BorrowValue) &Account) {
        self.stakingCollectionRef = account.storage.borrow<auth(FlowStakingCollection.CollectionOwner) &FlowStakingCollection.StakingCollection>(
            from: FlowStakingCollection.StakingCollectionStoragePath
        ) ?? panic("Could not borrow a reference to a StakingCollection in the primary user's account")
    }

    execute {
        self.stakingCollectionRef.stakeNewTokens(nodeID: nodeID, delegatorID: nil, amount: amount)
    }
}
`
}

/** Unstake FLOW tokens */
export function unstakeCadence(network: string): string {
  const c = getContracts(network)
  return `
import FlowStakingCollection from ${c.FlowStakingCollection}

transaction(nodeID: String, delegatorID: UInt32?, amount: UFix64) {
    let stakingCollectionRef: auth(FlowStakingCollection.CollectionOwner) &FlowStakingCollection.StakingCollection

    prepare(account: auth(BorrowValue) &Account) {
        self.stakingCollectionRef = account.storage.borrow<auth(FlowStakingCollection.CollectionOwner) &FlowStakingCollection.StakingCollection>(
            from: FlowStakingCollection.StakingCollectionStoragePath
        ) ?? panic("Could not borrow a reference to a StakingCollection in the primary user's account")
    }

    execute {
        self.stakingCollectionRef.requestUnstaking(nodeID: nodeID, delegatorID: delegatorID, amount: amount)
    }
}
`
}

/** Withdraw staking rewards */
export function withdrawRewardsCadence(network: string): string {
  const c = getContracts(network)
  return `
import FlowStakingCollection from ${c.FlowStakingCollection}

transaction(nodeID: String, delegatorID: UInt32?, amount: UFix64) {
    let stakingCollectionRef: auth(FlowStakingCollection.CollectionOwner) &FlowStakingCollection.StakingCollection

    prepare(account: auth(BorrowValue) &Account) {
        self.stakingCollectionRef = account.storage.borrow<auth(FlowStakingCollection.CollectionOwner) &FlowStakingCollection.StakingCollection>(
            from: FlowStakingCollection.StakingCollectionStoragePath
        ) ?? panic("Could not borrow a reference to a StakingCollection in the primary user's account")
    }

    execute {
        self.stakingCollectionRef.withdrawRewardedTokens(nodeID: nodeID, delegatorID: delegatorID, amount: amount)
    }
}
`
}

/** Create a new Flow account */
export function createAccountCadence(): string {
  return `
transaction(publicKey: String, signatureAlgorithm: UInt8, hashAlgorithm: UInt8) {
    prepare(signer: auth(BorrowValue) &Account) {
        let key = PublicKey(
            publicKey: publicKey.decodeHex(),
            signatureAlgorithm: SignatureAlgorithm(rawValue: signatureAlgorithm)
                ?? panic("Invalid signature algorithm")
        )

        let account = Account(payer: signer)

        account.keys.add(
            publicKey: key,
            hashAlgorithm: HashAlgorithm(rawValue: hashAlgorithm)
                ?? panic("Invalid hash algorithm"),
            weight: UFix64(1000)
        )
    }
}
`
}

/** Add a key to an account */
export function addKeyCadence(): string {
  return `
transaction(publicKey: String, signatureAlgorithm: UInt8, hashAlgorithm: UInt8, weight: UFix64) {
    prepare(signer: auth(Keys) &Account) {
        let key = PublicKey(
            publicKey: publicKey.decodeHex(),
            signatureAlgorithm: SignatureAlgorithm(rawValue: signatureAlgorithm)
                ?? panic("Invalid signature algorithm")
        )

        signer.keys.add(
            publicKey: key,
            hashAlgorithm: HashAlgorithm(rawValue: hashAlgorithm)
                ?? panic("Invalid hash algorithm"),
            weight: weight
        )
    }
}
`
}

/** Remove a key from an account */
export function removeKeyCadence(): string {
  return `
transaction(keyIndex: Int) {
    prepare(signer: auth(Keys) &Account) {
        signer.keys.revoke(keyIndex: keyIndex)
            ?? panic("No key with the given index exists on the account")
    }
}
`
}

/** Batch transfer FLOW to multiple recipients */
export function batchTransferCadence(network: string, count: number): string {
  const c = getContracts(network)

  const addressParams = Array.from({ length: count }, (_, i) => `a${i}: Address`).join(', ')
  const amountParams = Array.from({ length: count }, (_, i) => `m${i}: UFix64`).join(', ')
  const transfers = Array.from(
    { length: count },
    (_, i) => `
        let r${i} = getAccount(a${i})
            .capabilities.borrow<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            ?? panic("Could not borrow receiver for recipient ${i}")
        r${i}.deposit(from: <-vaultRef.withdraw(amount: m${i}))`
  ).join('\n')

  return `
import FungibleToken from ${c.FungibleToken}
import FlowToken from ${c.FlowToken}

transaction(${addressParams}, ${amountParams}) {
    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow reference to the owner's Vault!")
${transfers}
    }
}
`
}

/** EVM.run Cadence script for sending EVM transactions via Flow */
export function evmSendCadence(network: string): string {
  return `
import EVM from ${network === 'testnet' ? '0x8c5303eaa26202d6' : '0xe467b9dd11fa00df'}

transaction(to: String, data: String, gasLimit: UInt64, value: UInt256) {
    let coa: auth(EVM.Call) &EVM.CadenceOwnedAccount

    prepare(signer: auth(BorrowValue) &Account) {
        self.coa = signer.storage.borrow<auth(EVM.Call) &EVM.CadenceOwnedAccount>(
            from: /storage/evm
        ) ?? panic("Could not borrow COA from provided gateway address")
    }

    execute {
        let toBytes = to.decodeHex()
        var evmAddr = EVM.EVMAddress(bytes: [
            toBytes[0], toBytes[1], toBytes[2], toBytes[3], toBytes[4],
            toBytes[5], toBytes[6], toBytes[7], toBytes[8], toBytes[9],
            toBytes[10], toBytes[11], toBytes[12], toBytes[13], toBytes[14],
            toBytes[15], toBytes[16], toBytes[17], toBytes[18], toBytes[19]
        ])

        let dataBytes = data.decodeHex()

        let result = self.coa.call(
            to: evmAddr,
            data: dataBytes,
            gasLimit: gasLimit,
            value: EVM.Balance(attoflow: value)
        )

        assert(result.status == EVM.Status.successful, message: "EVM call failed: ".concat(result.errorMessage))
    }
}
`
}
