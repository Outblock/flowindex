import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Copy, Check, Search } from 'lucide-react';

interface Props {
    account: any;
}

function CopyablePublicKey({ publicKey }: { publicKey: string }) {
    const [copied, setCopied] = useState(false);
    const navigate = useNavigate();

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(publicKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSearch = () => {
        const key = publicKey.replace(/^0x/i, '');
        navigate({ to: '/key/$publicKey', params: { publicKey: key } });
    };

    return (
        <div className="group relative flex items-start gap-2">
            <p
                onClick={handleSearch}
                className="font-mono text-zinc-900 dark:text-white break-all text-[13px] leading-relaxed flex-1 bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/5 px-3 py-2.5 rounded-sm cursor-pointer hover:border-nothing-green/40 dark:hover:border-nothing-green/40 transition-colors"
            >
                {publicKey}
            </p>
            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-1.5">
                <button
                    onClick={handleCopy}
                    className="p-1.5 rounded-sm bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-500 hover:text-zinc-700 dark:hover:text-white transition-colors"
                    title="Copy public key"
                >
                    {copied ? <Check className="w-3.5 h-3.5 text-nothing-green" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                    onClick={handleSearch}
                    className="p-1.5 rounded-sm bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-500 hover:text-zinc-700 dark:hover:text-white transition-colors"
                    title="Search by public key"
                >
                    <Search className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

export function AccountKeysTab({ account }: Props) {
    return (
        <div>
            <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                Public Keys ({account.keys?.length || 0})
            </h2>
            {account.keys && account.keys.length > 0 ? (
                <div className="space-y-4">
                    {account.keys.map((key: any, i: number) => (
                        <div key={i} className="border border-zinc-200 dark:border-white/5 p-5 bg-zinc-50 dark:bg-black/40 rounded-sm">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs uppercase tracking-widest text-zinc-500">Key #{key.keyIndex ?? i}</span>
                                <span className={`text-xs font-medium uppercase tracking-wide ${key.revoked ? 'text-red-500' : 'text-nothing-green-dark dark:text-nothing-green'}`}>
                                    {key.revoked ? 'REVOKED' : 'ACTIVE'}
                                </span>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Public Key</p>
                                    <CopyablePublicKey publicKey={key.publicKey} />
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div>
                                        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Signing Algo</p>
                                        <p className="font-mono text-sm text-zinc-900 dark:text-white">{key.signingAlgorithm}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Hashing Algo</p>
                                        <p className="font-mono text-sm text-zinc-900 dark:text-white">{key.hashingAlgorithm}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Weight</p>
                                        <p className="font-mono text-sm text-zinc-900 dark:text-white">{key.weight}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Seq. Number</p>
                                        <p className="font-mono text-sm text-zinc-900 dark:text-white">{key.sequenceNumber}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center text-zinc-500 italic py-8">No public keys found</div>
            )}
        </div>
    );
}
