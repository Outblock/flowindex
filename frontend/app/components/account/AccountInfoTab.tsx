import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface Props {
    account: any;
}

function CopyablePublicKey({ publicKey }: { publicKey: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(publicKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div
            onClick={handleCopy}
            className={`group/key relative font-mono break-all text-[13px] leading-relaxed px-3 py-2.5 cursor-pointer border transition-colors ${
                copied
                    ? 'text-nothing-green-dark dark:text-nothing-green border-nothing-green/40 bg-nothing-green/5'
                    : 'text-zinc-900 dark:text-white border-white/5 bg-white/5 hover:border-nothing-green/30'
            }`}
        >
            {publicKey}
            <button
                onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover/key:opacity-100 transition-opacity bg-zinc-200/80 dark:bg-white/10 hover:bg-zinc-300 dark:hover:bg-white/20 text-zinc-500 hover:text-zinc-700 dark:hover:text-white"
                title="Copy public key"
            >
                {copied ? <Check className="w-3.5 h-3.5 text-nothing-green" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
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
                        <div key={i} className="border border-zinc-200 dark:border-white/10 p-5 bg-zinc-50 dark:bg-white/[0.03] ">
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
