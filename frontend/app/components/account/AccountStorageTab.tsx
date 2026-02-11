import { useState, useEffect } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import {
    getAccountsByAddressStorage,
    getAccountsByAddressStorageLinks,
    getAccountsByAddressStorageItem,
} from '../../api/gen/core';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
    HardDrive, Folder, FolderOpen, File, FileText, ChevronRight, ChevronDown
} from 'lucide-react';
import { normalizeAddress, decodeCadenceValue } from './accountUtils';

/** Extract a JSON-CDC type schema (without values) */
const extractTypeSchema = (val: any): any => {
    if (val === null || val === undefined) return null;
    if (typeof val !== 'object') return typeof val;
    if (val.type !== undefined && val.value !== undefined) {
        const t = val.type;
        const v = val.value;
        if (t === 'Optional') return { type: 'Optional', inner: v ? extractTypeSchema(v) : null };
        if (t === 'Array') return { type: 'Array', items: Array.isArray(v) && v.length > 0 ? extractTypeSchema(v[0]) : null };
        if (t === 'Dictionary') {
            const entries = (v || []).slice(0, 1);
            return {
                type: 'Dictionary',
                key: entries.length > 0 ? extractTypeSchema(entries[0].key) : null,
                value: entries.length > 0 ? extractTypeSchema(entries[0].value) : null,
            };
        }
        if (t === 'Struct' || t === 'Resource' || t === 'Event') {
            const fields = v?.fields || v;
            if (Array.isArray(fields)) {
                const schema: Record<string, any> = {};
                if (v?.id) schema['_typeId'] = v.id;
                fields.forEach((f: any) => {
                    if (f.name !== undefined) schema[f.name] = extractTypeSchema(f.value);
                });
                return { type: t, fields: schema };
            }
        }
        if (t === 'Type') {
            const st = v?.staticType;
            if (st && typeof st === 'object') return { type: 'Type', typeID: st.typeID || st };
            return { type: 'Type', typeID: st ?? v ?? '' };
        }
        if (t === 'Path') return { type: 'Path', domain: v?.domain, identifier: v?.identifier };
        return { type: t };
    }
    if (Array.isArray(val)) return val.length > 0 ? ['Array', extractTypeSchema(val[0])] : 'Array';
    return typeof val;
};

interface Props {
    address: string;
}

export function AccountStorageTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [overview, setOverview] = useState<any>(null);
    const [selected, setSelected] = useState<any>(null);
    const [rawItem, setRawItem] = useState<any>(null);
    const [decodedItem, setDecodedItem] = useState<any>(null);
    const [typeSchema, setTypeSchema] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<any>(null);
    const [viewTab, setViewTab] = useState<'value' | 'type'>('value');
    const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({ storage: true, public: true, private: false });

    useEffect(() => {
        setOverview(null);
        setSelected(null);
        setRawItem(null);
        setDecodedItem(null);
        setTypeSchema(null);
    }, [address]);

    const loadOverview = async () => {
        setLoading(true);
        setError(null);
        try {
            await ensureHeyApiConfigured();
            const [storageRes, linksRes] = await Promise.all([
                getAccountsByAddressStorage({ path: { address: normalizedAddress } }),
                getAccountsByAddressStorageLinks({ path: { address: normalizedAddress }, query: { domain: 'public' } }),
            ]);

            const storagePayload: any = storageRes.data;
            const linksPayload: any = linksRes.data;

            const storagePaths = (storagePayload?.paths || []).map((p: any) => typeof p === 'string' ? p : p?.identifier ?? p?.path ?? JSON.stringify(p));
            const publicPaths = (linksPayload?.public_paths || linksPayload?.publicPaths || []).map((p: any) => typeof p === 'string' ? p : p?.identifier ?? p?.path ?? JSON.stringify(p));
            const privatePaths = (linksPayload?.private_paths || linksPayload?.privatePaths || []).map((p: any) => typeof p === 'string' ? p : p?.identifier ?? p?.path ?? JSON.stringify(p));

            setOverview({
                storagePaths,
                publicPaths,
                privatePaths,
                used: storagePayload?.used ?? storagePayload?.storage_used ?? '?',
                capacity: storagePayload?.capacity ?? storagePayload?.storage_capacity ?? '?',
            });
        } catch (err) {
            console.error('Failed to load storage overview', err);
            setError('Failed to load storage overview');
        } finally {
            setLoading(false);
        }
    };

    const browseStoragePath = async (path: string) => {
        setSelected(path);
        setRawItem(null);
        setDecodedItem(null);
        setTypeSchema(null);
        setLoading(true);
        try {
            await ensureHeyApiConfigured();
            const identifier = path.split('/').pop() || path;
            const res = await getAccountsByAddressStorageItem({ path: { address: normalizedAddress }, query: { path: identifier } });
            const raw: any = res.data;
            setRawItem(raw);

            // Decode value using our decoder (handles JSON-CDC → plain objects)
            const decoded = decodeCadenceValue(raw);
            setDecodedItem(decoded ?? raw);

            // Extract type schema
            setTypeSchema(extractTypeSchema(raw));
        } catch (err) {
            console.error('Failed to load storage item', err);
            setDecodedItem({ error: 'Failed to load item' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!overview && !loading) loadOverview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    const displayContent = viewTab === 'value' ? decodedItem : typeSchema;

    return (
        <div className="space-y-4">
            <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                Storage
            </h2>

            {error && <div className="text-xs text-red-500 dark:text-red-400 mb-4">{error}</div>}

            {(!overview && loading) && (
                <div className="text-xs text-zinc-500 italic p-4">Loading storage overview...</div>
            )}

            {overview && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px]">
                    {/* Left: File Browser */}
                    <div className="md:col-span-1 border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/40 rounded-sm flex flex-col overflow-hidden">
                        <div className="p-3 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">File Browser</span>
                            <span className="text-[10px] text-zinc-500">{overview.used ?? '?'} / {overview.capacity ?? '?'}</span>
                        </div>
                        <div className="flex-1 overflow-auto p-2 space-y-1">
                            {['storage', 'public', 'private'].map(domain => {
                                const paths: string[] = domain === 'storage' ? overview.storagePaths
                                    : domain === 'public' ? overview.publicPaths
                                        : overview.privatePaths || [];
                                if (!paths || paths.length === 0) return null;
                                const isExpanded = expandedDomains[domain];

                                return (
                                    <div key={domain}>
                                        <button
                                            onClick={() => setExpandedDomains(prev => ({ ...prev, [domain]: !prev[domain] }))}
                                            className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-sm transition-colors text-zinc-700 dark:text-zinc-300"
                                        >
                                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                            {isExpanded ? <FolderOpen className="h-3 w-3 text-nothing-green-dark dark:text-nothing-green" /> : <Folder className="h-3 w-3 text-nothing-green-dark dark:text-nothing-green" />}
                                            <span className="text-xs font-semibold uppercase tracking-wider">/{domain}</span>
                                            <span className="text-[10px] text-zinc-500 ml-auto">({paths.length})</span>
                                        </button>

                                        {isExpanded && (
                                            <div className="ml-4 pl-2 border-l border-zinc-200 dark:border-white/5 mt-1 space-y-0.5">
                                                {paths.map((path: string) => {
                                                    const name = path.split('/').pop();
                                                    const isSelected = selected === path;
                                                    return (
                                                        <button
                                                            key={path}
                                                            onClick={() => {
                                                                if (domain === 'storage') browseStoragePath(path);
                                                                else { setSelected(path); setDecodedItem({ [domain + 'Path']: path }); setTypeSchema(null); }
                                                            }}
                                                            className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded-sm transition-colors text-xs font-mono truncate ${isSelected
                                                                ? 'bg-nothing-green-dark/10 dark:bg-nothing-green/10 text-nothing-green-dark dark:text-nothing-green'
                                                                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5'}`}
                                                            title={path}
                                                        >
                                                            <File className="h-3 w-3 flex-shrink-0" />
                                                            <span className="truncate">{name}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right: Content Viewer */}
                    <div className="md:col-span-2 border border-zinc-200 dark:border-white/10 bg-white dark:bg-black/40 rounded-sm flex flex-col overflow-hidden relative">
                        {loading && (
                            <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                                <div className="w-8 h-8 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin" />
                            </div>
                        )}

                        <div className="p-3 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center gap-2 overflow-hidden">
                            <FileText className="h-4 w-4 text-zinc-500" />
                            <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate flex-1" title={selected || ''}>
                                {selected || 'Select a file'}
                            </span>
                            {/* Value / Type toggle */}
                            {(decodedItem || typeSchema) && (
                                <div className="flex border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden flex-shrink-0">
                                    <button
                                        onClick={() => setViewTab('value')}
                                        className={`px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors ${viewTab === 'value'
                                            ? 'bg-zinc-200 dark:bg-white/10 text-zinc-900 dark:text-white'
                                            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                                    >
                                        Value
                                    </button>
                                    <button
                                        onClick={() => setViewTab('type')}
                                        className={`px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors ${viewTab === 'type'
                                            ? 'bg-zinc-200 dark:bg-white/10 text-zinc-900 dark:text-white'
                                            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                                    >
                                        Type
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-[#1e1e1e] relative">
                            {displayContent ? (
                                <SyntaxHighlighter
                                    language="json"
                                    style={vscDarkPlus}
                                    customStyle={{ margin: 0, padding: '1.5rem', fontSize: '11px', lineHeight: '1.6', minHeight: '100%' }}
                                    showLineNumbers={true}
                                    lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: "#555", userSelect: "none" }}
                                >
                                    {JSON.stringify(displayContent, null, 2)}
                                </SyntaxHighlighter>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-600">
                                    <HardDrive className="h-12 w-12 mb-4 opacity-20" />
                                    <p className="text-xs uppercase tracking-widest">Select an item to view contents</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
