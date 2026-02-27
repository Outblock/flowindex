interface Props {
    value?: number;    // pre-computed USD value
    price?: number;    // per-unit USD price
    amount?: number;   // token amount (value = amount * price)
    className?: string;
}

export function UsdValue({ value, price, amount, className }: Props) {
    const usd = value ?? (price && amount ? price * amount : 0);
    if (!usd || usd === 0) return null;

    const formatted = usd >= 1
        ? `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : usd >= 0.01
            ? `$${usd.toFixed(4)}`
            : `$${usd.toFixed(6)}`;

    return (
        <span className={`text-zinc-400 dark:text-zinc-500 ${className ?? ''}`}>
            {formatted}
        </span>
    );
}
