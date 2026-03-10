import NonFungibleToken from 0xNonFungibleToken
import MetadataViews from 0xMetadataViews
import ViewResolver from 0xViewResolver

access(all) struct CollectionDisplay {
    access(all) let name: String
    access(all) let squareImage: MetadataViews.Media

    init(name: String, squareImage: MetadataViews.Media) {
        self.name = name
        self.squareImage = squareImage
    }
}

access(all) struct NFTCollection {
    access(all) let id: String
    access(all) let display: CollectionDisplay?
    access(all) let idList: [UInt64]

    init(id: String, display: CollectionDisplay?, idList: [UInt64]) {
        self.id = id
        self.display = display
        self.idList = idList
    }
}

access(all) fun main(address: Address): [NFTCollection] {
    let account = getAuthAccount<auth(Storage) &Account>(address)
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let collections: [NFTCollection] = []

    account.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
        if type.isRecovered {
            return true
        }
        if !type.isSubtype(of: collectionType) {
            return true
        }

        let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: path)!
        let ids = collection.getIDs()

        var display: CollectionDisplay? = nil
        if ids.length > 0 {
            let resolver = collection.borrowViewResolver(id: ids[0])
            if resolver != nil {
                if let collDisplay = MetadataViews.getNFTCollectionDisplay(resolver!) {
                    display = CollectionDisplay(
                        name: collDisplay.name,
                        squareImage: collDisplay.squareImage
                    )
                }
            }
        }

        collections.append(NFTCollection(
            id: type.identifier,
            display: display,
            idList: ids
        ))
        return true
    })

    return collections
}
