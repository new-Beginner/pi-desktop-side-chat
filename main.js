"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createStore } = require("./store");

const COMMAND_ID = "com.vastsa.side-chat.open";
const MESSAGE_BUDGET = 180_000;
const SESSION_BUDGET = 40_000;
const SYSTEM_MAX = 32 * 1024;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high"]);

const SYSTEM_PROMPT = [
  "You are Side Chat, a compact sidebar assistant inside PI-Desktop.",
  "Answer directly. You have no tools.",
  "If a session transcript is attached, treat it as background; quote it only when asked.",
  "Reply in the same language the user is using.",
].join(" ");

let store = createStore();
let dataFile = "";
let persistChain = Promise.resolve();
const jobs = new Map();

function nid(prefix) {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function errorWith(code, message) {
  return Object.assign(new Error(message), { code });
}

function extractText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.text === "string") return result.text;
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("");
  }
  return "";
}

function messageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("");
  }
  return String(message.content ?? "");
}

function clampThinking(value) {
  const level = String(value ?? "low");
  return THINKING_LEVELS.has(level) ? level : "low";
}

async function readSettings() {
  try {
    const raw = await pi.plugin.getSettings();
    return {
      modelKey: String(raw?.modelKey ?? "").trim(),
      thinkingLevel: clampThinking(raw?.thinkingLevel),
      includeSession: raw?.includeSession !== false,
      sessionId: String(raw?.sessionId ?? "").trim(),
    };
  } catch {
    return { modelKey: "", thinkingLevel: "low", includeSession: true, sessionId: "" };
  }
}

async function writeSettings(patch) {
  const next = {};
  if (typeof patch.modelKey === "string") next.modelKey = patch.modelKey.trim();
  if (patch.thinkingLevel !== undefined) next.thinkingLevel = clampThinking(patch.thinkingLevel);
  if (typeof patch.includeSession === "boolean") next.includeSession = patch.includeSession;
  if (typeof patch.sessionId === "string") next.sessionId = patch.sessionId.trim();
  if (Object.keys(next).length === 0) return readSettings();
  try {
    await pi.plugin.setSettings(next);
  } catch {
    /* generated settings UI may also write */
  }
  return readSettings();
}

async function loadStore() {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    store.load(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      try {
        await pi.ui.showToast("Side Chat: failed to read history", "warn");
      } catch {
        /* ignore */
      }
    }
  }
}

function persist() {
  persistChain = persistChain
    .then(async () => {
      const tmp = `${dataFile}.tmp`;
      await fs.mkdir(path.dirname(dataFile), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(store.snapshot()), "utf8");
      await fs.rename(tmp, dataFile);
    })
    .catch(() => {});
  return persistChain;
}

async function listModels() {
  try {
    const rows = await pi.models.list();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function pickModel(models, preferred) {
  if (preferred && models.some((row) => row.key === preferred)) return preferred;
  const fallback = models.find((row) => row.isDefault) || models[0];
  return fallback ? fallback.key : "";
}

async function listSessions() {
  try {
    const result = await pi.desktop.invoke({ operation: "session/list", args: [] });
    const rows = Array.isArray(result) ? result : (result?.sessions ?? []);
    let projectPath = "";
    try {
      const workspace = await pi.workspace.get();
      projectPath = String(workspace?.path ?? "").trim();
    } catch {
      projectPath = "";
    }
    return rows
      .filter((row) => row && row.id)
      .map((row) => ({
        id: String(row.id),
        title: String(row.title || "").trim(),
        updatedAt: String(row.updatedAt ?? ""),
        projectPath: String(row.projectPath ?? ""),
        modelId: String(row.modelId ?? ""),
        providerId: String(row.providerId ?? ""),
        canPrompt: row.capabilities?.canPrompt !== false && !String(row.id).startsWith("native-pi:"),
        currentProject: Boolean(projectPath) && String(row.projectPath ?? "") === projectPath,
      }));
  } catch {
    return [];
  }
}

function serializeSession(session) {
  if (!session) return "";
  const lines = [
    `Session: ${session.title || session.id || "untitled"}`,
    session.projectPath ? `Project: ${session.projectPath}` : "",
    "",
  ].filter((line) => line !== "");
  const messages = Array.isArray(session.messages) ? session.messages : [];
  for (const message of messages) {
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    const content = messageText(message).trim();
    if (!content) continue;
    const role = message.role === "assistant" ? "Assistant" : "User";
    lines.push(`${role}: ${content}`);
    lines.push("");
  }
  let text = lines.join("\n").trim();
  if (text.length > SESSION_BUDGET) text = text.slice(-SESSION_BUDGET);
  return text;
}

async function sessionContext(sessionId) {
  const id = String(sessionId ?? "").trim();
  if (!id) return { text: "", session: null };
  try {
    const result = await pi.desktop.invoke({
      operation: "session/get",
      args: [{ id, messageLimit: 32, contentLimit: 2500 }],
    });
    const session = result?.session ?? result;
    return { text: serializeSession(session), session };
  } catch {
    return { text: "", session: null };
  }
}

function trimHistory(messages, budget) {
  const kept = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    const size = item.content.length + 16;
    if (used + size > budget && kept.length > 0) break;
    kept.push(item);
    used += size;
  }
  return kept.reverse();
}

async function bootstrap() {
  const [settings, models, sessions, locale] = await Promise.all([
    readSettings(),
    listModels(),
    listSessions(),
    pi.app.getLocale().catch(() => "en"),
  ]);
  const modelKey = pickModel(models, settings.modelKey);
  let sessionId = settings.sessionId;
  if (sessionId && !sessions.some((row) => row.id === sessionId)) sessionId = "";
  if (!sessionId) {
    const preferred = sessions.find((row) => row.currentProject) || sessions[0];
    sessionId = preferred ? preferred.id : "";
  }
  if (modelKey !== settings.modelKey || sessionId !== settings.sessionId) {
    await writeSettings({ modelKey, sessionId });
  }
  return {
    snapshot: store.snapshot(),
    settings: { ...settings, modelKey, sessionId },
    models,
    sessions,
    locale: String(locale || "en"),
  };
}

async function runComplete(job) {
  const entry = jobs.get(job.id);
  if (!entry) return;
  try {
    const conversation = store.snapshot().conversations.find((item) => item.id === job.conversationId);
    const history = (conversation?.messages ?? [])
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content)
      .map((message) => ({ role: message.role, content: message.content }));
    let contextBlock = "";
    if (job.includeSession && job.sessionId) {
      const attached = await sessionContext(job.sessionId);
      contextBlock = attached.text;
    }
    const packed = trimHistory(history, contextBlock ? MESSAGE_BUDGET - contextBlock.length - 64 : MESSAGE_BUDGET);
    const messages = contextBlock
      ? [{ role: "user", content: `Current PI-Desktop session transcript:\n\n${contextBlock}` }, ...packed]
      : packed;
    let system = SYSTEM_PROMPT;
    if (system.length > SYSTEM_MAX) system = system.slice(0, SYSTEM_MAX);
    const result = await pi.agent.complete({
      modelKey: job.modelKey,
      thinkingLevel: job.thinkingLevel === "off" ? undefined : job.thinkingLevel,
      system,
      messages,
    });
    const text = extractText(result).trim() || "(empty reply)";
    store.addAssistantMessage(job.conversationId, text);
    await persist();
    entry.status = "done";
    entry.text = text;
    entry.usage = result?.usage ?? null;
    entry.snapshot = store.snapshot();
  } catch (error) {
    const message = error?.code === "RATE_LIMITED"
      ? "RATE_LIMITED"
      : (error?.message || String(error));
    store.addAssistantMessage(job.conversationId, message, { error: true });
    await persist();
    entry.status = "error";
    entry.error = message;
    entry.code = error?.code || "COMPLETE_FAILED";
    entry.snapshot = store.snapshot();
  }
}

async function send(payload) {
  const text = String(payload?.text ?? "").trim();
  if (!text) throw errorWith("INVALID_ARGUMENT", "message is empty");
  const settings = await readSettings();
  const models = await listModels();
  const modelKey = pickModel(models, String(payload?.modelKey || settings.modelKey || "").trim());
  if (!modelKey) throw errorWith("NO_MODEL", "no signed-in model");
  const thinkingLevel = clampThinking(payload?.thinkingLevel ?? settings.thinkingLevel);
  const includeSession = payload?.includeSession === undefined
    ? settings.includeSession
    : payload.includeSession === true;
  const sessionId = String(payload?.sessionId || settings.sessionId || "").trim();
  await writeSettings({ modelKey, thinkingLevel, includeSession, sessionId });
  const conversation = store.addUserMessage(text);
  await persist();
  const jobId = nid("j");
  const job = {
    id: jobId,
    status: "running",
    conversationId: conversation.id,
    modelKey,
    thinkingLevel,
    includeSession,
    sessionId,
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);
  if (jobs.size > 20) {
    const oldest = [...jobs.keys()].slice(0, jobs.size - 20);
    for (const key of oldest) {
      if (jobs.get(key)?.status !== "running") jobs.delete(key);
    }
  }
  void runComplete(job);
  return { jobId, snapshot: store.snapshot(), settings: await readSettings() };
}

function poll(payload) {
  const jobId = String(payload?.jobId ?? "");
  const job = jobs.get(jobId);
  if (!job) return { status: "missing", snapshot: store.snapshot() };
  return {
    status: job.status,
    text: job.text || "",
    error: job.error || "",
    code: job.code || "",
    usage: job.usage || null,
    snapshot: job.snapshot || store.snapshot(),
  };
}

async function insertToSession(payload) {
  const settings = await readSettings();
  const sessionId = String(payload?.sessionId || settings.sessionId || "").trim();
  const text = String(payload?.text ?? "").trim();
  if (!sessionId) throw errorWith("NO_SESSION", "pick a session first");
  if (!text) throw errorWith("INVALID_ARGUMENT", "nothing to insert");
  await writeSettings({ sessionId });
  await pi.desktop.invoke({
    operation: "agent/prompt",
    args: [{
      sessionId,
      content: `[Side Chat / 侧边聊天]\n\n${text}`,
    }],
  });
  return { ok: true, sessionId };
}

async function onPanelInvoke(channel, payload = {}) {
  switch (channel) {
    case "chat.bootstrap":
      return bootstrap();
    case "chat.send":
      return send(payload);
    case "chat.poll":
      return poll(payload);
    case "chat.new": {
      store.newConversation();
      await persist();
      return { snapshot: store.snapshot() };
    }
    case "chat.select": {
      store.select(String(payload?.id ?? ""));
      await persist();
      return { snapshot: store.snapshot() };
    }
    case "chat.delete": {
      store.deleteConversation(String(payload?.id ?? ""));
      await persist();
      return { snapshot: store.snapshot() };
    }
    case "chat.sessions":
      return { sessions: await listSessions() };
    case "chat.setSettings":
      return { settings: await writeSettings(payload || {}) };
    case "chat.insert":
      return insertToSession(payload);
    case "chat.copy":
      await pi.clipboard.writeText(String(payload?.text ?? ""));
      return { ok: true };
    default: {
      throw errorWith("UNSUPPORTED", `Unsupported side-chat channel: ${channel}`);
    }
  }
}

async function onLoad() {
  const dataPath = await pi.plugin.getDataPath();
  dataFile = path.join(dataPath, "conversations.json");
  store = createStore();
  await loadStore();
  await pi.commands.register({
    id: COMMAND_ID,
    title: "Side Chat: Open",
    keywords: ["side", "chat", "sidebar", "assistant", "侧边", "聊天", "旁路"],
    category: "Agent",
    run: async () => {
      await pi.ui.openPanel();
    },
  });
}

async function onUnload() {
  jobs.clear();
  try {
    await persist();
  } catch {
    /* ignore */
  }
  try {
    await pi.commands.unregister(COMMAND_ID);
  } catch {
    /* ignore */
  }
}

module.exports = {
  onLoad,
  onUnload,
  onPanelInvoke,
};
