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

access(all) fun getNFTDetail(collectionRef: &{NonFungibleToken.Collection, ViewResolver.ResolverCollection}, tokenID: UInt64): {String: AnyStruct} {
    let res: {String: AnyStruct} = {}

    collectionRef.borrowNFT(tokenID)

    let resolver = collectionRef.borrowViewResolver(id: tokenID)!
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

access(all) fun main(address: Address, pathId: String, tokenIDs: [UInt64]): [{String: AnyStruct}] {
    let account = getAccount(address)
    let results: [{String: AnyStruct}] = []

    let storagePath = StoragePath(identifier: pathId)!
    let publicPath = PublicPath(identifier: pathId)!
    let collectionRef = account.capabilities.borrow<&{NonFungibleToken.Collection, ViewResolver.ResolverCollection}>(publicPath)
    if collectionRef == nil {
        panic("Get Collection Failed")
    }

    let type = account.storage.type(at: storagePath)
    if type == nil {
        return results
    }

    let metadataViewType = Type<@{ViewResolver.ResolverCollection}>()
    let conformedMetadataViews = type!.isSubtype(of: metadataViewType)

    if (!conformedMetadataViews) {
        return results
    }

    for tokenID in tokenIDs {
        results.append(getNFTDetail(collectionRef: collectionRef!, tokenID: tokenID))
    }

    return results
}
