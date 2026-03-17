export interface TemplateArg {
  name: string
  type: string
  defaultValue: string
}

export interface Template {
  id: string
  name: string
  filename: string
  cadence: string
  args: TemplateArg[]
  defaultPayer?: string
}

/**
 * Parse transaction/script parameters from Cadence source code.
 * Matches `transaction(amount: UFix64, to: Address)` or `fun main(...)`.
 */
export function parseParamsFromCode(code: string): TemplateArg[] {
  const match =
    code.match(/^\s*transaction\s*\(([^)]*)\)/m) ||
    code.match(/fun\s+main\s*\(([^)]*)\)/)
  if (!match || !match[1].trim()) return []
  return match[1]
    .split(',')
    .map((param) => {
      const trimmed = param.trim()
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) return { name: trimmed, type: 'String', defaultValue: '' }
      const name = trimmed.slice(0, colonIdx).trim()
      const type = trimmed.slice(colonIdx + 1).trim() || 'String'
      return { name, type, defaultValue: defaultForType(type) }
    })
    .filter((p) => p.name)
}

function defaultForType(type: string): string {
  if (type === 'UFix64' || type === 'Fix64') return '0.0'
  if (type === 'Address') return '0x1654653399040a61'
  if (type === 'Bool') return 'true'
  if (type.startsWith('UInt') || type.startsWith('Int') || type === 'UInt' || type === 'Int') return '0'
  if (type.startsWith('[')) return '[]'
  return ''
}

export const templates: Template[] = [
  {
    id: 'transfer-flow',
    name: 'Transfer FLOW',
    filename: 'transfer-flow.cdc',
    cadence: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

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
            ?? panic("Could not borrow receiver reference")

        receiverRef.deposit(from: <- self.sentVault)
    }
}`,
    args: [
      { name: 'amount', type: 'UFix64', defaultValue: '10.0' },
      { name: 'to', type: 'Address', defaultValue: '0xf233dcee88fe0abe' },
    ],
  },
  {
    id: 'create-account',
    name: 'Create Account',
    filename: 'create-account.cdc',
    cadence: `transaction(publicKey: String) {
    prepare(signer: auth(BorrowValue) &Account) {
        let account = Account(payer: signer)

        let key = PublicKey(
            publicKey: publicKey.decodeHex(),
            signatureAlgorithm: SignatureAlgorithm.ECDSA_P256
        )

        account.keys.add(
            publicKey: key,
            hashAlgorithm: HashAlgorithm.SHA3_256,
            weight: 1000.0
        )

        log("Account created: ".concat(account.address.toString()))
    }
}`,
    args: [
      { name: 'publicKey', type: 'String', defaultValue: '930f06f2b2e26ff36e74473b0cad4e5a09192f80215986ec66398848add935e8d3c78aa6ad03362682da9fa1b6b704ce6a467959c30fade2064f0fd80e01bada' },
    ],
  },
  {
    id: 'transfer-nba-topshot',
    name: 'Transfer NBA Moment',
    filename: 'transfer-nba-moment.cdc',
    cadence: `import NonFungibleToken from 0x1d7e57aa55817448
import TopShot from 0x0b2a3299cc857e29

transaction(recipientAddr: Address, momentID: UInt64) {
    let transferToken: @{NonFungibleToken.NFT}

    prepare(signer: auth(BorrowValue) &Account) {
        let collectionRef = signer.storage.borrow<auth(NonFungibleToken.Withdraw) &TopShot.Collection>(
            from: /storage/MomentCollection
        ) ?? panic("Could not borrow reference to the owner's Moment collection")

        self.transferToken <- collectionRef.withdraw(withdrawID: momentID)
    }

    execute {
        let recipientCollection = getAccount(recipientAddr)
            .capabilities.borrow<&{TopShot.MomentCollectionPublic}>(/public/MomentCollection)
            ?? panic("Could not borrow recipient's Moment collection")

        recipientCollection.deposit(token: <- self.transferToken)
    }
}`,
    args: [
      { name: 'recipientAddr', type: 'Address', defaultValue: '0xc8b75d0745d3f284' },
      { name: 'momentID', type: 'UInt64', defaultValue: '18412224' },
    ],
    defaultPayer: '0x220cb8d928c0b076',
  },
  {
    id: 'deploy-contract',
    name: 'Deploy Contract',
    filename: 'deploy-contract.cdc',
    cadence: `transaction(name: String, code: String) {
    prepare(signer: auth(AddContract) &Account) {
        signer.contracts.add(name: name, code: code.utf8)
    }
}`,
    args: [
      { name: 'name', type: 'String', defaultValue: 'HelloWorld' },
      { name: 'code', type: 'String', defaultValue: 'access(all) contract HelloWorld { access(all) fun hello(): String { return "Hello!" } }' },
    ],
  },
  {
    id: 'evm-transfer-flow',
    name: 'EVM: Transfer FLOW',
    filename: 'evm-transfer-flow.cdc',
    cadence: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61
import EVM from 0xe467b9dd11fa00df

/// Transfer FLOW to an EVM address via a Cadence-Owned Account (COA).
/// The signer's Cadence FLOW vault funds the COA, which then calls
/// the recipient EVM address with the specified value.
transaction(recipientEVMAddressHex: String, amount: UFix64) {
    let coa: auth(EVM.Withdraw, EVM.Call) &EVM.CadenceOwnedAccount
    var sentVault: @FlowToken.Vault

    prepare(signer: auth(BorrowValue, SaveValue, Storage) &Account) {
        if signer.storage.type(at: /storage/evm) == nil {
            signer.storage.save(<-EVM.createCadenceOwnedAccount(), to: /storage/evm)
        }
        self.coa = signer.storage.borrow<auth(EVM.Withdraw, EVM.Call) &EVM.CadenceOwnedAccount>(
            from: /storage/evm
        ) ?? panic("Could not borrow COA")

        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault")
        self.sentVault <- vaultRef.withdraw(amount: amount) as! @FlowToken.Vault
    }

    execute {
        self.coa.deposit(from: <-self.sentVault)
        let recipientAddr = EVM.addressFromString(recipientEVMAddressHex)
        let valueBalance = EVM.Balance(attoflow: 0)
        valueBalance.setFLOW(flow: amount)
        let txResult = self.coa.call(
            to: recipientAddr,
            data: [],
            gasLimit: 21000,
            value: valueBalance
        )
        assert(
            txResult.status == EVM.Status.successful,
            message: "EVM transfer failed: ".concat(txResult.errorMessage)
        )
    }
}`,
    args: [
      { name: 'recipientEVMAddressHex', type: 'String', defaultValue: '0x000000000000000000000000000000000000dEaD' },
      { name: 'amount', type: 'UFix64', defaultValue: '1.0' },
    ],
  },
  {
    id: 'evm-call-contract',
    name: 'EVM: Call Contract',
    filename: 'evm-call-contract.cdc',
    cadence: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61
import EVM from 0xe467b9dd11fa00df

/// Call an EVM smart contract via a Cadence-Owned Account (COA).
/// Provide the contract address, ABI-encoded calldata (hex), value
/// to send (in FLOW), and a gas limit. The COA is funded from the
/// signer's Cadence FLOW vault before making the call.
transaction(evmContractHex: String, calldata: String, amount: UFix64, gasLimit: UInt64) {
    let coa: auth(EVM.Withdraw, EVM.Call) &EVM.CadenceOwnedAccount
    var sentVault: @FlowToken.Vault

    prepare(signer: auth(BorrowValue, SaveValue, Storage) &Account) {
        if signer.storage.type(at: /storage/evm) == nil {
            signer.storage.save(<-EVM.createCadenceOwnedAccount(), to: /storage/evm)
        }
        self.coa = signer.storage.borrow<auth(EVM.Withdraw, EVM.Call) &EVM.CadenceOwnedAccount>(
            from: /storage/evm
        ) ?? panic("Could not borrow COA")

        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault")
        self.sentVault <- vaultRef.withdraw(amount: amount) as! @FlowToken.Vault
    }

    execute {
        self.coa.deposit(from: <-self.sentVault)
        let contractAddr = EVM.addressFromString(evmContractHex)
        let data = calldata.decodeHex()
        let valueBalance = EVM.Balance(attoflow: 0)
        valueBalance.setFLOW(flow: amount)
        let txResult = self.coa.call(
            to: contractAddr,
            data: data,
            gasLimit: gasLimit,
            value: valueBalance
        )
        assert(
            txResult.status == EVM.Status.failed || txResult.status == EVM.Status.successful,
            message: "EVM call reverted: ".concat(txResult.errorMessage)
        )
    }
}`,
    args: [
      { name: 'evmContractHex', type: 'String', defaultValue: '0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e' },
      { name: 'calldata', type: 'String', defaultValue: '70a08231000000000000000000000000000000000000000000000000000000000000dEaD' },
      { name: 'amount', type: 'UFix64', defaultValue: '0.0' },
      { name: 'gasLimit', type: 'UInt64', defaultValue: '100000' },
    ],
  },
  {
    id: 'evm-deploy-contract',
    name: 'EVM: Deploy Contract',
    filename: 'evm-deploy-contract.cdc',
    cadence: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61
import EVM from 0xe467b9dd11fa00df

/// Deploy an EVM smart contract via a Cadence-Owned Account (COA).
/// Provide the contract bytecode (hex) and an initial FLOW value to
/// send with the deployment (usually 0.0).
transaction(bytecode: String, amount: UFix64, gasLimit: UInt64) {
    let coa: auth(EVM.Withdraw, EVM.Deploy) &EVM.CadenceOwnedAccount
    var sentVault: @FlowToken.Vault

    prepare(signer: auth(BorrowValue, SaveValue, Storage) &Account) {
        if signer.storage.type(at: /storage/evm) == nil {
            signer.storage.save(<-EVM.createCadenceOwnedAccount(), to: /storage/evm)
        }
        self.coa = signer.storage.borrow<auth(EVM.Withdraw, EVM.Deploy) &EVM.CadenceOwnedAccount>(
            from: /storage/evm
        ) ?? panic("Could not borrow COA")

        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault")
        self.sentVault <- vaultRef.withdraw(amount: amount) as! @FlowToken.Vault
    }

    execute {
        self.coa.deposit(from: <-self.sentVault)
        let code = bytecode.decodeHex()
        let valueBalance = EVM.Balance(attoflow: 0)
        valueBalance.setFLOW(flow: amount)
        let deployedAddr = self.coa.deploy(
            code: code,
            gasLimit: gasLimit,
            value: valueBalance
        )
        log("Deployed to: ".concat(deployedAddr.toString()))
    }
}`,
    args: [
      { name: 'bytecode', type: 'String', defaultValue: '6080604052348015600e575f5ffd5b50608580601a5f395ff3fe6080604052348015600e575f5ffd5b50600436106026575f3560e01c8063c605f76c14602a575b5f5ffd5b60306044565b604051603b9190606a565b60405180910390f35b5f602a905090565b5f819050919050565b6064816054565b82525050565b5f602082019050607b5f830184605d565b9291505056fea164736f6c634300081d000a' },
      { name: 'amount', type: 'UFix64', defaultValue: '0.0' },
      { name: 'gasLimit', type: 'UInt64', defaultValue: '1000000' },
    ],
  },
  {
    id: 'transfer-flow-multi',
    name: 'Multi Transfer',
    filename: 'multi-transfer.cdc',
    cadence: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

transaction(amount1: UFix64, to1: Address, amount2: UFix64, to2: Address) {
    let vault1: @{FungibleToken.Vault}
    let vault2: @{FungibleToken.Vault}

    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault")

        self.vault1 <- vaultRef.withdraw(amount: amount1)
        self.vault2 <- vaultRef.withdraw(amount: amount2)
    }

    execute {
        let receiver1 = getAccount(to1)
            .capabilities.borrow<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            ?? panic("Could not borrow receiver 1")
        receiver1.deposit(from: <- self.vault1)

        let receiver2 = getAccount(to2)
            .capabilities.borrow<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            ?? panic("Could not borrow receiver 2")
        receiver2.deposit(from: <- self.vault2)
    }
}`,
    args: [
      { name: 'amount1', type: 'UFix64', defaultValue: '5.0' },
      { name: 'to1', type: 'Address', defaultValue: '0xc1e160d6ed546c26' },
      { name: 'amount2', type: 'UFix64', defaultValue: '3.0' },
      { name: 'to2', type: 'Address', defaultValue: '0xf233dcee88fe0abe' },
    ],
  },
]
