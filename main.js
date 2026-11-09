"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createStore } = require("./store");
const { createAttachments } = require("./attachments.cjs");

const COMMAND_ID = "com.vastsa.side-chat.open";
const MESSAGE_BUDGET = 180_000;
const SESSION_BUDGET = 40_000;
const SYSTEM_MAX = 32 * 1024;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const SYSTEM_PROMPT = [
  "You are Side Chat, a compact sidebar assistant inside PI-Desktop.",
  "Answer directly. You have no tools.",
  "If a session transcript is attached, treat it as background; quote it only when asked.",
  "Reply in the same language the user is using.",
].join(" ");

const projects = new Map();
let dataFile = "";
let persistChain = Promise.resolve();
let historyReady = false;
const jobs = new Map();
let pendingDraft = null;
let attachmentSupport = null;

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
    };
  } catch {
    return { modelKey: "", thinkingLevel: "low", includeSession: true };
  }
}

async function writeSettings(patch) {
  const next = {};
  if (typeof patch.modelKey === "string") next.modelKey = patch.modelKey.trim();
  if (patch.thinkingLevel !== undefined) next.thinkingLevel = clampThinking(patch.thinkingLevel);
  if (typeof patch.includeSession === "boolean") next.includeSession = patch.includeSession;
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
    const text = await fs.readFile(dataFile, "utf8");
    const raw = JSON.parse(text);
    if (raw.version === 2 && Array.isArray(raw.projects)) {
      for (const item of raw.projects) {
        if (!item || typeof item.key !== "string") continue;
        const store = createStore();
        store.load(item.state);
        projects.set(item.key, { name: String(item.name || item.key), store });
      }
    } else if (Array.isArray(raw.conversations)) {
      // A v1 file has no project provenance. Keep it intact, never guess its owner.
      try {
        await fs.writeFile(path.join(path.dirname(dataFile), "conversations.v1.json"), text, { flag: "wx" });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      const store = createStore();
      store.load(raw);
      projects.set("legacy", { name: "Legacy history", store });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      try {
        await pi.ui.showToast("Side Chat: failed to read history", "warn");
      } catch {
        /* ignore */
      }
      throw error;
    }
  }
}

function persist() {
  if (!historyReady) return Promise.resolve();
  persistChain = persistChain
    .then(async () => {
      const tmp = `${dataFile}.tmp`;
      await fs.mkdir(path.dirname(dataFile), { recursive: true });
      const saved = { version: 2, projects: [...projects].map(([key, item]) => ({ key, name: item.name, state: item.store.snapshot() })) };
      await fs.writeFile(tmp, JSON.stringify(saved), "utf8");
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

function normalizedPath(value) {
  const text = String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return /^(?:[a-z]:|\/\/)/i.test(text) ? text.toLowerCase() : text;
}

async function currentContext() {
  // Recheck after the workspace await: never pair project B with session A.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const selected = await pi.session.getActive();
    const workspace = await pi.workspace.get();
    const checked = await pi.session.getActive();
    if (selected?.sessionId !== checked?.sessionId || selected?.projectPath !== checked?.projectPath) continue;
    // A selected session without a project must not borrow another open workspace.
    const projectPath = String(selected ? selected.projectPath || "" : workspace?.path || "");
    const roots = [workspace?.path, ...(workspace?.roots || []).map((root) => root.path)];
    const inWorkspace = roots.some((root) => root && normalizedPath(root) === normalizedPath(projectPath));
    const projectKey = inWorkspace && workspace?.projectId
      ? `project:${workspace.projectId}`
      : projectPath ? `path:${normalizedPath(projectPath)}` : "general";
    const projectName = inWorkspace && workspace?.name
      ? String(workspace.name) : projectPath.split(/[\\/]/).filter(Boolean).pop() || "";
    return { sessionId: String(selected?.sessionId || ""), projectKey, projectName, projectPath };
  }
  throw errorWith("STALE_CONTEXT", "Session changed. Please try again.");
}

function projectStore(context) {
  if (!projects.has(context.projectKey)) projects.set(context.projectKey, { name: context.projectName, store: createStore() });
  return projects.get(context.projectKey).store;
}

function projectSnapshot(projectKey) {
  const item = projects.get(projectKey);
  if (!item) throw errorWith("NOT_FOUND", "Project history not found");
  return { ...item.store.snapshot(), projectKey, projectName: item.name };
}

function projectList(currentProjectKey) {
  // Context reads create a blank store. It is not historical activity, and
  // cold path/project-ID snapshots must not leave visible shadow projects.
  return [...projects]
    .filter(([key, item]) => key === "general" || key === "legacy" || key === currentProjectKey
      || item.store.snapshot().conversations.some(conversation => conversation.title.trim() || conversation.messages.length))
    .map(([key, item]) => ({ key, name: item.name }));
}

function assertContext(payload, context) {
  if (payload.projectKey !== context.projectKey || String(payload.sessionId ?? "") !== context.sessionId) {
    throw errorWith("STALE_CONTEXT", "Session changed. Please try again.");
  }
}

async function contextSnapshot() {
  const context = await currentContext();
  projectStore(context);
  return { context, snapshot: projectSnapshot(context.projectKey), projects: projectList(context.projectKey) };
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
  const [settings, models, locale] = await Promise.all([
    readSettings(), listModels(), pi.app.getLocale().catch(() => "en"),
  ]);
  const modelKey = pickModel(models, settings.modelKey);
  if (modelKey !== settings.modelKey) await writeSettings({ modelKey });
  return {
    ...await contextSnapshot(),
    settings: { ...settings, modelKey },
    models,
    locale: String(locale || "en"),
  };
}

async function runComplete(job) {
  const entry = jobs.get(job.id);
  if (!entry) return;
  try {
    const history = job.messages
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content)
      .map((message) => ({ role: message.role, content: message.content }));
    let contextBlock = "";
    if (job.includeSession && job.sessionId) {
      const attached = await sessionContext(job.sessionId);
      contextBlock = attached.text;
    }
    let result;
    if (job.backend === "agent") {
      result = { text: await attachmentSupport.run(job, contextBlock) };
    } else {
      const packed = trimHistory(history, contextBlock ? MESSAGE_BUDGET - contextBlock.length - 64 : MESSAGE_BUDGET);
      const messages = contextBlock
        ? [{ role: "user", content: `Current PI-Desktop session transcript:\n\n${contextBlock}` }, ...packed]
        : packed;
      let system = SYSTEM_PROMPT;
      if (system.length > SYSTEM_MAX) system = system.slice(0, SYSTEM_MAX);
      result = await pi.agent.complete({
        modelKey: job.modelKey,
        thinkingLevel: job.thinkingLevel === "off" ? undefined : job.thinkingLevel,
        system,
        messages,
      });
    }
    const text = extractText(result).trim() || "(empty reply)";
    job.store.addAssistantMessage(job.conversationId, text);
    await persist();
    entry.status = "done";
    entry.text = text;
    entry.usage = result?.usage ?? null;
    entry.snapshot = projectSnapshot(job.projectKey);
  } catch (error) {
    const message = error?.code === "RATE_LIMITED"
      ? "RATE_LIMITED"
      : (error?.message || String(error));
    job.store.addAssistantMessage(job.conversationId, message, { error: true });
    await persist();
    entry.status = "error";
    entry.error = message;
    entry.code = error?.code || "COMPLETE_FAILED";
    entry.snapshot = projectSnapshot(job.projectKey);
  }
}

async function send(payload) {
  const text = String(payload?.text ?? "").trim();
  const incoming = payload?.attachments ?? [];
  if (!Array.isArray(incoming) || incoming.length > 8) throw errorWith("INVALID_ATTACHMENT", "At most eight attachments are allowed");
  if (!text && !incoming.length) throw errorWith("INVALID_ARGUMENT", "message is empty");
  const settings = await readSettings();
  const models = await listModels();
  const modelKey = pickModel(models, String(payload?.modelKey || settings.modelKey || "").trim());
  if (!modelKey) throw errorWith("NO_MODEL", "no signed-in model");
  const thinkingLevel = clampThinking(payload?.thinkingLevel ?? settings.thinkingLevel);
  const includeSession = payload?.includeSession === undefined
    ? settings.includeSession
    : payload.includeSession === true;
  await writeSettings({ modelKey, thinkingLevel, includeSession });
  const context = await currentContext();
  assertContext(payload, context);
  const store = projectStore(context);
  const selected = store.active();
  if (payload.conversationId && payload.conversationId !== selected.id) throw errorWith("STALE_CONTEXT", "Session changed. Please send again.");
  const usesAgent = incoming.length > 0 || selected.messages.some(m => m.attachments?.length);
  let files = [];
  if (usesAgent) {
    const operations = await pi.desktop.listOperations?.();
    if (!Array.isArray(operations) || !["session/create", "agent/prompt", "agent/getStatus", "session/get", "agent/abort"].every(id => operations.some(op => op.id === id))) {
      throw errorWith("ATTACHMENTS_UNSUPPORTED", "This host does not support independent attachment sessions");
    }
    if (incoming.length && payload.conversationId !== selected.id) throw errorWith("STALE_CONTEXT", "Attachment conversation changed");
    files = (await attachmentSupport.resolve({ projectKey: context.projectKey, conversationId: selected.id }, incoming)).map(({ path: _path, ...meta }) => meta);
    assertContext(payload, await currentContext());
    if (store.active().id !== selected.id) throw errorWith("STALE_CONTEXT", "Attachment conversation changed");
  }
  const conversation = store.addUserMessage(text, files);
  await persist();
  const jobId = nid("j");
  const job = {
    id: jobId,
    status: "running",
    conversationId: conversation.id,
    modelKey,
    backend: usesAgent ? "agent" : "complete",
    thinkingLevel,
    includeSession,
    sessionId: context.sessionId,
    projectKey: context.projectKey,
    store,
    messages: conversation.messages,
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
  return { jobId, backend: job.backend, snapshot: projectSnapshot(context.projectKey), settings: await readSettings() };
}

function poll(payload) {
  const jobId = String(payload?.jobId ?? "");
  const job = jobs.get(jobId);
  if (!job) return { status: "missing" };
  return {
    status: job.status,
    text: job.text || "",
    error: job.error || "",
    code: job.code || "",
    usage: job.usage || null,
    snapshot: projectSnapshot(job.projectKey),
  };
}

function settleDraft(request, error) {
  if (pendingDraft !== request) return;
  clearTimeout(request.timer);
  pendingDraft = null;
  if (error) request.reject(error);
  else request.resolve({ ok: true, sessionId: request.sessionId });
}

async function insertToSession(payload) {
  const text = String(payload?.text ?? "").trim();
  if (!text) throw errorWith("INVALID_ARGUMENT", "nothing to insert");
  if (Buffer.byteLength(text, "utf8") > 32 * 1024) throw errorWith("LIMIT_EXCEEDED", "Draft text exceeds the host's 32 KiB insert limit");
  const context = await currentContext();
  assertContext(payload, context);
  if (!context.sessionId) throw errorWith("NO_SESSION", "Open a session first");
  if (pendingDraft) throw errorWith("BUSY", "A draft return is already pending");
  return new Promise((resolve, reject) => {
    const request = { id: nid("d"), ...context, text, resolve, reject, claimed: false, expiresAt: Date.now() + 8000 };
    pendingDraft = request;
    request.timer = setTimeout(() => settleDraft(request, errorWith("DRAFT_UNAVAILABLE", "Draft bridge unavailable. Reload the plugin and grant renderer.extension.")), 8000);
  });
}

async function onRendererCall(method, args = {}) {
  const request = pendingDraft;
  if (method === "takeDraft") {
    if (!request || request.claimed) return null;
    try {
      const context = await currentContext();
      if (pendingDraft !== request || request.claimed) return null;
      assertContext(request, context);
    } catch (error) {
      settleDraft(request, error);
      return null;
    }
    request.claimed = true;
    return { id: request.id, sessionId: request.sessionId, text: request.text, expiresAt: request.expiresAt };
  }
  if (method === "finishDraft") {
    if (!request || !request.claimed || args?.id !== request.id) return { ok: false };
    const error = args.ok === true ? null : errorWith(String(args.code || "DRAFT_FAILED"), String(args.message || "Unable to fill the main input"));
    settleDraft(request, error);
    return { ok: true };
  }
  throw errorWith("UNSUPPORTED", `Unsupported draft method: ${method}`);
}

async function onPanelInvoke(channel, payload = {}) {
  if (channel.startsWith("chat.attachment.")) {
    const action = channel.slice("chat.attachment.".length);
    if (!["begin", "chunk", "finish", "discard"].includes(action)) throw errorWith("UNSUPPORTED", "Unsupported attachment operation");
    // An opaque upload token remains valid for cleanup after navigation, never for sending.
    if (action === "discard") return attachmentSupport.discard({ projectKey: payload.projectKey, conversationId: payload.conversationId }, payload);
    const context = await currentContext();
    assertContext(payload, context);
    if (projectStore(context).active().id !== payload.conversationId) throw errorWith("STALE_CONTEXT", "Attachment conversation changed");
    return attachmentSupport[action]({ projectKey: context.projectKey, conversationId: payload.conversationId }, payload);
  }
  switch (channel) {
    case "chat.bootstrap":
      return bootstrap();
    case "chat.context":
      return contextSnapshot();
    case "chat.history": {
      const context = await currentContext();
      return { snapshot: projectSnapshot(String(payload.projectKey || "")), projects: projectList(context.projectKey) };
    }
    case "chat.send":
      return send(payload);
    case "chat.poll":
      return poll(payload);
    case "chat.new": {
      const context = await currentContext();
      assertContext(payload, context);
      projectStore(context).newConversation();
      await persist();
      return { snapshot: projectSnapshot(context.projectKey), projects: projectList(context.projectKey) };
    }
    case "chat.select":
    case "chat.delete": {
      const key = String(payload.projectKey || "");
      const item = projects.get(key);
      if (!item) throw errorWith("NOT_FOUND", "Project history not found");
      const context = await currentContext();
      if (channel === "chat.delete" && context.projectKey !== key) {
        throw errorWith("STALE_CONTEXT", "Session changed. Please return to the current project.");
      }
      if (channel === "chat.select") item.store.select(String(payload.id || ""));
      else item.store.deleteConversation(String(payload.id || ""));
      await persist();
      return { snapshot: projectSnapshot(key), projects: projectList(context.projectKey) };
    }
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
  attachmentSupport = createAttachments({
    io: fs, pathLib: path, dataPath,
    invoke: input => pi.desktop.invoke(input),
    getMainId: async () => (await pi.session.getActive())?.sessionId || null,
  });
  historyReady = false;
  projects.clear();
  // A permanent entry; loading an existing general bucket restores its history in place.
  projects.set("general", { name: "Standalone sessions", store: createStore() });
  await loadStore();
  historyReady = true;
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
  if (pendingDraft) settleDraft(pendingDraft, errorWith("PLUGIN_UNLOADED", "Plugin unloaded before draft return"));
  await attachmentSupport?.close();
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
  onRendererCall,
};
