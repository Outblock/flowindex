import * as fcl from "@onflow/fcl";

/** Generated from Cadence files */
/** Flow Signer interface for transaction signing */
export interface FlowSigner {
  address: string;
  keyIndex: number;
  sign(signableData: Uint8Array): Promise<Uint8Array>;
  authzFunc: (account: any) => Promise<any>;
}

export interface CompositeSignature {
  addr: string;
  keyId: number;
  signature: string;
}

export interface AuthorizationAccount extends Record<string, any> {
  tempId: string;
  addr: string;
  keyId: number;
  signingFunction: (signable: { message: string }) => Promise<CompositeSignature>;
}

export type AuthorizationFunction = (account: any) => Promise<AuthorizationAccount>;

/** Network addresses for contract imports */
export const addresses = {"mainnet":{"0xCapabilityDelegator":"0xd8a7e05a7ac670c0","0xCapabilityFactory":"0xd8a7e05a7ac670c0","0xCapabilityFilter":"0xd8a7e05a7ac670c0","0xCrossVMMetadataViews":"0x1d7e57aa55817448","0xDomains":"0x233eb012d34b0070","0xEVM":"0xe467b9dd11fa00df","0xEVMUtils":"0x1e4aa0b87d10b141","0xFLOAT":"0x2d4c3caffbeab845","0xFiatToken":"0xb19436aae4d94622","0xFind":"0x097bafa4e0b48eef","0xFlowEVMBridge":"0x1e4aa0b87d10b141","0xFlowEVMBridgeConfig":"0x1e4aa0b87d10b141","0xFlowEVMBridgeUtils":"0x1e4aa0b87d10b141","0xFlowEpoch":"0x8624b52f9ddcd04a","0xFlowFees":"0xf919ee77447b7497","0xFlowIDTableStaking":"0x8624b52f9ddcd04a","0xFlowServiceAccount":"0xe467b9dd11fa00df","0xFlowStakingCollection":"0x8d0e87b65159ae63","0xFlowStorageFees":"0xe467b9dd11fa00df","0xFlowTableStaking":"0x8624b52f9ddcd04a","0xFlowToken":"0x1654653399040a61","0xFlowns":"0x233eb012d34b0070","0xFungibleToken":"0xf233dcee88fe0abe","0xFungibleTokenMetadataViews":"0xf233dcee88fe0abe","0xHybridCustody":"0xd8a7e05a7ac670c0","0xLockedTokens":"0x8d0e87b65159ae63","0xLostAndFound":"0x473d6a2c37eab5be","0xMetadataViews":"0x1d7e57aa55817448","0xNonFungibleToken":"0x1d7e57aa55817448","0xScopedFTProviders":"0x1e4aa0b87d10b141","0xStakingCollection":"0x8d0e87b65159ae63","0xStakingProxy":"0x62430cf28c26d095","0xStorageRent":"0x707adbad1428c624","0xSwapError":"0xb78ef7afa52ff906","0xSwapRouter":"0xa6850776a94e6551","0xUSDCFlow":"0xf1ab99c82dee3526","0xViewResolver":"0x1d7e57aa55817448","0xstFlowToken":"0xd6f80565193ad727"},"testnet":{"0xCapabilityDelegator":"0x294e44e1ec6993c6","0xCapabilityFactory":"0x294e44e1ec6993c6","0xCapabilityFilter":"0x294e44e1ec6993c6","0xCrossVMMetadataViews":"0x631e88ae7f1d7c20","0xDomains":"0xb05b2abb42335e88","0xEVM":"0x8c5303eaa26202d6","0xEVMUtils":"0xdfc20aee650fcbdf","0xFLOAT":"0x0afe396ebc8eee65","0xFiatToken":"0xa983fecbed621163","0xFind":"0xa16ab1d0abde3625","0xFlowEVMBridge":"0xdfc20aee650fcbdf","0xFlowEVMBridgeConfig":"0xdfc20aee650fcbdf","0xFlowEVMBridgeUtils":"0xdfc20aee650fcbdf","0xFlowEpoch":"0x9eca2b38b18b5dfe","0xFlowFees":"0x912d5440f7e3769e","0xFlowIDTableStaking":"0x9eca2b38b18b5dfe","0xFlowServiceAccount":"0x8c5303eaa26202d6","0xFlowStakingCollection":"0x95e019a17d0e23d7","0xFlowStorageFees":"0x8c5303eaa26202d6","0xFlowTableStaking":"0x9eca2b38b18b5dfe","0xFlowToken":"0x7e60df042a9c0868","0xFlowns":"0xb05b2abb42335e88","0xFungibleToken":"0x9a0766d93b6608b7","0xFungibleTokenMetadataViews":"0x9a0766d93b6608b7","0xHybridCustody":"0x294e44e1ec6993c6","0xLockedTokens":"0x95e019a17d0e23d7","0xLostAndFound":"0xbe4635353f55bbd4","0xMetadataViews":"0x631e88ae7f1d7c20","0xNonFungibleToken":"0x631e88ae7f1d7c20","0xScopedFTProviders":"0xdfc20aee650fcbdf","0xStakingCollection":"0x95e019a17d0e23d7","0xStakingProxy":"0x7aad92e5a0715d21","0xStorageRent":"0xd50084a1a43b1507","0xSwapError":"0xddb929038d45d4b3","0xSwapRouter":"0x2f8af5ed05bbde0d","0xUSDCFlow":"0x64adf39cbc354fcb","0xViewResolver":"0x631e88ae7f1d7c20","0xstFlowToken":"0xe45c64ecfe31e465"}};

/** Generated Cadence interface */
export interface ChildAccountInfo {
    factory: CapabilityFactoryGetter;
    filter: CapabilityFilterFilter;
}

/** Generated Cadence interface */
export interface CollectionData {
    storagePath: string;
    publicPath: string;
    publicCollection: string;
    publicLinkedType: string;
}

/** Generated Cadence interface */
export interface DelegatorInfo {
    id: number;
    nodeID: string;
    nodeInfo: NodeInfo;
    tokensCommitted: string;
    tokensStaked: string;
    tokensUnstaking: string;
    tokensRewarded: string;
    tokensUnstaked: string;
    tokensRequestedToUnstake: string;
}

/** Generated Cadence interface */
export interface EpochInfo {
    currentEpochCounter: number;
    currentEpochPhase: number;
}

/** Generated Cadence interface */
export interface FTVaultInfo {
    name?: string | undefined;
    symbol?: string | undefined;
    description?: string | undefined;
    logos?: MetadataViewsMedias | undefined;
    socials?: Record<string, MetadataViewsExternalURL> | undefined;
    balance: string;
    contractAddress: string;
    contractName: string;
    storagePath: string;
    receiverPath?: string | undefined;
    balancePath?: string | undefined;
    identifier: string;
    evmAddress?: string | undefined;
}

/** Generated Cadence interface */
export interface FlowEpochEpochMetadata {
    counter: number;
    seed: string;
    startView: number;
    endView: number;
    stakingEndView: number;
    collectorClusters: FlowClusterQCCluster[];
}

/** Generated Cadence interface */
export interface FlowIDTableStakingDelegatorInfo {
    id: number;
    nodeID: string;
    tokensCommitted: string;
    tokensStaked: string;
    tokensUnstaking: string;
    tokensRewarded: string;
    tokensUnstaked: string;
    tokensRequestedToUnstake: string;
}

/** Generated Cadence interface */
export interface FlowIDTableStakingNodeInfo {
    id: string;
    role: number;
    networkingAddress: string;
    networkingKey: string;
    stakingKey: string;
    tokensStaked: string;
    tokensCommitted: string;
    tokensUnstaking: string;
    tokensUnstaked: string;
    tokensRewarded: string;
    delegators: number[];
    delegatorIDCounter: number;
    tokensRequestedToUnstake: string;
    initialWeight: number;
}

/** Generated Cadence interface */
export interface FlowStakingCollectionMachineAccountInfo {
    nodeID: string;
    role: number;
    machineAccountVaultProvider: any;
}

/** Generated Cadence interface */
export interface LockedAccountInfo {
    lockedAddress: string;
    lockedBalance: string;
    unlockLimit: string;
}

/** Generated Cadence interface */
export interface ManagerInfo {
    childAccounts: ChildAccountInfo[];
    ownedAccounts: ChildAccountInfo[];
    isManagerExists: boolean;
}

/** Generated Cadence interface */
export interface MetadataViewsDisplay {
    name: string;
    description: string;
    thumbnail: any;
}

/** Generated Cadence interface */
export interface MetadataViewsExternalURL {
    url: string;
}

/** Generated Cadence interface */
export interface MetadataViewsMedias {
    items: Media[];
}

/** Generated Cadence interface */
export interface NFTCollection {
    id: string;
    path: string;
    collectionDisplay?: any | undefined;
    collectionData?: NFTCollectionData | undefined;
    ids: number[];
}

/** Generated Cadence interface */
export interface NFTCollectionData {
    storagePath: string;
    publicPath: string;
    publicCollection: string;
    publicLinkedType: string;
}

/** Generated Cadence interface */
export interface NodeInfo {
    id: string;
    networkingAddress: string;
    role: number;
    tokensStaked: string;
    tokensCommitted: string;
    tokensUnstaking: string;
    tokensUnstaked: string;
    tokensRewarded: string;
    delegatorIDCounter: number;
    tokensRequestedToUnstake: string;
    initialWeight: number;
}

/** Generated Cadence interface */
export interface OwnedAccountInfo {
    display?: MetadataViewsDisplay | undefined;
    parents: ParentInfo[];
    owner?: string | undefined;
    isOwnedAccountExists: boolean;
}

/** Generated Cadence interface */
export interface ParentInfo {
    address: string;
    isClaimed: boolean;
    childAccount?: ChildAccountInfo | undefined;
}

/** Generated Cadence interface */
export interface Response {
    tokens: FTVaultInfo[];
    storage: StorageInfo;
}

/** Generated Cadence interface */
export interface Result {
    stakingInfo?: StakingInfo | undefined;
}

/** Generated Cadence interface */
export interface StakingInfo {
    epochInfo: EpochInfo;
    lockedAccountInfo?: LockedAccountInfo | undefined;
    nodeInfos: NodeInfo[];
    delegatorInfos: DelegatorInfo[];
    machineAccounts: Record<string, FlowStakingCollectionMachineAccountInfo>;
}

/** Generated Cadence interface */
export interface StorageInfo {
    storageUsedInMB: string;
    storageAvailableInMB: string;
    storageCapacityInMB: string;
    lockedFLOWforStorage: string;
    availableBalanceToUse: string;
}

export type CapabilityFactoryGetter = any;
export type CapabilityFilterFilter = any;
export type FlowClusterQCCluster = any;
export type Media = any;

type RequestInterceptor = (config: any) => any | Promise<any>;
type ResponseInterceptor = (config: any, response: any) => { config: any; response: any } | Promise<{ config: any; response: any }>;

export class CadenceService {
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];

  constructor() {
  }

  useRequestInterceptor(interceptor: RequestInterceptor) {
    this.requestInterceptors.push(interceptor);
  }

  useResponseInterceptor(interceptor: ResponseInterceptor) {
    this.responseInterceptors.push(interceptor);
  }

  private async runRequestInterceptors(config: any) {
    let c = config;
    for (const interceptor of this.requestInterceptors) {
      c = await interceptor(c);
    }
    return c;
  }

  private async runResponseInterceptors(config: any, response: any) {
    let c = config;
    let r = response;
    for (const interceptor of this.responseInterceptors) {
      const result = await interceptor(c, r);
      c = result.config;
      r = result.response;
    }
    return { config: c, response: r };
  }



  // Tag: CadenceDomain
  public async getAddressOfDomain(name: string, root: string): Promise<string| undefined> {
    const code = `
import FlowDomainUtils from 0xFlowbox

access(all) fun main(name: String, root: String): Address? {
  return FlowDomainUtils.getAddressOfDomain(name: name, root: root)
}
`;
    let config = {
      cadence: code.trim(),
      name: "getAddressOfDomain",
      type: "script",
      args: (arg: any, t: any) => [
        arg(name, t.String),
        arg(root, t.String),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getDefaultDomainsOfAddress(address: string): Promise<Record<string, string>> {
    const code = `
import FlowDomainUtils from 0xFlowbox

access(all) fun main(address: Address): {String: String} {
  return FlowDomainUtils.getDefaultDomainsOfAddress(address)
}
`;
    let config = {
      cadence: code.trim(),
      name: "getDefaultDomainsOfAddress",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }

  // Tag: CadenceEvm
  public async getCoa(flowAddress: string): Promise<string| undefined> {
    const code = `
import EVM from 0xEVM

access(all) fun main(flowAddress: Address): String? {
    if let address: EVM.EVMAddress = getAuthAccount<auth(BorrowValue) &Account>(flowAddress)
        .storage.borrow<&EVM.CadenceOwnedAccount>(from: /storage/evm)?.address() {
        let bytes: [UInt8] = []
        for byte in address.bytes {
            bytes.append(byte)
        }
        return String.encodeHex(bytes)
    }
    return nil
}
`;
    let config = {
      cadence: code.trim(),
      name: "getCoa",
      type: "script",
      args: (arg: any, t: any) => [
        arg(flowAddress, t.Address),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }

  // Tag: CadenceHybridcustody
  public async getHcManagerInfo(child: string): Promise<ManagerInfo> {
    const code = `
import HybridCustody from 0xHybridCustody
import MetadataViews from 0xMetadataViews
import CapabilityFactory from 0xCapabilityFactory
import CapabilityFilter from 0xCapabilityFilter

access(all) struct ChildAccountInfo {
  access(all) let address: Address
  access(all) let display: MetadataViews.Display?
  access(all) let factorySupportedTypes: [Type]?
  access(all) let filterDetails: AnyStruct?
  access(all) let managerFilterDetails: AnyStruct?

  init(
    address: Address,
    display: MetadataViews.Display?,
    factorySupportedTypes: [Type]?,
    filterDetails: AnyStruct?,
    managerFilterDetails: AnyStruct?
  ) {
    self.address = address
    self.display = display
    self.factorySupportedTypes = factorySupportedTypes
    self.filterDetails = filterDetails
    self.managerFilterDetails = managerFilterDetails
  }
}

access(all) struct ManagerInfo {
  access(all) let childAccounts: [ChildAccountInfo]
  access(all) let ownedAccounts: [ChildAccountInfo]
  access(all) let isManagerExists: Bool

  init(
    childAccounts: [ChildAccountInfo],
    ownedAccounts: [ChildAccountInfo],
    isManagerExists: Bool
  ) {
    self.childAccounts = childAccounts
    self.ownedAccounts = ownedAccounts
    self.isManagerExists = isManagerExists
  }
}

access(all) fun main(child: Address): ManagerInfo {
    let acct = getAuthAccount<auth(Storage) &Account>(child)
    let m = acct.storage.borrow<auth(HybridCustody.Manage) &HybridCustody.Manager>(from: HybridCustody.ManagerStoragePath)
    
    if let manager = m {
      return ManagerInfo(
        childAccounts: getChildAccounts(manager: manager),
        ownedAccounts: getOwnedAccounts(manager: manager),
        isManagerExists: true
      )
    }

    return ManagerInfo(
      childAccounts: [],
      ownedAccounts: [],
      isManagerExists: false
    )
}

access(all) fun getChildAccounts(manager: auth(HybridCustody.Manage) &HybridCustody.Manager): [ChildAccountInfo] {
  let childAddresses = manager.getChildAddresses()
  let children: [ChildAccountInfo] = []
  for childAddress in childAddresses {
    let display = manager.getChildAccountDisplay(address: childAddress)
    var factorySupportedTypes: [Type]? = nil
    var filterDetails: AnyStruct? = nil
    var managerFilterDetails: AnyStruct? = nil
    if let acct = manager.borrowAccount(addr: childAddress) {
      if let factory = acct.getCapabilityFactoryManager() {
        factorySupportedTypes = factory.getSupportedTypes()
      }
      if let filter = acct.getCapabilityFilter() {
        filterDetails = filter.getDetails()
      }
      if let mFilter = acct.getManagerCapabilityFilter() {
        managerFilterDetails = mFilter.getDetails()
      }
    }
    let child = ChildAccountInfo(address: childAddress, display: display, factorySupportedTypes: factorySupportedTypes, filterDetails: filterDetails, managerFilterDetails: managerFilterDetails)
    children.append(child)
  }

  return children
}

access(all) fun getOwnedAccounts(manager: auth(HybridCustody.Manage) &HybridCustody.Manager): [ChildAccountInfo] {
  let ownedAddresses = manager.getOwnedAddresses()
  let children: [ChildAccountInfo] = []
  for ownedAddress in ownedAddresses {
    if let o = manager.borrowOwnedAccount(addr: ownedAddress) {
      let d = o.resolveView(Type<MetadataViews.Display>()) as? MetadataViews.Display? 
      if let display = d {
        let child = ChildAccountInfo(address: ownedAddress, display: display, factorySupportedTypes: nil, filterDetails: nil, managerFilterDetails: nil)
        children.append(child)
      }
    } else {
      children.append(ChildAccountInfo(address: ownedAddress, display: nil, factorySupportedTypes: nil, filterDetails: nil, managerFilterDetails: nil))
    }
  }
  return children
}
`;
    let config = {
      cadence: code.trim(),
      name: "getHcManagerInfo",
      type: "script",
      args: (arg: any, t: any) => [
        arg(child, t.Address),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getOwnedAccountInfo(child: string): Promise<OwnedAccountInfo> {
    const code = `
import HybridCustody from 0xHybridCustody
import MetadataViews from 0xMetadataViews
import CapabilityFactory from 0xCapabilityFactory
import CapabilityFilter from 0xCapabilityFilter

access(all) struct OwnedAccountInfo {
  access(all) let display: MetadataViews.Display?
  access(all) let parents: [ParentInfo]
  access(all) let owner: Address?
  access(all) let isOwnedAccountExists: Bool

  init(
    display: MetadataViews.Display?, 
    parents: [ParentInfo],
    owner: Address?,
    isOwnedAccountExists: Bool
  ) {
    self.display = display
    self.parents = parents
    self.owner = owner
    self.isOwnedAccountExists = isOwnedAccountExists
  }
}

access(all) struct ParentInfo {
  access(all) let address: Address
  access(all) let isClaimed: Bool
  access(all) let childAccount: ChildAccountInfo?

  init(
    address: Address,
    isClaimed: Bool,
    childAccount: ChildAccountInfo?
  ) {
    self.address = address
    self.isClaimed = isClaimed
    self.childAccount = childAccount
  }
}

access(all) struct ChildAccountInfo {
  access(all) let factory: &{CapabilityFactory.Getter}
  access(all) let filter: &{CapabilityFilter.Filter}

  init(
    factory: &{CapabilityFactory.Getter},
    filter: &{CapabilityFilter.Filter}
  ) {
    self.factory = factory
    self.filter = filter
  }
}

access(all) fun main(child: Address): OwnedAccountInfo {
    let acct = getAuthAccount<auth(Storage, Inbox, Capabilities) &Account>(child)
    let o = acct.storage.borrow<auth(HybridCustody.Owner) &HybridCustody.OwnedAccount>(from: HybridCustody.OwnedAccountStoragePath)
    if let owned = o {
      let viewType = Type<MetadataViews.Display>()
      let display = owned.resolveView(viewType) as! MetadataViews.Display?
      let parentAddresses = owned.getParentAddresses()
      let parents: [ParentInfo] = []
      for parent in parentAddresses {
        var childInfo: ChildAccountInfo? = nil
        if let child = owned.borrowChildAccount(parent: parent) {
            if let factory = child.getCapabilityFactoryManager() {
                if let filter = child.getCapabilityFilter() {
                    childInfo = ChildAccountInfo(factory: factory, filter: filter)
                }
            }
        }

        let isClaimed = owned.getRedeemedStatus(addr: parent) ?? false
        let p = ParentInfo(address: parent, isClaimed: isClaimed, childAccount: childInfo)

        parents.append(p)
      }

      return OwnedAccountInfo(
        display: display,
        parents: parents,
        owner: owned.getOwner(),
        isOwnedAccountExists: true
      )
    }

    return OwnedAccountInfo(
      display: nil,
      parents: [],
      owner: nil,
      isOwnedAccountExists: false
    )
}
`;
    let config = {
      cadence: code.trim(),
      name: "getOwnedAccountInfo",
      type: "script",
      args: (arg: any, t: any) => [
        arg(child, t.Address),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }

  // Tag: CadenceNft
  public async getAllNftCount(address: string): Promise<number> {
    const code = `
import NonFungibleToken from 0xNonFungibleToken
import MetadataViews from 0xMetadataViews
import ViewResolver from 0xMetadataViews

access(all) fun main(address: Address): Int {
    let account = getAccount(address)
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    var count = 0

    fun eachPath(path: StoragePath, Type: Type): Bool {
        if Type != nil {
            if Type.isSubtype(of: collectionType) && !Type.isRecovered {
                let pathStr = path.toString()
                let splitArr = pathStr.split(separator: "/")
                let identifier = splitArr[2]

                var acc = getAuthAccount<auth(Storage) &Account>(address)
                var obj = acc.storage.borrow<&AnyResource>(from: StoragePath(identifier: identifier)!)!
                var meta = obj as? &{ViewResolver.ResolverCollection}
                count = count + meta!.getIDs().length
            }
        }
        return true
    }
    account.storage.forEachStored(eachPath)

    return count
}
`;
    let config = {
      cadence: code.trim(),
      name: "getAllNftCount",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getAllNfts(address: string, start: number, end: number): Promise<any[]> {
    const code = `
import NonFungibleToken from 0xNonFungibleToken
import MetadataViews from 0xMetadataViews
import ViewResolver from 0xMetadataViews


access(all) struct CollectionData {
    access(all) let storagePath: StoragePath
    access(all) let publicPath: PublicPath
    access(all) let publicCollection: Type
    access(all) let publicLinkedType: Type

    init(
        storagePath: StoragePath,
        publicPath: PublicPath,
        publicCollection: Type,
        publicLinkedType: Type,
    ) {
        self.storagePath = storagePath
        self.publicPath = publicPath
        self.publicCollection = publicCollection
        self.publicLinkedType = publicLinkedType
    }
}

access(all) fun getNFTDetail(_ resolver: &{ViewResolver.Resolver}, id: UInt64): {String: AnyStruct} {
    let res: {String: AnyStruct} = {}
    if resolver != nil {
        if let rarity = MetadataViews.getRarity(resolver) {
            res["rarity"] = rarity
        }

        if let display = MetadataViews.getDisplay(resolver) {
            res["display"] = display
        }

        if let editions = MetadataViews.getEditions(resolver) {
            res["editions"] = editions
        }

        if let serial = MetadataViews.getSerial(resolver) {
            res["serial"] = serial
        }

        if let royalties = MetadataViews.getRoyalties(resolver) {
            res["royalties"] = royalties
        }

        if let license = MetadataViews.getLicense(resolver) {
            res["license"] = license
        }

        if let medias = MetadataViews.getMedias(resolver) {
            res["medias"] = medias
        }

        if let externalURL = MetadataViews.getExternalURL(resolver) {
            res["externalURL"] = externalURL
        }

        if let traits = MetadataViews.getTraits(resolver) {
            res["traits"] = traits
        }

        if let collectionDisplay = MetadataViews.getNFTCollectionDisplay(resolver) {
            res["collectionDisplay"] = collectionDisplay
        }

        if let collectionData = MetadataViews.getNFTCollectionData(resolver) {
            let data = CollectionData(
                storagePath: collectionData.storagePath,
                publicPath: collectionData.publicPath,
                publicCollection: collectionData.publicCollection,
                publicLinkedType: collectionData.publicLinkedType,
            )
            res["collectionData"] = data
        }
    }
    res["tokenId"] = id
    return res
}

access(all) fun main(address: Address, start: Int, end: Int): [AnyStruct] {
    var results: [AnyStruct] = []
    var acc = getAuthAccount<auth(Storage) &Account>(address)
    var index = 0

    acc.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
        if type.isSubtype(of: Type<@{NonFungibleToken.Collection}>()) && !type.isRecovered {
            var collection = acc.storage.borrow<&{NonFungibleToken.Collection}>(from: path)!
            let ids = collection.getIDs()
            for id in ids {
                if index >= start && index < end {
                    var resolver = collection.borrowViewResolver(id: id)

                    if resolver != nil {
                        var res = getNFTDetail(resolver!, id: id)
                        results.append(res)
                    } else {
                        let res: {String: AnyStruct} = {}
                        let nft = collection.borrowNFT(id)!
                        res["tokenId"] = nft.id
                        res["display"] = nft.resolveView(Type<MetadataViews.Display>())
                        results.append(res)
                    }
                }
                index = index + 1
            }
        }
        return true
    })
    return results
}
`;
    let config = {
      cadence: code.trim(),
      name: "getAllNfts",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
        arg(start, t.Int),
        arg(end, t.Int),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getCollectionCount(address: string, pathId: string, ids: string[]): Promise<Record<string, any>> {
    const code = `
import NonFungibleToken from 0xNonFungibleToken
    import MetadataViews from 0xMetadataViews
    import ViewResolver from 0xMetadataViews

   
    access(all) struct CollectionData {
      access(all) let storagePath: StoragePath
      access(all) let publicPath: PublicPath
      access(all) let publicCollection: Type
      access(all) let publicLinkedType: Type

      init(
        storagePath: StoragePath,
        publicPath: PublicPath,
        publicCollection: Type,
        publicLinkedType: Type,
      ) {
        self.storagePath = storagePath
        self.publicPath = publicPath
        self.publicCollection = publicCollection
        self.publicLinkedType = publicLinkedType
      }
    }

    access(all) fun getNFTDetail(_ resolver: &{ViewResolver.Resolver}, id: UInt64): {String: AnyStruct} {
      let res: {String: AnyStruct} = {}
      if resolver != nil {
        if let rarity = MetadataViews.getRarity(resolver) {
          res["rarity"] = rarity
        }

        if let display = MetadataViews.getDisplay(resolver) {
          res["display"] = display
        }

        if let editions = MetadataViews.getEditions(resolver) {
          res["editions"] = editions
        }

        if let serial = MetadataViews.getSerial(resolver) {
          res["serial"] = serial
        }

        if let royalties = MetadataViews.getRoyalties(resolver) {
          res["royalties"] = royalties
        }

        if let license = MetadataViews.getLicense(resolver) {
          res["license"] = license
        }

        if let medias = MetadataViews.getMedias(resolver) {
          res["medias"] = medias
        }

        if let externalURL = MetadataViews.getExternalURL(resolver) {
          res["externalURL"] = externalURL
        }

        if let traits = MetadataViews.getTraits(resolver) {
          res["traits"] = traits
        }

        if let collectionDisplay = MetadataViews.getNFTCollectionDisplay(resolver) {
          res["collectionDisplay"] = collectionDisplay
        }

        if let collectionData = MetadataViews.getNFTCollectionData(resolver) {
          let data = CollectionData(
            storagePath: collectionData.storagePath,
            publicPath: collectionData.publicPath,
            publicCollection: collectionData.publicCollection,
            publicLinkedType: collectionData.publicLinkedType,
          )
          res["collectionData"] = data
        }
      }
      res["tokenId"] = id
      return res
    } 


    access(all) fun main(address: Address, pathId: String, ids: [String]): {String: AnyStruct} {
      let account = getAuthAccount<auth(Storage) &Account>(address)
      let collectionType = Type<@{NonFungibleToken.Collection}>()
      var index = 0
      let nftsInfo: [{String: AnyStruct}] = []

      let pubPath = PublicPath(identifier: pathId)!
      let storagePath = StoragePath(identifier: pathId)!
      var count = 0
      let collection =  account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath)!
      let ids = collection.getIDs()
      count = ids.length
      
      for id in ids {
        if index >= start && index < end {
          let resolver = collection.borrowViewResolver(id: id)
          if resolver != nil {
            nftsInfo.append(getNFTDetail(resolver!, id: id))
          }
        }
        index = index + 1
      }
      return {"nfts": nftsInfo, "nftCount": count }
    }
`;
    let config = {
      cadence: code.trim(),
      name: "getCollectionCount",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
        arg(pathId, t.String),
        arg(ids, t.Array(t.String)),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getCollectionInfo(address: string, pathID: string): Promise<NFTCollection> {
    const code = `
import MetadataViews from 0xMetadataViews
import ViewResolver from 0xViewResolver
import NonFungibleToken from 0xNonFungibleToken

access(all) struct NFTCollectionData {
    access(all) let storagePath: StoragePath
    access(all) let publicPath: PublicPath
    access(all) let publicCollection: Type
    access(all) let publicLinkedType: Type

    view init(
        storagePath: StoragePath,
        publicPath: PublicPath,
        publicCollection: Type,
        publicLinkedType: Type,
    ) {
        self.storagePath = storagePath
        self.publicPath = publicPath
        self.publicCollection = publicCollection
        self.publicLinkedType = publicLinkedType
    }
}

access(all) struct NFTCollection {
    access(all) let id: String
    access(all) let path: String
    access(all) let collectionDisplay: AnyStruct?
    access(all) let collectionData: NFTCollectionData?
    access(all) let ids: [UInt64]

    init(id: String, path: String, collectionDisplay: AnyStruct?, collectionData: NFTCollectionData?, ids: [UInt64]) {
        self.id = id
        self.path = path
        self.collectionDisplay = collectionDisplay
        self.collectionData = collectionData
        self.ids = ids
    }
}

access(all) fun getDisplay(address: Address, storagePath: StoragePath, publicPath: PublicPath): AnyStruct? {
    let account = getAuthAccount<auth(Storage) &Account>(address)
    let resourceType = Type<@AnyResource>()
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let metadataViewType = Type<@{ViewResolver.ResolverCollection}>()
    var item: AnyStruct? = nil

    if let type = account.storage.type(at: storagePath) {
        let isResource = type.isSubtype(of: resourceType)
        let isNFTCollection = type.isSubtype(of: collectionType)
        let conformedMetadataViews = type.isSubtype(of: metadataViewType)

        var tokenIDs: [UInt64] = []
        if let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath) {
            tokenIDs = collection.getIDs()

            if tokenIDs.length > 0 {
                let resolver = collection.borrowViewResolver(id: tokenIDs[0])
                if resolver != nil {
                    if let display = MetadataViews.getNFTCollectionDisplay(resolver!) {
                        item = display
                    }
                }
            }
        }
    }

    return item
}

access(all) fun getCollectionData(address: Address, storagePath: StoragePath, publicPath: PublicPath): NFTCollectionData? {
    let account = getAuthAccount<auth(Storage) &Account>(address)
    let resourceType = Type<@AnyResource>()
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let metadataViewType = Type<@{ViewResolver.ResolverCollection}>()
    var item: NFTCollectionData? = nil

    if let type = account.storage.type(at: storagePath) {
        let isResource = type.isSubtype(of: resourceType)
        let isNFTCollection = type.isSubtype(of: collectionType)
        let conformedMetadataViews = type.isSubtype(of: metadataViewType)

        var tokenIDs: [UInt64] = []
        if isNFTCollection && conformedMetadataViews {
            if let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath) {
                tokenIDs = collection.getIDs()

                if tokenIDs.length > 0 {
                    let resolver = collection.borrowViewResolver(id: tokenIDs[0])
                    if resolver != nil {
                        if let data = MetadataViews.getNFTCollectionData(resolver!) {
                            item = NFTCollectionData(
                                storagePath: data.storagePath,
                                publicPath: data.publicPath,
                                publicCollection: data.publicCollection,
                                publicLinkedType: data.publicLinkedType
                            )
                        }
                    }
                }
            }
        }
    }

    return item
}

access(all) fun main(address: Address, pathID: String): NFTCollection {
    let account = getAuthAccount<auth(Storage) &Account>(address)
    let storagePath = StoragePath(identifier: pathID)!
    let publicPath = PublicPath(identifier: pathID)!
    let collection = account.storage.borrow<&{ViewResolver.ResolverCollection}>(from: storagePath)!
    return NFTCollection(
        id: account.storage.type(at: storagePath)!.identifier,
        path: storagePath.toString(),
        collectionDisplay: getDisplay(address: address, storagePath: storagePath, publicPath: publicPath),
        collectionData: getCollectionData(address: address, storagePath: storagePath, publicPath: publicPath),
        ids: collection.getIDs()
    )
}
`;
    let config = {
      cadence: code.trim(),
      name: "getCollectionInfo",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
        arg(pathID, t.String),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getNftCollections(address: string): Promise<NFTCollection[]> {
    const code = `
import MetadataViews from 0xMetadataViews
  import ViewResolver from 0xViewResolver
  import NonFungibleToken from 0xNonFungibleToken

  access(all) struct NFTCollectionData {
    /// Path in storage where this NFT is recommended to be stored.
    access(all) let storagePath: StoragePath

    /// Public path which must be linked to expose public capabilities of this NFT
    /// including standard NFT interfaces and metadataviews interfaces
    access(all) let publicPath: PublicPath

    /// The concrete type of the collection that is exposed to the public
    /// now that entitlements exist, it no longer needs to be restricted to a specific interface
    access(all) let publicCollection: Type

    /// Type that should be linked at the aforementioned public path
    access(all) let publicLinkedType: Type

    view init(
        storagePath: StoragePath,
        publicPath: PublicPath,
        publicCollection: Type,
        publicLinkedType: Type,
    ) {

        self.storagePath=storagePath
        self.publicPath=publicPath
        self.publicCollection=publicCollection
        self.publicLinkedType=publicLinkedType
    }
  }

  access(all) struct NFTCollection {
    access(all) let id: String
    access(all) let path: String
    access(all) let collectionDisplay: AnyStruct?
    access(all) let collectionData: NFTCollectionData?
    access(all) let ids: [UInt64]

    init(id:String, path: String, collectionDisplay: AnyStruct?, collectionData: NFTCollectionData?, ids: [UInt64]) {
      self.id = id
      self.path = path
      self.collectionDisplay = collectionDisplay
      self.collectionData = collectionData
      self.ids = ids
    }
  }

  access(all) fun getDisplay(address: Address, storagePath: StoragePath, publicPath: PublicPath): AnyStruct? {
    let account = getAuthAccount<auth(Storage) &Account>(address)
    let resourceType = Type<@AnyResource>()
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let metadataViewType = Type<@{ViewResolver.ResolverCollection}>()
    var item: AnyStruct? =  nil

      if let type = account.storage.type(at: storagePath)  {
        let isResource = type.isSubtype(of: resourceType)
        let isNFTCollection = type.isSubtype(of: collectionType)
        let conformedMetadataViews = type.isSubtype(of: metadataViewType)

        var tokenIDs: [UInt64] = []
        if isNFTCollection && conformedMetadataViews {
          let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath)!
          tokenIDs = collection.getIDs()

          // TODO: move to a list
          if tokenIDs.length > 0
          && storagePath != /storage/RaribleNFTCollection
          && storagePath != /storage/ARTIFACTPackV3Collection
          && storagePath != /storage/ArleeScene {
            let resolver = collection.borrowViewResolver(id: tokenIDs[0])
            if resolver != nil {
                if let display = MetadataViews.getNFTCollectionDisplay(resolver!) {
                item = display
              }
            } else {
              let nft = collection.borrowNFT(tokenIDs[0])!
              if let display = nft.resolveView(Type<MetadataViews.NFTCollectionDisplay>()) {
                item = display
              }
            }
          }
        }
      }

    return item
  }

  access(all) fun getCollectionData(address: Address, storagePath: StoragePath, publicPath: PublicPath): NFTCollectionData? {
    let account =  getAuthAccount<auth(Storage) &Account>(address)
    let resourceType = Type<@AnyResource>()
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let metadataViewType = Type<@{ViewResolver.ResolverCollection}>()
    var item: NFTCollectionData? =  nil

      if let type = account.storage.type(at: storagePath) {
        let isResource = type.isSubtype(of: resourceType)
        let isNFTCollection = type.isSubtype(of: collectionType)
        let conformedMetadataViews = type.isSubtype(of: metadataViewType)

        var tokenIDs: [UInt64] = []
        if isNFTCollection && conformedMetadataViews {
          if let collectionRef = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath) {
            tokenIDs = collectionRef.getIDs()

            // TODO: move to a list
            if tokenIDs.length > 0 {
              let resolver = collectionRef.borrowViewResolver(id: tokenIDs[0])
              if resolver != nil {
                  if let data = MetadataViews.getNFTCollectionData(resolver!) {
                  item = NFTCollectionData(
                    storagePath: data.storagePath,
                    publicPath: data.publicPath,
                    publicCollection:data.publicCollection,
                    publicLinkedType:data.publicLinkedType
                  )
                }
              }
            }
          }
        }
      }

    return item
  }

  access(all) fun main(address: Address): [NFTCollection] {
    let account = getAuthAccount<auth(Storage) &Account>(address)

    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let collectionPaths: [StoragePath] = []
    let collections: [NFTCollection] = []

    fun eachPath(path: StoragePath, Type: Type): Bool {

      if Type != nil {
        if Type.isSubtype(of: collectionType) && !Type.isRecovered {
          collectionPaths.append(path)
        }
      }
      return true
    }

    account.storage.forEachStored(eachPath)

    for path in collectionPaths {
      let pathStr = path.toString()
      let splitArr = pathStr.split(separator: "/")
      let identifier = splitArr[2]
      let pubPath = PublicPath(identifier: identifier)!

      var collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from:path)!

      if path == /storage/findCharityCollection {
        continue
      }

      collections.append(
        NFTCollection(
        id: account.storage.type(at: path)!.identifier,
        path: pubPath.toString(),
        collectionDisplay: getDisplay(address: address, storagePath: path, publicPath: pubPath),
        collectionData: getCollectionData(address: address, storagePath: path, publicPath: pubPath),
        ids: collection.getIDs()
        )
      )
    }

    return collections
  }
`;
    let config = {
      cadence: code.trim(),
      name: "getNftCollections",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getNftDetail(address: string, pathId: string, tokenID: number): Promise<Record<string, any>> {
    const code = `
import NonFungibleToken from 0xNonFungibleToken
import MetadataViews from 0xMetadataViews
import ViewResolver from 0xMetadataViews


access(all) struct CollectionData {
    access(all) let storagePath: StoragePath
    access(all) let publicPath: PublicPath
    access(all) let publicCollection: Type
    access(all) let publicLinkedType: Type

    init(
        storagePath: StoragePath,
        publicPath: PublicPath,
        publicCollection: Type,
        publicLinkedType: Type,
    ) {
        self.storagePath = storagePath
        self.publicPath = publicPath
        self.publicCollection = publicCollection
        self.publicLinkedType = publicLinkedType
    }
}

access(all) fun main(address: Address, pathId: String, tokenID: UInt64): {String: AnyStruct} {
    let account = getAccount(address)
    let res: {String: AnyStruct} = {}

    let storagePath = StoragePath(identifier: pathId)!
    let publicPath = PublicPath(identifier: pathId)!
    let collectionRef = account.capabilities.borrow<&{NonFungibleToken.Collection, ViewResolver.ResolverCollection}>(publicPath)
    if collectionRef == nil {
        panic("Get Collection Failed")
    }

    let type = account.storage.type(at: storagePath)
    if type == nil {
        return res
    }

    let metadataViewType = Type<@{ViewResolver.ResolverCollection}>()
    let conformedMetadataViews = type!.isSubtype(of: metadataViewType)

    if (!conformedMetadataViews) {
        return res
    }

    collectionRef!.borrowNFT(tokenID)

    let resolver = collectionRef!.borrowViewResolver(id: tokenID)!
    if resolver != nil {
        if let rarity = MetadataViews.getRarity(resolver) {
            res["rarity"] = rarity
        }

        if let display = MetadataViews.getDisplay(resolver) {
            res["display"] = display
        }

        if let editions = MetadataViews.getEditions(resolver) {
            res["editions"] = editions
        }

        if let serial = MetadataViews.getSerial(resolver) {
            res["serial"] = serial
        }

        if let royalties = MetadataViews.getRoyalties(resolver) {
            res["royalties"] = royalties
        }

        if let license = MetadataViews.getLicense(resolver) {
            res["license"] = license
        }

        if let medias = MetadataViews.getMedias(resolver) {
            res["medias"] = medias
        }

        if let externalURL = MetadataViews.getExternalURL(resolver) {
            res["externalURL"] = externalURL
        }

        if let traits = MetadataViews.getTraits(resolver) {
            res["traits"] = traits
        }

        if let collectionDisplay = MetadataViews.getNFTCollectionDisplay(resolver) {
            res["collectionDisplay"] = collectionDisplay
        }

        if let collectionData = MetadataViews.getNFTCollectionData(resolver) {
            let data = CollectionData(
                storagePath: collectionData.storagePath,
                publicPath: collectionData.publicPath,
                publicCollection: collectionData.publicCollection,
                publicLinkedType: collectionData.publicLinkedType,
            )
            res["collectionData"] = data
        }
    }
    res["tokenId"] = tokenID

    return res
}
`;
    let config = {
      cadence: code.trim(),
      name: "getNftDetail",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
        arg(pathId, t.String),
        arg(tokenID, t.UInt64),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getNftListPublic(address: string, pathId: string, start: number, end: number): Promise<Record<string, any>[]> {
    const code = `
import NonFungibleToken from 0xNonFungibleToken
import MetadataViews from 0xMetadataViews
import ViewResolver from 0xMetadataViews


access(all) struct CollectionData {
    access(all) let storagePath: StoragePath
    access(all) let publicPath: PublicPath
    access(all) let publicCollection: Type
    access(all) let publicLinkedType: Type

    init(
        storagePath: StoragePath,
        publicPath: PublicPath,
        publicCollection: Type,
        publicLinkedType: Type,
    ) {
        self.storagePath = storagePath
        self.publicPath = publicPath
        self.publicCollection = publicCollection
        self.publicLinkedType = publicLinkedType
    }
}

access(all) fun main(address: Address, pathId: String, start: Int, end: Int): [{String: AnyStruct}] {
    let account = getAccount(address)
    let nfts: [{String: AnyStruct}] = []

    let storagePath = StoragePath(identifier: pathId)!
    let publicPath = PublicPath(identifier: pathId)!
    let collectionRef = account.capabilities.borrow<&{NonFungibleToken.Collection, ViewResolver.ResolverCollection}>(publicPath)
    if collectionRef == nil {
        panic("Get Collection Failed")
    }

    let type = account.storage.type(at: storagePath)
    if type == nil {
        return nfts
    }

    let metadataViewType = Type<@{ViewResolver.ResolverCollection}>()
    let conformedMetadataViews = type!.isSubtype(of: metadataViewType)

    let tokenIDs = collectionRef!.getIDs()

    if (!conformedMetadataViews || tokenIDs.length == 0) {
        return nfts
    }

    for tokenID in tokenIDs {
        let res: {String: AnyStruct} = {}

        collectionRef!.borrowNFT(tokenID)

        let resolver = collectionRef!.borrowViewResolver(id: tokenID)!
        if resolver != nil {
            if let rarity = MetadataViews.getRarity(resolver) {
                res["rarity"] = rarity
            }

            if let display = MetadataViews.getDisplay(resolver) {
                res["display"] = display
            }

            if let editions = MetadataViews.getEditions(resolver) {
                res["editions"] = editions
            }

            if let serial = MetadataViews.getSerial(resolver) {
                res["serial"] = serial
            }

            if let royalties = MetadataViews.getRoyalties(resolver) {
                res["royalties"] = royalties
            }

            if let license = MetadataViews.getLicense(resolver) {
                res["license"] = license
            }

            if let medias = MetadataViews.getMedias(resolver) {
                res["medias"] = medias
            }

            if let externalURL = MetadataViews.getExternalURL(resolver) {
                res["externalURL"] = externalURL
            }

            if let traits = MetadataViews.getTraits(resolver) {
                res["traits"] = traits
            }

            if let collectionDisplay = MetadataViews.getNFTCollectionDisplay(resolver) {
                res["collectionDisplay"] = collectionDisplay
            }

            if let collectionData = MetadataViews.getNFTCollectionData(resolver) {
                let data = CollectionData(
                    storagePath: collectionData.storagePath,
                    publicPath: collectionData.publicPath,
                    publicCollection: collectionData.publicCollection,
                    publicLinkedType: collectionData.publicLinkedType,
                )
                res["collectionData"] = data
            }
        }
        res["tokenId"] = tokenID

        nfts.append(res)
    }
    let len = nfts.length
    var endNum = end
    if len < start {
        return []
    } else {
        if len < end {
            endNum = len
        }
    }

    return nfts.slice(from: start, upTo: endNum)
}
`;
    let config = {
      cadence: code.trim(),
      name: "getNftListPublic",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
        arg(pathId, t.String),
        arg(start, t.Int),
        arg(end, t.Int),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }

  // Tag: CadenceStaking
  public async getDelegatorInfo(nodeID: string, delegatorID: number): Promise<FlowIDTableStakingDelegatorInfo> {
    const code = `
import FlowIDTableStaking from 0x8624b52f9ddcd04a

access(all) fun main(nodeID: String, delegatorID: UInt32): FlowIDTableStaking.DelegatorInfo {
  return FlowIDTableStaking.DelegatorInfo(nodeID: nodeID, delegatorID: delegatorID)
}
`;
    let config = {
      cadence: code.trim(),
      name: "getDelegatorInfo",
      type: "script",
      args: (arg: any, t: any) => [
        arg(nodeID, t.String),
        arg(delegatorID, t.UInt32),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getEpochMetadata(epochCounter: number): Promise<FlowEpochEpochMetadata| undefined> {
    const code = `
import FlowEpoch from 0x8624b52f9ddcd04a

access(all) fun main(epochCounter: UInt64): FlowEpoch.EpochMetadata? {
  return FlowEpoch.getEpochMetadata(epochCounter)
}
`;
    let config = {
      cadence: code.trim(),
      name: "getEpochMetadata",
      type: "script",
      args: (arg: any, t: any) => [
        arg(epochCounter, t.UInt64),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getNodeInfo(nodeID: string): Promise<FlowIDTableStakingNodeInfo> {
    const code = `
import FlowIDTableStaking from 0x8624b52f9ddcd04a

access(all) fun main(nodeID: String): FlowIDTableStaking.NodeInfo {
  return FlowIDTableStaking.NodeInfo(nodeID: nodeID)
}
`;
    let config = {
      cadence: code.trim(),
      name: "getNodeInfo",
      type: "script",
      args: (arg: any, t: any) => [
        arg(nodeID, t.String),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }


  public async getStakingInfo(address: string): Promise<Result> {
    const code = `
import LockedTokens from 0x8d0e87b65159ae63
import FlowIDTableStaking from 0x8624b52f9ddcd04a
import FlowEpoch from 0x8624b52f9ddcd04a
import FlowStakingCollection from 0x8d0e87b65159ae63

access(all) struct EpochInfo {
  access(all) let currentEpochCounter: UInt64
  access(all) let currentEpochPhase: UInt8

  init(
      currentEpochCounter: UInt64,
      currentEpochPhase: UInt8
  ) {
      self.currentEpochCounter = currentEpochCounter
      self.currentEpochPhase = currentEpochPhase
  }
}

access(all) struct Result {
  access(all) let stakingInfo: StakingInfo?

  init(stakingInfo: StakingInfo?) {
    self.stakingInfo = stakingInfo
  }
}

access(all) struct LockedAccountInfo {
  access(all) let lockedAddress: Address   
  access(all) let lockedBalance: UFix64
  access(all) let unlockLimit: UFix64 

  init(
    lockedAddress: Address,
    lockedBalance: UFix64,
    unlockLimit: UFix64,
  ) {
    self.lockedAddress = lockedAddress
    self.lockedBalance = lockedBalance
    self.unlockLimit = unlockLimit
  }
}

access(all) struct StakingInfo {
  access(all) let epochInfo: EpochInfo
  access(all) let lockedAccountInfo: LockedAccountInfo?
  access(all) let nodeInfos: [NodeInfo]
  access(all) let delegatorInfos: [DelegatorInfo]
  access(all) let machineAccounts: {String: FlowStakingCollection.MachineAccountInfo}

  init(
    epochInfo: EpochInfo,
    lockedAccountInfo: LockedAccountInfo?,
    nodeInfos: [NodeInfo],
    delegatorInfos: [DelegatorInfo],
    machineAccounts: {String: FlowStakingCollection.MachineAccountInfo}
  ) {
    self.epochInfo = epochInfo
    self.lockedAccountInfo = lockedAccountInfo
    self.nodeInfos = nodeInfos
    self.delegatorInfos = delegatorInfos
    self.machineAccounts = machineAccounts
  }
}

access(all) struct NodeInfo {
  access(all) let id: String
  access(all) let networkingAddress: String
  access(all) let role: UInt8
  access(all) let tokensStaked: UFix64
  access(all) let tokensCommitted: UFix64
  access(all) let tokensUnstaking: UFix64
  access(all) let tokensUnstaked: UFix64
  access(all) let tokensRewarded: UFix64
  
  access(all) let delegatorIDCounter: UInt32
  access(all) let tokensRequestedToUnstake: UFix64
  access(all) let initialWeight: UInt64

  init(nodeID: String) {
    let nodeInfo = FlowIDTableStaking.NodeInfo(nodeID: nodeID) 

    self.id = nodeInfo.id
    self.networkingAddress = nodeInfo.networkingAddress
    self.role = nodeInfo.role
    self.tokensStaked = nodeInfo.tokensStaked
    self.tokensCommitted = nodeInfo.tokensCommitted
    self.tokensUnstaking = nodeInfo.tokensUnstaking
    self.tokensUnstaked = nodeInfo.tokensUnstaked
    self.tokensRewarded = nodeInfo.tokensRewarded
    self.delegatorIDCounter = nodeInfo.delegatorIDCounter
    self.tokensRequestedToUnstake = nodeInfo.tokensRequestedToUnstake
    self.initialWeight = nodeInfo.initialWeight
  }
}

access(all) struct DelegatorInfo {
  access(all) let id: UInt32
  access(all) let nodeID: String
  access(all) let nodeInfo: NodeInfo
  access(all) let tokensCommitted: UFix64
  access(all) let tokensStaked: UFix64
  access(all) let tokensUnstaking: UFix64
  access(all) let tokensRewarded: UFix64
  access(all) let tokensUnstaked: UFix64
  access(all) let tokensRequestedToUnstake: UFix64

  init(nodeID: String, delegatorID: UInt32) {
    let delegatorInfo = FlowIDTableStaking.DelegatorInfo(nodeID: nodeID, delegatorID: delegatorID)
    let nodeInfo = NodeInfo(nodeID: delegatorInfo.nodeID)

    self.id = delegatorInfo.id
    self.nodeID = delegatorInfo.nodeID
    self.nodeInfo = nodeInfo
    self.tokensCommitted = delegatorInfo.tokensCommitted
    self.tokensStaked = delegatorInfo.tokensStaked
    self.tokensUnstaking = delegatorInfo.tokensUnstaking
    self.tokensRewarded = delegatorInfo.tokensRewarded
    self.tokensUnstaked = delegatorInfo.tokensUnstaked
    self.tokensRequestedToUnstake = delegatorInfo.tokensRequestedToUnstake
  }
}

access(all) fun main(address: Address): Result {
  let epochInfo = EpochInfo(
    currentEpochCounter: FlowEpoch.currentEpochCounter,
    currentEpochPhase: FlowEpoch.currentEpochPhase.rawValue
  )

  let account = getAuthAccount<auth(Storage, Contracts, Keys, Inbox, Capabilities) &Account>(address)
  let tokenHolderRef = account.storage.borrow<auth(LockedTokens.TokenOperations) &LockedTokens.TokenHolder>(from: LockedTokens.TokenHolderStoragePath)

  var stakingInfo: StakingInfo? = nil
  if let tokenHolder = tokenHolderRef {
    let lockedAddress = tokenHolder.getLockedAccountAddress()       
    let lockedBalance = tokenHolder.getLockedAccountBalance()
    let unlockLimit = tokenHolder.getUnlockLimit()
    let lockedAccountInfo = LockedAccountInfo(
      lockedAddress: lockedAddress,
      lockedBalance: lockedBalance,
      unlockLimit: unlockLimit
    )
    
    var nodeInfo: NodeInfo? = nil
    if let nodeID = tokenHolder.getNodeID() {
      nodeInfo = NodeInfo(nodeID: nodeID)
    }

    var delegatorInfo: DelegatorInfo? = nil
    if let delegatorNodeID = tokenHolder.getDelegatorNodeID() {
      if let delegatorID = tokenHolder.getDelegatorID() {
        delegatorInfo = DelegatorInfo(nodeID: delegatorNodeID, delegatorID: delegatorID)
      } 
    } 

    let nodeInfos: [NodeInfo] = []
    if let nodeInfo = nodeInfo {
      nodeInfos.append(nodeInfo)
    }

    let delegatorInfos: [DelegatorInfo] = []
    if let delegatorInfo = delegatorInfo {
      delegatorInfos.append(delegatorInfo)
    }
    stakingInfo = StakingInfo(
      epochInfo: epochInfo,
      lockedAccountInfo: lockedAccountInfo,
      nodeInfos: nodeInfos,
      delegatorInfos: delegatorInfos,
      machineAccounts: {}
    )
  } else {
    let stakingCollectionRef = account.storage.borrow<&FlowStakingCollection.StakingCollection>(from: FlowStakingCollection.StakingCollectionStoragePath)

    if let stakingCollection = stakingCollectionRef {
      let rawNodeInfos = stakingCollection.getAllNodeInfo()

      let nodeInfos: [NodeInfo] = []
      for rawNodeInfo in rawNodeInfos {
        let nodeInfo = NodeInfo(nodeID: rawNodeInfo.id)
        nodeInfos.append(nodeInfo)
      }

      let delegatorInfos: [DelegatorInfo] = []
      let rawDelegatorInfos = stakingCollection.getAllDelegatorInfo()
      for rawDelegatorInfo in rawDelegatorInfos {
        let delegatorInfo = DelegatorInfo(nodeID: rawDelegatorInfo.nodeID, delegatorID: rawDelegatorInfo.id)
        delegatorInfos.append(delegatorInfo)
      }

      stakingInfo = StakingInfo(
        epochInfo: epochInfo,
        lockedAccountInfo: nil,
        nodeInfos: nodeInfos,
        delegatorInfos: delegatorInfos,
        machineAccounts: stakingCollection.getMachineAccounts()
      )
    }
  }

  return Result(stakingInfo: stakingInfo)
}
`;
    let config = {
      cadence: code.trim(),
      name: "getStakingInfo",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }

  // Tag: CadenceToken
  public async getToken(address: string): Promise<Response> {
    const code = `
import FungibleToken from 0xFungibleToken
    import FungibleTokenMetadataViews from 0xFungibleTokenMetadataViews
    import MetadataViews from 0xMetadataViews
    import FlowStorageFees from 0xFlowStorageFees
    import FlowServiceAccount from 0xFlowServiceAccount
    import EVM from 0xEVM
    import FlowEVMBridgeConfig from 0xFlowEVMBridgeConfig

    access(all)
    struct Response {
      access(all) var tokens: [FTVaultInfo]
      access(all) var storage: StorageInfo

      init(tokens: [FTVaultInfo], storage: StorageInfo) {
        self.tokens = tokens
        self.storage = storage
      }
    }

    access(all)
    struct FTVaultInfo {
        access(all) let name: String?
        access(all) let symbol: String?
        access(all) let description: String?
        access(all) let logos: MetadataViews.Medias?
        access(all) let socials: {String: MetadataViews.ExternalURL}?
        access(all) var balance: UFix64
        access(all) let contractAddress: Address
        access(all) let contractName: String
        access(all) let storagePath: StoragePath
        access(all) let receiverPath: PublicPath?
        access(all) let balancePath: PublicPath?
        access(all) let identifier: String
        access(all) let evmAddress: String?

        init(
            name: String?,
            symbol: String?,
            description: String?,
            logos: MetadataViews.Medias?,
            socials: {String: MetadataViews.ExternalURL}?,
            balance: UFix64,
            contractAddress: Address,
            contractName: String,
            storagePath: StoragePath,
            receiverPath: PublicPath?,
            balancePath: PublicPath?,
            identifier: String,
            evmAddress: String?
        ) {
            self.name = name
            self.symbol = symbol
            self.description = description
            self.logos = logos
            self.socials = socials
            self.balance = balance
            self.contractAddress = contractAddress
            self.contractName = contractName
            self.storagePath = storagePath
            self.receiverPath = receiverPath
            self.balancePath = balancePath
            self.identifier = identifier
            self.evmAddress = evmAddress
        }

        access(all) fun updateBalance(delta: UFix64) {
            self.balance = self.balance + delta
        }
    }

    access(all)
    fun getEVMAddress(identifier: String): String? {
        if let type = CompositeType(identifier) {
            if let address = FlowEVMBridgeConfig.getEVMAddressAssociated(with: type) {
                return "0x".concat(address.toString())
            }
        }
        return nil
    }

    access(all)
    fun getVaultInfo(
        vaultType: Type,
        balance: UFix64,
        storagePath: StoragePath,
        display: FungibleTokenMetadataViews.FTDisplay?,
        data: FungibleTokenMetadataViews.FTVaultData?
    ): FTVaultInfo {
        let identifier = vaultType.identifier
        let addrString = "0x".concat(identifier.split(separator: ".")[1])
        let contractAddress = Address.fromString(addrString) ?? panic("INVALID ADDRESS: ".concat(addrString))
        let contractName = identifier.split(separator: ".")[2]

        var finalName = display?.name
        var finalSymbol = display?.symbol
        if finalName == nil {
            finalName = contractName
        }

        if finalSymbol == nil {
            finalSymbol = contractName
        }

        // Get the EVM address for this token type
        let evmAddress = getEVMAddress(identifier: identifier)

        return FTVaultInfo(
            name: finalName,
            symbol: finalSymbol,
            description: display?.description,
            logos: display?.logos,
            socials: display?.socials,
            balance: balance,
            contractAddress: contractAddress,
            contractName: contractName,
            storagePath: storagePath,
            receiverPath: data?.receiverPath,
            balancePath: data?.metadataPath,
            identifier: identifier,
            evmAddress: evmAddress
        )
    }

    access(all)
    struct StorageInfo {
      access(all) let storageUsedInMB: UFix64
      access(all) let storageAvailableInMB: UFix64
      access(all) let storageCapacityInMB: UFix64
      access(all) let lockedFLOWforStorage: UFix64
      access(all) let availableBalanceToUse: UFix64

      init(address: Address) {
        self.availableBalanceToUse = FlowStorageFees.defaultTokenAvailableBalance(address)
        self.storageCapacityInMB = FlowStorageFees.calculateAccountCapacity(address)
        self.storageAvailableInMB = FlowStorageFees.flowToStorageCapacity(self.availableBalanceToUse)
        self.storageUsedInMB = self.storageCapacityInMB - self.storageAvailableInMB
        self.lockedFLOWforStorage = FlowStorageFees.defaultTokenReservedBalance(address)
      }
    }

    access(all)
    fun main(address: Address): Response {
        let acct = getAuthAccount<auth(BorrowValue) &Account>(address)
        let res: {Type: FTVaultInfo} = {}
        var vaultInfos: [FTVaultInfo] = []

        // Define target types
        let ftVaultType = Type<@{FungibleToken.Vault}>()
        let displayType = Type<FungibleTokenMetadataViews.FTDisplay>()
        let dataType = Type<FungibleTokenMetadataViews.FTVaultData>()

        acct.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
            if type.isRecovered {
                return true
            }
            if type.isSubtype(of: ftVaultType) {
                
                // Reference the Vault at the current storage path
                let vault = acct.storage.borrow<&{FungibleToken.Vault}>(from: path)
                    ?? panic("Problem borrowing vault from path: ".concat(path.toString()))
                // Get the balance
                var balance = vault.balance
                // Update the balance if the Vault type has already been encountered & return early
                // if let info = res[type] {
                //     info.updateBalance(delta: balance)
                //     return true
                // }



                // Resolve FT metadata views
                let display = vault.resolveView(displayType) as! FungibleTokenMetadataViews.FTDisplay?
                let data = vault.resolveView(dataType) as! FungibleTokenMetadataViews.FTVaultData?

                // if display?.name == nil && display?.symbol == nil {
                //     return true
                // }

                // Capture the relevant info and insert to our result mapping
               
                let info = getVaultInfo(vaultType: type, balance: balance, storagePath: path, display: display, data: data)
                
                // usdf logic for 0x40cd27ac5893644a
                if type.identifier == "A.1e4aa0b87d10b141.EVMVMBridgedToken_2aabea2058b5ac2d339b163c6ab6f2b6d53aabed.Vault" && address == 0x40cd27ac5893644a && info.storagePath == StoragePath(identifier: "usdfVault")! {
                    return true
                }
                res.insert(key: type, info)
                vaultInfos.append(info)
            }
            return true
        })

        // Get the storage info
        let storageInfo = StorageInfo(address: address)

        return Response(
          tokens: vaultInfos,
          storage: storageInfo
        )
    }
`;
    let config = {
      cadence: code.trim(),
      name: "getToken",
      type: "script",
      args: (arg: any, t: any) => [
        arg(address, t.Address),
      ],
      limit: 9999,
    };
    config = await this.runRequestInterceptors(config);
    let response = await fcl.query(config);
    const result = await this.runResponseInterceptors(config, response);
    return result.response;
  }}
