const MODEL_MAP: Record<string, string> = {
  // Explicit Claude model IDs — pass through
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',

  // Legacy model IDs that sim-workflow might send
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001',
  'claude-3-opus-20240229': 'claude-opus-4-6',
  'claude-sonnet-4-5-20250514': 'claude-sonnet-4-6',
  'claude-opus-4-5-20250918': 'claude-opus-4-6',

  // Generic short names
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',

  // GPT models → map to Claude equivalents
  'gpt-4o': 'claude-sonnet-4-6',
  'gpt-4o-mini': 'claude-haiku-4-5-20251001',
  'gpt-4-turbo': 'claude-sonnet-4-6',

  // Gemini models → map to Claude equivalents
  'gemini-2.0-flash': 'claude-haiku-4-5-20251001',
  'gemini-1.5-pro': 'claude-sonnet-4-6',
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'

/**
 * Resolve a model name from the request to a valid Claude model ID.
 */
export function resolveModel(requested?: string): string {
  if (!requested) return DEFAULT_MODEL

  // Check direct match
  if (MODEL_MAP[requested]) return MODEL_MAP[requested]

  // If it looks like a valid Claude model ID, pass through
  if (requested.startsWith('claude-')) return requested

  return DEFAULT_MODEL
}
