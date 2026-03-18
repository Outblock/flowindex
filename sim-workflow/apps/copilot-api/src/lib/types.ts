export type SSEEventType =
  | 'chat_id'
  | 'title_updated'
  | 'content'
  | 'reasoning'
  | 'tool_call'
  | 'tool_generating'
  | 'tool_result'
  | 'tool_error'
  | 'subagent_start'
  | 'subagent_end'
  | 'structured_result'
  | 'subagent_result'
  | 'done'
  | 'error'
  | 'start'

export interface SSEEvent {
  type: SSEEventType
  data?: Record<string, unknown> | string
  subagent?: string
  toolCallId?: string
  toolName?: string
  success?: boolean
  result?: unknown
  chatId?: string
  title?: string
  error?: string
  content?: string
  phase?: string
  failedDependency?: boolean
}

export interface ChatRequest {
  message: string
  workflowId: string
  userId: string
  model: string
  mode: 'agent' | 'ask' | 'plan'
  messageId: string
  version: string
  context?: Array<{ type: string; content: string }>
  conversationHistory?: ConversationMessage[]
  chatId?: string
  conversationId?: string
  integrationTools?: ToolSchema[]
  credentials?: CredentialsPayload
  fileAttachments?: FileContent[]
  commands?: string[]
  prefetch?: boolean
  implicitFeedback?: string
  provider?: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  tool_calls?: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
  }>
  tool_results?: Array<{
    tool_call_id: string
    output: unknown
  }>
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
  defer_loading?: boolean
  executeLocally?: boolean
  oauth?: { required: boolean; provider: string }
}

export interface CredentialsPayload {
  oauth: Record<string, {
    accessToken: string
    accountId: string
    name: string
    expiresAt?: string
  }>
  apiKeys: string[]
  metadata?: {
    connectedOAuth: Array<{ provider: string; name: string; scopes?: string[] }>
    configuredApiKeys: string[]
  }
}

export interface FileContent {
  id: string
  key: string
  name: string
  mimeType: string
  size: number
  content?: string
}

export interface MarkCompleteRequest {
  id: string
  name: string
  status: number
  message?: unknown
  data?: unknown
}

export interface ToolResult {
  success: boolean
  output?: unknown
  error?: string
}

export interface TitleRequest {
  message: string
  model: string
  provider?: string
}
