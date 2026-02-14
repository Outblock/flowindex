import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// Use Scalar's vanilla CDN bundle instead of @scalar/api-reference-react.
// The React wrapper pulls ~5 MB of transitive deps (zod, vue, codemirror,
// highlight.js, babel/parser …) that bloat the SSR bundle and double the
// build time.  The CDN approach loads everything at runtime — zero build cost.
const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/browser/standalone.min.js';
const SCALAR_CSS = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/style.min.css';

function ApiDocs({ specUrl }: { specUrl: string }) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    // Inject stylesheet
    if (!document.querySelector(`link[href="${SCALAR_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = SCALAR_CSS;
      document.head.appendChild(link);
    }

    // Load and initialize Scalar
    const script = document.createElement('script');
    script.src = SCALAR_CDN;
    script.onload = () => {
      if (!containerRef.current) return;
      // @ts-expect-error — Scalar attaches to window
      const Scalar = window.ScalarApiReference || (window as any).Scalar;
      if (Scalar?.createApiReference) {
        containerRef.current.innerHTML = '';
        Scalar.createApiReference(containerRef.current, {
          url: specUrl,
          darkMode: theme === 'dark',
          showSidebar: true,
          hideDownloadButton: false,
          hideTestRequestButton: false,
          withDefaultFonts: false,
        });
      } else if (Scalar?.init) {
        containerRef.current.innerHTML = '';
        Scalar.init(containerRef.current, {
          url: specUrl,
          darkMode: theme === 'dark',
          showSidebar: true,
        });
      }
      setLoading(false);
    };
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, [specUrl, theme]);

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white transition-colors duration-300">
      {loading && (
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse">
            Loading API Docs...
          </p>
        </div>
      )}
      <div ref={containerRef} />
    </div>
  );
}

export default ApiDocs;
