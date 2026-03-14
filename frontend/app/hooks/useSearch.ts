import { useCallback, useEffect, useRef, useState } from 'react';
import { searchAll, type SearchAllResponse } from '../api';
import { searchEVM } from '@/api/evm';
import type { BSSearchItem } from '@/types/blockscout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchMode = 'idle' | 'quick-match' | 'fuzzy';

export interface QuickMatchItem {
  type: string;
  label: string;
  value: string;
  route: string;
}

export interface SearchState {
  mode: SearchMode;
  quickMatches: QuickMatchItem[];
  fuzzyResults: SearchAllResponse | null;
  evmResults: BSSearchItem[];
  isLoading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Pattern matchers — ordered from most specific to least
// ---------------------------------------------------------------------------

const HEX_128 = /^[0-9a-fA-F]{128}$/;
const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const HEX_64 = /^[0-9a-fA-F]{64}$/;
const DIGITS = /^\d+$/;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;    // 0x-prefixed EVM address
const HEX_40 = /^[0-9a-fA-F]{40}$/;
const HEX_16 = /^(0x)?[0-9a-fA-F]{16}$/;

function detectPattern(query: string): { mode: SearchMode; matches: QuickMatchItem[] } {
  const q = query.trim();

  // 1. 128-hex → public key (deterministic, stay idle for direct-jump)
  if (HEX_128.test(q)) {
    return { mode: 'idle', matches: [{ type: 'public-key', label: 'Public Key', value: q, route: `/key/${q}` }] };
  }

  // 2. 0x + 64-hex → EVM transaction (deterministic)
  if (EVM_TX.test(q)) {
    return { mode: 'idle', matches: [{ type: 'evm-tx', label: 'EVM Transaction', value: q, route: `/txs/evm/${q}` }] };
  }

  // 3. 64-hex → ambiguous: could be Cadence tx or EVM tx
  if (HEX_64.test(q)) {
    return {
      mode: 'quick-match',
      matches: [
        { type: 'cadence-tx', label: 'Cadence Transaction', value: q, route: `/txs/${q}` },
        { type: 'evm-tx', label: 'EVM Transaction', value: q, route: `/txs/evm/0x${q}` },
      ],
    };
  }

  // 4. Pure digits → block height (deterministic)
  if (DIGITS.test(q)) {
    return { mode: 'idle', matches: [{ type: 'block', label: 'Block', value: q, route: `/blocks/${q}` }] };
  }

  // 5a. 0x + 40-hex → EVM address (deterministic)
  if (EVM_ADDR.test(q)) {
    return { mode: 'idle', matches: [{ type: 'evm-addr', label: 'EVM Address', value: q, route: `/accounts/${q}` }] };
  }

  // 5b. 40-hex (no 0x prefix) → EVM address (add 0x)
  if (HEX_40.test(q)) {
    return { mode: 'idle', matches: [{ type: 'evm-addr', label: 'EVM Address', value: q, route: `/accounts/0x${q}` }] };
  }

  // 6. 16-hex (with optional 0x) → Flow account (deterministic)
  if (HEX_16.test(q)) {
    const addr = q.startsWith('0x') ? q.slice(2) : q;
    return { mode: 'idle', matches: [{ type: 'flow-account', label: 'Flow Account', value: addr, route: `/accounts/0x${addr}` }] };
  }

  return { mode: 'idle', matches: [] };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const EMPTY_FUZZY: SearchAllResponse = { contracts: [], tokens: [], nft_collections: [] };

const INITIAL_STATE: SearchState = {
  mode: 'idle',
  quickMatches: [],
  fuzzyResults: null,
  evmResults: [],
  isLoading: false,
  error: null,
};

export function useSearch() {
  const [state, setState] = useState<SearchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(INITIAL_STATE);
  }, []);

  const search = useCallback((query: string) => {
    // Cancel any pending request / timer
    abortRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);

    const q = query.trim();

    // Empty query → reset
    if (!q) {
      setState(INITIAL_STATE);
      return;
    }

    // Try deterministic pattern detection first
    const { mode, matches } = detectPattern(q);

    if (mode === 'quick-match') {
      setState({ mode: 'quick-match', quickMatches: matches, fuzzyResults: null, evmResults: [], isLoading: false, error: null });
      return;
    }

    // Deterministic single match → idle (Header handles direct-jump)
    if (matches.length > 0) {
      setState({ mode: 'idle', quickMatches: matches, fuzzyResults: null, evmResults: [], isLoading: false, error: null });
      return;
    }

    // Free-text fuzzy search — need at least 2 chars
    if (q.length < 2) {
      setState(INITIAL_STATE);
      return;
    }

    // Show loading immediately, debounce the actual API call
    setState({ mode: 'fuzzy', quickMatches: [], fuzzyResults: null, evmResults: [], isLoading: true, error: null });

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const [localResult, evmResult] = await Promise.allSettled([
          searchAll(q, 3, controller.signal),
          searchEVM(q, controller.signal),
        ]);

        // Don't update state if this request was aborted
        if (controller.signal.aborted) return;

        const fuzzyResults = localResult.status === 'fulfilled' ? localResult.value : { contracts: [], tokens: [], nft_collections: [] };
        const evmResults = evmResult.status === 'fulfilled' ? (evmResult.value.items ?? []) : [];

        setState({
          mode: 'fuzzy',
          quickMatches: [],
          fuzzyResults: fuzzyResults.contracts.length || fuzzyResults.tokens.length || fuzzyResults.nft_collections.length
            ? fuzzyResults
            : EMPTY_FUZZY,
          evmResults,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setState({
          mode: 'fuzzy',
          quickMatches: [],
          fuzzyResults: null,
          evmResults: [],
          isLoading: false,
          error: err instanceof Error ? err.message : 'Search failed',
        });
      }
    }, 300);
  }, []);

  return { ...state, search, reset };
}
