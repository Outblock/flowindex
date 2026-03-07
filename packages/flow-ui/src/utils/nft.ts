/**
 * NFT media, thumbnail, and IPFS URL utilities.
 */

/** Resolve IPFS links to gateway */
export const resolveIPFS = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('ipfs://')) {
        return url.replace('ipfs://', 'https://ipfs-gtwy-nft.infura-ipfs.io/ipfs/');
    }
    return url;
};

/** Extract thumbnail URL from NFT display metadata with IPFS resolution */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getNFTThumbnail = (nft: any): string => {
    const display = nft?.display;
    if (!display) return '';

    let url = '';
    const thumbnail = display.thumbnail || display; // sometimes display is the image itself (legacy)

    if (typeof thumbnail === 'string') {
        url = thumbnail;
    } else if (thumbnail?.url) {
        url = thumbnail.url;
    } else if (thumbnail?.cid) {
        url = `https://ipfs-gtwy-nft.infura-ipfs.io/ipfs/${thumbnail.cid}${thumbnail.path ? `/${thumbnail.path}` : ''}`;
    }

    return resolveIPFS(url);
};

export interface NFTMedia {
    type: 'image' | 'video';
    url: string;
    fallbackImage?: string;
}

/** Get best media for NFT (Video if available, else Image) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getNFTMedia = (nft: any, collectionId: string = ''): NFTMedia => {
    const image = getNFTThumbnail(nft);
    const id = nft?.tokenId || nft?.id;

    // Type checking helper
    const isCollection = (suffix: string) => collectionId.endsWith(suffix) || collectionId.includes(suffix);

    // 1. NBA Top Shot Video
    if (isCollection('TopShot') || isCollection('0b2a3299cc857e29.TopShot')) {
        return {
            type: 'video',
            url: `https://assets.nbatopshot.com/media/${id}/video`,
            fallbackImage: image
        };
    }

    // 2. NFL All Day Video — derive video URL from image URL by replacing last path segment
    //    Also strip query params (e.g. ?format=jpeg&width=256) so the video URL is clean.
    if (isCollection('AllDay') || isCollection('e4cf4bdc1751c65d.AllDay')) {
        let videoUrl = image && image.includes('media.nflallday.com')
            ? image.replace(/\/media\/[^/?#]+/, '/media/video')
            : image;
        if (videoUrl && videoUrl.includes('?')) {
            videoUrl = videoUrl.split('?')[0];
        }
        return {
            type: 'video',
            url: videoUrl,
            fallbackImage: image
        };
    }

    // 3. HWGarageCardV2 (Hot Wheels)
    if (isCollection('HWGarageCardV2') || isCollection('d0bcefdf1e67ea85.HWGarageCardV2')) {
        return {
            type: 'video', // User said video = image, likely mp4 in image field
            url: image, // Use the image URL as video source
            fallbackImage: image
        };
    }

    // Default to Image
    return {
        type: 'image',
        url: image
    };
};

/**
 * Known collections that support video preview at the collection level.
 * Maps collection identifier suffix to a preview video URL.
 * Used on /nfts page for hover-to-play.
 */
const COLLECTION_VIDEO_PROVIDERS: Record<string, string> = {
    'TopShot': 'https://assets.nbatopshot.com/media/1/video',
    '0b2a3299cc857e29.TopShot': 'https://assets.nbatopshot.com/media/1/video',
    'AllDay': 'https://media.nflallday.com/editions/10000241/media/video',
    'e4cf4bdc1751c65d.AllDay': 'https://media.nflallday.com/editions/10000241/media/video',
};

/**
 * Get a preview video URL for a collection (for hover-to-play on listing page).
 * Returns a URL string or null if the collection doesn't support video preview.
 */
export const getCollectionPreviewVideo = (collectionId: string): string | null => {
    if (!collectionId) return null;
    for (const [key, url] of Object.entries(COLLECTION_VIDEO_PROVIDERS)) {
        if (collectionId.endsWith(key) || collectionId.includes(key)) {
            return url;
        }
    }
    return null;
};
