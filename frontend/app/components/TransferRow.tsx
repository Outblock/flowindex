import { Link } from '@tanstack/react-router';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { AddressLink } from '@/components/AddressLink';
import { UsdValue } from '@/components/UsdValue';
import { formatRelativeTime } from '@/lib/time';

export interface TransferRowProps {
    /** 'in' = received, 'out' = sent, 'self' = self-transfer */
    direction: 'in' | 'out' | 'self';
    /** Formatted amount string */
    amount: string;
    /** Token symbol (e.g. "PYUSD0", "FLOW") */
    tokenSymbol: string;
    /** Token icon URL */
    tokenIcon?: string | null;
    /** Token type badge (e.g. "ERC-20", "FT") */
    typeBadge?: string;
    /** Counterparty address (the "other" party) */
    counterpartyAddress: string;
    /** 'from' or 'to' — label for the counterparty */
    counterpartyRole: 'from' | 'to';
    /** Transaction hash */
    txHash: string;
    /** ISO timestamp */
    timestamp: string;
    /** Optional block number */
    blockNumber?: number;
    /** Link prefix for tx (default: /txs/) */
    txLinkPrefix?: string;
    /** Optional USD value */
    usdValue?: number | null;
}

export function TransferRow({
    direction,
    amount,
    tokenSymbol,
    tokenIcon,
    typeBadge,
    counterpartyAddress,
    counterpartyRole,
    txHash,
    timestamp,
    blockNumber,
    txLinkPrefix = '/txs/',
    usdValue,
}: TransferRowProps) {
    const isOut = direction === 'out';
    const dirColor = isOut ? 'text-red-500' : 'text-emerald-500';
    const dirLabel = isOut ? 'Sent' : 'Received';
    const DirIcon = isOut ? ArrowUpRight : ArrowDownLeft;
    const iconBg = isOut
        ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
        : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20';

    const timeStr = timestamp ? formatRelativeTime(timestamp, Date.now()) : '';
    const shortHash = txHash ? `${txHash.slice(0, 10)}...${txHash.slice(-6)}` : '';

    return (
        <div className="flex items-start gap-3 p-3 md:p-4 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
            {/* Token Icon */}
            <div className={`flex-shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center overflow-hidden ${iconBg}`}>
                {tokenIcon ? (
                    <img
                        src={tokenIcon}
                        alt={tokenSymbol}
                        className="w-7 h-7 object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                ) : (
                    <span className="text-xs font-bold text-zinc-400">{tokenSymbol?.slice(0, 2) || '?'}</span>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
                {/* Line 1: Direction + Amount + Token */}
                <div className="flex items-center gap-2 mb-0.5">
                    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${dirColor}`}>
                        <DirIcon className="h-3 w-3" />
                        {dirLabel}
                    </span>
                    <span className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
                        {amount}
                    </span>
                    <span className="text-xs font-medium text-zinc-500">{tokenSymbol}</span>
                    {usdValue != null && usdValue > 0 && (
                        <UsdValue value={usdValue} className="text-[10px]" />
                    )}
                    {typeBadge && (
                        <span className="text-[9px] px-1 py-px bg-zinc-100 dark:bg-zinc-800 text-zinc-500 uppercase font-medium">
                            {typeBadge}
                        </span>
                    )}
                </div>

                {/* Line 2: Counterparty + TX hash */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500">
                    <span className="capitalize">{counterpartyRole}</span>
                    <AddressLink address={counterpartyAddress} prefixLen={6} suffixLen={4} size={14} showTag={false} showBlockscoutLink={false} />
                    {txHash && (
                        <>
                            <span className="text-zinc-300 dark:text-zinc-600">·</span>
                            <span>tx:</span>
                            <Link
                                to={`${txLinkPrefix}${txHash}` as any}
                                className="text-[#5353D3] dark:text-[#7B7BE8] hover:underline font-mono"
                            >
                                {shortHash}
                            </Link>
                        </>
                    )}
                </div>
            </div>

            {/* Right: Time + Block */}
            <div className="flex-shrink-0 text-right">
                <p className="text-xs text-zinc-500" title={timestamp}>{timeStr}</p>
                {blockNumber != null && (
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                        <Link to={`/blocks/${blockNumber}` as any} className="hover:underline">
                            #{blockNumber.toLocaleString()}
                        </Link>
                    </p>
                )}
            </div>
        </div>
    );
}
