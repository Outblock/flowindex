import { createContext, useContext, useEffect, useState } from 'react';

export type FontFamily = 'mono' | 'sans' | 'pixel';
export type PixelVariant = 'square' | 'grid' | 'circle' | 'triangle' | 'line';

const FONT_FAMILY_MAP: Record<FontFamily, string> = {
  mono: 'Inconsolata, Space Mono, monospace',
  sans: 'Geist Sans, sans-serif',
  pixel: '', // resolved dynamically from pixelVariant
};

const PIXEL_VARIANT_MAP: Record<PixelVariant, string> = {
  square: 'Geist Pixel Square, monospace',
  grid: 'Geist Pixel Grid, monospace',
  circle: 'Geist Pixel Circle, monospace',
  triangle: 'Geist Pixel Triangle, monospace',
  line: 'Geist Pixel Line, monospace',
};

interface FontContextValue {
  fontFamily: FontFamily;
  pixelVariant: PixelVariant;
  setFontFamily: (f: FontFamily) => void;
  setPixelVariant: (v: PixelVariant) => void;
}

const FontContext = createContext<FontContextValue>({
  fontFamily: 'mono',
  pixelVariant: 'square',
  setFontFamily: () => {},
  setPixelVariant: () => {},
});

export function FontProvider({ children }: { children: React.ReactNode }) {
  const [fontFamily, setFontFamilyState] = useState<FontFamily>('mono');
  const [pixelVariant, setPixelVariantState] = useState<PixelVariant>('square');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const savedFont = localStorage.getItem('fontFamily') as FontFamily | null;
    const savedPixel = localStorage.getItem('pixelVariant') as PixelVariant | null;
    if (savedFont && FONT_FAMILY_MAP[savedFont] !== undefined) setFontFamilyState(savedFont);
    if (savedPixel && PIXEL_VARIANT_MAP[savedPixel]) setPixelVariantState(savedPixel);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const resolved =
      fontFamily === 'pixel'
        ? PIXEL_VARIANT_MAP[pixelVariant]
        : FONT_FAMILY_MAP[fontFamily];

    // Apply to <body> so code elements (which have explicit font-family) are unaffected
    document.body.style.fontFamily = resolved;
  }, [fontFamily, pixelVariant, ready]);

  const setFontFamily = (f: FontFamily) => {
    setFontFamilyState(f);
    localStorage.setItem('fontFamily', f);
  };

  const setPixelVariant = (v: PixelVariant) => {
    setPixelVariantState(v);
    localStorage.setItem('pixelVariant', v);
  };

  return (
    <FontContext.Provider value={{ fontFamily, pixelVariant, setFontFamily, setPixelVariant }}>
      {children}
    </FontContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFont() {
  return useContext(FontContext);
}
