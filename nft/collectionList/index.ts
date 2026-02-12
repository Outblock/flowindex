import type { NextApiRequest, NextApiResponse } from 'next'
const nfts = require('../scripts/nfts')
const collection = require('../scripts/collection')

/**
 * @swagger
 * /api/v2/nft/collectionList:
 *   get:
 *     summary: Get a list of NFTs from a specific collection under a FLOW address
 *     description: |
 *       Use this endpoint to get a list of NFTs that the user owns within a specific collection on the Flow network.
 *       Flow Address -> NFT Collection -> NFTs
 *     parameters:
 *     - in: query
 *       name: address
 *       required: true
 *       schema:
 *         type: string
 *       description: Flow address to get NFTs from
 *     - in: header
 *       name: network
 *       schema:
 *         type: string
 *         enum:
 *           - mainnet
 *           - testnet
 *       description: Flow network (mainnet/testnet)
 *       default: mainnet
 *     - in: query
 *       name: collectionIdentifier
 *       required: true
 *       schema:
 *         type: string
 *         ref: '#/components/schemas/CollectionIdentifier'
 *       description: Collection identifier
 *     - in: query
 *       name: offset
 *       schema:
 *         type: integer
 *       description: Number of records to skip
 *     - in: query
 *       name: limit
 *       schema:
 *         type: integer
 *       description: Maximum number of records to return
 *       default: 50
 *     responses:
 *       200:
 *         description: NFT List with pagination
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NFTListResponse'
 *     tags:
 *     - NFTs
 */
async function handler(req: NextApiRequest, res: NextApiResponse<any>) {
  const { address, collectionIdentifier, offset = 0, limit = 50 } = req.query
  const network = req.query.network || req.headers.network || 'mainnet'
  const nftsInfo = await nfts.getCollectionNFTs(
    network,
    address,
    collectionIdentifier,
    Number(offset),
    Number(limit),
  )
  nftsInfo.nftCount = Number(nftsInfo.nftCount)
  nftsInfo.nfts = nftsInfo.nfts.map(nfts.convertNFTData)

  const collectionInfo = await collection.fetchInfo(
    network,
    address,
    collectionIdentifier,
  )

  const collectionData = collection.convertCollectionInfo(collectionInfo)
  nftsInfo.collection = collectionData.collection

  const finalReturn = {
    data: nftsInfo,
    status: 200,
  }

  res.status(200).json(finalReturn)
}

export default handler
