import { cn } from "../lib/utils"

export interface TokenIconProps {
  /** URL of the token logo image */
  logoUrl?: string
  /** Token name (used for alt text and fallback initial) */
  name: string
  /** Token symbol (used for fallback display) */
  symbol?: string
  /** Size in pixels (default: 40) */
  size?: number
  className?: string
}

/**
 * Circular token icon with gradient fallback.
 * When `logoUrl` is provided, renders an `<img>` with onError handling
 * that falls back to a gradient circle with the first letter of the name.
 */
export function TokenIcon({
  logoUrl,
  name,
  symbol,
  size = 40,
  className,
}: TokenIconProps) {
  const initial = (symbol ?? name ?? "?").charAt(0).toUpperCase()

  return (
    <div
      className={cn("flex-shrink-0 relative", className)}
      style={{ width: size, height: size }}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={name}
          className="w-full h-full object-cover bg-white dark:bg-white/10 shadow-sm rounded-full"
          loading="lazy"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = "none"
            const sibling = (e.target as HTMLImageElement).nextElementSibling
            if (sibling) sibling.classList.remove("hidden")
          }}
        />
      ) : null}
      <div
        className={cn(
          "w-full h-full rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-white/10 dark:to-white/5 flex items-center justify-center shadow-inner",
          logoUrl ? "hidden" : "",
        )}
      >
        <span
          className="font-bold text-zinc-400 select-none"
          style={{ fontSize: size * 0.4 }}
        >
          {initial}
        </span>
      </div>
    </div>
  )
}
