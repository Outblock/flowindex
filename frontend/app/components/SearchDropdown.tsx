import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Coins, FileCode, ImageIcon, Hexagon, BadgeCheck } from 'lucide-react';
import type { SearchState, QuickMatchItem } from '../hooks/useSearch';
import type {
  SearchAllResponse,
  SearchContractResult,
  SearchTokenResult,
  SearchNFTCollectionResult,
} from '../api';
import type { BSSearchItem } from '@/types/blockscout';
import type {
  TxPreviewResponse,
  AddressPreviewResponse,
} from '@/types/blockscout';
import Avatar from 'boring-avatars';
import { colorsFromAddress, avatarVariant } from '@/components/AddressLink';
import { formatWei, truncateHash } from '@/lib/evmUtils';
import { formatRelativeTime } from '@/lib/time';

// ---------------------------------------------------------------------------
// Public handle exposed via ref
// ---------------------------------------------------------------------------

export interface SearchDropdownHandle {
  moveUp(): void;
  moveDown(): void;
  selectActive(): void;
  totalItems(): number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SearchDropdownProps {
  state: SearchState;
  onClose: () => void;
  highlightQuery: string;
}

// ---------------------------------------------------------------------------
// Flat item (for keyboard navigation)
// ---------------------------------------------------------------------------

interface FlatItem {
  route: string;
  label: string;
}

function evmItemRoute(item: BSSearchItem): string {
  const addr = item.address || item.address_hash;
  if (item.type === 'address' || item.type === 'contract') return `/accounts/${addr}`;
  if (item.type === 'transaction') return `/txs/${addr}`;
  if (item.type === 'token') return `/accounts/${addr}`;
  return `/accounts/${addr}`;
}

function getFlatItems(state: SearchState): FlatItem[] {
  if (state.mode === 'quick-match') {
    return state.quickMatches.map((m) => ({ route: m.route, label: m.label }));
  }

  if (state.mode === 'preview') {
    const items: FlatItem[] = [];
    if (state.previewData && state.previewType === 'tx') {
      const data = state.previewData as TxPreviewResponse;
      if (data.cadence) items.push({ route: `/txs/${data.cadence.id}`, label: 'Cadence Transaction' });
      if (data.evm) items.push({ route: `/txs/${data.evm.hash}?view=evm`, label: 'EVM Transaction' });
      if (data.scheduled) items.push({ route: `/scheduled/${data.scheduled.scheduled_id}`, label: 'Scheduled Transaction' });
    } else if (state.previewData && state.previewType === 'address') {
      const data = state.previewData as AddressPreviewResponse;
      // Show the searched address type first
      const searchedFlow = state.quickMatches[0]?.type === 'flow-account';
      if (searchedFlow) {
        if (data.cadence) items.push({ route: `/accounts/${data.cadence.address}`, label: 'Flow Address' });
        if (data.evm) items.push({ route: `/accounts/${data.evm.address}`, label: 'EVM Address' });
      } else {
        if (data.evm) items.push({ route: `/accounts/${data.evm.address}`, label: 'EVM Address' });
        if (data.cadence) items.push({ route: `/accounts/${data.cadence.address}`, label: 'Flow Address' });
      }
    }
    // Fallback to quickMatches during loading
    if (items.length === 0) {
      return state.quickMatches.map((m) => ({ route: m.route, label: m.label }));
    }
    return items;
  }

  if (state.mode === 'fuzzy') {
    const items: FlatItem[] = [];
    if (state.fuzzyResults) {
      for (const c of state.fuzzyResults.contracts) {
        items.push({
          route: `/contracts/A.${c.address}.${c.name}`,
          label: c.name,
        });
      }
      for (const t of state.fuzzyResults.tokens) {
        items.push({
          route: `/tokens/A.${t.address}.${t.contract_name}`,
          label: t.name,
        });
      }
      for (const n of state.fuzzyResults.nft_collections) {
        items.push({
          route: `/nfts/A.${n.address}.${n.contract_name}`,
          label: n.name,
        });
      }
    }
    if (state.evmResults) {
      for (const item of state.evmResults) {
        items.push({
          route: evmItemRoute(item),
          label: item.name || item.address || '?',
        });
      }
    }
    return items;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="h-px flex-1 bg-white/5" />
    </div>
  );
}

function ResultRow({
  idx,
  isActive,
  icon,
  label,
  sublabel,
  badge,
  badgeClass,
  onClick,
}: {
  idx: number;
  isActive: boolean;
  icon: React.ReactNode;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  badge?: string;
  badgeClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-index={idx}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left text-sm transition-colors ${
        isActive
          ? 'border-l-nothing-green bg-nothing-green/5'
          : 'border-l-transparent hover:bg-white/[0.02]'
      }`}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-zinc-200">{label}</span>
        {sublabel && (
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
        )}
      </span>
      {badge && (
        <span
          className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${badgeClass ?? 'bg-zinc-800 text-zinc-400'}`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-nothing-green">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function contractBadge(kind: string): { badge: string; badgeClass: string } {
  const k = kind.toUpperCase();
  if (k === 'FT' || k === 'FUNGIBLE')
    return { badge: 'FT', badgeClass: 'bg-nothing-green/10 text-nothing-green' };
  if (k === 'NFT' || k === 'NON_FUNGIBLE')
    return { badge: 'NFT', badgeClass: 'bg-purple-500/10 text-purple-400' };
  return { badge: 'CONTRACT', badgeClass: 'bg-zinc-800 text-zinc-400' };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const SearchDropdown = forwardRef<SearchDropdownHandle, SearchDropdownProps>(
  function SearchDropdown({ state, onClose, highlightQuery }, ref) {
    const navigate = useNavigate();
    const [activeIndex, setActiveIndex] = useState(-1);

    const flatItems = useMemo(() => getFlatItems(state), [state]);

    const goTo = useCallback(
      (route: string) => {
        onClose();
        navigate({ to: route });
      },
      [navigate, onClose],
    );

    useImperativeHandle(
      ref,
      () => ({
        moveUp() {
          setActiveIndex((prev) => (prev <= 0 ? flatItems.length - 1 : prev - 1));
        },
        moveDown() {
          setActiveIndex((prev) => (prev >= flatItems.length - 1 ? 0 : prev + 1));
        },
        selectActive() {
          const idx = activeIndex >= 0 ? activeIndex : 0;
          const item = flatItems[idx];
          if (item) goTo(item.route);
        },
        totalItems() {
          return flatItems.length;
        },
      }),
      [flatItems, activeIndex, goTo],
    );

    // -----------------------------------------------------------------------
    // Render: idle → nothing
    // -----------------------------------------------------------------------
    if (state.mode === 'idle') return null;

    // -----------------------------------------------------------------------
    // Container
    // -----------------------------------------------------------------------
    let globalIdx = 0;

    return (
      <div className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-sm border border-white/10 bg-zinc-900 shadow-2xl">
        {/* Quick-match mode */}
        {state.mode === 'quick-match' && (
          <>
            <SectionLabel label="Possible matches" />
            {state.quickMatches.map((m) => {
              const idx = globalIdx++;
              return (
                <ResultRow
                  key={m.type}
                  idx={idx}
                  isActive={activeIndex === idx}
                  icon={<ArrowRight className="h-4 w-4 text-zinc-500" />}
                  label={
                    <HighlightMatch text={m.label} query={highlightQuery} />
                  }
                  sublabel={
                    <span className="font-mono text-[11px]">
                      {m.value.length > 16
                        ? `${m.value.slice(0, 8)}...${m.value.slice(-8)}`
                        : m.value}
                    </span>
                  }
                  onClick={() => goTo(m.route)}
                />
              );
            })}
          </>
        )}

        {/* Preview mode */}
        {state.mode === 'preview' && (
          <>
            {/* Preview loading */}
            {state.previewLoading && (
              <div className="space-y-2 p-3">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded bg-white/5"
                  />
                ))}
              </div>
            )}

            {/* Preview error */}
            {!state.previewLoading && state.error && (
              <div className="px-3 py-4 text-center text-sm text-zinc-500">
                Preview unavailable
              </div>
            )}

            {/* Preview tx results */}
            {!state.previewLoading && !state.error && state.previewType === 'tx' && (() => {
              const data = state.previewData as TxPreviewResponse | null;
              if (!data || (!data.cadence && !data.evm && !data.scheduled)) {
                return (
                  <div className="px-3 py-4 text-center text-sm text-zinc-500">
                    Transaction not found
                  </div>
                );
              }
              return (
                <>
                  {data.cadence && (() => {
                    const idx = globalIdx++;
                    return (
                      <>
                        <SectionLabel label="Cadence Transaction" />
                        <button
                          type="button"
                          data-index={idx}
                          onClick={() => goTo(`/txs/${data.cadence!.id}`)}
                          className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                            activeIndex === idx
                              ? 'border-l-nothing-green bg-nothing-green/5'
                              : 'border-l-transparent hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                              data.cadence.status === 'SEALED'
                                ? 'bg-nothing-green/10 text-nothing-green'
                                : 'bg-yellow-500/10 text-yellow-400'
                            }`}>
                              {data.cadence.status}
                            </span>
                            <span className="text-xs text-zinc-400">
                              Block #{(data.cadence.block_height ?? 0).toLocaleString()}
                            </span>
                            <span className="text-xs text-zinc-500">
                              {formatRelativeTime(data.cadence.timestamp)}
                            </span>
                            {data.cadence.is_evm && (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase bg-blue-500/10 text-blue-400">
                                EVM
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs text-zinc-400 truncate block">
                            <HighlightMatch text={data.cadence.id} query={highlightQuery} />
                          </span>
                        </button>
                      </>
                    );
                  })()}

                  {data.evm && (() => {
                    const idx = globalIdx++;
                    const sectionLabel = data.link
                      ? 'EVM Transaction (linked)'
                      : 'EVM Transaction';
                    return (
                      <>
                        <SectionLabel label={sectionLabel} />
                        <button
                          type="button"
                          data-index={idx}
                          onClick={() => goTo(`/txs/${data.evm!.hash}?view=evm`)}
                          className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                            activeIndex === idx
                              ? 'border-l-nothing-green bg-nothing-green/5'
                              : 'border-l-transparent hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                              data.evm.status === 'ok'
                                ? 'bg-nothing-green/10 text-nothing-green'
                                : 'bg-red-500/10 text-red-400'
                            }`}>
                              {data.evm.status === 'ok' ? 'Success' : 'Failed'}
                            </span>
                            {data.evm.method && (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-400">
                                {data.evm.method}
                              </span>
                            )}
                            <span className="text-xs text-zinc-400">
                              {formatWei(data.evm.value)} FLOW
                            </span>
                          </div>
                          <span className="font-mono text-xs text-zinc-400 truncate block">
                            <HighlightMatch text={data.evm.hash} query={highlightQuery} />
                          </span>
                          <div className="flex items-center gap-1 text-xs text-zinc-500">
                            <span className="font-mono">{truncateHash(data.evm.from, 8, 6)}</span>
                            <ArrowRight className="h-3 w-3 flex-shrink-0" />
                            <span className="font-mono">{data.evm.to ? truncateHash(data.evm.to, 8, 6) : 'Contract Creation'}</span>
                          </div>
                        </button>
                      </>
                    );
                  })()}

                  {data.scheduled && (() => {
                    const idx = globalIdx++;
                    return (
                      <>
                        <SectionLabel label="Scheduled Transaction" />
                        <button
                          type="button"
                          data-index={idx}
                          onClick={() => goTo(`/scheduled/${data.scheduled!.scheduled_id}`)}
                          className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                            activeIndex === idx
                              ? 'border-l-nothing-green bg-nothing-green/5'
                              : 'border-l-transparent hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                              data.scheduled!.status === 'EXECUTED'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : data.scheduled!.status === 'CANCELED'
                                  ? 'bg-red-500/10 text-red-400'
                                  : 'bg-amber-500/10 text-amber-400'
                            }`}>
                              {data.scheduled!.status}
                            </span>
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-400">
                              {data.scheduled!.matched_by === 'executed_tx' ? 'Executor' : 'Scheduling TX'}
                            </span>
                            <span className="text-xs text-zinc-400">
                              #{data.scheduled!.scheduled_id}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <span>{data.scheduled!.handler_contract}</span>
                            <span className="text-zinc-600">·</span>
                            <span>{data.scheduled!.handler_owner}</span>
                          </div>
                        </button>
                      </>
                    );
                  })()}
                </>
              );
            })()}

            {/* Preview address results */}
            {!state.previewLoading && !state.error && state.previewType === 'address' && (() => {
              const data = state.previewData as AddressPreviewResponse | null;
              if (!data || (!data.cadence && !data.evm)) {
                return (
                  <div className="px-3 py-4 text-center text-sm text-zinc-500">
                    Address not found
                  </div>
                );
              }

              const searchedFlow = state.quickMatches[0]?.type === 'flow-account';
              const hasCOALink = !!(data.link || data.coa_link);

              // Render a Cadence address card
              const renderCadence = (isPrimary: boolean) => {
                if (!data.cadence) return null;
                const idx = globalIdx++;
                const cadenceAddr = data.cadence.address.startsWith('0x') ? data.cadence.address : `0x${data.cadence.address}`;
                return (
                  <>
                    <SectionLabel label={isPrimary ? 'Flow Address' : hasCOALink ? 'Linked COA Owner' : 'Flow Address'} />
                    <button
                      type="button"
                      data-index={idx}
                      onClick={() => goTo(`/accounts/${cadenceAddr}`)}
                      className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                        activeIndex === idx
                          ? 'border-l-nothing-green bg-nothing-green/5'
                          : 'border-l-transparent hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar size={20} name={cadenceAddr} variant={avatarVariant(cadenceAddr)} colors={colorsFromAddress(cadenceAddr)} />
                        <span className="font-mono text-xs text-zinc-200">
                          <HighlightMatch text={cadenceAddr} query={highlightQuery} />
                        </span>
                        {hasCOALink && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase bg-violet-500/10 text-violet-400">
                            COA
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        {(data.cadence.contracts_count ?? 0) > 0 && (
                          <span>{data.cadence.contracts_count} contract{data.cadence.contracts_count !== 1 ? 's' : ''}</span>
                        )}
                        {data.cadence.has_keys && <span>Has keys</span>}
                      </div>
                    </button>
                  </>
                );
              };

              // Render an EVM address card
              const renderEVM = (isPrimary: boolean) => {
                if (!data.evm) return null;
                const idx = globalIdx++;
                return (
                  <>
                    <SectionLabel label={isPrimary ? 'EVM Address' : hasCOALink ? '↳ Linked EVM (COA)' : 'EVM Address'} />
                    <button
                      type="button"
                      data-index={idx}
                      onClick={() => goTo(`/accounts/${data.evm!.address}`)}
                      className={`flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                        !isPrimary && hasCOALink ? 'ml-3 ' : ''
                      }${
                        activeIndex === idx
                          ? 'border-l-nothing-green bg-nothing-green/5'
                          : 'border-l-transparent hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar size={20} name={data.evm!.address} variant={avatarVariant(data.evm!.address)} colors={colorsFromAddress(data.evm!.address)} />
                        <span className="font-mono text-xs text-zinc-200 truncate">
                          <HighlightMatch text={data.evm.address} query={highlightQuery} />
                        </span>
                        <span className="text-xs text-zinc-400 shrink-0">
                          {formatWei(data.evm.balance)} FLOW
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">
                          {(data.evm.tx_count ?? 0).toLocaleString()} txns
                        </span>
                        {data.evm.is_contract && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase bg-blue-500/10 text-blue-400">
                            Contract
                          </span>
                        )}
                        {data.evm.is_verified && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase bg-nothing-green/10 text-nothing-green">
                            Verified
                          </span>
                        )}
                      </div>
                    </button>
                  </>
                );
              };

              return searchedFlow ? (
                <>
                  {renderCadence(true)}
                  {renderEVM(false)}
                </>
              ) : (
                <>
                  {renderEVM(true)}
                  {renderCadence(false)}
                </>
              );
            })()}
          </>
        )}

        {/* Fuzzy mode — loading */}
        {state.mode === 'fuzzy' && state.isLoading && (
          <div className="space-y-2 p-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded bg-white/5"
              />
            ))}
          </div>
        )}

        {/* Fuzzy mode — error */}
        {state.mode === 'fuzzy' && state.error && (
          <div className="px-3 py-4 text-center text-sm text-zinc-500">
            Search unavailable
          </div>
        )}

        {/* Fuzzy mode — no results */}
        {state.mode === 'fuzzy' &&
          !state.isLoading &&
          !state.error &&
          state.fuzzyResults &&
          !state.fuzzyResults.contracts.length &&
          !state.fuzzyResults.tokens.length &&
          !state.fuzzyResults.nft_collections.length &&
          !(state.evmResults && state.evmResults.length > 0) && (
            <div className="px-3 py-4 text-center text-sm text-zinc-500">
              No results found
            </div>
          )}

        {/* Fuzzy mode — results */}
        {state.mode === 'fuzzy' &&
          !state.isLoading &&
          !state.error &&
          ((state.fuzzyResults &&
            (state.fuzzyResults.contracts.length > 0 ||
              state.fuzzyResults.tokens.length > 0 ||
              state.fuzzyResults.nft_collections.length > 0)) ||
            (state.evmResults && state.evmResults.length > 0)) && (
            <>
              {state.fuzzyResults && state.fuzzyResults.contracts.length > 0 && (
                <>
                  <SectionLabel label="Contracts" />
                  {state.fuzzyResults.contracts.map((c: SearchContractResult) => {
                    const idx = globalIdx++;
                    const { badge, badgeClass } = contractBadge(c.kind);
                    return (
                      <ResultRow
                        key={`c-${c.address}-${c.name}`}
                        idx={idx}
                        isActive={activeIndex === idx}
                        icon={<FileCode className="h-4 w-4 text-zinc-500" />}
                        label={
                          <HighlightMatch text={c.name} query={highlightQuery} />
                        }
                        sublabel={`A.${c.address.slice(0, 6)}...${c.address.slice(-4)}`}
                        badge={badge}
                        badgeClass={badgeClass}
                        onClick={() =>
                          goTo(`/contracts/A.${c.address}.${c.name}`)
                        }
                      />
                    );
                  })}
                </>
              )}

              {state.fuzzyResults && state.fuzzyResults.tokens.length > 0 && (
                <>
                  <SectionLabel label="Tokens" />
                  {state.fuzzyResults.tokens.map((t: SearchTokenResult) => {
                    const idx = globalIdx++;
                    const tokenIcon = t.logo
                      ? <img src={t.logo} alt="" className="h-4 w-4 rounded-full object-cover" />
                      : <Coins className="h-4 w-4 text-nothing-green" />;
                    return (
                      <ResultRow
                        key={`t-${t.address}-${t.contract_name}`}
                        idx={idx}
                        isActive={activeIndex === idx}
                        icon={tokenIcon}
                        label={
                          <span className="inline-flex items-center gap-1">
                            <HighlightMatch text={t.name || t.contract_name} query={highlightQuery} />
                            {t.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-nothing-green flex-shrink-0" />}
                          </span>
                        }
                        sublabel={t.symbol || t.contract_name}
                        badge="FT"
                        badgeClass="bg-nothing-green/10 text-nothing-green"
                        onClick={() =>
                          goTo(`/tokens/A.${t.address}.${t.contract_name}`)
                        }
                      />
                    );
                  })}
                </>
              )}

              {state.fuzzyResults && state.fuzzyResults.nft_collections.length > 0 && (
                <>
                  <SectionLabel label="NFT Collections" />
                  {state.fuzzyResults.nft_collections.map(
                    (n: SearchNFTCollectionResult) => {
                      const idx = globalIdx++;
                      const nftIcon = n.square_image
                        ? <img src={n.square_image} alt="" className="h-4 w-4 rounded object-cover" />
                        : <ImageIcon className="h-4 w-4 text-purple-400" />;
                      return (
                        <ResultRow
                          key={`n-${n.address}-${n.contract_name}`}
                          idx={idx}
                          isActive={activeIndex === idx}
                          icon={nftIcon}
                          label={
                            <span className="inline-flex items-center gap-1">
                              <HighlightMatch
                                text={n.name}
                                query={highlightQuery}
                              />
                              {n.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />}
                            </span>
                          }
                          sublabel={n.contract_name}
                          badge="NFT"
                          badgeClass="bg-purple-500/10 text-purple-400"
                          onClick={() =>
                            goTo(
                              `/nfts/A.${n.address}.${n.contract_name}`,
                            )
                          }
                        />
                      );
                    },
                  )}
                </>
              )}

              {/* EVM Results */}
              {state.evmResults && state.evmResults.length > 0 && (
                <>
                  <SectionLabel label="EVM" />
                  {state.evmResults.map((item: BSSearchItem, i: number) => {
                    const idx = globalIdx++;
                    const route = evmItemRoute(item);
                    const displayLabel = item.name || item.address || '?';
                    const sublabel = item.symbol
                      ? item.symbol
                      : item.address
                        ? `${item.address.slice(0, 8)}...${item.address.slice(-6)}`
                        : undefined;
                    const evmIcon = item.icon_url
                      ? <img src={item.icon_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                      : <Hexagon className="h-4 w-4 text-blue-400" />;
                    return (
                      <ResultRow
                        key={`evm-${i}-${item.address || item.address_hash}`}
                        idx={idx}
                        isActive={activeIndex === idx}
                        icon={evmIcon}
                        label={
                          <HighlightMatch text={displayLabel} query={highlightQuery} />
                        }
                        sublabel={sublabel}
                        badge="EVM"
                        badgeClass="bg-blue-500/10 text-blue-400"
                        onClick={() => goTo(route)}
                      />
                    );
                  })}
                </>
              )}
            </>
          )}

        {/* Footer with keyboard hints */}
        <div className="flex items-center gap-3 border-t border-white/5 px-3 py-1.5 text-[10px] text-zinc-600">
          <span>
            <kbd className="rounded border border-white/10 bg-zinc-800 px-1 py-0.5 font-mono text-[10px]">
              &uarr;
            </kbd>{' '}
            <kbd className="rounded border border-white/10 bg-zinc-800 px-1 py-0.5 font-mono text-[10px]">
              &darr;
            </kbd>{' '}
            navigate
          </span>
          <span>
            <kbd className="rounded border border-white/10 bg-zinc-800 px-1 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{' '}
            select
          </span>
          <span>
            <kbd className="rounded border border-white/10 bg-zinc-800 px-1 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>{' '}
            close
          </span>
        </div>
      </div>
    );
  },
);
