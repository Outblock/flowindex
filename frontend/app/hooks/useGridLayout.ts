import { useState, useCallback, useEffect } from 'react'
import type { Layout, ResponsiveLayouts } from 'react-grid-layout'
import { DEFAULT_LAYOUTS } from '../routes/analytics-layout'

const DEFAULT_STORAGE_KEY = 'flowscan-analytics-grid-layout'

export function useGridLayout(
  _storageKey: string = DEFAULT_STORAGE_KEY,
  defaultLayouts: ResponsiveLayouts = DEFAULT_LAYOUTS,
) {
  // Always start from default layouts — persisting to localStorage caused layout
  // corruption when switching tabs (partial layouts saved, then loaded with missing items).
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(() => defaultLayouts)

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 767px)').matches
  })

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Clean up any stale layouts from localStorage
  useEffect(() => {
    try { localStorage.removeItem(_storageKey) } catch { /* ignore */ }
  }, [_storageKey])

  const onLayoutChange = useCallback((_layout: Layout, allLayouts: ResponsiveLayouts) => {
    setLayouts(allLayouts)
  }, [])

  const resetLayout = useCallback(() => {
    setLayouts(defaultLayouts)
  }, [defaultLayouts])

  return { layouts, onLayoutChange, resetLayout, isMobile }
}
