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
      { name: 'to', type: 'Address', defaultValue: '0x1654653399040a61' },
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
    id: 'check-balance',
    name: 'Check Balance',
    filename: 'check-balance.cdc',
    cadence: `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

transaction {
    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage.borrow<&FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault reference")

        log("Balance: ".concat(vaultRef.balance.toString()))
    }
}`,
    args: [],
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
      { name: 'to1', type: 'Address', defaultValue: '0x1654653399040a61' },
      { name: 'amount2', type: 'UFix64', defaultValue: '3.0' },
      { name: 'to2', type: 'Address', defaultValue: '0xf233dcee88fe0abe' },
    ],
  },
]
