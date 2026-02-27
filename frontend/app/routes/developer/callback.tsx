import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export const Route = createFileRoute('/developer/callback')({
  component: DeveloperCallbackPage,
})

function DeveloperCallbackPage() {
  const { handleCallback } = useAuth()
  const navigate = useNavigate()
  const processed = useRef(false)

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    const hash = window.location.hash
    if (hash) {
      handleCallback(hash)
    }

    // Navigate to developer dashboard after processing
    navigate({ to: '/developer' })
  }, [handleCallback, navigate])

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#00ef8b] mx-auto mb-4" />
        <p className="text-neutral-400 text-sm">Signing you in...</p>
      </div>
    </div>
  )
}
