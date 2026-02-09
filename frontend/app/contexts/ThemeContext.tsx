import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({
    theme: 'dark',
    toggleTheme: (_e?: any) => Promise.resolve(),
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    // Default to dark mode
    const [theme, setTheme] = useState(() => {
        // SSR-safe default
        if (typeof window === 'undefined') return 'dark';

        // Check what's already on the root (from inline script)
        if (window.document.documentElement.classList.contains('dark')) {
            return 'dark';
        }
        const saved = window.localStorage.getItem('theme');
        return saved || 'dark';
    });

    useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = async (e) => {
        // Fallback or if no event passed (no coordinates)
        if (!document.startViewTransition || !e?.clientX || !e?.clientY) {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
            return;
        }

        const x = e.clientX;
        const y = e.clientY;
        const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        );

        // Start the transition
        const transition = document.startViewTransition(() => {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
        });

        // Wait for the pseudo-elements to be created
        await transition.ready;

        // Animate the new view (the expanding circle)
        document.documentElement.animate(
            {
                clipPath: [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(${endRadius}px at ${x}px ${y}px)`,
                ],
            },
            {
                duration: 500,
                easing: 'ease-in-out',
                // Specify which pseudo-element to animate
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
