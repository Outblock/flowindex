/**
 * ActivityRow component -- renders a single transaction in a list.
 * Extracted from frontend TransactionRow.tsx for reuse across apps.
 *
 * Routing is decoupled: consumers provide a `renderLink` prop to control
 * how links (tx hash, block height) are rendered.
 */

import React from "react"
import {
  ArrowRightLeft,
  ArrowUpRight,
  ArrowDownLeft,
  ShoppingBag,
  Zap,
  FileCode,
  UserPlus,
  Key,
  Clock,
  ChevronDown,
  ChevronRight,
  Flame,
  Droplets,
  CircleDollarSign,
  Coins,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "../lib/utils"
import { formatShort } from "../utils/address"
import { formatRelativeTime } from "../utils/time"
import {
  deriveActivityType,
  deriveTransferPreview,
  findNftBannerImage,
  extractLogoUrl,
  formatTagLabel,
  TAG_STYLES,
  DEFAULT_TAG_STYLE,
} from "../utils/activity"
import type { TokenMetaEntry } from "../types/transaction"
import { Avatar, AvatarImage, AvatarFallback } from "../ui/avatar"

// ---------------------------------------------------------------------------
// Icon lookup for tags
// ---------------------------------------------------------------------------

const TAG_ICONS: Record<string, LucideIcon> = {
  FT_TRANSFER: ArrowRightLeft,
  FT_SENDER: ArrowUpRight,
  FT_RECEIVER: ArrowDownLeft,
  NFT_TRANSFER: ShoppingBag,
  NFT_SENDER: ArrowUpRight,
  NFT_RECEIVER: ArrowDownLeft,
  SCHEDULED_TX: Clock,
  EVM: Zap,
  CONTRACT_DEPLOY: FileCode,
  ACCOUNT_CREATED: UserPlus,
  KEY_UPDATE: Key,
  MARKETPLACE: ShoppingBag,
  STAKING: Coins,
  LIQUID_STAKING: Droplets,
  SWAP: ArrowRightLeft,
  LIQUIDITY: Droplets,
  TOKEN_MINT: CircleDollarSign,
  TOKEN_BURN: Flame,
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ActivityRowLinkProps {
  to: string
  children: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent) => void
}

export interface ActivityRowProps {
  /** Transaction object (loosely typed -- any shape from the API) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any
  /** Whether the row is currently expanded */
  expanded: boolean
  /** Callback when the row is clicked to toggle expand */
  onToggle: () => void
  /** Token metadata map for transfer preview avatars */
  tokenMeta?: Map<string, TokenMetaEntry>
  /**
   * Custom link renderer. When not provided, plain `<a>` tags are used.
   * Use this to integrate with your framework's router (e.g. TanStack Router).
   */
  renderLink?: (props: ActivityRowLinkProps) => React.ReactNode
  /**
   * Content to render when expanded (e.g. ExpandedTransferDetails).
   * This keeps the expansion panel app-specific while the row itself is reusable.
   */
  expandedContent?: React.ReactNode
  /** Additional CSS classes for the outer wrapper */
  className?: string
}

// ---------------------------------------------------------------------------
// Default link renderer (plain <a>)
// ---------------------------------------------------------------------------

function DefaultLink({ to, children, className, onClick }: ActivityRowLinkProps) {
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityRow({
  tx,
  expanded,
  onToggle,
  tokenMeta,
  renderLink,
  expandedContent,
  className: outerClassName,
}: ActivityRowProps) {
  const LinkComponent = renderLink ?? DefaultLink

  const timeStr = tx.timestamp
    ? formatRelativeTime(tx.timestamp, Date.now())
    : ""
  const tags: string[] = tx.tags || []
  const activity = deriveActivityType(tx)
  const hasDetails = true
  const transferPreview = deriveTransferPreview(tx, tokenMeta)
  const bannerUrl = findNftBannerImage(tx, tokenMeta)

  return (
    <div
      className={cn(
        "border-b border-zinc-100 dark:border-white/5 transition-colors",
        expanded && "bg-zinc-50/50 dark:bg-white/[0.02]",
        outerClassName,
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden flex items-start gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group",
          hasDetails && "cursor-pointer",
        )}
        onClick={hasDetails ? onToggle : undefined}
      >
        {/* NFT banner gradient overlay */}
        {bannerUrl && !expanded && (
          <div
            className="absolute right-0 top-0 bottom-0 w-40 pointer-events-none opacity-[0.18] dark:opacity-[0.12]"
            style={{
              backgroundImage: `url(${bannerUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              maskImage: "linear-gradient(to right, transparent, black)",
              WebkitMaskImage: "linear-gradient(to right, transparent, black)",
            }}
          />
        )}

        {/* Expand chevron */}
        <div className="flex-shrink-0 pt-1 w-4">
          {hasDetails &&
            (expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
            ))}
        </div>

        {/* Col 2: Main content */}
        <div className="flex-1 min-w-0">
          {/* Line 1: txid + tags + error */}
          <div className="flex items-center gap-2 flex-wrap">
            <LinkComponent
              to={`/txs/${tx.id}`}
              className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono text-xs flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {formatShort(tx.id, 12, 8)}
            </LinkComponent>
            {/* Tags */}
            {tags.length > 0
              ? tags.map((tag) => {
                  const Icon = TAG_ICONS[tag]
                  return (
                    <span
                      key={tag}
                      className={cn(
                        "inline-flex items-center gap-0.5 px-1.5 py-0.5 border rounded-sm text-[9px] font-bold uppercase tracking-wider",
                        TAG_STYLES[tag] || DEFAULT_TAG_STYLE,
                      )}
                    >
                      {Icon && <Icon className="h-2.5 w-2.5" />}
                      {formatTagLabel(tag)}
                    </span>
                  )
                })
              : activity.type !== "tx" && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 px-1.5 py-0.5 border rounded-sm text-[9px] font-bold uppercase tracking-wider",
                      activity.bgColor,
                      activity.color,
                    )}
                  >
                    {activity.label}
                  </span>
                )}
            {/* Error badge */}
            {(tx.error_message || tx.error) && tx.status === "SEALED" && (
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded-sm border font-semibold text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10">
                ERROR
              </span>
            )}
            {tx.status && tx.status !== "SEALED" && (
              <span
                className={cn(
                  "text-[9px] uppercase px-1.5 py-0.5 rounded-sm border font-semibold",
                  (tx.error_message || tx.error) || tx.status === "EXPIRED"
                    ? "text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10"
                    : "text-yellow-600 dark:text-yellow-500 border-yellow-300 dark:border-yellow-500/30 bg-yellow-50 dark:bg-yellow-500/10",
                )}
              >
                {tx.status}
              </span>
            )}
          </div>
          {/* Line 2: relative time + block link */}
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-400">
            {timeStr && <span>{timeStr}</span>}
            {timeStr && tx.block_height && <span>&middot;</span>}
            {tx.block_height && (
              <LinkComponent
                to={`/blocks/${tx.block_height}`}
                className="font-mono hover:text-nothing-green-dark dark:hover:text-nothing-green hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Block {Number(tx.block_height).toLocaleString()}
              </LinkComponent>
            )}
          </div>
        </div>

        {/* Col 3: Label + Transfer preview (right-aligned) */}
        {tx.template_label && tx.template_label !== activity.label && (
          <span
            className={cn(
              "flex-shrink-0 self-center text-[10px] font-medium truncate max-w-[180px]",
              activity.color,
            )}
            title={tx.template_label}
          >
            {tx.template_label}
          </span>
        )}
        {transferPreview.length > 0 && (
          <div
            className="flex-shrink-0 self-center relative z-[1] flex -space-x-2"
            onClick={(e) => e.stopPropagation()}
          >
            {transferPreview.map((item, i) => {
              const logoUrl = extractLogoUrl(item.icon)
              const fallbackChar = (
                item.symbol ||
                item.label ||
                "?"
              )[0].toUpperCase()
              return (
                <Avatar
                  key={i}
                  className="h-7 w-7 border-2 border-white dark:border-zinc-900"
                >
                  {logoUrl && <AvatarImage src={logoUrl} alt={item.label} />}
                  <AvatarFallback className="text-[9px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                    {fallbackChar}
                  </AvatarFallback>
                </Avatar>
              )
            })}
          </div>
        )}
      </div>

      {/* Expanded detail panel */}
      {expanded && hasDetails && expandedContent}
    </div>
  )
}
