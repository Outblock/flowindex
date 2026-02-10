import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({
    theme: 'dark',
    toggleTheme: (_e?: any) => Promise.resolve(),
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    // Lazy initializer: reads localStorage on client, defaults to 'dark' on server/SSR.
    // This avoids calling setState inside an effect (React 19 strict mode violation).
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        if (typeof window === 'undefined') return 'dark';
        const saved = window.localStorage.getItem('theme');
        return saved === 'light' ? 'light' : 'dark';
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

    const toggleTheme = async (e?: React.MouseEvent) => {
        // Fallback if View Transition API not supported or no coordinates
        if (!document.startViewTransition || !e?.clientX || !e?.clientY) {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
            return;
        }

        const x = e.clientX;
        const y = e.clientY;
        const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y),
        );

        const transition = document.startViewTransition(() => {
            setTheme(prev => prev === 'dark' ? 'light' : 'dark');
        });

        await transition.ready;

        // Animate the new view as an expanding circle from click position
        document.documentElement.animate(
            {
                clipPath: [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(${endRadius}px at ${x}px ${y}px)`,
                ],
            },
            {
                duration: 800,
                easing: 'ease-in-out',
                pseudoElement: '::view-transition-new(root)',
            },
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
