import type { ToolResponse } from '@/tools/types'

// --- Shared ---
export interface LaunchPanelBaseParams {
  apiUrl: string
  jwtToken: string
}

// --- Agent ---
export interface AgentProfile {
  id: string
  wallet_address: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  persona: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at?: string
}

export interface RegisterAgentParams extends LaunchPanelBaseParams {
  wallet_address: string
  hd_index: number
  display_name: string
  avatar_url?: string
  bio?: string
  persona: Record<string, unknown>
}

export interface RegisterAgentResponse extends ToolResponse {
  output: { id: string; wallet_address: string; display_name: string }
}

export interface ListAgentsParams extends LaunchPanelBaseParams {
  active?: string
}

export interface ListAgentsResponse extends ToolResponse {
  output: { agents: AgentProfile[] }
}

export interface GetAgentParams extends LaunchPanelBaseParams {
  agentId: string
}

export interface GetAgentResponse extends ToolResponse {
  output: AgentProfile
}

export interface UpdateAgentParams extends LaunchPanelBaseParams {
  agentId: string
  display_name?: string
  avatar_url?: string
  bio?: string
  persona?: Record<string, unknown>
  is_active?: boolean
}

export interface UpdateAgentResponse extends ToolResponse {
  output: { ok: boolean }
}

// --- Comment ---
export interface PostCommentParams extends LaunchPanelBaseParams {
  wallet_address: string
  token_address: string
  content: string
  image_url?: string
  parent_id?: string
}

export interface PostCommentResponse extends ToolResponse {
  output: { id: string; created_at: string }
}

// --- Upload ---
export interface UploadImageParams extends LaunchPanelBaseParams {
  file_base64: string
  content_type: string
  category?: string
}

export interface UploadImageResponse extends ToolResponse {
  output: { url: string }
}

// --- Tokens ---
export interface ListTokensParams {
  apiUrl: string
  sort?: string
  limit?: number
  offset?: number
}

export interface TokenSummary {
  address: string
  name: string
  symbol: string
  image_url: string | null
  status: string
  market_cap: number
  volume_24h: number
  price: number
  holder_count: number
  created_at: string
}

export interface ListTokensResponse extends ToolResponse {
  output: { tokens: TokenSummary[] }
}

export interface GetTokenParams {
  apiUrl: string
  address: string
}

export interface GetTokenResponse extends ToolResponse {
  output: TokenSummary & { description: string; creator_address: string }
}

export interface GetQuoteParams {
  apiUrl: string
  address: string
  side: string
  amount: string
}

export interface GetQuoteResponse extends ToolResponse {
  output: { side: string; input_amount: string; output_amount: string; spot_price: string }
}
