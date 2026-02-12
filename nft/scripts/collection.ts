const fcl = require('@onflow/fcl')
const config = require('../../../tools')
const { convertCID } = require('../utilities/convert')


const query = async (address: string) => {
  const cadence = `
  import MetadataViews from 0xMetadataViews
  import ViewResolver from 0xViewResolver
  import NonFungibleToken from 0xNonFungibleToken
  
  access(all) struct NFTCollectionData {
    /// Path in storage where this NFT is recommended to be stored.
    access(all) let storagePath: StoragePath

    /// Public path which must be linked to expose public capabilities of this NFT
    /// including standard NFT interfaces and metadataviews interfaces
    access(all) let publicPath: PublicPath

    /// The concrete type of the collection that is exposed to the public
    /// now that entitlements exist, it no longer needs to be restricted to a specific interface
    access(all) let publicCollection: Type

    /// Type that should be linked at the aforementioned public path
    access(all) let publicLinkedType: Type

    view init(
        storagePath: StoragePath,
        publicPath: PublicPath,
        publicCollection: Type,
        publicLinkedType: Type,
    ) {
        
        self.storagePath=storagePath
        self.publicPath=publicPath
        self.publicCollection=publicCollection
        self.publicLinkedType=publicLinkedType
    }
  }

  access(all) struct NFTCollection {
    access(all) let id: String
    access(all) let path: String
    access(all) let collectionDisplay: AnyStruct?
    access(all) let collectionData: NFTCollectionData?
    access(all) let ids: [UInt64]

    init(id:String, path: String, collectionDisplay: AnyStruct?, collectionData: NFTCollectionData?, ids: [UInt64]) {
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
    var item: AnyStruct? =  nil
  
      if let type = account.storage.type(at: storagePath)  {
        let isResource = type.isSubtype(of: resourceType)
        let isNFTCollection = type.isSubtype(of: collectionType)
        let conformedMetadataViews = type.isSubtype(of: metadataViewType)
  
        var tokenIDs: [UInt64] = []
        if isNFTCollection && conformedMetadataViews {
          let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath)!
          tokenIDs = collection.getIDs()

          // TODO: move to a list
          if tokenIDs.length > 0 
          && storagePath != /storage/RaribleNFTCollection 
          && storagePath != /storage/ARTIFACTPackV3Collection
          && storagePath != /storage/ArleeScene {
            let resolver = collection.borrowViewResolver(id: tokenIDs[0])
            if resolver != nil {
                if let display = MetadataViews.getNFTCollectionDisplay(resolver!) {
                item = display
              }
            } else {
              let nft = collection.borrowNFT(tokenIDs[0])!
              if let display = nft.resolveView(Type<MetadataViews.NFTCollectionDisplay>()) {
                item = display
              }
            }
          }
        }
      }
  
    return item
  }

  access(all) fun getCollectionData(address: Address, storagePath: StoragePath, publicPath: PublicPath): NFTCollectionData? {
    let account =  getAuthAccount<auth(Storage) &Account>(address)
    let resourceType = Type<@AnyResource>()
    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let metadataViewType = Type<@{ViewResolver.ResolverCollection}>()
    var item: NFTCollectionData? =  nil

      if let type = account.storage.type(at: storagePath) {
        let isResource = type.isSubtype(of: resourceType)
        let isNFTCollection = type.isSubtype(of: collectionType)
        let conformedMetadataViews = type.isSubtype(of: metadataViewType)

        var tokenIDs: [UInt64] = []
        if isNFTCollection && conformedMetadataViews {
          if let collectionRef = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath) {
            tokenIDs = collectionRef.getIDs()

            // TODO: move to a list
            if tokenIDs.length > 0 {
              let resolver = collectionRef.borrowViewResolver(id: tokenIDs[0])
              if resolver != nil {
                  if let data = MetadataViews.getNFTCollectionData(resolver!) {
                  item = NFTCollectionData(
                    storagePath: data.storagePath,
                    publicPath: data.publicPath,
                    publicCollection:data.publicCollection,
                    publicLinkedType:data.publicLinkedType
                  )
                }
              }
            }
          }
        }
      }

    return item
  }
  
  access(all) fun main(address: Address): [NFTCollection] {
    let account = getAuthAccount<auth(Storage) &Account>(address)

    let collectionType = Type<@{NonFungibleToken.Collection}>()
    let collectionPaths: [StoragePath] = []
    let collections: [NFTCollection] = []
  
    fun eachPath(path: StoragePath, Type: Type): Bool {
     
      if Type != nil {
        if Type.isSubtype(of: collectionType) && !Type.isRecovered {
          collectionPaths.append(path)
        }
      }
      return true
    }
  
    account.storage.forEachStored(eachPath)
  
    for path in collectionPaths {
      let pathStr = path.toString()
      let splitArr = pathStr.split(separator: "/")
      let identifier = splitArr[2]
      let pubPath = PublicPath(identifier: identifier)!

      // if account.capabilities.exists(pubPath) == false {
      //    continue
      // } 
      
      var collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from:path)!

      if path == /storage/findCharityCollection {
        continue
      }
        
      collections.append(
        NFTCollection(
        id: account.storage.type(at: path)!.identifier,
        path: pubPath.toString(),
        collectionDisplay: getDisplay(address: address, storagePath: path, publicPath: pubPath),
        collectionData: getCollectionData(address: address, storagePath: path, publicPath: pubPath),
        ids: collection.getIDs()
        )
      )
    }
    
    return collections
  }
  `

  return await fcl.query({
    cadence: cadence,
    args: (arg: any, t: any) => [arg(address, t.Address)],
  })
}

const getCollectionInfo = async (
  address: string,
  collectionIdentifier: string,
) => {

  const cadence = `
  import MetadataViews from 0xMetadataViews
  import ViewResolver from 0xViewResolver
  import NonFungibleToken from 0xNonFungibleToken
 
  access(all) struct NFTCollectionData {
    /// Path in storage where this NFT is recommended to be stored.
    access(all) let storagePath: StoragePath

    /// Public path which must be linked to expose public capabilities of this NFT
    /// including standard NFT interfaces and metadataviews interfaces
    access(all) let publicPath: PublicPath

    /// The concrete type of the collection that is exposed to the public
    /// now that entitlements exist, it no longer needs to be restricted to a specific interface
    access(all) let publicCollection: Type

    /// Type that should be linked at the aforementioned public path
    access(all) let publicLinkedType: Type

    view init(
        storagePath: StoragePath,
        publicPath: PublicPath,
        publicCollection: Type,
        publicLinkedType: Type,
    ) {
        
        self.storagePath=storagePath
        self.publicPath=publicPath
        self.publicCollection=publicCollection
        self.publicLinkedType=publicLinkedType
    }
  }

  access(all) struct NFTCollection {
    access(all) let id: String
    access(all) let path: String
    access(all) let collectionDisplay: AnyStruct?
    access(all) let collectionData: NFTCollectionData?
    access(all) let ids: [UInt64]

    init(id:String, path: String, collectionDisplay: AnyStruct?, collectionData: NFTCollectionData?, ids: [UInt64]) {
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
    var item: AnyStruct? =  nil

      if let type = account.storage.type(at: storagePath) {
        let isResource = type.isSubtype(of: resourceType)
        let isNFTCollection = type.isSubtype(of: collectionType)
        let conformedMetadataViews = type.isSubtype(of: metadataViewType)

        var tokenIDs: [UInt64] = []
        if let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath) {
          tokenIDs = collection.getIDs()

          if tokenIDs.length > 0  {
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
    var item: NFTCollectionData? =  nil

      if let type = account.storage.type(at: storagePath) {
        let isResource = type.isSubtype(of: resourceType)
        let isNFTCollection = type.isSubtype(of: collectionType)
        let conformedMetadataViews = type.isSubtype(of: metadataViewType)

        var tokenIDs: [UInt64] = []
        if isNFTCollection && conformedMetadataViews {
          if let collection = account.storage.borrow<&{NonFungibleToken.Collection}>(from: storagePath) {
            tokenIDs = collection.getIDs()

            // TODO: move to a list
            if tokenIDs.length > 0 {
              let resolver = collection.borrowViewResolver(id: tokenIDs[0])
              if resolver != nil {
                  if let data = MetadataViews.getNFTCollectionData(resolver!) {
                  item = NFTCollectionData(
                    storagePath: data.storagePath,
                    publicPath: data.publicPath,
                    publicCollection:data.publicCollection,
                    publicLinkedType:data.publicLinkedType
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
  
  `

  return await fcl.query({
    cadence: cadence,
    args: (arg: any, t: any) => [
      arg(address, t.Address),
      arg(collectionIdentifier, t.String),
    ],
  })
}

export const convertCollectionInfo = (col: any) => {
  const { path, id, collectionDisplay = {}, collectionData } = col

  const idStr = path.split('/')[2]
  const idArr = id.split('.')
  const contractName = idArr[2]
  const contractAddress = idArr[1] ? `0x${idArr[1]}` : ''

  const { publicPath, storagePath } = collectionData || {}
  const {
    name = '',
    bannerImage = '',
    description = '',
    socials = undefined,
    squareImage = '',
    externalURL,
  } = collectionDisplay || {}

  const collection = {
    id: idStr,
    contract_name: contractName,
    contractName,
    address: contractAddress,
    name: name,
    logo: squareImage.file
      ? squareImage.file.url || convertCID(squareImage.file.cid)
      : '',
    banner: bannerImage.file
      ? bannerImage.file.url || convertCID(squareImage.file.cid)
      : '',
    description,
    path: {
      storage_path: publicPath
        ? `/storage/${storagePath.identifier}` || `/storage/${idStr}`
        : '',
      public_path: publicPath
        ? `/public/${publicPath.identifier}` || `/public/${idStr}`
        : '',
      private_path: 'deprecated/private_path',
    },
    socials,
    externalURL: externalURL && externalURL.url ? externalURL.url : '',
    nftTypeId: `A.${contractAddress.substring(2)}.${contractName}.NFT`,
    flowIdentifier: `A.${contractAddress.substring(2)}.${contractName}.NFT`
  }

  // if (socials) {
  //   collection.socials = socials
  // }
  return {
    collection,
  }
}

// todo
export const getCatalogTypeIds = async () => {
  // const cadence = `
  //   import NFTCatalog from 0x49a7cda3a1eecc29

  //   access(all) fun main(): [String] {
  //       let catalog: {String : NFTCatalog.NFTCatalogMetadata} = NFTCatalog.getCatalog()
  //       let catalogNames: [String] = []
  //       for collectionIdentifier in catalog.keys {
  //         catalogNames.append(catalog[collectionIdentifier]!.nftType.identifier)
  //       }
  //       return catalogNames
  //   }
  // `

  // return await fcl.query({
  //   cadence,
  // })

  return [
    'A.d756450f386fb4ac.MetaverseMarket.NFT',
    'A.82ed1b9cba5bb1b3.KaratNFT.NFT',
    'A.8920ffd3d8768daa.ExampleNFT.NFT',
  ]
}

const fetchList = async (
  network: string,
  address: string,
  withIds: boolean = false,
) => {
  config.setup(fcl, network)
  let result = await query(address)

  let catalogTypeIds = await getCatalogTypeIds()

  if (withIds) {
    result = result.map((col: any) => {
      let data = convertCollectionInfo(col)

      return {
        ...data,
        ids: col.ids,
        count: Number(col.ids.length),
      }
    })
    return result
  }

  result = result.map((col: any) => {
    let res = convertCollectionInfo(col)
    return res.collection
  })

  result = result.map((col: any) => {
    const { nftTypeId } = col
    let inCatalog = false
    if (nftTypeId && catalogTypeIds.includes(nftTypeId)) {
      inCatalog = true
    }
    return {
      ...col,
      inCatalog,
    }
  })
  // const collectionMap: any = {}

  // result.map((col: any) => {
  //   const { contractName } = col
  //   collectionMap[contractName] = col
  // })
  return result
}

export const fetchInfo = async (
  network: string,
  address: string,
  collectionIdentifier: string,
) => {
  config.setup(fcl, network)
  let result = await getCollectionInfo(address, collectionIdentifier)
  // result = convertCollectionInfo(result)
  return result
}

export async function getList(
  network: string,
  address: string,
  withIds: boolean,
) {
  const res = await fetchList(network, address, withIds)
  return res
}

export default {}
