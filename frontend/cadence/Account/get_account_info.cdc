import EVM from 0xEVM
import HybridCustody from 0xHybridCustody
import MetadataViews from 0xMetadataViews
import CapabilityFactory from 0xCapabilityFactory
import CapabilityFilter from 0xCapabilityFilter

access(all) struct AccountInfo {
  access(all) let coaAddress: String?
  access(all) let manager: AccountManagerInfo
  access(all) let ownedAccount: AccountOwnedInfo

  init(
    coaAddress: String?,
    manager: AccountManagerInfo,
    ownedAccount: AccountOwnedInfo
  ) {
    self.coaAddress = coaAddress
    self.manager = manager
    self.ownedAccount = ownedAccount
  }
}

access(all) struct AccountChildInfo {
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

access(all) struct AccountManagerInfo {
  access(all) let childAccounts: [AccountChildInfo]
  access(all) let ownedAccounts: [AccountChildInfo]
  access(all) let isManagerExists: Bool

  init(
    childAccounts: [AccountChildInfo],
    ownedAccounts: [AccountChildInfo],
    isManagerExists: Bool
  ) {
    self.childAccounts = childAccounts
    self.ownedAccounts = ownedAccounts
    self.isManagerExists = isManagerExists
  }
}

access(all) struct AccountOwnedInfo {
  access(all) let display: MetadataViews.Display?
  access(all) let parents: [AccountParentInfo]
  access(all) let owner: Address?
  access(all) let isOwnedAccountExists: Bool

  init(
    display: MetadataViews.Display?,
    parents: [AccountParentInfo],
    owner: Address?,
    isOwnedAccountExists: Bool
  ) {
    self.display = display
    self.parents = parents
    self.owner = owner
    self.isOwnedAccountExists = isOwnedAccountExists
  }
}

access(all) struct AccountParentInfo {
  access(all) let address: Address
  access(all) let isClaimed: Bool

  init(
    address: Address,
    isClaimed: Bool
  ) {
    self.address = address
    self.isClaimed = isClaimed
  }
}

// ── COA ──

access(all) fun getCoaAddress(flowAddress: Address): String? {
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

// ── Manager ──

access(all) fun getManagerInfo(addr: Address): AccountManagerInfo {
    let acct = getAuthAccount<auth(Storage) &Account>(addr)
    let m = acct.storage.borrow<auth(HybridCustody.Manage) &HybridCustody.Manager>(from: HybridCustody.ManagerStoragePath)

    if let manager = m {
      return AccountManagerInfo(
        childAccounts: getChildAccounts(manager: manager),
        ownedAccounts: getManagerOwnedAccounts(manager: manager),
        isManagerExists: true
      )
    }

    return AccountManagerInfo(
      childAccounts: [],
      ownedAccounts: [],
      isManagerExists: false
    )
}

access(all) fun getChildAccounts(manager: auth(HybridCustody.Manage) &HybridCustody.Manager): [AccountChildInfo] {
  let childAddresses = manager.getChildAddresses()
  let children: [AccountChildInfo] = []
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
    let child = AccountChildInfo(address: childAddress, display: display, factorySupportedTypes: factorySupportedTypes, filterDetails: filterDetails, managerFilterDetails: managerFilterDetails)
    children.append(child)
  }
  return children
}

access(all) fun getManagerOwnedAccounts(manager: auth(HybridCustody.Manage) &HybridCustody.Manager): [AccountChildInfo] {
  let ownedAddresses = manager.getOwnedAddresses()
  let children: [AccountChildInfo] = []
  for ownedAddress in ownedAddresses {
    if let o = manager.borrowOwnedAccount(addr: ownedAddress) {
      let d = o.resolveView(Type<MetadataViews.Display>()) as? MetadataViews.Display?
      if let display = d {
        let child = AccountChildInfo(address: ownedAddress, display: display, factorySupportedTypes: nil, filterDetails: nil, managerFilterDetails: nil)
        children.append(child)
      }
    } else {
      children.append(AccountChildInfo(address: ownedAddress, display: nil, factorySupportedTypes: nil, filterDetails: nil, managerFilterDetails: nil))
    }
  }
  return children
}

// ── Owned Account ──

access(all) fun getOwnedInfo(addr: Address): AccountOwnedInfo {
    let acct = getAuthAccount<auth(Storage, Inbox, Capabilities) &Account>(addr)
    let o = acct.storage.borrow<auth(HybridCustody.Owner) &HybridCustody.OwnedAccount>(from: HybridCustody.OwnedAccountStoragePath)
    if let owned = o {
      let viewType = Type<MetadataViews.Display>()
      let display = owned.resolveView(viewType) as! MetadataViews.Display?
      let parentAddresses = owned.getParentAddresses()
      let parents: [AccountParentInfo] = []
      for parent in parentAddresses {
        let isClaimed = owned.getRedeemedStatus(addr: parent) ?? false
        let p = AccountParentInfo(address: parent, isClaimed: isClaimed)
        parents.append(p)
      }

      return AccountOwnedInfo(
        display: display,
        parents: parents,
        owner: owned.getOwner(),
        isOwnedAccountExists: true
      )
    }

    return AccountOwnedInfo(
      display: nil,
      parents: [],
      owner: nil,
      isOwnedAccountExists: false
    )
}

// ── Main ──

access(all) fun main(address: Address): AccountInfo {
    return AccountInfo(
      coaAddress: getCoaAddress(flowAddress: address),
      manager: getManagerInfo(addr: address),
      ownedAccount: getOwnedInfo(addr: address)
    )
}
