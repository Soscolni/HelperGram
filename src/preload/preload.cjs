/**
 * Preload script — exposes IPC bridge to renderer via contextBridge
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Telegram
  validateTelegramToken: (token) => ipcRenderer.invoke("validate-telegram-token", token),
  startChatIdDetection: (token) => ipcRenderer.invoke("start-chat-id-detection", token),
  stopChatIdDetection: () => ipcRenderer.invoke("stop-chat-id-detection"),

  // LLM
  getLLMVendors: () => ipcRenderer.invoke("get-llm-vendors"),
  validateLLMKey: (vendor, model, apiKey) => ipcRenderer.invoke("validate-llm-key", vendor, model, apiKey),

  // Config
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  loadConfig: () => ipcRenderer.invoke("load-config"),

  // Bot
  launchBot: () => ipcRenderer.invoke("launch-bot"),

  // Events
  onChatIdDetected: (callback) => {
    ipcRenderer.on("chat-id-detected", (_event, chatId) => callback(chatId));
  },
  onDetectionError: (callback) => {
    ipcRenderer.on("detection-error", (_event, error) => callback(error));
  },
});
