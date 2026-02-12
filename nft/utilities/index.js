import NFTModel from '../collections'
const BN = require('bignumber.js')

async function pagination(collectionIds, limit, offset) {
	return Object.keys(collectionIds).sort()
	.map((key) => collectionIds[key]
		  .sort((a, b) => ( new BN(b) - new BN(a)))
		  .map((item) => Object.assign({collection: key, id: item}))
	)
	.flatMap(item => item)
}

async function nftMedia(nfts) {
	for (const k of nfts) {
		const postMedia = {}
		if (k.thumbnail.includes('ipfs://')) {
			let cid = k.thumbnail.replace('ipfs://ipfs/', '').replace('ipfs://', '')
			postMedia['image'] = `https://gateway.pinata.cloud/ipfs/${cid}`
		} else if (k.thumbnail.includes('https://ipfs.io/')) {
			postMedia['image'] = k.thumbnail.replace('https://ipfs.io/', 'https://lilico.app/api/ipfs/')
		} else if (k.thumbnail.includes('.mp4')){
			postMedia['video'] = k.thumbnail
		} else if (k.thumbnail.includes('.mp3')){
			postMedia['music'] = k.thumbnail
		} else {
			postMedia['image'] = k.thumbnail
		}
		if (k.thumbnail.includes('.svg')) {
			postMedia['isSvg'] = true
		} else if (k.collectionContractName == 'FlovatarComponent') {
			postMedia['isSvg'] = true
		} else {
			postMedia['isSvg'] = false
		} 
		postMedia['description'] = k.description
		postMedia['title'] = k.name

		if (k.collectionContractName == 'TopShot') {
			postMedia['video'] = `https://assets.nbatopshot.com/media/${k.id}/video`
		}
		k['postMedia'] = postMedia;
  }

  let finalResultMap = nfts;
  return finalResultMap;
}

export function convertType(type) {
	const regex = /A\.[0-9a-f]{16}\./g
	return type?.replaceAll(regex, "")
}

module.exports = {
	pagination,
	nftMedia,
	convertType
}