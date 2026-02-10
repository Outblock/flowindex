import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({
    theme: 'dark',
    toggleTheme: (_e?: any) => Promise.resolve(),
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    // IMPORTANT: Keep SSR + first client render deterministic to avoid hydration mismatch.
    // We always start in dark mode and then reconcile to the saved preference after mount.
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');

    useEffect(() => {
        const saved = window.localStorage.getItem('theme');
        if (saved === 'dark' || saved === 'light') {
            setTheme(saved);
        }
    }, []);

    useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = async () => {
        if (!document.startViewTransition) {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
            return;
        }

        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const duration = prefersReduced ? 0 : 320;

        const transition = document.startViewTransition(() => {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
        });

        await transition.ready;

        if (duration === 0) return;

        // Left-to-right wipe for smoother, less janky transition.
        document.documentElement.animate(
            {
                clipPath: [
                    'inset(0 100% 0 0)',
                    'inset(0 0 0 0)',
                ],
            },
            {
                duration,
                easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                fill: 'both',
                pseudoElement: '::view-transition-new(root)',
            }
        );
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
    return useContext(ThemeContext);
}
