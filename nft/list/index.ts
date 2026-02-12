import type { NextApiRequest, NextApiResponse } from 'next'
const nfts = require('../scripts/nfts')
import { withAuth } from 'api/verifyIdToken'
import { NFTListResponse } from '@/types/nft/NFTListResponse'


/**
 * @swagger
 * /api/v2/nft/list:
 *   get:
 *     summary: Get a list of Nfts owned by an account on the Flow network across all collections
 *     description: |
 *       Use this endpoint if you need to display an agregated list of NFTs owned by an account across all collections
 *       Flow Address -> NFTs
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
 *         $ref: '#/components/schemas/Network'
 *       default: mainnet
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
async function handler(req: NextApiRequest, res: NextApiResponse<NFTListResponse>) {
  const { address, offset = 0, limit = 50 } = req.query
  const network = req.query.network || req.headers.network || 'mainnet'
  let nftsInfo = await nfts.getAll(
    network,
    address,
    Number(offset),
    Number(limit),
  )

  nftsInfo = nftsInfo.map(nfts.convertNFTData)

  const count = await nfts.getAllCount(address)
  const finalReturn: NFTListResponse = {
    data: {
      nfts: nftsInfo,
      nftCount: Number(count),
      offset: String(Number(offset) + Number(nftsInfo.length)),
    },
    status: 200,
  }
  res.status(200).json(finalReturn)
}

export default withAuth(handler);
