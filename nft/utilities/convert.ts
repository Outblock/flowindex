export interface NFTModel {
  id: string
  name: string
  address: string
  contract_name: string
  logo: string | null
  banner: string | null
  official_website: string | null
  marketplace: string | null
  description: string | null
  path: NFTPath
  socials: SocialLink
}

export interface NFTPath {
  storage_path: string
  public_path: string
  public_collection_name: string
  public_type: string
  private_type: string
}

export interface SocialLink {
  discord: object
  twitter: object
  instagram: object
}

function convertType(type: any) {
  const regex = /A\.[0-9a-f]{16}\./g
  return type?.replaceAll(regex, '')
}

function convertToCollectionType(collections: any[]) {
  const nftArray = Object.keys(collections).map((key: any) => {
    const tempNft = collections[key]
    tempNft['id'] = key
    return tempNft
  })
  const nftReturn: NFTModel[] = []
  for (const k of nftArray) {
    const tempObject = {} as NFTModel
    if (nftReturn.find((e) => e.contract_name === k['contractName'])) {
      continue
    }
    tempObject.id = k['id']
    tempObject.contract_name = k['contractName']
    tempObject.logo = k['collectionDisplay']['squareImage']['file']['url']
    tempObject.address = k['contractAddress']
    tempObject.name = k['collectionDisplay']['name']
    tempObject.banner = k['collectionDisplay']['bannerImage']['file']['url']
    tempObject.official_website = k['collectionDisplay']['externalURL']['url']
    tempObject.description = k['collectionDisplay']['description']
    tempObject.path = {
      storage_path: '',
      public_path: '',
      public_collection_name: '',
      public_type: '',
      private_type: '',
    }
    tempObject.socials = {
      discord: {},
      twitter: {},
      instagram: {},
    }
    tempObject.path.storage_path =
      '/storage/' + k['collectionData']['storagePath']['identifier']
    tempObject.path.public_path =
      '/public/' + k['collectionData']['publicPath']['identifier']
    tempObject.path.public_collection_name = 'NonFungibleToken.CollectionPublic'
    tempObject.path.public_type =
      convertType(k['collectionData']['publicLinkedType']['typeID']) ?? ''
    tempObject.path.private_type =
      convertType(k['collectionData']['privateLinkedType']['typeID']) ?? ''
    tempObject.socials.discord = k['collectionDisplay']['socials']['discord']
    tempObject.socials.twitter = k['collectionDisplay']['socials']['twitter']
    tempObject.socials.instagram =
      k['collectionDisplay']['socials']['instagram']
    nftReturn.push(tempObject)
  }

  return nftReturn
}

export function convertCID(cid: string) {
  let ipfsUrl = `https://gateway.pinata.cloud/ipfs/${cid}`
  return ipfsUrl
}

export default convertToCollectionType

//   module.exports = {
//     convertToCollectionType,
//   }
