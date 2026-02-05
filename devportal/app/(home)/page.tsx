import Link from 'next/link';
import { ArrowRight, BookOpen, Code2, FlaskConical, Github } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center flex-1 py-10">
      <div className="mx-auto w-full max-w-3xl text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-fd-muted-foreground">
          Developer Portal
        </p>
        <h1 className="mt-4 text-3xl md:text-5xl font-bold tracking-tight text-fd-foreground">
          FlowScan API & Docs
        </h1>
        <p className="mt-4 text-sm md:text-base text-fd-muted-foreground leading-relaxed">
          Build on top of FlowScan with a stable public API, OpenAPI spec, and an interactive API
          reference.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-stretch justify-center gap-3">
          <Link
            href="/api-reference"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground hover:opacity-90 transition"
          >
            <Code2 className="size-4" />
            API (Scalar)
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/api-explorer"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 py-2 text-sm font-medium text-fd-foreground hover:bg-fd-muted transition"
          >
            <FlaskConical className="size-4" />
            API (Fumadocs)
          </Link>
          <Link
            href="/docs"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 py-2 text-sm font-medium text-fd-foreground hover:bg-fd-muted transition"
          >
            <BookOpen className="size-4" />
            Read the Docs
          </Link>
          <a
            href="https://github.com/zenabot27/flowscan-clone"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-4 py-2 text-sm font-medium text-fd-foreground hover:bg-fd-muted transition"
          >
            <Github className="size-4" />
            GitHub
          </a>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-fd-border bg-fd-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-fd-foreground">
            <Code2 className="size-4 text-fd-primary" />
            OpenAPI + Try It
          </div>
          <p className="mt-2 text-sm text-fd-muted-foreground leading-relaxed">
            Browse endpoints, inspect schemas, and send test requests directly from your browser.
          </p>
        </div>
        <div className="rounded-lg border border-fd-border bg-fd-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-fd-foreground">
            <BookOpen className="size-4 text-fd-primary" />
            Runbooks & Architecture
          </div>
          <p className="mt-2 text-sm text-fd-muted-foreground leading-relaxed">
            Learn how FlowScan ingests blocks, stores data, and scales across sporks and history.
          </p>
        </div>
        <div className="rounded-lg border border-fd-border bg-fd-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-fd-foreground">
            <Github className="size-4 text-fd-primary" />
            Open Source
          </div>
          <p className="mt-2 text-sm text-fd-muted-foreground leading-relaxed">
            Everything is versioned in Git. Contributions and feedback welcome.
          </p>
        </div>
      </div>
    </div>
  );
}
