import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Coins, FileCode, ImageIcon } from 'lucide-react';
import type { SearchState, QuickMatchItem } from '../hooks/useSearch';
import type {
  SearchAllResponse,
  SearchContractResult,
  SearchTokenResult,
  SearchNFTCollectionResult,
} from '../api';

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

function getFlatItems(state: SearchState): FlatItem[] {
  if (state.mode === 'quick-match') {
    return state.quickMatches.map((m) => ({ route: m.route, label: m.label }));
  }

  if (state.mode === 'fuzzy' && state.fuzzyResults) {
    const items: FlatItem[] = [];
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
          const item = flatItems[activeIndex];
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
      <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-sm border border-white/10 bg-zinc-900 shadow-2xl">
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
          !state.fuzzyResults.nft_collections.length && (
            <div className="px-3 py-4 text-center text-sm text-zinc-500">
              No results found
            </div>
          )}

        {/* Fuzzy mode — results */}
        {state.mode === 'fuzzy' &&
          !state.isLoading &&
          !state.error &&
          state.fuzzyResults &&
          (state.fuzzyResults.contracts.length > 0 ||
            state.fuzzyResults.tokens.length > 0 ||
            state.fuzzyResults.nft_collections.length > 0) && (
            <>
              {state.fuzzyResults.contracts.length > 0 && (
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

              {state.fuzzyResults.tokens.length > 0 && (
                <>
                  <SectionLabel label="Tokens" />
                  {state.fuzzyResults.tokens.map((t: SearchTokenResult) => {
                    const idx = globalIdx++;
                    return (
                      <ResultRow
                        key={`t-${t.address}-${t.contract_name}`}
                        idx={idx}
                        isActive={activeIndex === idx}
                        icon={<Coins className="h-4 w-4 text-nothing-green" />}
                        label={
                          <HighlightMatch text={t.name} query={highlightQuery} />
                        }
                        sublabel={t.symbol}
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

              {state.fuzzyResults.nft_collections.length > 0 && (
                <>
                  <SectionLabel label="NFT Collections" />
                  {state.fuzzyResults.nft_collections.map(
                    (n: SearchNFTCollectionResult) => {
                      const idx = globalIdx++;
                      return (
                        <ResultRow
                          key={`n-${n.address}-${n.contract_name}`}
                          idx={idx}
                          isActive={activeIndex === idx}
                          icon={
                            <ImageIcon className="h-4 w-4 text-purple-400" />
                          }
                          label={
                            <HighlightMatch
                              text={n.name}
                              query={highlightQuery}
                            />
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
