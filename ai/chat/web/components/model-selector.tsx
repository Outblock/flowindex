"use client";

import { useState, useCallback } from "react";
import { Zap, Scale, Brain, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMode = "fast" | "balanced" | "deep";

export interface ChatModeConfig {
  key: ChatMode;
  label: string;
  icon: LucideIcon;
  desc: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHAT_MODES: ChatModeConfig[] = [
  { key: "fast", label: "Fast", icon: Zap, desc: "Quick answers", model: "Haiku" },
  { key: "balanced", label: "Balanced", icon: Scale, desc: "Better quality", model: "Sonnet" },
  { key: "deep", label: "Deep", icon: Brain, desc: "Extended thinking", model: "Opus" },
];

const MODE_STORAGE_KEY = "flowai-chat-mode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStoredMode(): ChatMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    if (v === "fast" || v === "balanced" || v === "deep") return v;
  } catch {
    /* noop */
  }
  return "balanced";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useModelSelector() {
  const [mode, setMode] = useState<ChatMode>(getStoredMode);

  const selectMode = useCallback((m: ChatMode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, m);
    } catch {
      /* noop */
    }
  }, []);

  return { mode, selectMode, modes: CHAT_MODES } as const;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ModelSelectorProps {
  mode: ChatMode;
  onSelect: (mode: ChatMode) => void;
}

export function ModelSelector({ mode, onSelect }: ModelSelectorProps) {
  const current = CHAT_MODES.find((m) => m.key === mode) ?? CHAT_MODES[1];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-white/5"
          style={{ color: "var(--text-secondary)" }}
        >
          <CurrentIcon size={12} />
          {current.label}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel
          className="text-[10px] uppercase tracking-widest px-2 py-1"
          style={{ color: "var(--text-tertiary)" }}
        >
          Model
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {CHAT_MODES.map(({ key, label, icon: Icon, desc, model }) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => onSelect(key)}
            className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer ${
              key === mode ? "bg-white/5" : ""
            }`}
          >
            <Icon size={14} style={{ color: "var(--text-secondary)" }} />
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                {label}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                {desc}
              </span>
            </div>
            <span
              className="text-[10px] ml-auto shrink-0"
              style={{ color: "var(--text-tertiary)" }}
            >
              {model}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
