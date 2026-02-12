import { withAuth } from 'api/verifyIdToken'
import type { NextApiRequest, NextApiResponse } from 'next'
import { NFTCollectionIdsResponse } from 'types/nft/NFTIDsResponse'
const collection = require('../scripts/collection')

/**
 * @swagger
 * /api/v2/nft/id:
 *   get:
 *     summary: Get a list of the NFT collections and the ids of the nfts owned in each by an account on the Flow network
 *     description: |
 *       Use this endpoint to get a list of the NFT collections and the ids of the nfts owned in each collection by an account on the Flow network.
 *       This is used to populate the NFT collection list in the UI.
 *       Flow Address -> NFT Collections
 *     parameters:
 *       - in: query
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           example: "0x4d6800d557c29590"
 *         description: The wallet address to get NFT collections for
 *       - in: header
 *         name: network
 *         schema:
 *           $ref: '#/components/schemas/Network'
 *           default: mainnet
 *         description: The network to query (mainnet or testnet)
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NFTCollectionIdsResponse'
 *     tags:
 *     - NFTs
 */
async function handler(req: NextApiRequest, res: NextApiResponse<NFTCollectionIdsResponse>) {
  const { address } = req.query
  const network = req.query.network || req.headers.network || 'mainnet'
  const collectionInfo = await collection.getList(network, address, true)
  // console.log(collectionInfo)

  const finalReturn = {
    data: collectionInfo.filter((col: any) => col.ids.length > 0),
    status: 200,
  }
  res.status(200).json(finalReturn)
}

export default withAuth(handler);
