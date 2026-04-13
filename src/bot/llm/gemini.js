/**
 * Google Gemini API provider
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { toGeminiTools } from "../tools.js";

export class GeminiProvider {
  constructor({ model, apiKey }) {
    this.modelName = model;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async chat(systemPrompt, messages, tools) {
    const geminiTools = tools ? toGeminiTools() : undefined;
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: systemPrompt,
      tools: geminiTools,
    });

    const chat = model.startChat({
      history: this._convertHistory(messages.slice(0, -1)),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content || lastMessage.parts);
    return this._parseResponse(result);
  }

  async continueWithToolResults(systemPrompt, messages, tools) {
    // For Gemini, tool results are sent as function responses in the conversation
    const geminiTools = tools ? toGeminiTools() : undefined;
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: systemPrompt,
      tools: geminiTools,
    });

    const chat = model.startChat({
      history: this._convertHistory(messages.slice(0, -1)),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.parts || lastMessage.content);
    return this._parseResponse(result);
  }

  _convertHistory(messages) {
    return messages.map((m) => {
      if (m.role === "user") {
        return { role: "user", parts: [{ text: m.content }] };
      } else if (m.role === "assistant" || m.role === "model") {
        if (m.parts) return { role: "model", parts: m.parts };
        return { role: "model", parts: [{ text: m.content }] };
      } else if (m.role === "function") {
        return { role: "function", parts: m.parts };
      }
      return { role: "user", parts: [{ text: JSON.stringify(m) }] };
    });
  }

  _parseResponse(result) {
    const response = result.response;
    let text = "";
    const toolCalls = [];

    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.text) {
          text += part.text;
        } else if (part.functionCall) {
          toolCalls.push({
            id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args || {},
          });
        }
      }
    }

    return { text, toolCalls, stopReason: response.candidates?.[0]?.finishReason };
  }

  // Build tool result for continuation
  static buildToolResultParts(toolResults) {
    return {
      role: "function",
      parts: toolResults.map((r) => ({
        functionResponse: {
          name: r.name,
          response: r.result,
        },
      })),
    };
  }
}
