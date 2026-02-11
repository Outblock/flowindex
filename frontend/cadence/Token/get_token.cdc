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