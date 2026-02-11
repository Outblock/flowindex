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


access(all) fun main(address: Address, pathId: String, start: Int, end: Int): {String: AnyStruct} {
    let account = getAuthAccount<auth(Storage) &Account>(address)
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    var index = 0
    let nftsInfo: [{String: AnyStruct}] = []

    let pubPath = PublicPath(identifier: pathId)!
    let storagePath = StoragePath(identifier: pathId)!
    var count = 0
    let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath)!
    let ids = collection.getIDs()
    count = 0
    let nftCount = ids.length

    for id in ids {
        if index >= start && index < end {
            let resolver = collection.borrowViewResolver(id: id)
            if resolver != nil {
                nftsInfo.append(getNFTDetail(resolver!, id: id))
            } else {
                let res: {String: AnyStruct} = {}
                let nft = collection.borrowNFT(id)!
                res["tokenId"] = nft.id
                res["display"] = nft.resolveView(Type<MetadataViews.Display>())
                nftsInfo.append(res)
            }

            count = count + 1
        }
        index = index + 1
    }
    return {"nfts": nftsInfo, "nftCount": nftCount}
}
