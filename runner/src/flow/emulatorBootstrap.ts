import { fcl } from './fclConfig';
import { EMULATOR_SERVICE_ADDRESS, EMULATOR_SERVICE_KEY } from './emulatorSigner';
import { signMessage } from '../auth/localKeyManager';
import type { ExecutionResult } from './execute';

/**
 * Contracts to auto-deploy on the emulator service account.
 * FungibleToken, FlowToken, FlowFees are already deployed by the emulator bootstrap.
 * We deploy commonly-imported contracts that are NOT pre-deployed.
 */
const CONTRACTS_TO_DEPLOY: { name: string; source: string }[] = [
  {
    name: 'ViewResolver',
    source: `
access(all) contract interface ViewResolver {
    access(all) resource interface Resolver {
        access(all) view fun getViews(): [Type]
        access(all) fun resolveView(_ view: Type): AnyStruct?
    }
    access(all) resource interface ResolverCollection {
        access(all) view fun getIDs(): [UInt64]
        access(all) view fun borrowViewResolver(id: UInt64): &{Resolver}?
    }
}`,
  },
  {
    name: 'Burner',
    source: `
access(all) contract Burner {
    access(all) event Burned(type: Type, id: UInt64?)
    access(all) fun burn(_ r: @AnyResource) {
        if let b <- r as? @{Burnable} {
            b.burnCallback()
            emit Burned(type: b.getType(), id: nil)
            destroy b
        } else {
            destroy r
        }
    }
    access(all) resource interface Burnable {
        access(contract) fun burnCallback()
    }
}`,
  },
  {
    name: 'NonFungibleToken',
    source: `
import ViewResolver from 0xf8d6e0586b0a20c7
import Burner from 0xf8d6e0586b0a20c7

access(all) contract interface NonFungibleToken {
    access(all) var totalSupply: UInt64
    access(all) event Withdrawn(type: String, id: UInt64, uuid: UInt64, from: Address?, providerUUID: UInt64)
    access(all) event Deposited(type: String, id: UInt64, uuid: UInt64, to: Address?, collectionUUID: UInt64)
    access(all) resource interface NFT: ViewResolver.Resolver {
        access(all) let id: UInt64
    }
    access(all) resource interface Collection: ViewResolver.ResolverCollection {
        access(all) fun deposit(token: @{NFT})
        access(all) view fun getIDs(): [UInt64]
        access(all) view fun borrowNFT(_ id: UInt64): &{NFT}?
        access(all) view fun getLength(): Int
    }
}`,
  },
  {
    name: 'MetadataViews',
    source: `
import NonFungibleToken from 0xf8d6e0586b0a20c7
import ViewResolver from 0xf8d6e0586b0a20c7

access(all) contract MetadataViews {
    access(all) struct Display {
        access(all) let name: String
        access(all) let description: String
        access(all) let thumbnail: AnyStruct
        init(name: String, description: String, thumbnail: AnyStruct) {
            self.name = name
            self.description = description
            self.thumbnail = thumbnail
        }
    }
    access(all) struct HTTPFile {
        access(all) let url: String
        init(url: String) { self.url = url }
    }
    access(all) struct NFTCollectionDisplay {
        access(all) let name: String
        access(all) let description: String
        init(name: String, description: String) {
            self.name = name
            self.description = description
        }
    }
}`,
  },
];

const signFn = async (message: string) => {
  return signMessage(EMULATOR_SERVICE_KEY, message, 'ECDSA_P256', 'SHA3_256');
};

/**
 * Check which standard contracts are missing from the emulator and deploy them.
 */
export async function bootstrapEmulatorContracts(
  onResult?: (result: ExecutionResult) => void,
): Promise<void> {
  const log = (msg: string) => onResult?.({ type: 'log', data: msg });

  let existingContracts: Record<string, string> = {};
  try {
    const account = await fcl.account(`0x${EMULATOR_SERVICE_ADDRESS}`);
    existingContracts = account.contracts || {};
  } catch {
    log('Failed to fetch emulator service account — is the emulator running?');
    return;
  }

  const missing = CONTRACTS_TO_DEPLOY.filter((c) => !(c.name in existingContracts));
  if (missing.length === 0) return;

  log(`Deploying ${missing.length} standard contract(s) to emulator...`);

  for (const contract of missing) {
    try {
      const codeHex = Array.from(new TextEncoder().encode(contract.source))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const deployTx = `
transaction(name: String, code: String) {
  prepare(signer: auth(AddContract) &Account) {
    signer.contracts.add(name: name, code: code.decodeHex())
  }
}`;

      const authz = (account: any) => ({
        ...account,
        tempId: `${EMULATOR_SERVICE_ADDRESS}-0`,
        addr: fcl.sansPrefix(EMULATOR_SERVICE_ADDRESS),
        keyId: 0,
        signingFunction: async (signable: { message: string }) => {
          const sig = await signFn(signable.message);
          return {
            addr: fcl.withPrefix(EMULATOR_SERVICE_ADDRESS),
            keyId: 0,
            signature: sig,
          };
        },
        signatureAlgorithm: 2,
        hashAlgorithm: 3,
      });

      const txId = await fcl.mutate({
        cadence: deployTx,
        args: (arg: any, t: any) => [
          arg(contract.name, t.String),
          arg(codeHex, t.String),
        ],
        proposer: authz,
        payer: authz,
        authorizations: [authz],
        limit: 9999,
      });

      await fcl.tx(txId).onceSealed();
      log(`Deployed ${contract.name}`);
    } catch (err: any) {
      log(`Failed to deploy ${contract.name}: ${err.message}`);
    }
  }
}
