import Avatar from 'boring-avatars';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { normalizeAddress, formatShort } from './account/accountUtils';

/** Derive 5 colors from an address.
 *  For COA addresses (long hex with leading zeros), use the non-zero suffix
 *  so avatars aren't all-black. */
export function colorsFromAddress(addr: string): string[] {
    let hex = addr.replace(/^0x/, '');
    // For COA/EVM addresses, strip leading zeros to use the meaningful part
    if (hex.length > 16) {
        hex = hex.replace(/^0+/, '') || hex;
    }
    hex = hex.padEnd(16, '0').slice(0, 16);
    // 3 segments of ~5-6 hex chars each → 3 base colors
    const c1 = `#${hex.slice(0, 6)}`;
    const c2 = `#${hex.slice(5, 11)}`;
    const c3 = `#${hex.slice(10, 16)}`;
    // 2 extras by mixing nibbles for more variety
    const c4 = `#${hex[1]}${hex[3]}${hex[7]}${hex[9]}${hex[13]}${hex[15]}`;
    const c5 = `#${hex[0]}${hex[4]}${hex[8]}${hex[12]}${hex[2]}${hex[6]}`;
    return [c1, c2, c3, c4, c5];
}

interface Props {
    address: string;
    prefixLen?: number;
    suffixLen?: number;
    size?: number;
    className?: string;
    showAvatar?: boolean;
    showTag?: boolean;
    showBlockscoutLink?: boolean;
    neutral?: boolean;
    onClick?: (e: React.MouseEvent) => void;
}

/** Determine avatar variant by address type. */
export function avatarVariant(addr: string): 'beam' | 'bauhaus' | 'pixel' {
    const hex = addr.replace(/^0x/, '');
    if (hex.length <= 16) return 'beam';        // Flow
    if (/^0{10,}/.test(hex)) return 'bauhaus';   // COA (EVM with 10+ leading zeros)
    return 'pixel';                               // EVM
}

/** Detect address type: 'flow', 'coa', or 'eoa'. */
export function addressType(addr: string): 'flow' | 'coa' | 'eoa' {
    const hex = addr.replace(/^0x/, '');
    if (hex.length <= 16) return 'flow';
    if (/^0{10,}/.test(hex)) return 'coa';
    return 'eoa';
}

const TAG_CLASSES: Record<string, string> = {
    coa: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    eoa: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

export function AddressLink({
    address,
    prefixLen = 8,
    suffixLen = 6,
    size = 16,
    className = '',
    showAvatar = true,
    showTag = true,
    showBlockscoutLink,
    neutral = false,
    onClick,
}: Props) {
    const normalized = normalizeAddress(address);
    const colors = colorsFromAddress(normalized);
    const addrType = addressType(normalized);
    const isEVM = addrType === 'coa' || addrType === 'eoa';
    // Show Blockscout link for EVM addresses by default, unless explicitly set
    const showBsLink = showBlockscoutLink ?? isEVM;
    const colorCls = neutral
        ? 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
        : 'text-nothing-green-dark dark:text-nothing-green';
    return (
        <span className="inline-flex items-center gap-0.5">
            <Link
                to={`/accounts/${normalized}` as any}
                className={`inline-flex items-center gap-1 font-mono ${colorCls} hover:underline ${className}`}
                onClick={onClick}
            >
                {showAvatar && (
                    <Avatar
                        size={size}
                        name={normalized}
                        variant={avatarVariant(normalized)}
                        colors={colors}
                    />
                )}
                {formatShort(address, prefixLen, suffixLen)}
                {showTag && addrType !== 'flow' && (
                    <span className={`text-[9px] font-bold uppercase px-1 py-px rounded-sm leading-none ${TAG_CLASSES[addrType]}`}>
                        {addrType}
                    </span>
                )}
            </Link>
            {showBsLink && (
                <a
                    href={`https://evm.flowindex.io/address/${normalized}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in Blockscout"
                    className="text-zinc-400 hover:text-zinc-300 transition-colors p-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    <ExternalLink className="w-3 h-3" />
                </a>
            )}
        </span>
    );
}
