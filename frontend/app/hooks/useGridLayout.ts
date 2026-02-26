import { useState, useCallback, useEffect } from 'react'
import type { Layout, ResponsiveLayouts } from 'react-grid-layout'
import { DEFAULT_LAYOUTS } from '../routes/analytics-layout'

const DEFAULT_STORAGE_KEY = 'flowscan-analytics-grid-layout'

function loadLayouts(storageKey: string): ResponsiveLayouts | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Basic validation: must be object with at least one breakpoint array
    if (typeof parsed !== 'object' || parsed === null) return null
    for (const key of Object.keys(parsed)) {
      if (!Array.isArray(parsed[key])) return null
    }
    return parsed as ResponsiveLayouts
  } catch {
    return null
  }
}

export function useGridLayout(
  storageKey: string = DEFAULT_STORAGE_KEY,
  defaultLayouts: ResponsiveLayouts = DEFAULT_LAYOUTS,
) {
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(() => {
    return loadLayouts(storageKey) ?? defaultLayouts
  })

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

  const onLayoutChange = useCallback((_layout: Layout, allLayouts: ResponsiveLayouts) => {
    setLayouts(allLayouts)
    try {
      localStorage.setItem(storageKey, JSON.stringify(allLayouts))
    } catch {
      // storage full — silently ignore
    }
  }, [storageKey])

  const resetLayout = useCallback(() => {
    setLayouts(defaultLayouts)
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }, [storageKey, defaultLayouts])

  return { layouts, onLayoutChange, resetLayout, isMobile }
}
