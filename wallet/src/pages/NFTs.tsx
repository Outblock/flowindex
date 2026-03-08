import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Image as ImageIcon, Layers } from 'lucide-react';
import {
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
    <div className="rounded-2xl p-4 animate-pulse bg-wallet-surface">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-wallet-surface-hover" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded-xl bg-wallet-surface-hover" />
          <div className="h-3 w-20 rounded-xl bg-wallet-surface-hover" />
        </div>
      </div>
    </div>
  );
}

function ItemSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden bg-wallet-surface animate-pulse">
      <div className="aspect-square bg-wallet-surface-hover" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 w-24 rounded-xl bg-wallet-surface-hover" />
        <div className="h-3 w-16 rounded-xl bg-wallet-surface-hover" />
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
      <DialogContent className="max-w-lg bg-wallet-bg border-wallet-border text-white overflow-y-auto max-h-[90vh] rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold truncate">
            {item.name || `#${item.nft_id ?? item.id}`}
          </DialogTitle>
          {collection && (
            <DialogDescription className="text-sm text-wallet-muted truncate">
              {collection.display_name || collection.name || collection.contract_name}
            </DialogDescription>
          )}
        </DialogHeader>

        <ImageWithFallback
          src={thumbnail}
          alt={item.name ?? 'NFT'}
          className="w-full aspect-square rounded-2xl"
        />

        {item.description && (
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {item.description}
          </p>
        )}

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
            className="text-sm text-wallet-accent hover:underline"
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
    <div className="bg-wallet-surface rounded-2xl px-3 py-2">
      <div className="text-[11px] text-wallet-muted uppercase tracking-wider">{label}</div>
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
        // silently fail
      } finally {
        setLoadingItems(false);
      }
    }
  }, [expanded, items.length, loadingItems, address, nftType]);

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-4 p-4 rounded-2xl bg-wallet-surface hover:bg-wallet-surface-hover border border-wallet-border transition-colors text-left"
      >
        <ImageWithFallback
          src={squareImage}
          alt={collectionName}
          className="w-14 h-14 rounded-2xl shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">{collectionName}</div>
          <div className="text-sm text-wallet-muted">{count} item{count !== 1 ? 's' : ''}</div>
        </div>
        {expanded ? (
          <ChevronDown className="w-5 h-5 text-wallet-muted shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 text-wallet-muted shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 mb-2">
          {loadingItems ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <ItemSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-sm text-wallet-muted text-center py-6">
              No items found in this collection
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
      className="rounded-2xl overflow-hidden bg-wallet-surface border border-wallet-border hover:border-wallet-border-light transition-all text-left group cursor-pointer"
    >
      <ImageWithFallback
        src={thumbnail}
        alt={name}
        className="w-full aspect-square"
        fallback={
          <div className="flex flex-col items-center gap-1 text-wallet-muted">
            <ImageIcon className="w-8 h-8" />
            <span className="text-[10px]">{nftType.split('.').pop()}</span>
          </div>
        }
      />
      <div className="p-3">
        <div className="text-sm text-white font-medium truncate group-hover:text-wallet-accent transition-colors">
          {name}
        </div>
        {edition && <div className="text-xs text-wallet-muted mt-0.5">{edition}</div>}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NFTs() {
  const { activeAccount, network } = useWallet();
  const [collections, setCollections] = useState<NftCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const address =
    network === 'testnet'
      ? activeAccount?.flowAddressTestnet
      : activeAccount?.flowAddress;

  useEffect(() => {
    if (!address) {
      setCollections([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    getNftCollections(address)
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
  }, [address]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-white">NFTs</h1>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CollectionSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-white">NFTs</h1>
        <div className="text-center py-16 text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-white">NFTs</h1>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-wallet-surface flex items-center justify-center">
            <Layers className="w-7 h-7 text-wallet-muted" />
          </div>
          <span className="text-base font-semibold text-white">No NFTs found</span>
          <span className="text-sm text-wallet-muted">
            NFTs owned by this account will appear here
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">NFTs</h1>
        <span className="text-sm text-wallet-muted">
          {collections.length} collection{collections.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-3">
        {collections.map((c) => (
          <CollectionRow
            key={c.id || c.nft_type || c.name}
            collection={c}
            address={address!}
          />
        ))}
      </div>
    </div>
  );
}
