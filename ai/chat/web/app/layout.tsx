"use client";

import "./globals.css";
import Link from "next/link";
import { Terminal, Database, Settings } from "lucide-react";
import { FlowLogo } from "@/components/flow-logo";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex flex-col relative overflow-hidden">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

function Sidebar() {
  return (
    <aside className="w-[56px] lg:w-[220px] flex-shrink-0 flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      {/* Brand */}
      <div className="h-14 flex items-center px-3.5 lg:px-5 border-b border-[var(--border-subtle)]">
        <FlowLogo size={28} className="shrink-0" />
        <div className="ml-3 hidden lg:flex flex-col">
          <span className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)] leading-none">
            Flow AI
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
            SQL + Cadence
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-0.5 px-2">
        <NavItem href="/" icon={<Terminal size={18} />} label="Console" />
        <NavItem href="/api" icon={<Database size={18} />} label="Schema" />
        <NavItem href="/settings" icon={<Settings size={18} />} label="Settings" />
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-[var(--border-subtle)] hidden lg:block">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--flow-green)]" />
          <span className="text-[11px] text-[var(--text-tertiary)]">Connected</span>
        </div>
      </div>
    </aside>
  );
}

function NavItem({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-150 cursor-pointer group",
        isActive
          ? "bg-[var(--bg-element)] text-[var(--text-primary)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-element)]/50"
      )}
    >
      <span className={cn(
        "shrink-0 transition-colors duration-150",
        isActive ? "text-[var(--flow-green)]" : "group-hover:text-[var(--text-secondary)]"
      )}>
        {icon}
      </span>
      <span className="text-[13px] font-medium hidden lg:block">{label}</span>
    </Link>
  );
}
