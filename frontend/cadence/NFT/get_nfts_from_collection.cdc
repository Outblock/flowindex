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

access(all) fun main(address: Address, storageIdentifier: String, start: Int, end: Int): [AnyStruct] {
    var results: [AnyStruct] = []
    var acc = getAuthAccount<auth(Storage) &Account>(address)
    
    // Construct storage path from identifier string
    // e.g. "MomentCollection" -> /storage/MomentCollection
    if let path = StoragePath(identifier: storageIdentifier) {
        if let collection = acc.storage.borrow<&{NonFungibleToken.Collection}>(from: path) {
            let ids = collection.getIDs()
            
            // Handle pagination bounds
            if start < ids.length {
                var currentEnd = end
                if currentEnd > ids.length {
                    currentEnd = ids.length
                }
                
                var i = start
                while i < currentEnd {
                    let id = ids[i]
                    var resolver = collection.borrowViewResolver(id: id)

                    if resolver != nil {
                        var res = getNFTDetail(resolver!, id: id)
                        results.append(res)
                    } else {
                        // Fallback to basic display if no resolver
                        let res: {String: AnyStruct} = {}
                        if let nft = collection.borrowNFT(id) {
                            res["tokenId"] = nft.id
                            res["display"] = nft.resolveView(Type<MetadataViews.Display>())
                            results.append(res)
                        }
                    }
                    i = i + 1
                }
            }
        }
    }

    return results
}
