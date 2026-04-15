/**
 * LLM Factory — creates the appropriate provider based on config.
 *
 * Each provider implements:
 *   async chat(systemPrompt, messages, tools) => { text, toolCalls }
 *   async continueWithToolResults(messages, toolResults, tools) => { text, toolCalls }
 *
 * Where toolCalls is an array of { id, name, arguments }
 * and toolResults is an array of { toolCallId, result }
 */

export async function createLLMProvider(config) {
  const { vendor } = config.llm;

  switch (vendor) {
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic.js");
      return new AnthropicProvider(config.llm);
    }
    case "openai": {
      const { OpenAIProvider } = await import("./openai.js");
      return new OpenAIProvider(config.llm);
    }
    case "gemini": {
      const { GeminiProvider } = await import("./gemini.js");
      return new GeminiProvider(config.llm);
    }
    case "claude-cli": {
      const { ClaudeCliProvider } = await import("./claude-cli.js");
      return new ClaudeCliProvider(config.llm);
    }
    default:
      throw new Error(`Unknown LLM vendor: ${vendor}`);
  }
}

// Available vendors and their models
export const LLM_VENDORS = {
  anthropic: {
    name: "Anthropic",
    models: [
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4" },
      { id: "claude-opus-4-6", name: "Claude Opus 4" },
      { id: "claude-haiku-4-20251001", name: "Claude Haiku 4" },
    ],
    requiresApiKey: true,
  },
  openai: {
    name: "OpenAI",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "o3-mini", name: "o3-mini" },
    ],
    requiresApiKey: true,
  },
  gemini: {
    name: "Google Gemini",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
    requiresApiKey: true,
  },
  "claude-cli": {
    name: "Claude Code CLI (Free with Max)",
    models: [
      { id: "sonnet", name: "Sonnet" },
      { id: "opus", name: "Opus" },
      { id: "haiku", name: "Haiku" },
    ],
    requiresApiKey: false,
  },
};
