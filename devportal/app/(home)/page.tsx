import Link from 'next/link';
import { BookOpen, Play, Bot, Wallet, Package, Github, ArrowRight } from 'lucide-react';

const projects = [
  {
    title: 'FlowIndex',
    description: 'High-performance blockchain explorer and indexer for Flow with EVM support.',
    href: '/docs/flowindex',
    icon: BookOpen,
  },
  {
    title: 'Run',
    description: 'Interactive Cadence smart contract runner and playground.',
    href: '/docs/run',
    icon: Play,
  },
  {
    title: 'AI',
    description: 'AI-powered blockchain assistant with natural language queries.',
    href: '/docs/ai',
    icon: Bot,
  },
  {
    title: 'Wallet',
    description: 'Passkey-based Flow wallet — no seed phrases required.',
    href: '/docs/wallet',
    icon: Wallet,
  },
  {
    title: 'Packages',
    description: 'Reusable libraries: agent-wallet, auth, passkey, and UI components.',
    href: '/docs/packages',
    icon: Package,
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center flex-1 py-10">
      <div className="mx-auto w-full max-w-3xl text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-fd-muted-foreground">
          Open Source
        </p>
        <h1 className="mt-4 text-3xl md:text-5xl font-bold tracking-tight text-fd-foreground">
          FlowIndex Documentation
        </h1>
        <p className="mt-4 text-sm md:text-base text-fd-muted-foreground leading-relaxed">
          Open-source tools for the Flow blockchain. Explore, build, and transact.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/docs"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 py-2 text-sm font-medium text-fd-foreground hover:bg-fd-muted transition"
          >
            <BookOpen className="size-4" />
            Browse Docs
          </Link>
          <a
            href="https://github.com/Outblock"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 py-2 text-sm font-medium text-fd-foreground hover:bg-fd-muted transition"
          >
            <Github className="size-4" />
            GitHub
          </a>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => (
          <Link
            key={project.title}
            href={project.href}
            className="group rounded-lg border border-fd-border bg-fd-card p-5 hover:border-fd-primary/50 hover:bg-fd-muted transition"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-fd-foreground">
              <project.icon className="size-4 text-fd-primary" />
              {project.title}
              <ArrowRight className="size-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="mt-2 text-sm text-fd-muted-foreground leading-relaxed">
              {project.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
