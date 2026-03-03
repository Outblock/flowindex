import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'

const logger = createLogger('FlowAPI')

const FLOW_API_BASE = env.FLOWINDEX_API_URL || 'http://127.0.0.1:8080'

/**
 * Fetch data from the FlowIndex Go backend REST API.
 *
 * Handles timeout via AbortController and surfaces status/body on errors.
 */
export async function flowApiFetch<T = unknown>(
  path: string,
  options?: { method?: string; body?: unknown; timeout?: number }
): Promise<T> {
  const url = `${FLOW_API_BASE}${path}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? 15000)

  try {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`FlowIndex API ${res.status}: ${text}`)
    }

    return (await res.json()) as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`FlowIndex API timeout: ${path}`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Build a URL query string from a params object, omitting undefined/empty values.
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined>
): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  if (entries.length === 0) return ''
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
}
