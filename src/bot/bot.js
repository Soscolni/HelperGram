/**
 * Bot orchestrator — main message handling, polling loop, reminder checking.
 * Supports both native API tool calling (Anthropic/OpenAI/Gemini) and
 * the legacy <<<TOOL>>> text protocol (Claude CLI).
 */

import fs from "fs";
import path from "path";
import { createLLMProvider } from "./llm/llm.js";
import { TOOL_MAP, TOOL_SCHEMAS } from "./tools.js";
import { buildSystemPrompt } from "./system-prompt.js";
import {
  setDataDir, loadData, saveData, getStore, migrateExistingTasks,
  todayStr, nowTimeStr, loadDailyLog, saveDailyLog, addToHistory,
} from "./data.js";
import {
  setTelegramConfig, tgApi, sendTelegramMessage,
  sendTelegramMessageWithButtons, sendTyping,
} from "./telegram.js";
import { initWhisper, isWhisperInstalled, transcribeVoice } from "./whisper.js";

let provider = null;
let running = false;
let reminderInterval = null;
let botConfig = null;

// ─── Initialize ─────────────────────────────────────────────────────────────

export async function startBot(config) {
  botConfig = config;

  // Set up data directory
  setDataDir(config.dataDir);
  loadData();
  migrateExistingTasks();

  // Set up Telegram
  setTelegramConfig(config.telegram.botToken, config.telegram.chatId);

  // Set up Whisper (optional)
  initWhisper(config.dataDir);

  // Create LLM provider
  provider = await createLLMProvider(config);

  // Register bot commands
  await tgApi("setMyCommands", {
    commands: [
      { command: "tasks", description: "הצג משימות" },
      { command: "notes", description: "הצג הערות" },
      { command: "reminders", description: "הצג תזכורות" },
      { command: "summary", description: "סיכום יומי" },
      { command: "help", description: "מה אני יכול לעשות?" },
      { command: "version", description: "גרסה נוכחית" },
    ],
  });

  // Start reminder checker
  reminderInterval = setInterval(
    () => checkReminders().catch((err) => console.error("[HelperGram] Reminder error:", err.message)),
    60_000
  );
  setTimeout(() => checkReminders().catch(() => {}), 5000);

  // Start polling
  running = true;
  pollLoop();

  console.log(`[HelperGram] Bot running. Vendor: ${config.llm.vendor}, Model: ${config.llm.model}`);
}

export function stopBot() {
  running = false;
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
  saveData();
  console.log("[HelperGram] Bot stopped.");
}

// ─── Message Handling ───────────────────────────────────────────────────────

async function handleMessage(userText) {
  addToHistory("user", userText);

  const useCli = botConfig.llm.vendor === "claude-cli";
  const systemPrompt = buildSystemPrompt({ useCli });

  const messages = [{ role: "user", content: userText }];

  try {
    let response = await provider.chat(systemPrompt, messages, TOOL_SCHEMAS);

    // Tool calling loop — keep going until no more tool calls
    let maxIterations = 10;
    while (response.toolCalls.length > 0 && maxIterations-- > 0) {
      // Execute all tool calls
      const toolResults = [];
      for (const tc of response.toolCalls) {
        const fn = TOOL_MAP[tc.name];
        if (!fn) {
          console.error(`[HelperGram] Unknown tool: ${tc.name}`);
          toolResults.push({ toolCallId: tc.id, name: tc.name, result: { error: `Unknown tool: ${tc.name}` } });
          continue;
        }
        try {
          const result = await fn(tc.arguments);
          console.log(`[HelperGram] Tool ${tc.name}:`, JSON.stringify(result).slice(0, 100));
          toolResults.push({ toolCallId: tc.id, name: tc.name, result });
        } catch (err) {
          console.error(`[HelperGram] Tool ${tc.name} error:`, err.message);
          toolResults.push({ toolCallId: tc.id, name: tc.name, result: { error: err.message } });
        }
      }

      // Build continuation messages based on vendor type
      const vendor = botConfig.llm.vendor;
      let continuationMessages;

      if (vendor === "anthropic") {
        // Anthropic: assistant message with tool_use blocks, then user message with tool_result blocks
        const assistantContent = [];
        if (response.text) assistantContent.push({ type: "text", text: response.text });
        for (const tc of response.toolCalls) {
          assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
        continuationMessages = [
          ...messages,
          { role: "assistant", content: assistantContent },
          {
            role: "user",
            content: toolResults.map((r) => ({
              type: "tool_result",
              tool_use_id: r.toolCallId,
              content: JSON.stringify(r.result),
            })),
          },
        ];
      } else if (vendor === "openai") {
        // OpenAI: assistant message with tool_calls, then tool messages
        const assistantMsg = {
          role: "assistant",
          content: response.text || null,
          tool_calls: response.toolCalls.map((tc) => ({
            id: tc.id, type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
        const toolMsgs = toolResults.map((r) => ({
          role: "tool", tool_call_id: r.toolCallId, content: JSON.stringify(r.result),
        }));
        continuationMessages = [...messages, assistantMsg, ...toolMsgs];
      } else if (vendor === "gemini") {
        // Gemini: function response parts
        const assistantParts = [];
        if (response.text) assistantParts.push({ text: response.text });
        for (const tc of response.toolCalls) {
          assistantParts.push({ functionCall: { name: tc.name, args: tc.arguments } });
        }
        continuationMessages = [
          ...messages,
          { role: "model", parts: assistantParts },
          {
            role: "function",
            parts: toolResults.map((r) => ({
              functionResponse: { name: r.name, response: r.result },
            })),
          },
        ];
      } else {
        // Claude CLI: build a text-based follow-up
        const resultsText = toolResults.map((r) => `${r.name}: ${JSON.stringify(r.result)}`).join("\n");
        continuationMessages = [{
          role: "user",
          content: `The user said: "${userText}"\n\nTool results:\n${resultsText}\n\nRespond to the user in Hebrew based on these results. Be concise and friendly. Do NOT output any tool blocks.`,
        }];
      }

      response = await provider.continueWithToolResults(systemPrompt, continuationMessages, TOOL_SCHEMAS);
    }

    const reply = response.text || "(בוצע)";
    addToHistory("assistant", reply);
    return reply;
  } catch (err) {
    console.error("[HelperGram] LLM error:", err.message);
    return "שגיאה בתקשורת עם המודל. נסה שוב.";
  }
}

// ─── Reminder Checker ───────────────────────────────────────────────────────

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesFromNow(mins) {
  const d = new Date(Date.now() + mins * 60_000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function checkReminders() {
  const today = todayStr();
  const now = nowTimeStr();
  const store = getStore();
  const dailyLog = loadDailyLog(today);

  for (const reminder of store.reminders) {
    if (!reminder.active) continue;
    if (reminder.type === "once" && reminder.date !== today) continue;

    const checkin = dailyLog.checkins[reminder.id];

    if (checkin) {
      if (checkin.answered) continue;
      if (checkin.snoozed_to) {
        if (now < checkin.snoozed_to) continue;
      } else if (reminder.follow_up && reminder.follow_up_interval) {
        const lastAsk = timeToMinutes(checkin.asked_at);
        const nowMin = timeToMinutes(now);
        if (nowMin - lastAsk < reminder.follow_up_interval) continue;
      } else {
        continue;
      }
    } else {
      if (now < reminder.time) continue;
      const diff = timeToMinutes(now) - timeToMinutes(reminder.time);
      const maxWindow = reminder.follow_up
        ? Math.min(reminder.follow_up_interval || 60, 240)
        : 2;
      if (diff > maxWindow) {
        if (reminder.type === "once") { reminder.active = false; saveData(); }
        continue;
      }
    }

    console.log(`[HelperGram] Firing reminder: ${reminder.id} "${reminder.message}"`);
    try {
      await sendTyping();
      const response = await handleMessage(
        `[REMINDER] The following reminder just triggered (id: ${reminder.id}): "${reminder.message}". Check in with me about this.`
      );

      if (reminder.follow_up) {
        await sendTelegramMessageWithButtons(response, [
          { text: "כן, בוצע!", callback_data: `done_${reminder.id}` },
          { text: "עוד לא", callback_data: `notyet_${reminder.id}` },
          { text: "תזכיר בעוד שעה", callback_data: `snooze60_${reminder.id}` },
          { text: "תזכיר בעוד 30 דק׳", callback_data: `snooze30_${reminder.id}` },
        ]);
      } else {
        await sendTelegramMessage(response);
      }

      dailyLog.checkins[reminder.id] = { asked_at: now, answered: false, answer: "", snoozed_to: null };
      saveDailyLog(today, dailyLog);

      if (reminder.type === "once") { reminder.active = false; saveData(); }
    } catch (err) {
      console.error(`[HelperGram] Reminder ${reminder.id} error:`, err.message);
    }
  }
}

// ─── Polling Loop ───────────────────────────────────────────────────────────

async function pollLoop() {
  // Flush pending updates
  let offset = 0;
  try {
    const flush = await tgApi("getUpdates", { offset: -1, timeout: 0 });
    const results = flush.result || [];
    if (results.length > 0) offset = results[results.length - 1].update_id + 1;
  } catch {}

  while (running) {
    try {
      const data = await tgApi("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });

      for (const update of data.result || []) {
        offset = update.update_id + 1;

        // ── Handle button presses ──
        if (update.callback_query) {
          const cb = update.callback_query;
          if (String(cb.from.id) !== String(botConfig.telegram.chatId)) continue;
          const cbData = cb.data;
          console.log(`[HelperGram] Button: ${cbData}`);
          await tgApi("answerCallbackQuery", { callback_query_id: cb.id });

          let userText = "";
          if (cbData.startsWith("done_")) {
            userText = `[BUTTON] I pressed "כן, בוצע!" for reminder ${cbData.slice(5)}. Log as completed.`;
          } else if (cbData.startsWith("notyet_")) {
            userText = `[BUTTON] I pressed "עוד לא" for reminder ${cbData.slice(7)}.`;
          } else if (cbData.startsWith("snooze60_")) {
            userText = `[BUTTON] Snooze reminder ${cbData.slice(9)} to ${minutesFromNow(60)}.`;
          } else if (cbData.startsWith("snooze30_")) {
            userText = `[BUTTON] Snooze reminder ${cbData.slice(9)} to ${minutesFromNow(30)}.`;
          }

          if (userText) {
            await sendTyping();
            const typingInterval = setInterval(sendTyping, 4000);
            try {
              const response = await handleMessage(userText);
              clearInterval(typingInterval);
              await sendTelegramMessage(response);
            } catch (err) {
              clearInterval(typingInterval);
              await sendTelegramMessage(`שגיאה: ${err.message}`);
            }
          }
          continue;
        }

        // ── Handle text and voice messages ──
        const msg = update.message;
        if (!msg || String(msg.chat.id) !== String(botConfig.telegram.chatId)) continue;

        // Voice messages
        if (msg.voice || msg.audio) {
          const fileId = (msg.voice || msg.audio).file_id;
          console.log(`[HelperGram] Voice message received, transcribing...`);
          await sendTyping();
          const typingInterval = setInterval(sendTyping, 4000);
          try {
            const tmpDir = path.join(botConfig.dataDir, ".tmp");
            const transcription = await transcribeVoice(fileId, tmpDir);
            if (!transcription) {
              clearInterval(typingInterval);
              await sendTelegramMessage("לא הצלחתי לתמלל את ההודעה הקולית. נסה שוב.");
              continue;
            }
            console.log(`[HelperGram] Transcribed: "${transcription.slice(0, 80)}"`);
            const response = await handleMessage(transcription);
            clearInterval(typingInterval);
            await sendTelegramMessage(response);
          } catch (err) {
            clearInterval(typingInterval);
            console.error("[HelperGram] Voice error:", err.message);
            await sendTelegramMessage(`שגיאה בתמלול: ${err.message}`);
          }
          continue;
        }

        if (!msg.text) continue;

        let userText = msg.text;

        // Handle /version command
        if (userText === "/version") {
          try {
            const ver = JSON.parse(fs.readFileSync(path.join(botConfig.dataDir, "version.json"), "utf-8"));
            const updated = new Date(ver.updated_at).toLocaleString("he-IL");
            await sendTelegramMessage(`📦 *גרסה:* ${ver.version}\n📅 *עודכן:* ${updated}\n📝 *שינויים:* ${ver.changelog}`);
          } catch {
            await sendTelegramMessage("❌ לא נמצא קובץ גרסה");
          }
          continue;
        }

        // Command shortcuts
        const CMD_MAP = {
          "/tasks": "הראה לי את כל רשימות המשימות והמשימות הפתוחות שלי מכל הרשימות",
          "/notes": "הראה לי את ההערות שלי",
          "/reminders": "הראה לי את התזכורות הפעילות שלי",
          "/summary": "תן לי סיכום יומי",
          "/help": "מה אתה יכול לעשות? תפרט בקצרה.",
          "/start": "שלום! מה אתה יכול לעשות בשבילי?",
        };
        if (CMD_MAP[userText]) userText = CMD_MAP[userText];

        console.log(`[HelperGram] Received: "${userText.slice(0, 80)}"`);

        await sendTyping();
        const typingInterval = setInterval(sendTyping, 4000);

        try {
          const response = await handleMessage(userText);
          clearInterval(typingInterval);
          await sendTelegramMessage(response);
          console.log(`[HelperGram] Replied (${response.length} chars)`);
        } catch (err) {
          clearInterval(typingInterval);
          console.error("[HelperGram] Error:", err.message);
          await sendTelegramMessage(`שגיאה: ${err.message}`);
        }
      }
    } catch (err) {
      console.error("[HelperGram] Polling error:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
