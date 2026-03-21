import { formatShort, normalizeAddress } from '../components/account/accountUtils';

export type TxAddressKind = 'flow' | 'coa' | 'eoa';

export interface TxAddressBadge {
    label: string;
    tone: 'accent' | 'neutral';
}

export interface TxAddressBookEntry {
    address: string;
    addressKind: TxAddressKind;
    badges: TxAddressBadge[];
    callLabel?: string;
    contractLabel?: string;
    ownerFlowAddress?: string;
    primaryLabel?: string;
    roleLabels: string[];
    shortAddress: string;
}

export type TxAddressBook = Map<string, TxAddressBookEntry>;

type MutableAddressEntry = {
    address: string;
    addressKind: TxAddressKind;
    evmLabels: string[];
    flowContracts: string[];
    methods: string[];
    ownerFlowAddress?: string;
    roles: string[];
};

const GENERIC_FLOW_CONTRACTS = new Set([
    'Burner',
    'Crypto',
    'FungibleToken',
    'MetadataViews',
    'NonFungibleToken',
    'ViewResolver',
]);

const HELPER_FLOW_CONTRACT_PATTERNS = [
    /Factory/i,
    /Minter/i,
    /Registry/i,
    /Scheduler/i,
    /Utils/i,
    /Views?$/i,
];

const SIGNER_ROLE_ORDER = ['Authorizer', 'Proposer', 'Payer'] as const;

function normalizeTxAddress(address?: string | null): string {
    if (!address) return '';
    return normalizeAddress(address).toLowerCase();
}

function inferAddressKind(address: string): TxAddressKind {
    const hex = address.replace(/^0x/, '');
    if (hex.length <= 16) return 'flow';
    if (/^0{10,}/.test(hex)) return 'coa';
    return 'eoa';
}

function pushUnique(target: string[], value?: string | null) {
    const next = String(value || '').trim();
    if (!next || target.includes(next)) return;
    target.push(next);
}

function canonicalizeSignerRole(role?: string | null): string {
    const value = String(role || '').trim();
    if (!value) return '';
    if (/^Authorizer\b/i.test(value)) return 'Authorizer';
    return value;
}

function formatSignerRoles(roles: string[]): string {
    const normalized = roles
        .map((role) => canonicalizeSignerRole(role))
        .filter(Boolean)
        .filter((role, index, items) => items.indexOf(role) === index)
        .sort((a, b) => {
            const aIndex = SIGNER_ROLE_ORDER.indexOf(a as (typeof SIGNER_ROLE_ORDER)[number]);
            const bIndex = SIGNER_ROLE_ORDER.indexOf(b as (typeof SIGNER_ROLE_ORDER)[number]);
            const aRank = aIndex === -1 ? SIGNER_ROLE_ORDER.length : aIndex;
            const bRank = bIndex === -1 ? SIGNER_ROLE_ORDER.length : bIndex;
            return aRank - bRank || a.localeCompare(b);
        });

    return normalized.join(' / ');
}

function parseFlowContractImport(identifier?: string | null): { address: string; name: string } | null {
    const value = String(identifier || '').trim();
    const match = value.match(/^A\.([a-f0-9]{16})\.(.+)$/i);
    if (!match) return null;
    return {
        address: normalizeTxAddress(match[1]),
        name: match[2],
    };
}

function preferredFlowContractLabel(labels: string[]): string {
    const filtered = labels.filter(Boolean);
    if (filtered.length === 0) return '';
    const nonGeneric = filtered.filter((label) => !GENERIC_FLOW_CONTRACTS.has(label));
    if (nonGeneric.length === 0) return filtered[0];

    const businessFirst = nonGeneric.filter(
        (label) => !HELPER_FLOW_CONTRACT_PATTERNS.some((pattern) => pattern.test(label)),
    );
    const ranked = (businessFirst.length > 0 ? businessFirst : nonGeneric)
        .slice()
        .sort((a, b) => b.length - a.length || a.localeCompare(b));

    return ranked[0];
}

function preferredEvmLabel(labels: string[]): string {
    return labels.find(Boolean) || '';
}

function buildEvmLabel(meta?: any, decodedCall?: any): string {
    return String(
        meta?.label ||
        decodedCall?.implementation_name ||
        decodedCall?.contract_name ||
        meta?.contract_name ||
        '',
    ).trim();
}

export function describeEvmExecution(exec: any): string {
    const method = String(exec?.decoded_call?.method || '').trim();
    const contract = buildEvmLabel(exec?.to_meta, exec?.decoded_call);
    if (contract && method) return `${contract}.${method}()`;
    if (method) return `${method}()`;
    if (contract) return contract;
    return '';
}

function makeAddressEntry(address: string): MutableAddressEntry {
    return {
        address,
        addressKind: inferAddressKind(address),
        evmLabels: [],
        flowContracts: [],
        methods: [],
        roles: [],
    };
}

function ownerPrimaryLabel(entry?: TxAddressBookEntry): string {
    if (!entry) return '';
    const signerRoles = formatSignerRoles(entry.roleLabels);
    if (signerRoles) return signerRoles;
    if (entry.primaryLabel) return entry.primaryLabel;
    return entry.shortAddress;
}

export function buildTxAddressBook(transaction: any): TxAddressBook {
    const rawEntries = new Map<string, MutableAddressEntry>();

    const ensure = (address?: string | null) => {
        const normalized = normalizeTxAddress(address);
        if (!normalized) return null;
        const existing = rawEntries.get(normalized);
        if (existing) return existing;
        const created = makeAddressEntry(normalized);
        rawEntries.set(normalized, created);
        return created;
    };

    const addRole = (address?: string | null, role?: string | null) => {
        const entry = ensure(address);
        if (!entry) return;
        pushUnique(entry.roles, canonicalizeSignerRole(role));
    };

    addRole(transaction?.payer, 'Payer');
    addRole(transaction?.proposer, 'Proposer');
    (transaction?.authorizers || []).forEach((address: string, index: number) => {
        addRole(address, `Authorizer #${index + 1}`);
    });

    (transaction?.contract_imports || []).forEach((identifier: string) => {
        const parsed = parseFlowContractImport(identifier);
        if (!parsed) return;
        const entry = ensure(parsed.address);
        if (!entry) return;
        pushUnique(entry.flowContracts, parsed.name);
    });

    (transaction?.events || []).forEach((event: any) => {
        const entry = ensure(event?.contract_address);
        if (!entry) return;
        pushUnique(entry.flowContracts, event?.contract_name);
    });

    const collectCoaOwner = (address?: string | null, flowAddress?: string | null) => {
        const entry = ensure(address);
        const owner = normalizeTxAddress(flowAddress);
        if (!entry || !owner) return;
        entry.ownerFlowAddress = owner;
        ensure(owner);
    };

    const transferCollections = [
        transaction?.ft_transfers || [],
        transaction?.raw_ft_transfers || [],
        transaction?.nft_transfers || [],
    ];
    transferCollections.forEach((items: any[]) => {
        items.forEach((item: any) => {
            collectCoaOwner(item?.from_address, item?.from_coa_flow_address);
            collectCoaOwner(item?.to_address, item?.to_coa_flow_address);
        });
    });

    (transaction?.evm_executions || []).forEach((exec: any) => {
        collectCoaOwner(exec?.from, exec?.from_meta?.flow_address);
        collectCoaOwner(exec?.to, exec?.to_meta?.flow_address);

        const fromEntry = ensure(exec?.from);
        if (fromEntry) {
            pushUnique(fromEntry.evmLabels, buildEvmLabel(exec?.from_meta));
        }

        const toEntry = ensure(exec?.to);
        if (toEntry) {
            pushUnique(toEntry.evmLabels, buildEvmLabel(exec?.to_meta, exec?.decoded_call));
            if (exec?.decoded_call?.method) {
                pushUnique(toEntry.methods, `${exec.decoded_call.method}()`);
            }
        }
    });

    const finalized = new Map<string, TxAddressBookEntry>();
    const resolve = (address?: string | null, trail = new Set<string>()): TxAddressBookEntry | undefined => {
        const normalized = normalizeTxAddress(address);
        if (!normalized) return undefined;
        const cached = finalized.get(normalized);
        if (cached) return cached;
        const raw = rawEntries.get(normalized);
        if (!raw) return undefined;

        if (trail.has(normalized)) {
            const roleLabel = formatSignerRoles(raw.roles);
            return {
                address: normalized,
                addressKind: raw.addressKind,
                badges: [],
                contractLabel: preferredFlowContractLabel(raw.flowContracts) || preferredEvmLabel(raw.evmLabels) || undefined,
                primaryLabel: roleLabel || preferredFlowContractLabel(raw.flowContracts) || preferredEvmLabel(raw.evmLabels) || undefined,
                roleLabels: [...raw.roles],
                shortAddress: formatShort(normalized, 8, 4),
            };
        }

        trail.add(normalized);
        const flowContractLabel = preferredFlowContractLabel(raw.flowContracts);
        const evmLabel = preferredEvmLabel(raw.evmLabels);
        const roleLabel = formatSignerRoles(raw.roles);
        const owner = raw.ownerFlowAddress ? resolve(raw.ownerFlowAddress, trail) : undefined;
        trail.delete(normalized);

        let primaryLabel = '';
        if (raw.addressKind === 'coa' && owner) {
            const ownerLabel = ownerPrimaryLabel(owner);
            if (ownerLabel) {
                primaryLabel = ownerLabel;
            }
        }
        if (!primaryLabel && roleLabel) {
            primaryLabel = roleLabel;
        }
        if (!primaryLabel && raw.addressKind === 'flow' && flowContractLabel) {
            primaryLabel = flowContractLabel;
        }
        if (!primaryLabel && evmLabel) {
            primaryLabel = evmLabel;
        }
        if (!primaryLabel && flowContractLabel) {
            primaryLabel = flowContractLabel;
        }

        const badges: TxAddressBadge[] = [];
        if (raw.methods.length > 0) {
            badges.push({ label: raw.methods[0], tone: 'accent' });
        }
        if (flowContractLabel && flowContractLabel !== primaryLabel) {
            badges.push({ label: flowContractLabel, tone: 'neutral' });
        }
        if (evmLabel && evmLabel !== primaryLabel && evmLabel !== flowContractLabel) {
            badges.push({ label: evmLabel, tone: 'neutral' });
        }
        raw.roles.forEach((role) => {
            const promotedToPrimary = primaryLabel === roleLabel || primaryLabel === role || primaryLabel === `${role} COA`;
            if (!promotedToPrimary) {
                badges.push({ label: role, tone: 'neutral' });
            }
        });

        const entry: TxAddressBookEntry = {
            address: normalized,
            addressKind: raw.addressKind,
            badges,
            callLabel: raw.methods[0],
            contractLabel: flowContractLabel || evmLabel || undefined,
            ownerFlowAddress: raw.ownerFlowAddress,
            primaryLabel: primaryLabel || undefined,
            roleLabels: [...raw.roles],
            shortAddress: formatShort(normalized, 8, 4),
        };
        finalized.set(normalized, entry);
        return entry;
    };

    rawEntries.forEach((_value, address) => {
        resolve(address);
    });

    return finalized;
}

export function getTxAddressBookEntry(book: TxAddressBook | undefined, address?: string | null): TxAddressBookEntry | undefined {
    if (!book) return undefined;
    const normalized = normalizeTxAddress(address);
    if (!normalized) return undefined;
    return book.get(normalized);
}
