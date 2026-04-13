/**
 * Config manager — reads/writes config.json from %APPDATA%/HelperGram/
 */

import fs from "fs";
import path from "path";
import { app } from "electron";

const CONFIG_FILENAME = "config.json";

function getConfigDir() {
  return path.join(app.getPath("userData"));
}

function getConfigPath() {
  return path.join(getConfigDir(), CONFIG_FILENAME);
}

const DEFAULT_CONFIG = {
  telegram: { botToken: "", chatId: "" },
  llm: { vendor: "", model: "", apiKey: "" },
  startOnBoot: false,
  setupComplete: false,
};

export function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export function isConfigured() {
  const config = loadConfig();
  return config.setupComplete === true;
}

export function getDataDir() {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
