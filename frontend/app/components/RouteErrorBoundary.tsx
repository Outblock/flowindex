import React from 'react';

type Props = {
  title?: string;
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

// SSR-safe error boundary. Prevents route-level render errors from collapsing the
// entire SSR stream into an empty response (we've observed Content-Length: 0).
export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, message: msg };
  }

  componentDidCatch(error: unknown) {
    // Keep logging minimal, but do surface the error for debugging.
    // eslint-disable-next-line no-console
    console.error('Route render error:', error);
  }

  render() {
    if (this.state.hasError) {
      const title = this.props.title || 'Page Error';
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center font-mono transition-colors duration-300 px-4">
          <div className="border border-red-500/30 bg-red-50 dark:bg-red-900/10 p-6 max-w-2xl w-full rounded-sm">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-2">{title}</h2>
            <pre className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
              {this.state.message || 'Unknown render error'}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

