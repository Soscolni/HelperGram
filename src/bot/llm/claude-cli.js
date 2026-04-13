/**
 * Claude Code CLI provider — uses `claude -p` command.
 * Free for Claude Code Max subscribers. Falls back to the text-based
 * <<<TOOL...TOOL>>> protocol since the CLI doesn't support native tool calling.
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export class ClaudeCliProvider {
  constructor({ model }) {
    this.model = model || "sonnet";
  }

  async chat(systemPrompt, messages, tools) {
    // Extract the last user message
    const lastMsg = messages[messages.length - 1];
    const userText = typeof lastMsg.content === "string" ? lastMsg.content : JSON.stringify(lastMsg.content);

    const response = await this._runClaude(systemPrompt, userText);
    return this._parseResponse(response);
  }

  async continueWithToolResults(systemPrompt, messages, tools) {
    // For CLI mode, we build a follow-up prompt with tool results
    const toolResultsMsg = messages[messages.length - 1];
    let followUpText;

    if (typeof toolResultsMsg.content === "string") {
      followUpText = toolResultsMsg.content;
    } else {
      // Build from structured content
      followUpText = `Tool results:\n${JSON.stringify(toolResultsMsg.content, null, 2)}\n\nRespond to the user based on these results. Do NOT output any tool blocks.`;
    }

    const response = await this._runClaude(systemPrompt, followUpText);
    return this._parseResponse(response);
  }

  async _runClaude(systemPrompt, userMessage) {
    const tmpDir = path.join(process.cwd(), ".tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const sysFile = path.join(tmpDir, "system.txt");
    fs.writeFileSync(sysFile, systemPrompt);

    const msgFile = path.join(tmpDir, "message.txt");
    fs.writeFileSync(msgFile, userMessage);

    return new Promise((resolve, reject) => {
      const pipeCmd = process.platform === "win32" ? "type" : "cat";
      const cmd = `${pipeCmd} "${msgFile}" | claude -p --system-prompt-file "${sysFile}" --model ${this.model} --no-session-persistence`;
      const proc = spawn(cmd, [], { shell: true, timeout: 120_000, windowsHide: true });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => stdout += d);
      proc.stderr.on("data", (d) => stderr += d);

      proc.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else {
          console.error(`[HelperGram] claude stderr: ${stderr}`);
          reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`));
        }
      });
      proc.on("error", reject);
    });
  }

  _parseResponse(response) {
    if (!response) return { text: "", toolCalls: [], stopReason: "end_turn" };

    // Parse <<<TOOL...TOOL>>> blocks
    const toolRegex = /<<<TOOL\n([\s\S]*?)\nTOOL>>>/g;
    let match;
    const toolCalls = [];
    while ((match = toolRegex.exec(response)) !== null) {
      try {
        const cmd = JSON.parse(match[1]);
        toolCalls.push({
          id: `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: cmd.action,
          arguments: cmd.params || {},
        });
      } catch {
        console.error("[HelperGram] Failed to parse CLI tool JSON:", match[1]);
      }
    }

    const text = response.replace(toolRegex, "").trim();
    const stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";

    return { text, toolCalls, stopReason };
  }
}
