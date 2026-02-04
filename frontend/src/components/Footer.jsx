import { Github } from 'lucide-react';

function Footer() {
  return (
    <footer className="border-t border-white/5 bg-nothing-dark/90">
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
        <div className="flex items-center gap-2 uppercase tracking-widest">
          <span>Built by</span>
          <span className="text-white">Flow Community</span>
        </div>
        <a
          href="https://github.com/zenabot27/flowscan-clone"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors uppercase tracking-widest"
          aria-label="Open Source on GitHub"
        >
          <Github className="h-4 w-4" />
          <span>Open Source</span>
        </a>
      </div>
    </footer>
  );
}

export default Footer;
