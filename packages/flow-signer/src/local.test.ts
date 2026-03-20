import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalSigner, parseKeyIndexerResponse } from './local.js';
import type { DiscoveredAccount } from './local.js';

// ---------------------------------------------------------------------------
// Fixtures — real data from FlowIndex key-indexer API
// GET https://flowindex.io/api/flow/key/{publicKey}
// ---------------------------------------------------------------------------

/** Real response for public key 3588eb28... (Dapper Labs / service account key) */
const REAL_KEY_INDEXER_RESPONSE = {
  _meta: { count: 5, has_more: false, limit: 20, offset: 0 },
  data: [
    {
      address: '0xf919ee77447b7497',
      hashing_algorithm: '1',
      key_index: 0,
      public_key:
        '3588eb28b60e28d24c1e8b03f9a00f73ebd3f6707ee813e27d58ecb6439b8dde1413d7a74a7cc7e8939cbef2e0aa6acc51d5c7010afdb4c6dba55d4cc2ca8bed',
      revoked: false,
      signing_algorithm: '3',
      weight: 1000,
    },
    {
      address: '0x1654653399040a61',
      hashing_algorithm: '1',
      key_index: 0,
      public_key:
        '3588eb28b60e28d24c1e8b03f9a00f73ebd3f6707ee813e27d58ecb6439b8dde1413d7a74a7cc7e8939cbef2e0aa6acc51d5c7010afdb4c6dba55d4cc2ca8bed',
      revoked: false,
      signing_algorithm: '2',
      weight: 1000,
    },
    {
      address: '0xf233dcee88fe0abe',
      hashing_algorithm: '1',
      key_index: 0,
      public_key:
        '3588eb28b60e28d24c1e8b03f9a00f73ebd3f6707ee813e27d58ecb6439b8dde1413d7a74a7cc7e8939cbef2e0aa6acc51d5c7010afdb4c6dba55d4cc2ca8bed',
      revoked: false,
      signing_algorithm: '2',
      weight: 1000,
    },
    {
      address: '0x1d7e57aa55817448',
      hashing_algorithm: '1',
      key_index: 0,
      public_key:
        '3588eb28b60e28d24c1e8b03f9a00f73ebd3f6707ee813e27d58ecb6439b8dde1413d7a74a7cc7e8939cbef2e0aa6acc51d5c7010afdb4c6dba55d4cc2ca8bed',
      revoked: false,
      signing_algorithm: '3',
      weight: 1000,
    },
    {
      address: '0xe467b9dd11fa00df',
      hashing_algorithm: '1',
      key_index: 1,
      public_key:
        '3588eb28b60e28d24c1e8b03f9a00f73ebd3f6707ee813e27d58ecb6439b8dde1413d7a74a7cc7e8939cbef2e0aa6acc51d5c7010afdb4c6dba55d4cc2ca8bed',
      revoked: true,
      signing_algorithm: '2',
      weight: 1000,
    },
  ],
};

// A well-known test private key (DO NOT use in production)
const TEST_PRIVATE_KEY =
  'a]1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'.replace(
    /\]|a(?=1)/g,
    '',
  );
// Clean hex: 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
const TEST_PRIVATE_KEY_HEX =
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

// Known EVM address for this private key (secp256k1)
// Computed via: privateKeyToAccount('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef').address
const EXPECTED_EVM_ADDRESS = '0x1Be31A94361a391bBaFB2a4CCd704F57dc04d4bb';

// ---------------------------------------------------------------------------
// parseKeyIndexerResponse
// ---------------------------------------------------------------------------

describe('parseKeyIndexerResponse', () => {
  it('parses real FlowIndex response correctly', () => {
    const accounts = parseKeyIndexerResponse(REAL_KEY_INDEXER_RESPONSE);

    // Should exclude revoked key (e467b9dd11fa00df key_index=1)
    expect(accounts).toHaveLength(4);

    // First account
    expect(accounts[0]).toEqual({
      address: '0xf919ee77447b7497',
      keyIndex: 0,
      sigAlgo: 'ECDSA_secp256k1', // signing_algorithm "3"
      hashAlgo: 'SHA2_256', // hashing_algorithm "1"
    });

    // Second account — P256
    expect(accounts[1]).toEqual({
      address: '0x1654653399040a61',
      keyIndex: 0,
      sigAlgo: 'ECDSA_P256', // signing_algorithm "2"
      hashAlgo: 'SHA2_256',
    });
  });

  it('filters out revoked keys', () => {
    const accounts = parseKeyIndexerResponse(REAL_KEY_INDEXER_RESPONSE);
    const addresses = accounts.map((a) => a.address);
    // e467b9dd11fa00df has revoked=true
    expect(addresses).not.toContain('0xe467b9dd11fa00df');
  });

  it('filters out low-weight keys', () => {
    const response = {
      data: [
        {
          address: '0xabc',
          key_index: 0,
          weight: 500,
          revoked: false,
          signing_algorithm: '2',
          hashing_algorithm: '1',
        },
        {
          address: '0xdef',
          key_index: 0,
          weight: 1000,
          revoked: false,
          signing_algorithm: '3',
          hashing_algorithm: '1',
        },
      ],
    };
    const accounts = parseKeyIndexerResponse(response);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].address).toBe('0xdef');
  });

  it('returns empty array for missing data field', () => {
    expect(parseKeyIndexerResponse({})).toEqual([]);
    expect(parseKeyIndexerResponse({ data: null })).toEqual([]);
    expect(parseKeyIndexerResponse(null)).toEqual([]);
    expect(parseKeyIndexerResponse('not json')).toEqual([]);
  });

  it('returns empty array for empty data', () => {
    expect(parseKeyIndexerResponse({ data: [] })).toEqual([]);
  });

  it('handles numeric algorithm codes correctly', () => {
    const response = {
      data: [
        {
          address: '0x1',
          key_index: 0,
          weight: 1000,
          revoked: false,
          signing_algorithm: '2', // P256
          hashing_algorithm: '1', // SHA2_256
        },
        {
          address: '0x2',
          key_index: 0,
          weight: 1000,
          revoked: false,
          signing_algorithm: '3', // secp256k1
          hashing_algorithm: '3', // SHA3_256
        },
      ],
    };

    const accounts = parseKeyIndexerResponse(response);
    expect(accounts[0].sigAlgo).toBe('ECDSA_P256');
    expect(accounts[0].hashAlgo).toBe('SHA2_256');
    expect(accounts[1].sigAlgo).toBe('ECDSA_secp256k1');
    expect(accounts[1].hashAlgo).toBe('SHA3_256');
  });

  it('handles string algorithm names', () => {
    const response = {
      data: [
        {
          address: '0x1',
          key_index: 0,
          weight: 1000,
          revoked: false,
          signing_algorithm: 'ECDSA_secp256k1',
          hashing_algorithm: 'SHA3_256',
        },
      ],
    };

    const accounts = parseKeyIndexerResponse(response);
    expect(accounts[0].sigAlgo).toBe('ECDSA_secp256k1');
    expect(accounts[0].hashAlgo).toBe('SHA3_256');
  });
});

// ---------------------------------------------------------------------------
// LocalSigner — key derivation & EVM address
// ---------------------------------------------------------------------------

describe('LocalSigner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('private key mode', () => {
    it('derives public key and computes EVM address', async () => {
      // Mock fetch to avoid network calls
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false }),
      );

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        { privateKey: TEST_PRIVATE_KEY_HEX },
      );
      await signer.init();

      const info = signer.info();

      // Should have derived a public key (128 hex chars = 64 bytes uncompressed sans prefix)
      expect(signer.getFlowPublicKey()).toHaveLength(128);

      // EVM address should be computed
      expect(info.evmAddress).toBe(EXPECTED_EVM_ADDRESS);
      expect(signer.getEvmAddress()).toBe(EXPECTED_EVM_ADDRESS);
    });

    it('uses separate EVM key when provided', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false }),
      );

      const separateEvmKey =
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        {
          privateKey: TEST_PRIVATE_KEY_HEX,
          evmPrivateKey: separateEvmKey,
        },
      );
      await signer.init();

      // EVM address should differ from the default (derived from Flow key)
      expect(signer.getEvmAddress()).not.toBe(EXPECTED_EVM_ADDRESS);
      expect(signer.getEvmPrivateKey()).toBe(separateEvmKey);
    });

    it('discovers Flow address via key-indexer API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => REAL_KEY_INDEXER_RESPONSE,
      });
      vi.stubGlobal('fetch', mockFetch);

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        { privateKey: TEST_PRIVATE_KEY_HEX },
      );
      await signer.init();

      // Should have called the key-indexer API
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/flow/key/'),
      );

      // Should pick the first non-revoked account with weight >= 1000
      expect(signer.getFlowAddress()).toBe('0xf919ee77447b7497');
      expect(signer.getKeyIndex()).toBe(0);
    });

    it('skips discovery when explicit address provided', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        {
          privateKey: TEST_PRIVATE_KEY_HEX,
          address: '0xdeadbeef12345678',
          keyIndex: 3,
        },
      );
      await signer.init();

      // Should NOT call the API
      expect(mockFetch).not.toHaveBeenCalled();

      // Should use the explicit address
      expect(signer.getFlowAddress()).toBe('0xdeadbeef12345678');
      expect(signer.getKeyIndex()).toBe(3);
    });

    it('handles discovery failure gracefully', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('network error')),
      );

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        { privateKey: TEST_PRIVATE_KEY_HEX },
      );
      await signer.init();

      // No address discovered, but signer still works
      expect(signer.getFlowAddress()).toBeUndefined();
      expect(signer.getFlowPublicKey()).toHaveLength(128);
      expect(signer.getEvmAddress()).toBe(EXPECTED_EVM_ADDRESS);
    });
  });

  describe('mnemonic mode', () => {
    // Standard 12-word test mnemonic (from BIP-39 test vectors — DO NOT use in production)
    const TEST_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    it('derives Flow key and EVM address from mnemonic', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false }),
      );

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        { mnemonic: TEST_MNEMONIC },
      );
      await signer.init();

      const info = signer.info();

      // Should derive a Flow public key
      expect(signer.getFlowPublicKey()).toHaveLength(128);

      // Should derive an EVM address (from m/44'/60'/0'/0/0)
      expect(info.evmAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it('discovers Flow address from mnemonic-derived public key', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              address: '0xabc123',
              key_index: 2,
              weight: 1000,
              revoked: false,
              signing_algorithm: '3',
              hashing_algorithm: '1',
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        { mnemonic: TEST_MNEMONIC },
      );
      await signer.init();

      expect(signer.getFlowAddress()).toBe('0xabc123');
      expect(signer.getKeyIndex()).toBe(2);
    });
  });

  describe('signing', () => {
    it('produces valid signature format (128 hex chars)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false }),
      );

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        { privateKey: TEST_PRIVATE_KEY_HEX },
      );
      await signer.init();

      const result = await signer.signFlowTransaction('deadbeef01020304');
      expect(result.signature).toHaveLength(128);
      expect(result.signature).toMatch(/^[0-9a-f]{128}$/);
    });

    it('throws if not initialized', async () => {
      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        { privateKey: TEST_PRIVATE_KEY_HEX },
      );

      // flowPrivateKey is empty before init()
      await expect(
        signer.signFlowTransaction('deadbeef'),
      ).rejects.toThrow();
    });
  });

  describe('info()', () => {
    it('returns correct metadata', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false }),
      );

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        {
          privateKey: TEST_PRIVATE_KEY_HEX,
          sigAlgo: 'ECDSA_P256',
          hashAlgo: 'SHA3_256',
        },
      );
      await signer.init();

      const info = signer.info();
      expect(info.type).toBe('local');
      expect(info.sigAlgo).toBe('ECDSA_P256');
      expect(info.hashAlgo).toBe('SHA3_256');
      expect(info.evmAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it('defaults to secp256k1 + SHA2_256', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false }),
      );

      const signer = new LocalSigner(
        { flowindexUrl: 'https://flowindex.io/api', network: 'mainnet' },
        { privateKey: TEST_PRIVATE_KEY_HEX },
      );
      await signer.init();

      const info = signer.info();
      expect(info.sigAlgo).toBe('ECDSA_secp256k1');
      expect(info.hashAlgo).toBe('SHA2_256');
    });
  });
});

// ---------------------------------------------------------------------------
// Integration test — real FlowIndex API (skipped in CI)
// ---------------------------------------------------------------------------

describe.skipIf(process.env.CI === 'true')('integration: FlowIndex key-indexer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('discovers accounts for a known public key', async () => {
    const publicKey =
      '3588eb28b60e28d24c1e8b03f9a00f73ebd3f6707ee813e27d58ecb6439b8dde1413d7a74a7cc7e8939cbef2e0aa6acc51d5c7010afdb4c6dba55d4cc2ca8bed';
    const resp = await fetch(
      `https://flowindex.io/api/flow/key/${publicKey}`,
      { signal: AbortSignal.timeout(10000) },
    );
    expect(resp.ok).toBe(true);

    const body = await resp.json();
    const accounts = parseKeyIndexerResponse(body);

    // Should find known accounts for this public key
    expect(accounts.length).toBeGreaterThan(0);

    // Known accounts: f919ee77447b7497, 1654653399040a61, f233dcee88fe0abe, 1d7e57aa55817448
    const addresses = accounts.map((a: DiscoveredAccount) => a.address);
    expect(addresses).toContain('0xf919ee77447b7497');
    expect(addresses).toContain('0x1654653399040a61');
  });
});
