/**
 * Tool implementations and vendor-neutral schema definitions.
 * Extracted from index.js — all 18 tools plus web search.
 */

import fetch from "node-fetch";
import {
  todayStr, nowTimeStr, getStore, saveData,
  sanitizeListName, loadTaskList, saveTaskList, getAllTaskLists,
  findTaskAcrossLists, deleteTaskListFile,
  loadDailyLog, saveDailyLog, loadMemory, saveMemory,
} from "./data.js";

// ─── Tool Implementations ───────────────────────────────────────────────────

export function addTask({ title, priority = "medium", due_date = null, notes = "", list = "general" }) {
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

export function listTasks({ status = "pending", priority = null, list = null } = {}) {
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

export function updateTask({ id, ...fields }) {
  const found = findTaskAcrossLists(id);
  if (!found) return { error: `Task ${id} not found` };
  Object.assign(found.task, fields);
  saveTaskList(found.list.slug, found.list);
  return { ...found.task, list: found.list.name };
}

export function completeTask({ id }) {
  const found = findTaskAcrossLists(id);
  if (!found) return { error: `Task ${id} not found` };
  found.task.status = "completed";
  found.task.completed_at = new Date().toISOString();
  saveTaskList(found.list.slug, found.list);
  return { completed: true, title: found.task.title, list: found.list.name };
}

export function deleteTask({ id }) {
  const found = findTaskAcrossLists(id);
  if (!found) return { deleted: false };
  found.list.tasks = found.list.tasks.filter((t) => t.id !== id);
  saveTaskList(found.list.slug, found.list);
  return { deleted: true, list: found.list.name };
}

export function createTaskList({ name }) {
  const slug = sanitizeListName(name);
  if (loadTaskList(slug)) return { error: `Task list "${name}" already exists` };
  const data = { name, slug, created_at: new Date().toISOString(), tasks: [] };
  saveTaskList(slug, data);
  return data;
}

export function deleteTaskList({ name }) {
  const slug = sanitizeListName(name);
  if (slug === "general") return { error: "Cannot delete the general task list" };
  const taskList = loadTaskList(slug);
  if (!taskList) return { error: `Task list "${name}" not found` };
  const pending = taskList.tasks.filter((t) => t.status === "pending");
  if (pending.length > 0) return { error: `Cannot delete "${taskList.name}" — it has ${pending.length} pending tasks. Complete or move them first.` };
  deleteTaskListFile(slug);
  return { deleted: true, name: taskList.name };
}

export function listTaskLists() {
  const lists = getAllTaskLists();
  return lists.map((l) => ({
    name: l.name, slug: l.slug,
    total: l.tasks.length,
    pending: l.tasks.filter((t) => t.status === "pending").length,
    completed: l.tasks.filter((t) => t.status === "completed").length,
  }));
}

export function migrateTask({ task_id, target_list }) {
  const found = findTaskAcrossLists(task_id);
  if (!found) return { error: `Task ${task_id} not found` };
  const targetSlug = sanitizeListName(target_list);
  const targetData = loadTaskList(targetSlug);
  if (!targetData) return { error: `Target list "${target_list}" not found` };
  if (found.list.slug === targetSlug) return { error: "Task is already in that list" };
  found.list.tasks = found.list.tasks.filter((t) => t.id !== task_id);
  saveTaskList(found.list.slug, found.list);
  targetData.tasks.push(found.task);
  saveTaskList(targetSlug, targetData);
  return { migrated: true, task: found.task.title, from: found.list.name, to: targetData.name };
}

export function addNote({ content, tags = [], title = "" }) {
  const store = getStore();
  const note = {
    id: `n_${Date.now()}`, title, content, tags,
    created_at: new Date().toISOString(),
  };
  store.notes.push(note);
  saveData();
  return note;
}

export function listNotes({ tag = null, search = null } = {}) {
  const store = getStore();
  let notes = store.notes;
  if (tag) notes = notes.filter((n) => n.tags.includes(tag));
  if (search) {
    const q = search.toLowerCase();
    notes = notes.filter((n) => n.content.toLowerCase().includes(q) || n.title.toLowerCase().includes(q));
  }
  return notes;
}

export function deleteNote({ id }) {
  const store = getStore();
  const before = store.notes.length;
  store.notes = store.notes.filter((n) => n.id !== id);
  saveData();
  return { deleted: store.notes.length < before };
}

export function addReminder({ message, time, type = "once", date = null, follow_up = false, follow_up_interval = null }) {
  const store = getStore();
  const reminder = {
    id: `r_${Date.now()}`, message, time, type,
    date: type === "once" ? (date || todayStr()) : null,
    active: true, follow_up, follow_up_interval,
  };
  store.reminders.push(reminder);
  saveData();
  return reminder;
}

export function listReminders({ active_only = true } = {}) {
  const store = getStore();
  let reminders = store.reminders;
  if (active_only) reminders = reminders.filter((r) => r.active);
  const dailyLog = loadDailyLog(todayStr());
  return reminders.map((r) => ({ ...r, today_status: dailyLog.checkins[r.id] || null }));
}

export function deleteReminder({ id }) {
  const store = getStore();
  const before = store.reminders.length;
  store.reminders = store.reminders.filter((r) => r.id !== id);
  saveData();
  return { deleted: store.reminders.length < before };
}

export function logDailyCheckin({ reminder_id, answered, answer = "", snoozed_to = null }) {
  const today = todayStr();
  const log = loadDailyLog(today);
  log.checkins[reminder_id] = { asked_at: nowTimeStr(), answered, answer, snoozed_to };
  saveDailyLog(today, log);
  return { logged: true, reminder_id, date: today };
}

export function getDailySummary() {
  const today = todayStr();
  const store = getStore();
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

export async function webSearch({ query }) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
    });
    const html = await res.text();
    const results = [];
    const linkRegex = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const titles = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let link = match[1];
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) link = decodeURIComponent(uddg[1]);
      titles.push({ title: match[2].replace(/<[^>]+>/g, "").trim(), link });
    }
    const snipRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)>/g;
    const snippets = [];
    while ((match = snipRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
    }
    for (let i = 0; i < Math.min(titles.length, 5); i++) {
      results.push({ title: titles[i].title, link: titles[i].link, snippet: snippets[i] || "" });
    }
    if (results.length === 0) return { query, results: [], note: "No results found" };
    return { query, results };
  } catch (err) {
    return { query, error: err.message };
  }
}

export async function fetchUrl({ url }) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TelegramBot/1.0)" },
      timeout: 10000,
    });
    const text = await res.text();
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

export function updateMemory({ section, content, mode = "append" }) {
  let memory = loadMemory();
  const sectionHeader = `## ${section}`;
  const idx = memory.indexOf(sectionHeader);
  if (idx === -1) {
    memory = memory.trimEnd() + `\n\n${sectionHeader}\n${content}\n`;
  } else {
    const afterHeader = idx + sectionHeader.length;
    const nextSection = memory.indexOf("\n## ", afterHeader);
    const sectionEnd = nextSection === -1 ? memory.length : nextSection;
    if (mode === "replace") {
      memory = memory.slice(0, afterHeader) + `\n${content}\n` + memory.slice(sectionEnd);
    } else {
      const existing = memory.slice(afterHeader, sectionEnd);
      memory = memory.slice(0, afterHeader) + existing.trimEnd() + `\n- ${content}\n` + memory.slice(sectionEnd);
    }
  }
  saveMemory(memory);
  return { saved: true, section };
}

// ─── Tool Map ───────────────────────────────────────────────────────────────

export const TOOL_MAP = {
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

// ─── Vendor-Neutral Tool Schemas ────────────────────────────────────────────

export const TOOL_SCHEMAS = [
  {
    name: "add_task",
    description: "Add a new task to a task list",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority level (default: medium)" },
        due_date: { type: "string", description: "Due date in YYYY-MM-DD format" },
        notes: { type: "string", description: "Additional notes" },
        list: { type: "string", description: "Task list slug name (default: general)" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_tasks",
    description: "List tasks, optionally filtered by status, priority, or list",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "completed", "all"], description: "Filter by status (default: pending)" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "Filter by priority" },
        list: { type: "string", description: "Specific list slug to filter by" },
      },
    },
  },
  {
    name: "update_task",
    description: "Update task fields",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID" },
        title: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        due_date: { type: "string" },
        notes: { type: "string" },
        status: { type: "string", enum: ["pending", "completed"] },
      },
      required: ["id"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as completed",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Task ID to complete" } },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Delete a task",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Task ID to delete" } },
      required: ["id"],
    },
  },
  {
    name: "create_task_list",
    description: "Create a new named task list",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "List name" } },
      required: ["name"],
    },
  },
  {
    name: "delete_task_list",
    description: "Delete a task list (only if no pending tasks)",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "List name to delete" } },
      required: ["name"],
    },
  },
  {
    name: "list_task_lists",
    description: "Show all task lists with counts",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "migrate_task",
    description: "Move a task from one list to another",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID to move" },
        target_list: { type: "string", description: "Target list slug" },
      },
      required: ["task_id", "target_list"],
    },
  },
  {
    name: "add_note",
    description: "Add a new note",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Note content" },
        title: { type: "string", description: "Note title" },
        tags: { type: "array", items: { type: "string" }, description: "Tags" },
      },
      required: ["content"],
    },
  },
  {
    name: "list_notes",
    description: "List notes, optionally filtered by tag or search query",
    parameters: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag" },
        search: { type: "string", description: "Search text in title/content" },
      },
    },
  },
  {
    name: "delete_note",
    description: "Delete a note",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Note ID" } },
      required: ["id"],
    },
  },
  {
    name: "add_reminder",
    description: "Add a new reminder",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Reminder message" },
        time: { type: "string", description: "Time in HH:MM (24h)" },
        type: { type: "string", enum: ["once", "daily"], description: "once or daily (default: once)" },
        date: { type: "string", description: "Date for one-time reminders (YYYY-MM-DD)" },
        follow_up: { type: "boolean", description: "Whether to follow up if not acknowledged" },
        follow_up_interval: { type: "number", description: "Minutes between follow-ups" },
      },
      required: ["message", "time"],
    },
  },
  {
    name: "list_reminders",
    description: "List reminders",
    parameters: {
      type: "object",
      properties: {
        active_only: { type: "boolean", description: "Only active reminders (default: true)" },
      },
    },
  },
  {
    name: "delete_reminder",
    description: "Delete a reminder",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Reminder ID" } },
      required: ["id"],
    },
  },
  {
    name: "log_daily_checkin",
    description: "Log a daily check-in response for a reminder",
    parameters: {
      type: "object",
      properties: {
        reminder_id: { type: "string", description: "Reminder ID" },
        answered: { type: "boolean", description: "Whether answered" },
        answer: { type: "string", description: "The answer text" },
        snoozed_to: { type: "string", description: "Snooze to HH:MM" },
      },
      required: ["reminder_id", "answered"],
    },
  },
  {
    name: "get_daily_summary",
    description: "Get a daily overview of tasks, reminders, notes, and activity",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "update_memory",
    description: "Save or update persistent memory about the user",
    parameters: {
      type: "object",
      properties: {
        section: { type: "string", description: "Memory section name" },
        content: { type: "string", description: "Content to save" },
        mode: { type: "string", enum: ["append", "replace"], description: "append or replace (default: append)" },
      },
      required: ["section", "content"],
    },
  },
  {
    name: "web_search",
    description: "Search the web via DuckDuckGo and return top results",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description: "Fetch and read the content of a web page (plain text, first 2000 chars)",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "URL to fetch" } },
      required: ["url"],
    },
  },
];

// ─── Schema Converters ──────────────────────────────────────────────────────

export function toAnthropicTools() {
  return TOOL_SCHEMAS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export function toOpenAITools() {
  return TOOL_SCHEMAS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function toGeminiTools() {
  return [{
    functionDeclarations: TOOL_SCHEMAS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  }];
}
