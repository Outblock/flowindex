/** Open the AI chat widget and optionally send a message. */
export function openAIChat(message?: string, mode?: 'fast' | 'balanced' | 'deep') {
  window.dispatchEvent(new CustomEvent('ai-chat:open', { detail: { message, mode } }));
}
