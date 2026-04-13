/**
 * Electron main process — app lifecycle, window management, bot control
 */

import { app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, isConfigured, getDataDir } from "./config.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { createTray, destroyTray } from "./tray.js";
import { startBot, stopBot } from "../bot/bot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let botRunning = false;

function createSetupWindow() {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 680,
    resizable: false,
    frame: true,
    title: "HelperGram Setup",
    icon: path.join(__dirname, "../../assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on("closed", () => {
    mainWindow = null;
    // If bot isn't running and window is closed, quit
    if (!botRunning) app.quit();
  });
}

function openSettingsWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }
  createSetupWindow();
}

async function launchBot(config) {
  try {
    await startBot(config);
    botRunning = true;

    // Create system tray
    createTray({
      onSettings: openSettingsWindow,
      onQuit: () => {
        stopBot();
        destroyTray();
        app.quit();
      },
    });

    // Close setup window
    if (mainWindow) {
      mainWindow.close();
      mainWindow = null;
    }

    console.log("[HelperGram] Bot launched successfully.");
  } catch (err) {
    console.error("[HelperGram] Failed to launch bot:", err);
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Register IPC handlers
  registerIpcHandlers({ onBotLaunch: launchBot });

  if (isConfigured()) {
    // Already set up — launch bot directly
    const config = loadConfig();
    config.dataDir = getDataDir();
    launchBot(config);
  } else {
    // Show setup wizard
    createSetupWindow();
  }
});

// Keep app running when all windows are closed (for tray mode)
app.on("window-all-closed", (e) => {
  if (botRunning) {
    // Don't quit — bot runs in background with tray
  } else {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (botRunning) stopBot();
});

app.on("activate", () => {
  if (!mainWindow && !botRunning) {
    createSetupWindow();
  }
});
