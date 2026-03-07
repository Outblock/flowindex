import { cn } from "../lib/utils"

export interface UsdValueProps {
  /** Pre-computed USD value */
  value?: number
  /** Per-unit USD price */
  price?: number
  /** Token amount (value = amount * price) */
  amount?: number
  className?: string
}

export function UsdValue({ value, price, amount, className }: UsdValueProps) {
  const usd = value ?? (price && amount ? price * amount : 0)
  if (!usd || usd === 0) return null

  const formatted =
    usd >= 1
      ? `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : usd >= 0.01
        ? `$${usd.toFixed(4)}`
        : `$${usd.toFixed(6)}`

  return (
    <span
      className={cn("text-zinc-400 dark:text-zinc-500", className)}
    >
      ≈ {formatted}
    </span>
  )
}
