const fcl = require('@onflow/fcl')
const config = require('../../../tools')

const pagnation = async (address: string, start: number, end: number) => {
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

    access(all) fun main(address:Address, start: Int, end: Int): [AnyStruct]{
    var results : [AnyStruct] = []
    var acc = getAuthAccount<auth(Storage) &Account>(address)
    var index = 0

    acc.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
      if type.isSubtype(of: Type<@{NonFungibleToken.Collection}>()) && !type.isRecovered {
          var collection = acc.storage.borrow<&{NonFungibleToken.Collection}>(from:path)!
          let ids = collection.getIDs()
          for id in ids {
            if index >= start && index < end {
              var resolver = collection.borrowViewResolver(id: id)

              if resolver!= nil {
                var res = getNFTDetail(resolver!, id: id)
                results.append(res)
              } else {
                let res: {String: AnyStruct} = {}
                let nft = collection.borrowNFT(id)!
                res["tokenId"] = nft.id
                res["display"] = nft.resolveView(Type<MetadataViews.Display>())
                results.append(res) 
              }
             
            }
            index = index + 1
          }
        }
      return true
    })
    return results
  }
  `

  return await fcl.query({
    cadence: cadence,
    args: (arg: any, t: any) => [
      arg(address, t.Address),
      arg(start, t.Int),
      arg(end, t.Int),
    ],
  })
}

export const getAllCount = async (address: string) => {
  const cadence = `
    import NonFungibleToken from 0xNonFungibleToken
    import MetadataViews from 0xMetadataViews
    import ViewResolver from 0xMetadataViews

    access(all) fun main(address: Address,): Int {
      let account = getAccount(address)
      let collectionType = Type<@{NonFungibleToken.Collection}>()
      var count = 0
      let nftsInfo: [{String: AnyStruct}] = []

      fun eachPath(path: StoragePath, Type: Type): Bool {
        if Type != nil {
          if Type.isSubtype(of: collectionType) && !Type.isRecovered {
            let pathStr = path.toString()
            let splitArr = pathStr.split(separator: "/")
            let identifier = splitArr[2]

            var acc = getAuthAccount<auth(Storage) &Account>(address)
            var obj = acc.storage.borrow<&AnyResource>(from: StoragePath(identifier: identifier)!)!
            var meta = obj as? &{ViewResolver.ResolverCollection}
            count = count + meta!.getIDs().length
            // let pubPath = PublicPath(identifier: identifier)!
            // if account.capabilities.exists(pubPath) == true {
            //   let collection =  account.capabilities.borrow<&{NonFungibleToken.CollectionPublic}>(pubPath)!
            //   let ids = collection.getIDs()
            //   count = count + ids.length
            // }
          }
        }
        return true
      }
      account.storage.forEachStored(eachPath)

      return count
    }
    `

  return await fcl.query({
    cadence: cadence,
    args: (arg: any, t: any) => [arg(address, t.Address)],
  })
}

const fetchNFTs = async (
  network: string,
  address: string,
  offset: number = 0,
  end: number = 50,
) => {
  config.setup(fcl, network)
  let result = await pagnation(address, offset, end)

  return result
}

export async function getAll(
  network: string,
  address: string,
  offset: number = 0,
  limit: number = 50,
) {
  const res = await fetchNFTs(network, address, offset, offset + limit)
  // console.log(res)
  return res
}

export async function getCollectionNFTs(
  network: string,
  address: string,
  collectionIdentifier: string,
  offset: number = 0,
  limit: number = 50,
) {
  const res = await fetchCollectionNFTs(
    network,
    address,
    collectionIdentifier,
    offset,
    offset + limit,
  )
  return res
}

const fetchCollectionNFTsPagnation = async (
  address: string,
  collectionIdentifier: string,
  start: number,
  end: number,
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
      let collection =  account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath)!
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
      return {"nfts": nftsInfo, "nftCount": nftCount }
    }
  `

  return await fcl.query({
    cadence: cadence,
    args: (arg: any, t: any) => [
      arg(address, t.Address),
      arg(collectionIdentifier, t.String),
      arg(start, t.Int),
      arg(end, t.Int),
    ],
  })
}

const fetchCollectionNFTsByIdList = async (
  address: string,
  collectionIdentifier: string,
  ids: string[],
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


    access(all) fun main(address: Address, pathId: String, ids: [String]): {String: AnyStruct} {
      let account = getAuthAccount<auth(Storage) &Account>(address)
      let collectionType = Type<@{NonFungibleToken.Collection}>()
      var index = 0
      let nftsInfo: [{String: AnyStruct}] = []

      let pubPath = PublicPath(identifier: pathId)!
      let storagePath = StoragePath(identifier: pathId)!
      var count = 0
      let collection =  account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath)!
      let ids = collection.getIDs()
      count = ids.length
      
      for id in ids {
        if index >= start && index < end {
          let resolver = collection.borrowViewResolver(id: id)
          if resolver != nil {
            nftsInfo.append(getNFTDetail(resolver!, id: id))
          }
        }
        index = index + 1
      }
      return {"nfts": nftsInfo, "nftCount": count }
    }
  `

  return await fcl.query({
    cadence: cadence,
    args: (arg: any, t: any) => [
      arg(address, t.Address),
      arg(collectionIdentifier, t.String),
    ],
  })
}

const fetchCollectionNFTs = async (
  network: string,
  address: string,
  collectionIdentifier: string,
  offset: number = 0,
  end: number = 50,
) => {
  config.setup(fcl, network)
  // deprecated InceptionCrystalCollection not implement metadataview
  if (collectionIdentifier == 'InceptionCrystalCollection') {
    return {
      nfts: [],
      nftCount: 0,
    }
  }
  let result = await fetchCollectionNFTsPagnation(
    address,
    collectionIdentifier,
    offset,
    end,
  )
  return result
}

export const convertNFTData = (nft: any) => {
  const {
    tokenId,
    display = {},
    collectionData = {},
    collectionDisplay,
    traits = null,
    externalURL: nftURL,
    royalties,
  } = nft
  const { name = '', description = '', thumbnail = '' } = display
  // if (collectionData == null) {
  //   return {}
  // }

  const { publicCollection } = collectionData

  let typeID =
    publicCollection && publicCollection.type.typeID
      ? publicCollection.type.typeID
      : ''
  let flowIdentifier = typeID

  if (flowIdentifier.indexOf('CollectionPublic') > 0) {
    // Additional logic for gaia‘s unusual type {A.8b148183c28ff88f.Gaia.CollectionPublic}
    flowIdentifier = typeID.replace('CollectionPublic', 'NFT')
    flowIdentifier = flowIdentifier.replace('{', '')
    flowIdentifier = flowIdentifier.replace('}', '')
  } else {
    flowIdentifier = typeID.replace('Collection', 'NFT')
  }

  const typeArr = typeID.split('.')
  const contractAddress = `0x${typeArr[1]}`
  const contractName = typeArr[2]
  const {
    externalURL = '',
    squareImage = '',
    bannerImage = '',
  } = collectionDisplay || {}

  const nftData = {
    id: tokenId,
    name,
    description,
    thumbnail:
      thumbnail && thumbnail.url
        ? thumbnail.url
        : thumbnail.cid
          ? `https://ipfs.io/ipfs/${thumbnail.cid}${thumbnail.path ? `/${thumbnail.path}` : ''}`
          : '',
    externalURL: nftURL && nftURL.url ? nftURL.url : '',
    // collectionID: identifier,
    collectionName: collectionDisplay ? collectionDisplay.name : '',
    collectionContractName: contractName,
    contractAddress: contractAddress,
    // collectionContractName:
    collectionDescription: collectionDisplay
      ? collectionDisplay.description
      : '',
    collectionSquareImage:
      squareImage.file && squareImage.file.url ? squareImage.file.url : '',
    collectionBannerImage:
      bannerImage.file && bannerImage.file.url ? bannerImage.file.url : '',
    collectionExternalURL: externalURL.url ? externalURL.url : '',
    traits: traits ? traits.traits : [],
    royalties,
    postMedia: {},
    // collectionData,
    flowIdentifier,
  }

  nftData.postMedia = getPostMedia(nftData, typeID)

  return nftData
}

export const getPostMedia = (nft: any, typeId: string = '') => {
  const postMedia: any = {}

  let thumbnail = nft.thumbnail || ``

  if (thumbnail.includes('ipfs://')) {
    let cid = thumbnail.replace('ipfs://ipfs/', '').replace('ipfs://', '')
    postMedia['image'] = `https://ipfs-gtwy-nft.infura-ipfs.io/ipfs/${cid}`
  } else if (thumbnail.includes('https://ipfs.io/')) {
    postMedia['image'] = thumbnail.replace(
      'https://ipfs.io/',
      'https://ipfs-gtwy-nft.infura-ipfs.io/',
    )
  } else if (thumbnail.includes('.mp4')) {
    postMedia['video'] = thumbnail
  } else if (thumbnail.includes('.mp3')) {
    postMedia['music'] = thumbnail
  } else {
    postMedia['image'] = thumbnail
  }
  if (thumbnail.includes('.svg')) {
    postMedia['isSvg'] = true
  } else if (nft.collectionContractName == 'FlovatarComponent') {
    postMedia['isSvg'] = true
  } else {
    postMedia['isSvg'] = false
  }
  postMedia['description'] = nft.description
  postMedia['title'] = nft.name

  if (typeId == 'A.0b2a3299cc857e29.TopShot.Collection') {
    postMedia['video'] = `https://assets.nbatopshot.com/media/${nft.id}/video`
  }
  if (typeId == 'A.d0bcefdf1e67ea85.HWGarageCardV2.Collection') {
    postMedia['video'] = postMedia['image']
  }
  if (typeId == 'A.e5bf4d436ca23932.BBxBarbieCard.Collection') {
    let url = postMedia['image'] || ''
    url = url.replace('/ThumbnailPath not set', '')
    postMedia['image'] = url
    postMedia['video'] = url
  }

  return postMedia
}

export default {}
