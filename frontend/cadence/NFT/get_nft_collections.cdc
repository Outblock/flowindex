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
