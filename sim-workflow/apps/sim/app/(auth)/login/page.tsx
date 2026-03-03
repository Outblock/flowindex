import { redirect } from 'next/navigation'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'
import LoginForm from '@/app/(auth)/login/login-form'
import { env } from '@/lib/core/config/env'
import { isFlowIndexSupabaseCookieAuth } from '@/lib/core/config/feature-flags'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (isFlowIndexSupabaseCookieAuth) {
    const flowIndexLoginUrl = env.FLOWINDEX_LOGIN_URL || 'https://flowindex.io/developer/login'
    const appUrl = env.FLOWINDEX_APP_URL || env.NEXT_PUBLIC_APP_URL || 'https://studio.flowindex.io'
    const callback = `${appUrl.replace(/\/$/, '')}/workspace`
    redirect(`${flowIndexLoginUrl}?redirect=${encodeURIComponent(callback)}`)
  }

  const { githubAvailable, googleAvailable, isProduction } = await getOAuthProviderStatus()

  return (
    <LoginForm
      githubAvailable={githubAvailable}
      googleAvailable={googleAvailable}
      isProduction={isProduction}
    />
  )
}
