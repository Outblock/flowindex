import type { NextApiRequest, NextApiResponse } from 'next'
const collection = require('../scripts/collection')

async function handler(req: NextApiRequest, res: NextApiResponse<any>) {
  const { address, collectionIdentifier, offset = 0, limit = 50 } = req.query
  const network = req.query.network || req.headers.network || 'mainnet'
  const collectionInfo = await collection.fetchInfo(
    network,
    address,
    collectionIdentifier,
  )

  // const nftReturn: NFTModel[] = convertToCollectionType(collections)

  const finalReturn = {
    data: collectionInfo,
    status: 200,
  }
  res.status(200).json(finalReturn)
}

// export default withAuth(handler);
export default handler
