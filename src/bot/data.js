/**
 * Data store — JSON-based persistence for tasks, notes, reminders, history, memory, daily logs.
 * All paths are relative to a configurable dataDir.
 */

import fs from "fs";
import path from "path";

let dataDir = ".";

export function setDataDir(dir) {
  dataDir = dir;
  // Ensure subdirectories exist
  const dailyDir = path.join(dataDir, "daily");
  const tasksDir = path.join(dataDir, "tasks");
  if (!fs.existsSync(dailyDir)) fs.mkdirSync(dailyDir, { recursive: true });
  if (!fs.existsSync(tasksDir)) fs.mkdirSync(tasksDir, { recursive: true });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Main Data Store (notes, reminders) ─────────────────────────────────────

const DEFAULT_DATA = { tasks: [], notes: [], reminders: [] };

let store = { ...DEFAULT_DATA };

function dataFilePath() {
  return path.join(dataDir, "data.json");
}

export function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(dataFilePath(), "utf-8"));
    if (!data.reminders) data.reminders = [];
    store = data;
    return store;
  } catch {
    store = { ...DEFAULT_DATA };
    return store;
  }
}

export function saveData() {
  fs.writeFileSync(dataFilePath(), JSON.stringify(store, null, 2));
}

export function getStore() {
  return store;
}

// ─── Conversation History ───────────────────────────────────────────────────

const MAX_HISTORY = 20;

function historyPath() {
  return path.join(dataDir, "history.json");
}

export function loadHistory() {
  try { return JSON.parse(fs.readFileSync(historyPath(), "utf-8")); }
  catch { return []; }
}

export function saveHistory(history) {
  const trimmed = history.slice(-MAX_HISTORY);
  fs.writeFileSync(historyPath(), JSON.stringify(trimmed, null, 2));
}

export function addToHistory(role, text) {
  const history = loadHistory();
  history.push({ role, text: text.slice(0, 500), time: nowTimeStr() });
  saveHistory(history);
}

export function getHistoryContext() {
  const history = loadHistory();
  if (history.length === 0) return "none";
  return history.map((h) => `[${h.time}] ${h.role === "user" ? "אורן" : "בוט"}: ${h.text}`).join("\n");
}

// ─── Memory ─────────────────────────────────────────────────────────────────

function memoryPath() {
  return path.join(dataDir, "memory.md");
}

export function loadMemory() {
  try { return fs.readFileSync(memoryPath(), "utf-8"); } catch { return ""; }
}

export function saveMemory(content) {
  fs.writeFileSync(memoryPath(), content);
}

// ─── Daily Log ──────────────────────────────────────────────────────────────

function dailyLogPath(date) {
  return path.join(dataDir, "daily", `${date}.json`);
}

export function loadDailyLog(date) {
  try {
    return JSON.parse(fs.readFileSync(dailyLogPath(date), "utf-8"));
  } catch {
    return { date, checkins: {} };
  }
}

export function saveDailyLog(date, log) {
  fs.writeFileSync(dailyLogPath(date), JSON.stringify(log, null, 2));
}

// ─── Task Lists (file-based) ────────────────────────────────────────────────

export function sanitizeListName(name) {
  return name.trim().toLowerCase().replace(/[^a-zא-ת0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 50) || "general";
}

function tasksDir() {
  return path.join(dataDir, "tasks");
}

export function loadTaskList(slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(tasksDir(), `${slug}.json`), "utf-8"));
  } catch {
    return null;
  }
}

export function saveTaskList(slug, data) {
  fs.writeFileSync(path.join(tasksDir(), `${slug}.json`), JSON.stringify(data, null, 2));
}

export function getAllTaskLists() {
  const dir = tasksDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const lists = [];
  for (const f of files) {
    try {
      lists.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
    } catch { /* skip corrupt files */ }
  }
  lists.sort((a, b) => a.slug === "general" ? -1 : b.slug === "general" ? 1 : a.name.localeCompare(b.name));
  return lists;
}

export function findTaskAcrossLists(taskId) {
  const dir = tasksDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      const task = data.tasks.find((t) => t.id === taskId);
      if (task) return { list: data, task };
    } catch { /* skip */ }
  }
  return null;
}

export function deleteTaskListFile(slug) {
  fs.unlinkSync(path.join(tasksDir(), `${slug}.json`));
}

// Migrate legacy tasks from data.json to tasks/general.json
export function migrateExistingTasks() {
  const generalSlug = "general";
  const existing = loadTaskList(generalSlug);
  if (!existing && store.tasks && store.tasks.length > 0) {
    saveTaskList(generalSlug, {
      name: "כללי", slug: generalSlug,
      created_at: new Date().toISOString(), tasks: store.tasks,
    });
    console.log(`[HelperGram] Migrated ${store.tasks.length} tasks to tasks/general.json`);
    store.tasks = [];
    saveData();
  } else if (!existing) {
    saveTaskList(generalSlug, {
      name: "כללי", slug: generalSlug,
      created_at: new Date().toISOString(), tasks: [],
    });
  }
}
