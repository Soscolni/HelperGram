/**
 * OpenAI Chat Completions API provider
 */

import OpenAI from "openai";
import { toOpenAITools } from "../tools.js";

export class OpenAIProvider {
  constructor({ model, apiKey }) {
    this.model = model;
    this.client = new OpenAI({ apiKey });
  }

  async chat(systemPrompt, messages, tools) {
    const openaiTools = tools ? toOpenAITools() : undefined;
    const openaiMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools,
      max_tokens: 4096,
    });
    return this._parseResponse(response);
  }

  async continueWithToolResults(systemPrompt, messages, tools) {
    const openaiTools = tools ? toOpenAITools() : undefined;
    const openaiMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools,
      max_tokens: 4096,
    });
    return this._parseResponse(response);
  }

  _parseResponse(response) {
    const choice = response.choices[0];
    const message = choice.message;
    const text = message.content || "";
    const toolCalls = [];

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        });
      }
    }

    return { text, toolCalls, stopReason: choice.finish_reason };
  }

  // Build tool result messages for continuation
  static buildToolResultMessages(assistantMessage, toolResults) {
    const msgs = [];
    // Add the assistant message with tool_calls
    msgs.push(assistantMessage);
    // Add tool results
    for (const r of toolResults) {
      msgs.push({
        role: "tool",
        tool_call_id: r.toolCallId,
        content: JSON.stringify(r.result),
      });
    }
    return msgs;
  }
}
