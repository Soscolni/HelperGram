/**
 * Personal Telegram Assistant — powered by Claude Code CLI (Max subscription)
 *
 * Uses `claude -p` instead of the Anthropic API, so it runs on your
 * Claude Code Max subscription at no extra token cost.
 */

import { execFile, exec } from "child_process";
import { promisify } from "util";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// ─── Config ───────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Run claude CLI — uses spawn with stdin pipe to avoid Windows shell issues
import { spawn } from "child_process";

async function runClaude(systemPrompt, userMessage, useTools = false) {
  const tmpDir = path.join(__dirname, ".tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  const sysFile = path.join(tmpDir, "system.txt");
  fs.writeFileSync(sysFile, systemPrompt);

  // Write user message to file and use type/cat to pipe it in
  const msgFile = path.join(tmpDir, "message.txt");
  fs.writeFileSync(msgFile, userMessage);

  return new Promise((resolve, reject) => {
    // Use 'type' (Windows) to pipe file content to claude via shell
    const allowTools = useTools ? ' --allowedTools "WebSearch WebFetch"' : '';
    const cmd = `type "${msgFile}" | claude -p --system-prompt-file "${sysFile}" --model sonnet --no-session-persistence${allowTools}`;
    const proc = spawn(cmd, [], { shell: true, timeout: 120_000, windowsHide: true });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => stdout += d);
    proc.stderr.on("data", (d) => stderr += d);

    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        console.error(`[telegram-assistant] claude stderr: ${stderr}`);
        console.error(`[telegram-assistant] claude stdout: ${stdout.slice(0, 200)}`);
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`));
      }
    });
    proc.on("error", reject);
  });
}

const envFile = fs.readFileSync(path.join(__dirname, ".env"), "utf-8");
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

const DATA_FILE = path.join(__dirname, "data.json");
const DAILY_DIR = path.join(__dirname, "daily");
const TASKS_DIR = path.join(__dirname, "tasks");
const HISTORY_FILE = path.join(__dirname, "history.json");
const MAX_HISTORY = 20; // keep last 20 messages (10 exchanges)
const MEMORY_FILE = path.join(__dirname, "memory.md");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("ERROR: Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");
  process.exit(1);
}

if (!fs.existsSync(DAILY_DIR)) fs.mkdirSync(DAILY_DIR);
if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR);

// ─── Data Store ───────────────────────────────────────────────────────────────
const DEFAULT_DATA = {
  tasks: [],
  notes: [],
  reminders: [],
};

function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    if (!data.reminders) data.reminders = [];
    return data;
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

let store = loadData();

// ─── Conversation History ────────────────────────────────────────────────────
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")); }
  catch { return []; }
}

function saveHistory(history) {
  // Keep only last MAX_HISTORY messages
  const trimmed = history.slice(-MAX_HISTORY);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}

function addToHistory(role, text) {
  const history = loadHistory();
  history.push({ role, text: text.slice(0, 500), time: nowTimeStr() });
  saveHistory(history);
}

function getHistoryContext() {
  const history = loadHistory();
  if (history.length === 0) return "none";
  return history.map((h) => `[${h.time}] ${h.role === "user" ? "אורן" : "בוט"}: ${h.text}`).join("\n");
}

// ─── Daily Log ───────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dailyLogPath(date) {
  return path.join(DAILY_DIR, `${date}.json`);
}

function loadMemory() {
  try { return fs.readFileSync(MEMORY_FILE, "utf-8"); } catch { return ""; }
}

function saveMemory(content) {
  fs.writeFileSync(MEMORY_FILE, content);
}

function loadDailyLog(date) {
  try {
    return JSON.parse(fs.readFileSync(dailyLogPath(date), "utf-8"));
  } catch {
    return { date, checkins: {} };
  }
}

function saveDailyLog(date, log) {
  fs.writeFileSync(dailyLogPath(date), JSON.stringify(log, null, 2));
}

// ─── Task Lists (file-based) ─────────────────────────────────────────────────
function sanitizeListName(name) {
  return name.trim().toLowerCase().replace(/[^a-zא-ת0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 50) || "general";
}

function taskListPath(listName) {
  return path.join(TASKS_DIR, `${sanitizeListName(listName)}.json`);
}

function loadTaskList(slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, `${slug}.json`), "utf-8"));
  } catch {
    return null;
  }
}

function saveTaskList(slug, data) {
  fs.writeFileSync(path.join(TASKS_DIR, `${slug}.json`), JSON.stringify(data, null, 2));
}

function getAllTaskLists() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json"));
  const lists = [];
  for (const f of files) {
    try {
      lists.push(JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf-8")));
    } catch { /* skip corrupt files */ }
  }
  // General list first, then alphabetically
  lists.sort((a, b) => a.slug === "general" ? -1 : b.slug === "general" ? 1 : a.name.localeCompare(b.name));
  return lists;
}

function findTaskAcrossLists(taskId) {
  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf-8"));
      const task = data.tasks.find((t) => t.id === taskId);
      if (task) return { list: data, task };
    } catch { /* skip */ }
  }
  return null;
}

// Migrate existing tasks from data.json to tasks/general.json (one-time)
function migrateExistingTasks() {
  const generalSlug = "general";
  const existing = loadTaskList(generalSlug);
  if (!existing && store.tasks && store.tasks.length > 0) {
    saveTaskList(generalSlug, {
      name: "כללי",
      slug: generalSlug,
      created_at: new Date().toISOString(),
      tasks: store.tasks,
    });
    console.log(`[telegram-assistant] Migrated ${store.tasks.length} tasks to tasks/general.json`);
    store.tasks = [];
    saveData();
  } else if (!existing) {
    saveTaskList(generalSlug, {
      name: "כללי",
      slug: generalSlug,
      created_at: new Date().toISOString(),
      tasks: [],
    });
  }
}
migrateExistingTasks();

// ─── Tool Implementations ────────────────────────────────────────────────────
function addTask({ title, priority = "medium", due_date = null, notes = "", list = "general" }) {
  const slug = sanitizeListName(list);
  const taskList = loadTaskList(slug);
  if (!taskList) return { error: `Task list "${list}" not found. Create it first with create_task_list.` };
  const task = {
    id: `t_${Date.now()}`, title, priority, status: "pending",
    due_date, notes, created_at: new Date().toISOString(), completed_at: null,
  };
  taskList.tasks.push(task);
  saveTaskList(slug, taskList);
  return { ...task, list: taskList.name };
}

function listTasks({ status = "pending", priority = null, list = null } = {}) {
  const lists = list ? [loadTaskList(sanitizeListName(list))].filter(Boolean) : getAllTaskLists();
  const prioOrder = { high: 0, medium: 1, low: 2 };
  const today = todayStr();
  const result = [];
  for (const taskList of lists) {
    let tasks = taskList.tasks;
    if (status !== "all") tasks = tasks.filter((t) => t.status === status);
    if (priority) tasks = tasks.filter((t) => t.priority === priority);
    tasks.sort((a, b) => {
      const aO = a.due_date && a.due_date < today ? -1 : 0;
      const bO = b.due_date && b.due_date < today ? -1 : 0;
      if (aO !== bO) return aO - bO;
      if (prioOrder[a.priority] !== prioOrder[b.priority]) return prioOrder[a.priority] - prioOrder[b.priority];
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      return a.due_date ? -1 : b.due_date ? 1 : 0;
    });
    result.push({ list_name: taskList.name, slug: taskList.slug, tasks });
  }
  return result;
}

function updateTask({ id, ...fields }) {
  const found = findTaskAcrossLists(id);
  if (!found) return { error: `Task ${id} not found` };
  Object.assign(found.task, fields);
  saveTaskList(found.list.slug, found.list);
  return { ...found.task, list: found.list.name };
}

function completeTask({ id }) {
  const found = findTaskAcrossLists(id);
  if (!found) return { error: `Task ${id} not found` };
  found.task.status = "completed";
  found.task.completed_at = new Date().toISOString();
  saveTaskList(found.list.slug, found.list);
  return { completed: true, title: found.task.title, list: found.list.name };
}

function deleteTask({ id }) {
  const found = findTaskAcrossLists(id);
  if (!found) return { deleted: false };
  found.list.tasks = found.list.tasks.filter((t) => t.id !== id);
  saveTaskList(found.list.slug, found.list);
  return { deleted: true, list: found.list.name };
}

function createTaskList({ name }) {
  const slug = sanitizeListName(name);
  if (loadTaskList(slug)) return { error: `Task list "${name}" already exists` };
  const data = { name, slug, created_at: new Date().toISOString(), tasks: [] };
  saveTaskList(slug, data);
  return data;
}

function deleteTaskList({ name }) {
  const slug = sanitizeListName(name);
  if (slug === "general") return { error: "Cannot delete the general task list" };
  const taskList = loadTaskList(slug);
  if (!taskList) return { error: `Task list "${name}" not found` };
  const pending = taskList.tasks.filter((t) => t.status === "pending");
  if (pending.length > 0) return { error: `Cannot delete "${taskList.name}" — it has ${pending.length} pending tasks. Complete or move them first.` };
  fs.unlinkSync(path.join(TASKS_DIR, `${slug}.json`));
  return { deleted: true, name: taskList.name };
}

function listTaskLists() {
  const lists = getAllTaskLists();
  return lists.map((l) => ({
    name: l.name, slug: l.slug,
    total: l.tasks.length,
    pending: l.tasks.filter((t) => t.status === "pending").length,
    completed: l.tasks.filter((t) => t.status === "completed").length,
  }));
}

function migrateTask({ task_id, target_list }) {
  const found = findTaskAcrossLists(task_id);
  if (!found) return { error: `Task ${task_id} not found` };
  const targetSlug = sanitizeListName(target_list);
  const targetData = loadTaskList(targetSlug);
  if (!targetData) return { error: `Target list "${target_list}" not found` };
  if (found.list.slug === targetSlug) return { error: "Task is already in that list" };
  // Remove from source
  found.list.tasks = found.list.tasks.filter((t) => t.id !== task_id);
  saveTaskList(found.list.slug, found.list);
  // Add to target
  targetData.tasks.push(found.task);
  saveTaskList(targetSlug, targetData);
  return { migrated: true, task: found.task.title, from: found.list.name, to: targetData.name };
}

function addNote({ content, tags = [], title = "" }) {
  const note = {
    id: `n_${Date.now()}`, title, content, tags,
    created_at: new Date().toISOString(),
  };
  store.notes.push(note);
  saveData();
  return note;
}

function listNotes({ tag = null, search = null } = {}) {
  let notes = store.notes;
  if (tag) notes = notes.filter((n) => n.tags.includes(tag));
  if (search) {
    const q = search.toLowerCase();
    notes = notes.filter((n) => n.content.toLowerCase().includes(q) || n.title.toLowerCase().includes(q));
  }
  return notes;
}

function deleteNote({ id }) {
  const before = store.notes.length;
  store.notes = store.notes.filter((n) => n.id !== id);
  saveData();
  return { deleted: store.notes.length < before };
}

function addReminder({ message, time, type = "once", date = null, follow_up = false, follow_up_interval = null }) {
  const reminder = {
    id: `r_${Date.now()}`, message, time, type,
    date: type === "once" ? (date || todayStr()) : null,
    active: true, follow_up, follow_up_interval,
  };
  store.reminders.push(reminder);
  saveData();
  return reminder;
}

function listReminders({ active_only = true } = {}) {
  let reminders = store.reminders;
  if (active_only) reminders = reminders.filter((r) => r.active);
  const dailyLog = loadDailyLog(todayStr());
  return reminders.map((r) => ({ ...r, today_status: dailyLog.checkins[r.id] || null }));
}

function deleteReminder({ id }) {
  const before = store.reminders.length;
  store.reminders = store.reminders.filter((r) => r.id !== id);
  saveData();
  return { deleted: store.reminders.length < before };
}

function logDailyCheckin({ reminder_id, answered, answer = "", snoozed_to = null }) {
  const today = todayStr();
  const log = loadDailyLog(today);
  log.checkins[reminder_id] = { asked_at: nowTimeStr(), answered, answer, snoozed_to };
  saveDailyLog(today, log);
  return { logged: true, reminder_id, date: today };
}

function getDailySummary() {
  const today = todayStr();
  const allLists = getAllTaskLists();
  const allTasks = allLists.flatMap((l) => l.tasks.map((t) => ({ ...t, _list: l.name })));
  const pending = allTasks.filter((t) => t.status === "pending");
  const overdue = pending.filter((t) => t.due_date && t.due_date < today);
  const dueToday = pending.filter((t) => t.due_date === today);
  const completedToday = allTasks.filter((t) => t.completed_at && t.completed_at.slice(0, 10) === today);
  const recentNotes = [...store.notes].reverse().slice(0, 5);
  const activeReminders = store.reminders.filter((r) => r.active);
  const dailyLog = loadDailyLog(today);
  return {
    date: today, current_time: nowTimeStr(), pending_count: pending.length,
    overdue_tasks: overdue, due_today: dueToday, completed_today: completedToday,
    recent_notes: recentNotes, all_pending: pending,
    active_reminders: activeReminders, daily_checkins: dailyLog.checkins,
    task_lists: allLists.map((l) => ({ name: l.name, slug: l.slug, pending: l.tasks.filter((t) => t.status === "pending").length })),
  };
}

async function webSearch({ query }) {
  try {
    // Use DuckDuckGo HTML search
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
    });
    const html = await res.text();

    const results = [];

    // Extract titles and links
    const linkRegex = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const titles = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let link = match[1];
      // Extract actual URL from DDG redirect
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) link = decodeURIComponent(uddg[1]);
      titles.push({ title: match[2].replace(/<[^>]+>/g, "").trim(), link });
    }

    // Extract snippets
    const snipRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)>/g;
    const snippets = [];
    while ((match = snipRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
    }

    // Combine titles and snippets
    for (let i = 0; i < Math.min(titles.length, 5); i++) {
      results.push({
        title: titles[i].title,
        link: titles[i].link,
        snippet: snippets[i] || "",
      });
    }

    if (results.length === 0) {
      return { query, results: [], note: "No results found" };
    }
    return { query, results };
  } catch (err) {
    return { query, error: err.message };
  }
}

async function fetchUrl({ url }) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramBot/1.0)" },
      timeout: 10000,
    });
    const text = await res.text();
    // Strip HTML tags and return first 2000 chars
    const clean = text.replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);
    return { url, content: clean };
  } catch (err) {
    return { url, error: err.message };
  }
}

function updateMemory({ section, content, mode = "append" }) {
  let memory = loadMemory();
  const sectionHeader = `## ${section}`;
  const idx = memory.indexOf(sectionHeader);

  if (idx === -1) {
    // Section doesn't exist — add it
    memory = memory.trimEnd() + `\n\n${sectionHeader}\n${content}\n`;
  } else {
    // Find the end of this section (next ## or end of file)
    const afterHeader = idx + sectionHeader.length;
    const nextSection = memory.indexOf("\n## ", afterHeader);
    const sectionEnd = nextSection === -1 ? memory.length : nextSection;

    if (mode === "replace") {
      memory = memory.slice(0, afterHeader) + `\n${content}\n` + memory.slice(sectionEnd);
    } else {
      // Append before next section
      const existing = memory.slice(afterHeader, sectionEnd);
      memory = memory.slice(0, afterHeader) + existing.trimEnd() + `\n- ${content}\n` + memory.slice(sectionEnd);
    }
  }

  saveMemory(memory);
  return { saved: true, section };
}

const TOOL_MAP = {
  add_task: addTask, list_tasks: listTasks, update_task: updateTask,
  complete_task: completeTask, delete_task: deleteTask,
  create_task_list: createTaskList, delete_task_list: deleteTaskList,
  list_task_lists: listTaskLists, migrate_task: migrateTask,
  add_note: addNote, list_notes: listNotes, delete_note: deleteNote,
  add_reminder: addReminder, list_reminders: listReminders,
  delete_reminder: deleteReminder, log_daily_checkin: logDailyCheckin,
  get_daily_summary: getDailySummary, update_memory: updateMemory,
  web_search: webSearch, fetch_url: fetchUrl,
};

// ─── Build System Prompt ─────────────────────────────────────────────────────
function buildSystemPrompt() {
  const today = todayStr();
  const now = nowTimeStr();
  const allLists = getAllTaskLists();
  const allPending = allLists.flatMap((l) => l.tasks.filter((t) => t.status === "pending").map((t) => ({ ...t, _list: l.name })));
  const overdue = allPending.filter((t) => t.due_date && t.due_date < today);
  const activeReminders = store.reminders.filter((r) => r.active);
  const dailyLog = loadDailyLog(today);

  let reminderSection = "none";
  if (activeReminders.length > 0) {
    reminderSection = activeReminders.map((r) => {
      const checkin = dailyLog.checkins[r.id];
      const status = checkin
        ? checkin.answered ? `answered: "${checkin.answer}"` : checkin.snoozed_to ? `snoozed to ${checkin.snoozed_to}` : "asked, awaiting answer"
        : "not yet triggered today";
      return `  - [${r.id}] "${r.message}" at ${r.time} (${r.type}${r.follow_up ? ", follow-up" : ""}) — today: ${status}`;
    }).join("\n");
  }

  // Current data snapshot for context — tasks grouped by list
  let tasksSummary = "";
  for (const tl of allLists) {
    const pending = tl.tasks.filter((t) => t.status === "pending");
    if (pending.length > 0) {
      tasksSummary += `\n  [${tl.name}] (slug: "${tl.slug}"):\n`;
      tasksSummary += pending.map((t) => `    - [${t.id}] "${t.title}" (${t.priority}${t.due_date ? `, due ${t.due_date}` : ""})`).join("\n");
    }
  }
  if (!tasksSummary) tasksSummary = "  none";

  const notesSummary = store.notes.length > 0
    ? store.notes.slice(-5).map((n) => `  - [${n.id}] "${n.title || n.content.slice(0, 40)}"`).join("\n")
    : "  none";

  const listsSummary = allLists.map((l) => `  - "${l.name}" (slug: "${l.slug}", ${l.tasks.filter((t) => t.status === "pending").length} pending)`).join("\n");

  return `You are Oren's personal assistant on Telegram. You help manage tasks, capture ideas, plan the day, and handle reminders.

IMPORTANT: Always respond in Hebrew. All your messages to the user must be in Hebrew.

CURRENT DATE: ${today}
CURRENT TIME: ${now} (24-hour clock, Israel timezone)
NOTE: All times use 24-hour format. 09:00 is morning, 21:00 is evening. Do NOT fire or confuse morning reminders at night.

You have access to tools via JSON commands. When you need to perform an action, output a JSON command block BEFORE your message, like this:

<<<TOOL
{"action": "add_task", "params": {"title": "Buy groceries", "priority": "high", "due_date": "2026-04-12", "list": "general"}}
TOOL>>>

You can output multiple tool blocks. Available actions and their parameters:

TASK MANAGEMENT:
- add_task: {title, priority?("high"|"medium"|"low"), due_date?("YYYY-MM-DD"), notes?, list?("general" by default — use slug name of the target list)}
- list_tasks: {status?("pending"|"completed"|"all"), priority?, list?(slug name of specific list, or omit for ALL lists)}
- update_task: {id, title?, priority?, due_date?, notes?, status?}
- complete_task: {id}
- delete_task: {id}

TASK LISTS:
- create_task_list: {name} — create a new named task list (e.g., "מעבר דירה", "ארוחת ערב")
- delete_task_list: {name} — delete a task list (only works if no pending tasks remain; use slug name)
- list_task_lists: {} — show all task lists with task counts
- migrate_task: {task_id, target_list} — move a task from its current list to another (use slug name for target_list)

NOTES:
- add_note: {content, title?, tags?[]}
- list_notes: {tag?, search?}
- delete_note: {id}

REMINDERS:
- add_reminder: {message, time("HH:MM"), type?("once"|"daily"), date?("YYYY-MM-DD"), follow_up?(bool), follow_up_interval?(minutes)}
- list_reminders: {active_only?(bool)}
- delete_reminder: {id}
- log_daily_checkin: {reminder_id, answered(bool), answer?, snoozed_to?("HH:MM")}

SUMMARY:
- get_daily_summary: {}

WEB:
- web_search: {query} — search the web via DuckDuckGo, returns top 5 results with titles, snippets, and links
- fetch_url: {url} — fetch and read the content of a webpage (returns plain text, first 2000 chars)

MEMORY:
- update_memory: {section("About Oren"|"Preferences"|"Important Dates"|"People"|"Health & Habits"|"Work"|"Ideas & Projects"|"Misc"), content(string), mode?("append"|"replace")}

BEHAVIOR:
- When the user mentions something to do, use add_task immediately (use the appropriate list, default to "general")
- When the user shares an idea, use add_note
- For "בוקר טוב" or greetings, use get_daily_summary
- For recurring things (medication, exercise), use add_reminder with type="daily" and follow_up=true
- When user confirms a reminder (e.g. "כן לקחתי"), use log_daily_checkin with answered=true
- When user says "עוד לא" or "later", use log_daily_checkin with snoozed_to
- When a [REMINDER] fires, respond naturally as if checking in
- Keep responses SHORT and friendly — this is Telegram
- When the user asks about current/real-time info (weather, times, news, prices, events), ALWAYS use web_search first — do NOT guess or use your training data. You have internet access, use it!
- NEVER show internal IDs (like r_1775933008307 or t_1234567) to the user — they are for internal use only. Use human-readable descriptions instead (e.g. "תזכורת לקנות חלב" not "r_1775933008307")
- When the user asks to see tasks (/tasks), show ALL lists with their pending tasks grouped by list name
- When a topic-specific task comes up and a relevant list exists, add it there; if the user mentions a new category, suggest creating a list
- When all tasks in a specific list are completed, suggest deleting the list
- When the user wants to reorganize tasks, use migrate_task to move tasks between lists

MEMORY BEHAVIOR:
- PROACTIVELY save things you learn about Oren to memory using update_memory — don't ask, just save
- Save personal details (birthday, family, pets, allergies, preferences, habits, etc.)
- Save info about people Oren mentions (boss's name, friends, family members)
- Save work-related context (projects, deadlines, company info)
- Save preferences (food, schedule, communication style)
- Save health info (medications, conditions, exercise routines)
- If user explicitly says "תזכור ש..." or "remember that...", always save to memory
- You can create new sections if needed by using a new section name

CURRENT STATE:
Task lists:
${listsSummary}

Pending tasks by list (${allPending.length} total):
${tasksSummary}

Recent notes (${store.notes.length} total):
${notesSummary}

Active reminders:
${reminderSection}

Overdue: ${overdue.length > 0 ? overdue.map((t) => `"${t.title}" (due ${t.due_date}, list: ${t._list})`).join(", ") : "none"}

YOUR MEMORY (things you know about Oren):
${loadMemory()}

RECENT CONVERSATION (last messages for context):
${getHistoryContext()}`;
}

// ─── Claude CLI Engine ───────────────────────────────────────────────────────
async function handleMessage(userText) {
  // Save user message to history
  addToHistory("user", userText);

  const systemPrompt = buildSystemPrompt();

  // Detect if user wants a web search — give Claude access to WebSearch tool
  const wantsSearch = /חפש|תחפש|חיפוש|search/i.test(userText);
  if (wantsSearch) console.log(`[telegram-assistant] Enabling web search tools`);

  let response;
  try {
    response = await runClaude(systemPrompt, userText, wantsSearch);
  } catch (err) {
    console.error("[telegram-assistant] Claude CLI error:", err.message);
    return "שגיאה בתקשורת עם Claude. נסה שוב.";
  }

  if (!response) return "(אין תגובה)";

  // Debug: log raw response to see if tool blocks are present
  console.log(`[telegram-assistant] Raw response (first 300): ${response.slice(0, 300)}`);

  // Parse and execute tool blocks
  const toolRegex = /<<<TOOL\n([\s\S]*?)\nTOOL>>>/g;
  let match;
  const toolCalls = [];
  while ((match = toolRegex.exec(response)) !== null) {
    try {
      const cmd = JSON.parse(match[1]);
      toolCalls.push(cmd);
    } catch {
      console.error("[telegram-assistant] Failed to parse tool JSON:", match[1]);
    }
  }

  // Execute tool calls (some may be async like web_search)
  for (const cmd of toolCalls) {
    const fn = TOOL_MAP[cmd.action];
    if (fn) {
      try {
        const result = await fn(cmd.params || {});
        console.log(`[telegram-assistant] Tool ${cmd.action}:`, JSON.stringify(result).slice(0, 100));
      } catch (err) {
        console.error(`[telegram-assistant] Tool ${cmd.action} error:`, err.message);
      }
    }
  }

  // If there were tool calls that need data returned to Claude (like list/summary),
  // and the response doesn't have useful text beyond the tool blocks, call Claude again
  const textOnly = response.replace(toolRegex, "").trim();

  const needsFollowUp = toolCalls.some((c) =>
    ["list_tasks", "list_notes", "list_reminders", "get_daily_summary", "web_search", "fetch_url", "list_task_lists"].includes(c.action)
  );

  if (needsFollowUp && textOnly.length < 20) {
    // Call Claude again with the tool results
    const results = [];
    for (const cmd of toolCalls) {
      const fn = TOOL_MAP[cmd.action];
      if (!fn) continue;
      try { results.push({ action: cmd.action, result: await fn(cmd.params || {}) }); }
      catch { /* skip */ }
    }

    const followUpPrompt = `The user said: "${userText}"

I executed these tools and got these results:
${JSON.stringify(results, null, 2)}

Now respond to the user in Hebrew based on these results. Be concise and friendly. Do NOT output any tool blocks.`;

    try {
      const followUpResult = await runClaude(buildSystemPrompt(), followUpPrompt);
      const reply = followUpResult || textOnly || "(אין תגובה)";
      addToHistory("assistant", reply);
      return reply;
    } catch {
      const reply = textOnly || "(אין תגובה)";
      addToHistory("assistant", reply);
      return reply;
    }
  }

  const reply = textOnly || "(בוצע)";
  addToHistory("assistant", reply);
  return reply;
}

// ─── Voice Transcription (Whisper) ──────────────────────────────────────────
const WHISPER_DIR = path.join(__dirname, "whisper");
const WHISPER_MODEL = path.join(WHISPER_DIR, "ggml-base.bin");
const WHISPER_EXE = fs.existsSync(path.join(WHISPER_DIR, "whisper-cli.exe"))
  ? path.join(WHISPER_DIR, "whisper-cli.exe")
  : path.join(WHISPER_DIR, "main.exe");

function isWhisperInstalled() {
  return fs.existsSync(WHISPER_EXE) && fs.existsSync(WHISPER_MODEL);
}

async function transcribeVoice(fileId) {
  if (!isWhisperInstalled()) {
    console.error("[telegram-assistant] Whisper not installed. Run: node setup-whisper.js");
    return null;
  }

  const tmpDir = path.join(__dirname, ".tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  // 1. Get file path from Telegram
  const fileInfo = await tgApi("getFile", { file_id: fileId });
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

  // 2. Download the ogg file
  const oggFile = path.join(tmpDir, `voice_${Date.now()}.ogg`);
  const wavFile = oggFile.replace(".ogg", ".wav");

  const res = await fetch(fileUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(oggFile, buffer);

  // 3. Convert ogg to wav using ffmpeg
  try {
    await new Promise((resolve, reject) => {
      // Use local ffmpeg if available, otherwise system ffmpeg
    const ffmpegPath = fs.existsSync(path.join(WHISPER_DIR, "ffmpeg.exe"))
      ? `"${path.join(WHISPER_DIR, "ffmpeg.exe")}"`
      : "ffmpeg";
    const proc = spawn(ffmpegPath, ["-i", oggFile, "-ar", "16000", "-ac", "1", "-y", wavFile], { shell: true, windowsHide: true });
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
      proc.on("error", reject);
    });
  } catch (err) {
    console.error("[telegram-assistant] ffmpeg error:", err.message);
    // Cleanup
    try { fs.unlinkSync(oggFile); } catch {}
    return null;
  }

  // 4. Run whisper
  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(`"${WHISPER_EXE}"`, ["-m", `"${WHISPER_MODEL}"`, "-f", `"${wavFile}"`, "-l", "he", "--no-timestamps", "-nt"], { shell: true, timeout: 60_000, windowsHide: true });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => stdout += d);
      proc.stderr.on("data", (d) => stderr += d);
      proc.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`whisper exited ${code}: ${stderr.slice(0, 200)}`));
      });
      proc.on("error", reject);
    });

    // Cleanup temp files
    try { fs.unlinkSync(oggFile); fs.unlinkSync(wavFile); } catch {}

    return result || null;
  } catch (err) {
    console.error("[telegram-assistant] Whisper error:", err.message);
    try { fs.unlinkSync(oggFile); fs.unlinkSync(wavFile); } catch {}
    return null;
  }
}

// ─── Telegram Interface ──────────────────────────────────────────────────────
async function tgApi(method, body = {}) {
  const res = await fetch(`${TG}/${method}`, {
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

async function sendTelegramMessage(text) {
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
      await tgApi("sendMessage", { chat_id: CHAT_ID, text: chunk, parse_mode: "Markdown" });
    } catch {
      await tgApi("sendMessage", { chat_id: CHAT_ID, text: chunk });
    }
  }
}

async function sendTelegramMessageWithButtons(text, buttons) {
  const keyboard = { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.callback_data }))] };
  try {
    await tgApi("sendMessage", { chat_id: CHAT_ID, text, parse_mode: "Markdown", reply_markup: keyboard });
  } catch {
    await tgApi("sendMessage", { chat_id: CHAT_ID, text, reply_markup: keyboard });
  }
}

async function sendTyping() {
  try { await tgApi("sendChatAction", { chat_id: CHAT_ID, action: "typing" }); } catch {}
}

// ─── Reminder Timer ─────────────────────────────────────────────────────────
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
      // Don't fire if we missed the window by too much
      // For follow-up reminders: allow up to follow_up_interval or 4 hours max
      // For regular reminders: allow up to 2 minutes
      const maxWindow = reminder.follow_up
        ? Math.min(reminder.follow_up_interval || 60, 240)
        : 2;
      if (diff > maxWindow) {
        if (reminder.type === "once") { reminder.active = false; saveData(); }
        continue;
      }
    }

    console.log(`[telegram-assistant] Firing reminder: ${reminder.id} "${reminder.message}"`);
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
      console.error(`[telegram-assistant] Reminder ${reminder.id} error:`, err.message);
    }
  }
}

// ─── Main Loop ───────────────────────────────────────────────────────────────
async function main() {
  console.log("[telegram-assistant] Starting up (Claude CLI mode)...");

  // Register bot commands
  await tgApi("setMyCommands", {
    commands: [
      { command: "tasks", description: "הצג משימות" },
      { command: "notes", description: "הצג הערות" },
      { command: "reminders", description: "הצג תזכורות" },
      { command: "summary", description: "סיכום יומי" },
      { command: "help", description: "מה אני יכול לעשות?" },
      { command: "version", description: "גרסה נוכחית" },
      { command: "update", description: "עדכון מ-GitHub והפעלה מחדש" },
    ],
  });

  // Flush pending updates
  let offset = 0;
  try {
    const flush = await tgApi("getUpdates", { offset: -1, timeout: 0 });
    const results = flush.result || [];
    if (results.length > 0) offset = results[results.length - 1].update_id + 1;
  } catch {}

  console.log(`[telegram-assistant] Bot running. Listening for messages from chat ${CHAT_ID}...`);

  // Reminder checker — every 60s
  setInterval(() => checkReminders().catch((err) => console.error("[telegram-assistant] Reminder error:", err.message)), 60_000);
  setTimeout(() => checkReminders().catch(() => {}), 5000);

  while (true) {
    try {
      const data = await tgApi("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });

      for (const update of data.result || []) {
        offset = update.update_id + 1;

        // ── Handle button presses ──
        if (update.callback_query) {
          const cb = update.callback_query;
          if (String(cb.from.id) !== String(CHAT_ID)) continue;
          const cbData = cb.data;
          console.log(`[telegram-assistant] Button: ${cbData}`);
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
        if (!msg || String(msg.chat.id) !== String(CHAT_ID)) continue;

        // Handle voice notes
        if (msg.voice || msg.audio) {
          const fileId = (msg.voice || msg.audio).file_id;
          console.log(`[telegram-assistant] Voice message received, transcribing...`);
          await sendTyping();
          const typingInterval = setInterval(sendTyping, 4000);
          try {
            const transcription = await transcribeVoice(fileId);
            if (!transcription) {
              clearInterval(typingInterval);
              await sendTelegramMessage("לא הצלחתי לתמלל את ההודעה הקולית. נסה שוב.");
              continue;
            }
            console.log(`[telegram-assistant] Transcribed: "${transcription.slice(0, 80)}"`);
            const response = await handleMessage(transcription);
            clearInterval(typingInterval);
            await sendTelegramMessage(response);
            console.log(`[telegram-assistant] Replied (${response.length} chars)`);
          } catch (err) {
            clearInterval(typingInterval);
            console.error("[telegram-assistant] Voice error:", err.message);
            await sendTelegramMessage(`שגיאה בתמלול: ${err.message}`);
          }
          continue;
        }

        if (!msg.text) continue;

        let userText = msg.text;

        // Handle /version command
        if (userText === "/version") {
          try {
            const ver = JSON.parse(fs.readFileSync(path.join(__dirname, "version.json"), "utf-8"));
            const updated = new Date(ver.updated_at).toLocaleString("he-IL");
            await sendTelegramMessage(`📦 *גרסה:* ${ver.version}\n📅 *עודכן:* ${updated}\n📝 *שינויים:* ${ver.changelog}`);
          } catch {
            await sendTelegramMessage("❌ לא נמצא קובץ גרסה");
          }
          continue;
        }

        // Handle /update command — git pull and restart
        if (userText === "/update") {
          console.log("[telegram-assistant] Update requested!");
          await sendTelegramMessage("🔄 מעדכן מ-GitHub...");
          try {
            const { stdout, stderr } = await new Promise((resolve, reject) => {
              const proc = spawn("git pull", [], { cwd: __dirname, shell: true, windowsHide: true });
              let stdout = "", stderr = "";
              proc.stdout.on("data", (d) => stdout += d);
              proc.stderr.on("data", (d) => stderr += d);
              proc.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || stdout)));
              proc.on("error", reject);
            });
            const output = stdout.trim();
            if (output.includes("Already up to date")) {
              await sendTelegramMessage("✅ כבר מעודכן, אין שינויים.");
            } else {
              await sendTelegramMessage(`✅ עודכן!\n\n${output.slice(0, 500)}\n\n🔄 מאתחל...`);
              // Write restart flag and exit — launcher.js will restart us
              fs.writeFileSync(path.join(__dirname, ".restart"), "1");
              process.exit(0);
            }
          } catch (err) {
            await sendTelegramMessage(`❌ שגיאה בעדכון: ${err.message}`);
          }
          continue;
        }

        const CMD_MAP = {
          "/tasks": "הראה לי את כל רשימות המשימות והמשימות הפתוחות שלי מכל הרשימות",
          "/notes": "הראה לי את ההערות שלי",
          "/reminders": "הראה לי את התזכורות הפעילות שלי",
          "/summary": "תן לי סיכום יומי",
          "/help": "מה אתה יכול לעשות? תפרט בקצרה.",
          "/start": "שלום! מה אתה יכול לעשות בשבילי?",
        };
        if (CMD_MAP[userText]) userText = CMD_MAP[userText];

        console.log(`[telegram-assistant] Received: "${userText.slice(0, 80)}"`);

        await sendTyping();
        const typingInterval = setInterval(sendTyping, 4000);

        try {
          const response = await handleMessage(userText);
          clearInterval(typingInterval);
          await sendTelegramMessage(response);
          console.log(`[telegram-assistant] Replied (${response.length} chars)`);
        } catch (err) {
          clearInterval(typingInterval);
          console.error("[telegram-assistant] Error:", err.message);
          await sendTelegramMessage(`שגיאה: ${err.message}`);
        }
      }
    } catch (err) {
      console.error("[telegram-assistant] Polling error:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
process.on("SIGINT", () => { console.log("\n[telegram-assistant] Shutting down..."); saveData(); process.exit(0); });
process.on("SIGTERM", () => { saveData(); process.exit(0); });

main().catch((err) => { console.error("[telegram-assistant] Fatal:", err); process.exit(1); });
