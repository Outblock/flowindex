import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Image as ImageIcon, Layers } from 'lucide-react';
import {
  GlassCard,
  ImageWithFallback,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  resolveIPFS,
} from '@flowindex/flow-ui';
import { useWallet } from '../hooks/useWallet';
import {
  getNftCollections,
  getNftCollectionItems,
  type NftCollection,
  type NftItem,
} from '../api/flow';

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function CollectionSkeleton() {
  return (
    <GlassCard className="rounded-xl p-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-lg bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-white/10" />
          <div className="h-3 w-20 rounded bg-white/10" />
        </div>
      </div>
    </GlassCard>
  );
}

function ItemSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden bg-white/5 animate-pulse">
      <div className="aspect-square bg-white/10" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 w-24 rounded bg-white/10" />
        <div className="h-3 w-16 rounded bg-white/10" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NFT item detail modal
// ---------------------------------------------------------------------------

function NFTDetailModal({
  item,
  collection,
  open,
  onClose,
}: {
  item: NftItem | null;
  collection: NftCollection | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!item) return null;

  const thumbnail = resolveIPFS(item.thumbnail ?? '');

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-black/90 border-white/10 text-white overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold truncate">
            {item.name || `#${item.nft_id ?? item.id}`}
          </DialogTitle>
          {collection && (
            <DialogDescription className="text-sm text-zinc-400 truncate">
              {collection.display_name || collection.name || collection.contract_name}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Image */}
        <ImageWithFallback
          src={thumbnail}
          alt={item.name ?? 'NFT'}
          className="w-full aspect-square rounded-lg"
        />

        {/* Description */}
        {item.description && (
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {item.description}
          </p>
        )}

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {item.nft_id != null && (
            <MetaField label="Token ID" value={String(item.nft_id)} />
          )}
          {item.serial_number != null && (
            <MetaField label="Serial" value={`#${item.serial_number}`} />
          )}
          {item.edition_name && (
            <MetaField label="Edition" value={item.edition_name} />
          )}
          {item.edition_number != null && (
            <MetaField
              label="Edition #"
              value={
                item.edition_max
                  ? `${item.edition_number} / ${item.edition_max}`
                  : String(item.edition_number)
              }
            />
          )}
          {item.rarity_score && (
            <MetaField label="Rarity" value={item.rarity_score} />
          )}
          {item.nft_type && (
            <MetaField label="Collection" value={item.nft_type} />
          )}
        </div>

        {item.external_url && (
          <a
            href={item.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-emerald-400 hover:underline"
          >
            View on external site
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-lg px-3 py-2">
      <div className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className="text-zinc-200 truncate">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collection row (expandable)
// ---------------------------------------------------------------------------

function CollectionRow({ collection, address }: { collection: NftCollection; address: string }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<NftItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selectedItem, setSelectedItem] = useState<NftItem | null>(null);

  const nftType = collection.id || collection.nft_type || '';
  const collectionName = collection.display_name || collection.name || collection.contract_name || nftType;
  const count = collection.number_of_tokens ?? collection.nft_count ?? 0;
  const squareImage = resolveIPFS(collection.square_image || collection.logo || '');

  const toggle = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && items.length === 0 && !loadingItems) {
      setLoadingItems(true);
      try {
        const fetched = await getNftCollectionItems(address, nftType, { limit: 50 });
        setItems(fetched);
      } catch {
        // silently fail — items will remain empty
      } finally {
        setLoadingItems(false);
      }
    }
  }, [expanded, items.length, loadingItems, address, nftType]);

  return (
    <div>
      <GlassCard
        className="rounded-xl cursor-pointer hover:border-white/20 transition-colors"
        onClick={toggle}
      >
        <div className="flex items-center gap-4 p-4">
          <ImageWithFallback
            src={squareImage}
            alt={collectionName}
            className="w-14 h-14 rounded-lg shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-white truncate">{collectionName}</div>
            <div className="text-sm text-zinc-400">{count} item{count !== 1 ? 's' : ''}</div>
          </div>
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="w-5 h-5 text-zinc-500 shrink-0" />
          )}
        </div>
      </GlassCard>

      {expanded && (
        <div className="mt-3 mb-2">
          {loadingItems ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <ItemSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-sm text-zinc-500 text-center py-6">
              No items found in this collection
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((item) => (
                <NFTItemCard
                  key={item.id ?? item.nft_id}
                  item={item}
                  nftType={nftType}
                  onClick={() => setSelectedItem(item)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <NFTDetailModal
        item={selectedItem}
        collection={collection}
        open={!!selectedItem}
        onClose={() => setSelectedItem(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single NFT item card
// ---------------------------------------------------------------------------

function NFTItemCard({
  item,
  nftType,
  onClick,
}: {
  item: NftItem;
  nftType: string;
  onClick: () => void;
}) {
  const thumbnail = resolveIPFS(item.thumbnail ?? '');
  const name = item.name || `#${item.nft_id ?? item.id ?? '?'}`;
  const edition =
    item.serial_number != null
      ? `#${item.serial_number}`
      : item.edition_number != null
        ? `Edition ${item.edition_number}`
        : null;

  return (
    <button
      onClick={onClick}
      className="rounded-xl overflow-hidden bg-white/5 border border-transparent hover:border-white/15 transition-all text-left group"
    >
      <ImageWithFallback
        src={thumbnail}
        alt={name}
        className="w-full aspect-square"
        fallback={
          <div className="flex flex-col items-center gap-1 text-zinc-600">
            <ImageIcon className="w-8 h-8" />
            <span className="text-[10px]">{nftType.split('.').pop()}</span>
          </div>
        }
      />
      <div className="p-3">
        <div className="text-sm text-white font-medium truncate group-hover:text-emerald-300 transition-colors">
          {name}
        </div>
        {edition && <div className="text-xs text-zinc-500 mt-0.5">{edition}</div>}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NFTs() {
  const { activeAccount } = useWallet();
  const [collections, setCollections] = useState<NftCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeAccount?.address) {
      setCollections([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    getNftCollections(activeAccount.address)
      .then((data) => {
        if (!cancelled) setCollections(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Failed to load NFTs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeAccount?.address]);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-xl font-semibold text-white">NFTs</h1>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CollectionSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-xl font-semibold text-white">NFTs</h1>
        <div className="text-center py-16 text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  // Empty state
  if (collections.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-xl font-semibold text-white">NFTs</h1>
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500 gap-3">
          <Layers className="w-12 h-12" />
          <span className="text-lg">No NFTs found</span>
          <span className="text-sm text-zinc-600">
            NFTs owned by this account will appear here
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">NFTs</h1>
        <span className="text-sm text-zinc-500">
          {collections.length} collection{collections.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-3">
        {collections.map((c) => (
          <CollectionRow
            key={c.id || c.nft_type || c.name}
            collection={c}
            address={activeAccount!.address}
          />
        ))}
      </div>
    </div>
  );
}
