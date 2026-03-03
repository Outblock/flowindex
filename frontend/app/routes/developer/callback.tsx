import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export const Route = createFileRoute('/developer/callback')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const redirect = typeof search.redirect === 'string' ? search.redirect : undefined
    return { redirect }
  },
  component: DeveloperCallbackPage,
})

const SIM_STUDIO_URL = import.meta.env.VITE_SIM_STUDIO_URL || 'https://studio.flowindex.io'
const SIM_STUDIO_ORIGIN = (() => {
  try {
    return new URL(SIM_STUDIO_URL).origin
  } catch {
    return 'https://studio.flowindex.io'
  }
})()

function normalizeRedirectTarget(redirect?: string): string {
  if (!redirect) return '/developer'
  if (redirect.startsWith('/')) return redirect

  try {
    const url = new URL(redirect)
    const isSameOrigin = url.origin === window.location.origin
    const isStudio = url.origin === SIM_STUDIO_ORIGIN
    const isFlowIndexSubdomain = url.hostname.endsWith('.flowindex.io')
    if (isSameOrigin || isStudio || isFlowIndexSubdomain) {
      return url.toString()
    }
  } catch {
    // Ignore malformed redirect
  }

  return '/developer'
}

function DeveloperCallbackPage() {
  const { handleCallback } = useAuth()
  const { redirect } = Route.useSearch()
  const processed = useRef(false)
  const redirectTo = normalizeRedirectTarget(redirect)

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    const hash = window.location.hash
    if (hash) {
      handleCallback(hash)
    }

    // Navigate after processing.
    window.location.assign(redirectTo)
  }, [handleCallback, redirectTo])

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00ef8b] mx-auto mb-4" />
        <p className="text-neutral-400 text-sm">Signing you in...</p>
      </div>
    </div>
  )
}
