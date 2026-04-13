/**
 * Telegram Bot API helpers
 */

import fetch from "node-fetch";

let botToken = "";
let chatId = "";

export function setTelegramConfig(token, chat) {
  botToken = token;
  chatId = chat;
}

export function getTelegramConfig() {
  return { botToken, chatId };
}

export async function tgApi(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram ${method} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function sendTelegramMessage(text) {
  const chunks = [];
  if (text.length <= 4096) {
    chunks.push(text);
  } else {
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= 4096) { chunks.push(remaining); break; }
      let split = remaining.lastIndexOf("\n\n", 4096);
      if (split < 500) split = remaining.lastIndexOf("\n", 4096);
      if (split < 500) split = 4096;
      chunks.push(remaining.slice(0, split));
      remaining = remaining.slice(split).trimStart();
    }
  }
  for (const chunk of chunks) {
    try {
      await tgApi("sendMessage", { chat_id: chatId, text: chunk, parse_mode: "Markdown" });
    } catch {
      await tgApi("sendMessage", { chat_id: chatId, text: chunk });
    }
  }
}

export async function sendTelegramMessageWithButtons(text, buttons) {
  const keyboard = { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.callback_data }))] };
  try {
    await tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "Markdown", reply_markup: keyboard });
  } catch {
    await tgApi("sendMessage", { chat_id: chatId, text, reply_markup: keyboard });
  }
}

export async function sendTyping() {
  try { await tgApi("sendChatAction", { chat_id: chatId, action: "typing" }); } catch {}
}
