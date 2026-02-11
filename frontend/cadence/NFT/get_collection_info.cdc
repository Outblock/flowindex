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
