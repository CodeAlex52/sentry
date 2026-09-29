import type {Block} from 'sentry/views/seerExplorer/types';

/**
 * An "Ask Seer" question: shown in Explorer as Seer's, and sent with the user's reply.
 * `context` is the JSON the entry point captured when it was clicked.
 */
export type ChatPrompt = {
  text: string;
  context?: string;
};

/** The question a user message answered, which the chat endpoint stores in its metadata. */
export function getBlockChatPrompt(block: Block): ChatPrompt | null {
  const text = block.message.metadata?.chat_prompt;
  if (!text) {
    return null;
  }
  return {text, context: block.message.metadata?.chat_prompt_context};
}

/** The metadata the chat endpoint stores for a prompt, mirrored on the optimistic block. */
export function toChatPromptMetadata(prompt: ChatPrompt): Record<string, string> {
  if (prompt.context === undefined) {
    return {chat_prompt: prompt.text};
  }
  return {chat_prompt: prompt.text, chat_prompt_context: prompt.context};
}
