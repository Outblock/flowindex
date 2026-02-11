import { Link } from '@tanstack/react-router';
import { normalizeAddress, formatShort } from './accountUtils';
import { SafeNumberFlow } from '../SafeNumberFlow';

interface Props {
    account: any;
}

export function AccountInfoTab({ account }: Props) {
    return (
        <div className="space-y-4">
            <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                Account Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Address</p>
                    <p className="font-mono text-sm text-zinc-900 dark:text-white">{account.address}</p>
                </div>
                <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Balance</p>
                    <p className="font-mono text-sm text-zinc-900 dark:text-white">
                        <SafeNumberFlow value={account.balance != null ? Number(account.balance) / 1e8 : 0} /> FLOW
                    </p>
                </div>
                <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Public Keys</p>
                    <p className="font-mono text-sm text-zinc-900 dark:text-white">{account.keys?.length || 0}</p>
                </div>
                <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Contracts</p>
                    <p className="font-mono text-sm text-zinc-900 dark:text-white">{account.contracts?.length || 0}</p>
                </div>
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
                <div className="space-y-3">
                    {account.keys.map((key: any, i: number) => (
                        <div key={i} className="border border-zinc-200 dark:border-white/5 p-4 bg-zinc-50 dark:bg-black/40 rounded-sm">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[10px] uppercase tracking-widest text-zinc-500">Key #{key.keyIndex ?? i}</span>
                                <span className={`text-[10px] uppercase ${key.revoked ? 'text-red-500' : 'text-nothing-green-dark dark:text-nothing-green'}`}>
                                    {key.revoked ? 'REVOKED' : 'ACTIVE'}
                                </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                <div>
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Public Key</p>
                                    <p className="font-mono text-zinc-900 dark:text-white break-all">{formatShort(key.publicKey, 20, 20)}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Signing Algo</p>
                                        <p className="font-mono text-zinc-900 dark:text-white">{key.signingAlgorithm}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Hashing Algo</p>
                                        <p className="font-mono text-zinc-900 dark:text-white">{key.hashingAlgorithm}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Weight</p>
                                        <p className="font-mono text-zinc-900 dark:text-white">{key.weight}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Seq. Number</p>
                                        <p className="font-mono text-zinc-900 dark:text-white">{key.sequenceNumber}</p>
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
