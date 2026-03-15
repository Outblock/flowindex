import Avatar from 'boring-avatars';
import { Link } from '@tanstack/react-router';
import { normalizeAddress, formatShort } from './account/accountUtils';

/** Blockscout logo icon (official symbol, simplified for inline use) */
function BlockscoutIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 276 270" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <path fillRule="evenodd" clipRule="evenodd" d="M115.899 40C115.899 34.4772 111.422 30 105.899 30H82.2002C76.6774 30 72.2002 34.4772 72.2002 40V63.6984C72.2002 69.2213 67.7231 73.6984 62.2002 73.6984H40C34.4772 73.6984 30 78.1756 30 83.6984V229.753C30 235.275 34.4771 239.753 40 239.753H63.6985C69.2213 239.753 73.6985 235.275 73.6985 229.753V83.6985C73.6985 78.1756 78.1756 73.6985 83.6985 73.6985H105.899C111.422 73.6985 115.899 69.2213 115.899 63.6985V40ZM203.296 40C203.296 34.4772 198.818 30 193.296 30H169.597C164.074 30 159.597 34.4771 159.597 40V63.6985C159.597 69.2213 164.074 73.6985 169.597 73.6985H191.797C197.32 73.6985 201.797 78.1756 201.797 83.6985V229.753C201.797 235.275 206.275 239.753 211.797 239.753H235.496C241.019 239.753 245.496 235.275 245.496 229.753V83.6984C245.496 78.1756 241.019 73.6984 235.496 73.6984H213.296C207.773 73.6984 203.296 69.2212 203.296 63.6984V40ZM159.597 123.651C159.597 118.129 155.12 113.651 149.597 113.651H125.899C120.376 113.651 115.899 118.129 115.899 123.651V188.551C115.899 194.074 120.376 198.551 125.899 198.551H149.597C155.12 198.551 159.597 194.074 159.597 188.551V123.651Z" fill="currentColor"/>
        </svg>
    );
}

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
        : isEVM
            ? 'text-[#5353D3] dark:text-[#7B7BE8]'
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
                    className="text-[#5353D3] hover:text-[#4040B0] dark:text-[#7B7BE8] dark:hover:text-[#9B9BF0] transition-colors p-0.5 shrink-0 opacity-60 hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                >
                    <BlockscoutIcon className="w-3 h-3" />
                </a>
            )}
        </span>
    );
}
