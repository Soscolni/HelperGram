/**
 * Anthropic Messages API provider
 */

import Anthropic from "@anthropic-ai/sdk";
import { toAnthropicTools } from "../tools.js";

export class AnthropicProvider {
  constructor({ model, apiKey }) {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async chat(systemPrompt, messages, tools) {
    const anthropicTools = tools ? toAnthropicTools() : undefined;
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: anthropicTools,
    });
    return this._parseResponse(response);
  }

  async continueWithToolResults(systemPrompt, messages, tools) {
    const anthropicTools = tools ? toAnthropicTools() : undefined;
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: anthropicTools,
    });
    return this._parseResponse(response);
  }

  _parseResponse(response) {
    let text = "";
    const toolCalls = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return { text, toolCalls, stopReason: response.stop_reason };
  }

  // Build tool result message for continuation
  static buildToolResultMessage(toolResults) {
    return {
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.toolCallId,
        content: JSON.stringify(r.result),
      })),
    };
  }
}
