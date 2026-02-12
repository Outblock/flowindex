import type { NextApiRequest, NextApiResponse } from 'next'
import { getFlowNFTs } from 'api/evmTools'
import { withAuth } from 'api/verifyIdToken'

/**
 * @swagger
 * /api/v2/nft/collections:
 *   get:
 *     summary: Get a list of ALL the Cadence NFT collections on the Flow network
 *     description: |
 *       Use this endpoint to get a list of ALL the Cadence NFT collections on the Flow network.
 *       This list is used to populate the "Collections" section in the wallet where the user can enable/disable collections.
 *       This is needed on the Flow network as Collections need to be enabled on accounts to receive NFTs.
 *     parameters:
 *       - in: header
 *         name: network
 *         schema:
 *           $ref: '#/components/schemas/Network'
 *         description: Flow network (mainnet/testnet)
 *         default: mainnet
 *     responses:
 *       200:
 *         description: List of NFT collections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/NFTCollection'
 *                 status:
 *                   type: number
 *     tags:
 *       - NFTs
 */

async function handler(req: NextApiRequest, res: NextApiResponse<any>) {
  const network = req.query.network || req.headers.network || 'mainnet'

  const tokenList = await getFlowNFTs(network as string)
  const collectionInfo = tokenList.data.map((token: any) => {
    const {
      address,
      contract_name,
      logoURI,
      path,
      name,
      evmAddress,
      bannerURI,
      description,
      extensions,
      official_website
    } = token
    const { storage_path, public_path: publicPath } = path
    const id = storage_path.replace('/storage/', '')
    // const { website } = extensions
    return {
      id,
      contract_name,
      address,
      name,
      logo: logoURI,
      banner: bannerURI,
      description: description,
      path: {
        storage_path: storage_path,
        public_path: publicPath,
      },
      evmAddress,
      evm_address: evmAddress,
      official_website: official_website,
      socials: {},
    }
  })

  const finalReturn = {
    data: collectionInfo,
    status: 200,
  }

  res.status(200).json(finalReturn)
}

export default withAuth(handler);
