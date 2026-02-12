const fcl = require('@onflow/fcl')
const config = require('../../../tools')
const cacheData = require('memory-cache')

const CacheKey = 'NFTList'

const pagnation = async (
  address: string,
  identifier: string,
  start: any,
  end: any,
) => {
  const cadence = `
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

      let res:{String: AnyStruct} = {}
      
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

    return nfts.slice(from: start, upTo: endNum )
  }
  `

  return await fcl.query({
    cadence: cadence,
    args: (arg: any, t: any) => [
      arg(address, t.Address),
      arg(identifier, t.String),
      arg(start, t.Int),
      arg(end, t.Int),
    ],
  })
}

const getCount = async () => {
  const cadence = `
    import NFTCatalog from 0xNFTCatalog

    pub fun main(): Int {
        let catalog = NFTCatalog.getCatalog()
        let catalogIDs = catalog.keys
        return catalogIDs.length
    }
    `

  return await fcl.query({
    cadence: cadence,
  })
}

const extendObj = (obj1: any, obj2: any) => {
  for (var key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      obj1[key] = obj2[key]
    }
  }

  return obj1
}

const fetchList = async (
  network: string,
  address: string,
  identifier: string,
  offset: number,
  limit: number,
) => {
  config.setup(fcl, network)
  let result = await pagnation(address, identifier, offset, offset + limit)
  return result
}

export async function get(
  network: string,
  address: string,
  identifier: string,
  offset: number = 0,
  limit: number = 50,
) {
  const res = await fetchList(network, address, identifier, offset, limit)
  return res
}
