/**
 * IPC handlers for the setup wizard — validation, config, bot lifecycle
 */

import { ipcMain } from "electron";
import fetch from "node-fetch";
import { loadConfig, saveConfig, getDataDir } from "./config.js";
import { setStartOnBoot } from "./startup.js";
import { LLM_VENDORS } from "../bot/llm/llm.js";

let chatIdPolling = false;
let chatIdAbort = null;

export function registerIpcHandlers({ onBotLaunch }) {

  // ─── Telegram ───────────────────────────────────────────────────────────

  ipcMain.handle("validate-telegram-token", async (_event, token) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json();
      if (!data.ok) return { success: false, error: data.description };
      return { success: true, bot: data.result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("start-chat-id-detection", async (event, token) => {
    chatIdPolling = true;

    // Flush existing updates first
    let offset = 0;
    try {
      const flush = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset: -1, timeout: 0 }),
      });
      const flushData = await flush.json();
      const results = flushData.result || [];
      if (results.length > 0) offset = results[results.length - 1].update_id + 1;
    } catch {}

    // Poll for /start message
    const poll = async () => {
      while (chatIdPolling) {
        try {
          const controller = new AbortController();
          chatIdAbort = controller;
          const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ offset, timeout: 10, allowed_updates: ["message"] }),
            signal: controller.signal,
          });
          const data = await res.json();
          for (const update of data.result || []) {
            offset = update.update_id + 1;
            const msg = update.message;
            if (msg && msg.text === "/start") {
              chatIdPolling = false;
              event.sender.send("chat-id-detected", String(msg.chat.id));
              return;
            }
          }
        } catch (err) {
          if (err.name === "AbortError") return;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    poll();
    return { started: true };
  });

  ipcMain.handle("stop-chat-id-detection", async () => {
    chatIdPolling = false;
    if (chatIdAbort) chatIdAbort.abort();
    return { stopped: true };
  });

  // ─── LLM ────────────────────────────────────────────────────────────────

  ipcMain.handle("get-llm-vendors", async () => {
    return LLM_VENDORS;
  });

  ipcMain.handle("validate-llm-key", async (_event, vendor, model, apiKey) => {
    try {
      if (vendor === "claude-cli") {
        // Test that claude CLI is accessible
        const { spawn } = await import("child_process");
        return new Promise((resolve) => {
          const proc = spawn("claude", ["--version"], { shell: true, timeout: 10_000, windowsHide: true });
          let stdout = "";
          proc.stdout.on("data", (d) => stdout += d);
          proc.on("close", (code) => {
            if (code === 0) resolve({ success: true, info: stdout.trim() });
            else resolve({ success: false, error: "Claude Code CLI not found. Install it first." });
          });
          proc.on("error", () => resolve({ success: false, error: "Claude Code CLI not found. Install it first." }));
        });
      }

      if (vendor === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model, max_tokens: 10,
            messages: [{ role: "user", content: "Hi" }],
          }),
        });
        if (res.ok) return { success: true };
        const err = await res.json();
        return { success: false, error: err.error?.message || `HTTP ${res.status}` };
      }

      if (vendor === "openai") {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model, max_tokens: 10,
            messages: [{ role: "user", content: "Hi" }],
          }),
        });
        if (res.ok) return { success: true };
        const err = await res.json();
        return { success: false, error: err.error?.message || `HTTP ${res.status}` };
      }

      if (vendor === "gemini") {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "Hi" }] }],
            }),
          }
        );
        if (res.ok) return { success: true };
        const err = await res.json();
        return { success: false, error: err.error?.message || `HTTP ${res.status}` };
      }

      return { success: false, error: "Unknown vendor" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Config ─────────────────────────────────────────────────────────────

  ipcMain.handle("save-config", async (_event, config) => {
    saveConfig(config);
    if (config.startOnBoot !== undefined) {
      setStartOnBoot(config.startOnBoot);
    }
    return { saved: true };
  });

  ipcMain.handle("load-config", async () => {
    return loadConfig();
  });

  // ─── Bot ────────────────────────────────────────────────────────────────

  ipcMain.handle("launch-bot", async () => {
    const config = loadConfig();
    config.dataDir = getDataDir();
    onBotLaunch(config);
    return { launched: true };
  });
}
