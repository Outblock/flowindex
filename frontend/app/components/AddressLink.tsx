import Avatar from 'boring-avatars';
import { Link } from '@tanstack/react-router';
import { normalizeAddress, formatShort } from './account/accountUtils';

/** Derive 5 colors from a Flow address (16 hex chars after 0x).
 *  Split into 3 base colors from the address, plus 2 mixed variants. */
export function colorsFromAddress(addr: string): string[] {
    const hex = addr.replace(/^0x/, '').padEnd(16, '0').slice(0, 16);
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
    onClick?: (e: React.MouseEvent) => void;
}

/** Determine avatar variant by address type. */
function avatarVariant(addr: string): 'beam' | 'bauhaus' | 'pixel' {
    const hex = addr.replace(/^0x/, '');
    if (hex.length <= 16) return 'beam';        // Flow
    if (/^0{10,}/.test(hex)) return 'bauhaus';   // COA (EVM with 10+ leading zeros)
    return 'pixel';                               // EVM
}

export function AddressLink({
    address,
    prefixLen = 8,
    suffixLen = 6,
    size = 16,
    className = '',
    showAvatar = true,
    onClick,
}: Props) {
    const normalized = normalizeAddress(address);
    const colors = colorsFromAddress(normalized);
    return (
        <Link
            to={`/accounts/${normalized}` as any}
            className={`inline-flex items-center gap-1 font-mono text-nothing-green-dark dark:text-nothing-green hover:underline ${className}`}
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
        </Link>
    );
}
