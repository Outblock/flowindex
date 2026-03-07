/**
 * Activity type derivation and transaction display utilities.
 * Extracted from frontend TransactionRow.tsx for reuse across apps.
 *
 * All functions here are pure -- they take data in, return data out,
 * with no side effects, React dependencies, or routing concerns.
 */

import type {
  ActivityBadge,
  TokenMetaEntry,
  TransferPreviewItem,
  TransferSummary,
} from "../types/transaction"
import { formatShort } from "./address"

// ---------------------------------------------------------------------------
// deriveActivityType -- primary badge for a transaction
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deriveActivityType(tx: any): ActivityBadge {
  const tags: string[] = tx.tags || []
  const imports: string[] = tx.contract_imports || []
  const summary: TransferSummary | undefined = tx.transfer_summary

  const tagsLower = tags.map((t) => t.toLowerCase())

  if (tagsLower.some((t) => t.includes("account_created"))) {
    return {
      type: "account",
      label: "New Account",
      color: "text-cyan-600 dark:text-cyan-400",
      bgColor:
        "border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10",
    }
  }
  if (tagsLower.some((t) => t.includes("key_update"))) {
    return {
      type: "key",
      label: "Key Update",
      color: "text-orange-600 dark:text-orange-400",
      bgColor:
        "border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/10",
    }
  }
  if (tagsLower.some((t) => t.includes("scheduled"))) {
    return {
      type: "scheduled",
      label: "Scheduled",
      color: "text-indigo-600 dark:text-indigo-400",
      bgColor:
        "border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10",
    }
  }
  if (
    tagsLower.some(
      (t) =>
        t.includes("deploy") ||
        t.includes("contract_added") ||
        t.includes("contract_updated") ||
        t.includes("contract_deploy"),
    )
  ) {
    return {
      type: "deploy",
      label: "Deploy",
      color: "text-blue-600 dark:text-blue-400",
      bgColor:
        "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10",
    }
  }
  if (
    tx.evm_hash ||
    tx.evm_executions?.length > 0 ||
    tagsLower.some((t) => t.includes("evm"))
  ) {
    return {
      type: "evm",
      label: "EVM",
      color: "text-purple-600 dark:text-purple-400",
      bgColor:
        "border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10",
    }
  }
  if (
    tagsLower.some(
      (t) => t.includes("swap") || t.includes("liquidity") || t.includes("defi"),
    )
  ) {
    return {
      type: "swap",
      label: "Swap",
      color: "text-teal-600 dark:text-teal-400",
      bgColor:
        "border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10",
    }
  }
  if (
    tagsLower.some(
      (t) => t.includes("marketplace") || t.includes("nft_purchase"),
    )
  ) {
    return {
      type: "marketplace",
      label: "Purchase",
      color: "text-pink-600 dark:text-pink-400",
      bgColor:
        "border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10",
    }
  }

  // Template-based category
  if (tx.template_category) {
    const mapped = mapTemplateCategoryToActivity(tx.template_category)
    if (mapped) return mapped
  }

  // Transfer-based classification
  if (summary?.ft?.length && summary.ft.length > 0) {
    return {
      type: "ft",
      label: "FT Transfer",
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor:
        "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
    }
  }
  if (summary?.nft?.length && summary.nft.length > 0) {
    return {
      type: "nft",
      label: "NFT Transfer",
      color: "text-amber-600 dark:text-amber-400",
      bgColor:
        "border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
    }
  }
  if (
    tagsLower.some(
      (t) =>
        t.includes("ft_transfer") ||
        t.includes("ft_sender") ||
        t.includes("ft_receiver"),
    )
  ) {
    return {
      type: "ft",
      label: "FT Transfer",
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor:
        "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
    }
  }
  if (
    tagsLower.some(
      (t) =>
        t.includes("nft_transfer") ||
        t.includes("nft_sender") ||
        t.includes("nft_receiver"),
    )
  ) {
    return {
      type: "nft",
      label: "NFT Transfer",
      color: "text-amber-600 dark:text-amber-400",
      bgColor:
        "border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
    }
  }
  if (
    tagsLower.some(
      (t) => t.includes("staking") || t.includes("liquid_staking"),
    )
  ) {
    return {
      type: "staking",
      label: "Staking",
      color: "text-violet-600 dark:text-violet-400",
      bgColor:
        "border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10",
    }
  }
  if (imports.length > 0) {
    return {
      type: "contract",
      label: "Contract Call",
      color: "text-zinc-600 dark:text-zinc-400",
      bgColor:
        "border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10",
    }
  }
  return {
    type: "tx",
    label: "Transaction",
    color: "text-zinc-500 dark:text-zinc-500",
    bgColor: "border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5",
  }
}

// ---------------------------------------------------------------------------
// deriveAllActivityBadges -- all applicable badges for detail page
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deriveAllActivityBadges(tx: any): ActivityBadge[] {
  const tags: string[] = (tx.tags || []).map((t: string) => t.toUpperCase())
  const badges: ActivityBadge[] = []
  const seen = new Set<string>()

  const add = (b: ActivityBadge) => {
    if (!seen.has(b.label)) {
      seen.add(b.label)
      badges.push(b)
    }
  }

  const tagBadgeStyles: Record<string, ActivityBadge> = {
    FT_TRANSFER: {
      type: "ft",
      label: "FT Transfer",
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor:
        "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
    },
    NFT_TRANSFER: {
      type: "nft",
      label: "NFT Transfer",
      color: "text-amber-600 dark:text-amber-400",
      bgColor:
        "border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
    },
    ACCOUNT_CREATED: {
      type: "account",
      label: "New Account",
      color: "text-cyan-600 dark:text-cyan-400",
      bgColor:
        "border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10",
    },
    KEY_UPDATE: {
      type: "key",
      label: "Key Update",
      color: "text-orange-600 dark:text-orange-400",
      bgColor:
        "border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/10",
    },
    CONTRACT_DEPLOY: {
      type: "deploy",
      label: "Deploy",
      color: "text-blue-600 dark:text-blue-400",
      bgColor:
        "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10",
    },
    CONTRACT_ADDED: {
      type: "deploy",
      label: "Deploy",
      color: "text-blue-600 dark:text-blue-400",
      bgColor:
        "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10",
    },
    CONTRACT_UPDATED: {
      type: "deploy",
      label: "Contract Update",
      color: "text-blue-600 dark:text-blue-400",
      bgColor:
        "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10",
    },
    MARKETPLACE: {
      type: "marketplace",
      label: "Marketplace",
      color: "text-pink-600 dark:text-pink-400",
      bgColor:
        "border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10",
    },
    SCHEDULED: {
      type: "scheduled",
      label: "Scheduled",
      color: "text-indigo-600 dark:text-indigo-400",
      bgColor:
        "border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10",
    },
  }

  for (const tag of tags) {
    const style = tagBadgeStyles[tag]
    if (style) add(style)
  }

  if (badges.length === 0) {
    add(deriveActivityType(tx))
  }

  return badges
}

// ---------------------------------------------------------------------------
// Template category -> activity badge mapping
// ---------------------------------------------------------------------------

const templateCategoryStyles: Record<string, ActivityBadge> = {
  FT_TRANSFER: {
    type: "ft",
    label: "FT Transfer",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor:
      "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
  },
  FT_MINT: {
    type: "ft",
    label: "FT Mint",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor:
      "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
  },
  NFT_TRANSFER: {
    type: "nft",
    label: "NFT Transfer",
    color: "text-amber-600 dark:text-amber-400",
    bgColor:
      "border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
  },
  NFT_MINT: {
    type: "nft",
    label: "NFT Mint",
    color: "text-amber-600 dark:text-amber-400",
    bgColor:
      "border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
  },
  NFT_PURCHASE: {
    type: "marketplace",
    label: "NFT Purchase",
    color: "text-pink-600 dark:text-pink-400",
    bgColor:
      "border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10",
  },
  NFT_LISTING: {
    type: "marketplace",
    label: "NFT Listing",
    color: "text-pink-600 dark:text-pink-400",
    bgColor:
      "border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10",
  },
  STAKING: {
    type: "ft",
    label: "Staking",
    color: "text-violet-600 dark:text-violet-400",
    bgColor:
      "border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10",
  },
  ACCOUNT_CREATION: {
    type: "account",
    label: "New Account",
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor:
      "border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10",
  },
  ACCOUNT_SETUP: {
    type: "account",
    label: "Account Setup",
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor:
      "border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10",
  },
  SCHEDULED: {
    type: "scheduled",
    label: "Scheduled",
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor:
      "border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10",
  },
  EVM_BRIDGE: {
    type: "evm",
    label: "EVM Bridge",
    color: "text-purple-600 dark:text-purple-400",
    bgColor:
      "border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10",
  },
  EVM_CALL: {
    type: "evm",
    label: "EVM Call",
    color: "text-purple-600 dark:text-purple-400",
    bgColor:
      "border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10",
  },
  SWAP: {
    type: "swap",
    label: "Swap",
    color: "text-teal-600 dark:text-teal-400",
    bgColor:
      "border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10",
  },
  LIQUIDITY: {
    type: "swap",
    label: "Liquidity",
    color: "text-teal-600 dark:text-teal-400",
    bgColor:
      "border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10",
  },
  CONTRACT_DEPLOY: {
    type: "deploy",
    label: "Deploy",
    color: "text-blue-600 dark:text-blue-400",
    bgColor:
      "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10",
  },
  SYSTEM: {
    type: "contract",
    label: "System",
    color: "text-zinc-600 dark:text-zinc-400",
    bgColor:
      "border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10",
  },
  OTHER: {
    type: "contract",
    label: "Contract Call",
    color: "text-zinc-600 dark:text-zinc-400",
    bgColor:
      "border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10",
  },
  // Import-derived categories
  token_transfer: {
    type: "ft",
    label: "Token Transfer",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor:
      "border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
  },
  nft: {
    type: "nft",
    label: "NFT",
    color: "text-amber-600 dark:text-amber-400",
    bgColor:
      "border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
  },
  marketplace: {
    type: "marketplace",
    label: "Marketplace",
    color: "text-pink-600 dark:text-pink-400",
    bgColor:
      "border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10",
  },
  staking: {
    type: "ft",
    label: "Staking",
    color: "text-violet-600 dark:text-violet-400",
    bgColor:
      "border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10",
  },
  evm: {
    type: "evm",
    label: "EVM",
    color: "text-purple-600 dark:text-purple-400",
    bgColor:
      "border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10",
  },
  defi: {
    type: "swap",
    label: "DeFi",
    color: "text-teal-600 dark:text-teal-400",
    bgColor:
      "border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10",
  },
  account_linking: {
    type: "account",
    label: "Account Link",
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor:
      "border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10",
  },
  account_creation: {
    type: "account",
    label: "New Account",
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor:
      "border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10",
  },
  contract_call: {
    type: "contract",
    label: "Contract Call",
    color: "text-zinc-600 dark:text-zinc-400",
    bgColor:
      "border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10",
  },
  crypto: {
    type: "contract",
    label: "Crypto",
    color: "text-zinc-600 dark:text-zinc-400",
    bgColor:
      "border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10",
  },
  system: {
    type: "contract",
    label: "System",
    color: "text-zinc-600 dark:text-zinc-400",
    bgColor:
      "border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10",
  },
}

export function mapTemplateCategoryToActivity(
  category: string,
): ActivityBadge | null {
  const cats = category
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
  for (const cat of cats) {
    const style = templateCategoryStyles[cat]
    if (style) return style
  }
  return null
}

// ---------------------------------------------------------------------------
// Tag style and icon maps (used by ActivityRow)
// ---------------------------------------------------------------------------

/** CSS classes for tag badges indexed by tag name */
export const TAG_STYLES: Record<string, string> = {
  FT_TRANSFER:
    "text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
  FT_SENDER:
    "text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
  FT_RECEIVER:
    "text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10",
  NFT_TRANSFER:
    "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
  NFT_SENDER:
    "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
  NFT_RECEIVER:
    "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
  SCHEDULED_TX:
    "text-indigo-600 dark:text-indigo-400 border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10",
  EVM: "text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10",
  CONTRACT_DEPLOY:
    "text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10",
  ACCOUNT_CREATED:
    "text-cyan-600 dark:text-cyan-400 border-cyan-300 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/10",
  KEY_UPDATE:
    "text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/10",
  MARKETPLACE:
    "text-pink-600 dark:text-pink-400 border-pink-300 dark:border-pink-500/30 bg-pink-50 dark:bg-pink-500/10",
  STAKING:
    "text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10",
  LIQUID_STAKING:
    "text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10",
  SWAP: "text-teal-600 dark:text-teal-400 border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10",
  LIQUIDITY:
    "text-teal-600 dark:text-teal-400 border-teal-300 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10",
  TOKEN_MINT:
    "text-lime-600 dark:text-lime-400 border-lime-300 dark:border-lime-500/30 bg-lime-50 dark:bg-lime-500/10",
  TOKEN_BURN:
    "text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10",
}

export const DEFAULT_TAG_STYLE =
  "text-zinc-500 dark:text-zinc-500 border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5"

/**
 * Lucide icon name string for each tag. Consumers map these to actual icon
 * components in their own code (avoids importing lucide-react here).
 */
export const TAG_ICON_NAMES: Record<string, string> = {
  FT_TRANSFER: "ArrowRightLeft",
  FT_SENDER: "ArrowUpRight",
  FT_RECEIVER: "ArrowDownLeft",
  NFT_TRANSFER: "ShoppingBag",
  NFT_SENDER: "ArrowUpRight",
  NFT_RECEIVER: "ArrowDownLeft",
  SCHEDULED_TX: "Clock",
  EVM: "Zap",
  CONTRACT_DEPLOY: "FileCode",
  ACCOUNT_CREATED: "UserPlus",
  KEY_UPDATE: "Key",
  MARKETPLACE: "ShoppingBag",
  STAKING: "Coins",
  LIQUID_STAKING: "Droplets",
  SWAP: "ArrowRightLeft",
  LIQUIDITY: "Droplets",
  TOKEN_MINT: "CircleDollarSign",
  TOKEN_BURN: "Flame",
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Extract readable contract name from "A.addr.ContractName" identifier */
export function formatTokenName(identifier: string): string {
  if (!identifier) return ""
  const parts = identifier.split(".")
  return parts.length >= 3 ? parts[2] : identifier
}

/** Format a tag string for display (replace underscores with spaces) */
export function formatTagLabel(tag: string): string {
  return tag.replace(/_/g, " ")
}

/**
 * Extract a URL from a logo value that may be a string, JSON string, or
 * nested Cadence-like object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractLogoUrl(logo: any): string | null {
  if (!logo) return null
  if (typeof logo === "string") {
    if (logo.startsWith("http")) return logo
    try {
      const parsed = JSON.parse(logo)
      if (typeof parsed === "string" && parsed.startsWith("http")) return parsed
      if (parsed && typeof parsed === "object") {
        logo = parsed
      } else {
        return null
      }
    } catch {
      return null
    }
  }
  try {
    const json = typeof logo === "string" ? JSON.parse(logo) : logo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findUrl = (obj: any): string | null => {
      if (!obj || typeof obj !== "object") return null
      if (typeof obj.url === "string" && obj.url.startsWith("http"))
        return obj.url
      if (typeof obj.value === "string" && obj.value.startsWith("http"))
        return obj.value
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const found = findUrl(item)
          if (found) return found
        }
      }
      if (obj.value && typeof obj.value === "object") {
        return findUrl(obj.value)
      }
      if (obj.fields && Array.isArray(obj.fields)) {
        for (const field of obj.fields) {
          const found = findUrl(field)
          if (found) return found
        }
      }
      return null
    }
    return findUrl(json)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// buildSummaryLine -- one-line text summary for a transaction
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSummaryLine(tx: any): string {
  const summary: TransferSummary | undefined = tx.transfer_summary
  const imports: string[] = tx.contract_imports || []
  const tags: string[] = tx.tags || []
  const tagsLower = tags.map((t) => t.toLowerCase())

  if (tagsLower.some((t) => t.includes("account_created")))
    return "Created new account"
  if (tagsLower.some((t) => t.includes("key_update")))
    return "Updated account key"

  if (tx.ft_transfers?.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = tx.ft_transfers.slice(0, 3).map((ft: any) => {
      const displayName =
        ft.token_symbol || formatTokenName(ft.token || "")
      const typeLabel =
        ft.transfer_type === "mint"
          ? "Minted"
          : ft.transfer_type === "burn"
            ? "Burned"
            : "Transferred"
      return `${typeLabel} ${Number(ft.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${displayName}`
    })
    return parts.join(", ")
  }
  if (tx.nft_transfers?.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = tx.nft_transfers.slice(0, 3).map((nt: any) => {
      const displayName =
        nt.collection_name || formatTokenName(nt.token || "")
      const typeLabel =
        nt.transfer_type === "mint"
          ? "Minted"
          : nt.transfer_type === "burn"
            ? "Burned"
            : "Transferred"
      return `${typeLabel} ${displayName} #${nt.token_id ?? ""}`
    })
    return parts.join(", ")
  }

  if (summary?.ft && summary.ft.length > 0) {
    const parts = summary.ft.map((f) => {
      const displayName = f.symbol || f.name || formatTokenName(f.token)
      const direction = f.direction === "out" ? "Sent" : "Received"
      const cp = f.counterparty
        ? ` ${f.direction === "out" ? "to" : "from"} ${formatShort(f.counterparty)}`
        : ""
      return `${direction} ${Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${displayName}${cp}`
    })
    return parts.join(", ")
  }

  if (summary?.nft && summary.nft.length > 0) {
    const parts = summary.nft.map((n) => {
      const displayName = n.name || formatTokenName(n.collection)
      const direction = n.direction === "out" ? "Sent" : "Received"
      const cp = n.counterparty
        ? ` ${n.direction === "out" ? "to" : "from"} ${formatShort(n.counterparty)}`
        : ""
      return `${direction} ${n.count} ${displayName}${cp}`
    })
    return parts.join(", ")
  }

  if (
    tagsLower.some(
      (t) =>
        t.includes("deploy") ||
        t.includes("contract_added") ||
        t.includes("contract_updated") ||
        t.includes("contract_deploy"),
    )
  ) {
    const contractNames = imports
      .map((c) => formatTokenName(c))
      .filter(Boolean)
    return contractNames.length > 0
      ? `Deployed ${contractNames.join(", ")}`
      : "Contract deployment"
  }

  if (tx.template_description) return tx.template_description
  if (tx.template_label) return tx.template_label

  if (imports.length > 0) {
    const contractNames = imports
      .slice(0, 3)
      .map((c) => formatTokenName(c))
      .filter(Boolean)
    const suffix = imports.length > 3 ? ` +${imports.length - 3} more` : ""
    return `Called ${contractNames.join(", ")}${suffix}`
  }

  return ""
}

// ---------------------------------------------------------------------------
// deriveTransferPreview -- avatar-group preview items for the row
// ---------------------------------------------------------------------------

export function deriveTransferPreview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tokenMeta?: Map<string, TokenMetaEntry>,
): TransferPreviewItem[] {
  const items: TransferPreviewItem[] = []

  // Priority 1: rich ft_transfers / nft_transfers arrays
  if (tx.ft_transfers?.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const ft of tx.ft_transfers as any[]) {
      if (items.length >= 3) break
      const sym = ft.token_symbol || ft.token?.split(".").pop() || ""
      items.push({
        type: "ft",
        icon: ft.token_logo || null,
        label: sym,
        amount:
          ft.amount != null
            ? Number(ft.amount).toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })
            : undefined,
        symbol: sym,
      })
    }
  }
  if (tx.nft_transfers?.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collMap = new Map<string, { count: number; icon: any; name: string }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const nt of tx.nft_transfers as any[]) {
      const key = nt.token || nt.collection_name || "NFT"
      const existing = collMap.get(key)
      if (existing) {
        existing.count++
      } else {
        collMap.set(key, {
          count: 1,
          icon: nt.collection_logo || null,
          name: nt.collection_name || formatTokenName(nt.token || ""),
        })
      }
    }
    for (const [, val] of collMap) {
      if (items.length >= 3) break
      items.push({ type: "nft", icon: val.icon, label: val.name, count: val.count })
    }
  }
  if (items.length > 0) return items

  // Priority 2: transfer_summary
  const summary: TransferSummary | undefined = tx.transfer_summary
  if (summary?.ft?.length) {
    for (const f of summary.ft) {
      if (items.length >= 3) break
      const sym = f.symbol || f.name || formatTokenName(f.token)
      items.push({
        type: "ft",
        icon: f.logo || null,
        label: sym,
        amount: f.amount
          ? Number(f.amount).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })
          : undefined,
        symbol: sym,
      })
    }
  }
  if (summary?.nft?.length) {
    for (const n of summary.nft) {
      if (items.length >= 3) break
      const name = n.name || formatTokenName(n.collection)
      items.push({ type: "nft", icon: n.logo || null, label: name, count: n.count })
    }
  }
  if (items.length > 0) return items

  // Priority 3: contract_imports + tokenMeta
  if (tokenMeta && tokenMeta.size > 0) {
    const imports: string[] = tx.contract_imports || []
    const seen = new Set<string>()
    for (const imp of imports) {
      if (items.length >= 3) break
      if (seen.has(imp)) continue
      const meta = tokenMeta.get(imp)
      if (meta) {
        seen.add(imp)
        items.push({
          type: meta.type,
          icon: meta.logo,
          label: meta.symbol || meta.name || formatTokenName(imp),
        })
      }
    }
    if (items.length > 0) return items
  }

  // Priority 4: tags hint
  const tags: string[] = tx.tags || []
  const tagsSet = new Set(tags)
  const imports: string[] = tx.contract_imports || []
  const contractNames = imports
    .map((c) => formatTokenName(c))
    .filter(
      (n) =>
        n &&
        n !== "Crypto" &&
        n !== "FungibleToken" &&
        n !== "NonFungibleToken",
    )
  if (
    tagsSet.has("FT_TRANSFER") ||
    tagsSet.has("FT_SENDER") ||
    tagsSet.has("FT_RECEIVER")
  ) {
    const label = contractNames[0] || "FT"
    items.push({ type: "ft", icon: null, label })
  }
  if (
    tagsSet.has("NFT_TRANSFER") ||
    tagsSet.has("NFT_SENDER") ||
    tagsSet.has("NFT_RECEIVER")
  ) {
    const label = contractNames[0] || "NFT"
    items.push({ type: "nft", icon: null, label })
  }
  return items
}

// ---------------------------------------------------------------------------
// findNftBannerImage -- find a banner image from token metadata
// ---------------------------------------------------------------------------

export function findNftBannerImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tokenMeta?: Map<string, TokenMetaEntry>,
): string | null {
  if (!tokenMeta || tokenMeta.size === 0) return null
  const imports: string[] = tx.contract_imports || []
  for (const imp of imports) {
    const meta = tokenMeta.get(imp)
    if (meta?.type === "nft" && meta.banner_image) {
      return extractLogoUrl(meta.banner_image)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// dedup -- deduplicate transaction arrays
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dedup(txs: any[]): any[] {
  const seen = new Set<string>()
  return txs.filter((tx) => {
    const key = tx.id
      ? `${tx.id}:${tx.block_height ?? tx.blockHeight ?? ""}`
      : ""
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
