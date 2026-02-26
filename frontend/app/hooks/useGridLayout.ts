import { useState, useCallback, useEffect } from 'react'
import type { Layout, ResponsiveLayouts } from 'react-grid-layout'
import { DEFAULT_LAYOUTS } from '../routes/analytics-layout'

const STORAGE_KEY = 'flowscan-analytics-grid-layout'

function loadLayouts(): ResponsiveLayouts | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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

export function useGridLayout() {
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(() => {
    return loadLayouts() ?? DEFAULT_LAYOUTS
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allLayouts))
    } catch {
      // storage full — silently ignore
    }
  }, [])

  const resetLayout = useCallback(() => {
    setLayouts(DEFAULT_LAYOUTS)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  return { layouts, onLayoutChange, resetLayout, isMobile }
}
