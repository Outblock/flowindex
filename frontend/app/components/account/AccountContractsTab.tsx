import { useState } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getAccountsByAddressContractsByName } from '../../api/gen/core';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Code, FileText } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { normalizeAddress } from './accountUtils';

SyntaxHighlighter.registerLanguage('swift', swift);

interface Props {
    address: string;
    contracts: string[];
}

export function AccountContractsTab({ address, contracts }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const { theme } = useTheme();
    const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;

    const [selectedContract, setSelectedContract] = useState('');
    const [contractCode, setContractCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<any>(null);

    const loadContractCode = async (name: string) => {
        if (!name) return;
        setLoading(true);
        setError(null);
        setSelectedContract(name);
        setContractCode('');
        try {
            await ensureHeyApiConfigured();
            const res = await getAccountsByAddressContractsByName({ path: { address: normalizedAddress, name } });
            setContractCode((res?.data as any)?.code || '');
        } catch (err) {
            console.error('Failed to load contract code', err);
            setError('Failed to load contract code');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                Contracts ({contracts.length})
            </h2>

            {contracts.length > 0 ? (
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {contracts.map((name: string) => (
                            <button
                                key={name}
                                onClick={() => loadContractCode(name)}
                                className={`px-3 py-2 text-xs font-mono border transition-colors rounded-sm ${selectedContract === name
                                    ? 'border-nothing-green-dark dark:border-nothing-green bg-nothing-green-dark/10 dark:bg-nothing-green/10 text-zinc-900 dark:text-white'
                                    : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Code className={`h-3 w-3 ${selectedContract === name ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                                    {name}
                                </span>
                            </button>
                        ))}
                    </div>

                    {selectedContract && (
                        <div className="border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden">
                            <div className="flex items-center justify-between bg-zinc-50 dark:bg-white/5 px-4 py-2 border-b border-zinc-200 dark:border-white/10">
                                <span className="text-xs font-mono text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
                                    <FileText className="h-3 w-3" />
                                    {selectedContract}.cdc
                                </span>
                                {loading && <span className="text-[10px] text-zinc-500">Loading...</span>}
                            </div>
                            {error && <div className="p-4 text-xs text-red-500">{error}</div>}
                            {contractCode && (
                                <div className={`${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-white'}`}>
                                    <SyntaxHighlighter
                                        language="swift"
                                        style={syntaxTheme}
                                        customStyle={{
                                            margin: 0,
                                            padding: '1rem',
                                            fontSize: '11px',
                                            lineHeight: '1.5',
                                            maxHeight: '420px',
                                        }}
                                        showLineNumbers={true}
                                        lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: theme === 'dark' ? '#555' : '#999', userSelect: "none" }}
                                    >
                                        {contractCode}
                                    </SyntaxHighlighter>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center text-zinc-500 italic py-8">No contracts deployed</div>
            )}
        </div>
    );
}
