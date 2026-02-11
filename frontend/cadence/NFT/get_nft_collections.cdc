import NonFungibleToken from 0xNonFungibleToken
import MetadataViews from 0xMetadataViews

access(all) struct NFTCollectionInfo {
    access(all) let storagePath: StoragePath
    access(all) let identifier: String
    access(all) let count: Int
    access(all) let name: String?
    access(all) let description: String?
    access(all) let squareImageURL: String?
    access(all) let bannerImageURL: String?
    access(all) let externalURL: String?
    access(all) let contractAddress: Address
    access(all) let contractName: String

    init(
        storagePath: StoragePath,
        identifier: String,
        count: Int,
        name: String?,
        description: String?,
        squareImageURL: String?,
        bannerImageURL: String?,
        externalURL: String?,
        contractAddress: Address,
        contractName: String
    ) {
        self.storagePath = storagePath
        self.identifier = identifier
        self.count = count
        self.name = name
        self.description = description
        self.squareImageURL = squareImageURL
        self.bannerImageURL = bannerImageURL
        self.externalURL = externalURL
        self.contractAddress = contractAddress
        self.contractName = contractName
    }
}

access(all) fun main(address: Address): [NFTCollectionInfo] {
    let acct = getAuthAccount<auth(BorrowValue) &Account>(address)
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let collections: [NFTCollectionInfo] = []

    acct.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
        if type.isRecovered {
            return true
        }
        if !type.isSubtype(of: collectionType) {
            return true
        }

        let collection = acct.storage.borrow<&{NonFungibleToken.Collection}>(from: path)
        if collection == nil {
            return true
        }

        let ids = collection!.getIDs()
        let count = ids.length
        let identifier = type.identifier

        // Parse contract address and name from type identifier (A.{address}.{name}.Collection)
        let parts = identifier.split(separator: ".")
        let addrString = "0x".concat(parts[1])
        let contractAddress = Address.fromString(addrString) ?? panic("Invalid address: ".concat(addrString))
        let contractName = parts[2]

        // Try to get NFTCollectionDisplay metadata from first NFT
        var name: String? = nil
        var description: String? = nil
        var squareImageURL: String? = nil
        var bannerImageURL: String? = nil
        var externalURL: String? = nil

        if ids.length > 0 {
            let resolver = collection!.borrowViewResolver(id: ids[0])
            if resolver != nil {
                if let collectionDisplay = MetadataViews.getNFTCollectionDisplay(resolver!) {
                    name = collectionDisplay.name
                    description = collectionDisplay.description
                    squareImageURL = collectionDisplay.squareImage.file.uri()
                    bannerImageURL = collectionDisplay.bannerImage.file.uri()
                    externalURL = collectionDisplay.externalURL.url
                }
            }
        }

        if name == nil {
            name = contractName
        }

        collections.append(NFTCollectionInfo(
            storagePath: path,
            identifier: identifier,
            count: count,
            name: name,
            description: description,
            squareImageURL: squareImageURL,
            bannerImageURL: bannerImageURL,
            externalURL: externalURL,
            contractAddress: contractAddress,
            contractName: contractName
        ))

        return true
    })

    return collections
}
