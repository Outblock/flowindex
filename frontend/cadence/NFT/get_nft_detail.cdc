import NonFungibleToken from 0xNonFungibleToken
import MetadataViews from 0xMetadataViews
import ViewResolver from 0xMetadataViews

access(all) fun main(address: Address, pathId: String, tokenIDs: [UInt64]): [{String: AnyStruct}] {
    let account = getAccount(address)
    let results: [{String: AnyStruct}] = []

    let publicPath = PublicPath(identifier: pathId)!
    let collectionRef = account.capabilities.borrow<&{NonFungibleToken.Collection, ViewResolver.ResolverCollection}>(publicPath)
    if collectionRef == nil {
        return results
    }

    for tokenID in tokenIDs {
        let res: {String: AnyStruct} = {}
        res["tokenId"] = tokenID

        if collectionRef!.borrowNFT(tokenID) == nil {
            results.append(res)
            continue
        }

        let resolver = collectionRef!.borrowViewResolver(id: tokenID)
        if resolver != nil {
            if let display = MetadataViews.getDisplay(resolver!) {
                res["name"] = display.name
                res["thumbnail"] = display.thumbnail.uri()
            }

            if let rarity = MetadataViews.getRarity(resolver!) {
                res["rarity"] = rarity.description
            }

            if let serial = MetadataViews.getSerial(resolver!) {
                res["serial"] = serial.number
            }

            if let editions = MetadataViews.getEditions(resolver!) {
                res["editions"] = editions
            }

            if let traits = MetadataViews.getTraits(resolver!) {
                res["traits"] = traits
            }

            if let medias = MetadataViews.getMedias(resolver!) {
                res["medias"] = medias
            }

            if let externalURL = MetadataViews.getExternalURL(resolver!) {
                res["externalURL"] = externalURL.url
            }
        }

        results.append(res)
    }

    return results
}
