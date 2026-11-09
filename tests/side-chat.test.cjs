"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function host(initialFile, behavior = {}) {
  const files = new Map(initialFile ? [["/private/conversations.json", JSON.stringify(initialFile)]] : []);
  let active = { sessionId: "a1", projectPath: "D:/projects/A", activeTurn: null };
  let workspace = { path: "D:/projects/A", name: "A", projectId: "project-a" };
  let settings = { modelKey: "mock/model", thinkingLevel: "low", includeSession: true };
  let resolveCompletion;
  let delayed = false;
  const completions = [], operations = [];
  const sideSessions = new Map();
  const fakeFs = {
    readFile: async (p) => { if (!files.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(p); },
    mkdir: async () => {},
    writeFile: async (p, text, options) => {
      if (behavior.failBackup && p.endsWith("conversations.v1.json")) throw Object.assign(new Error("backup denied"), { code: "EACCES" });
      if (options?.flag === "wx" && files.has(p)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      files.set(p, text);
    },
    appendFile: async (p, bytes) => { files.set(p, Buffer.concat([Buffer.from(files.get(p) || ""), bytes])); },
    unlink: async p => { if (!files.delete(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    rename: async (a, b) => { files.set(b, files.get(a)); files.delete(a); },
  };
  const pi = {
    plugin: { getDataPath: async () => "/private", getSettings: async () => ({ ...settings }), setSettings: async (p) => { settings = { ...settings, ...p }; } },
    commands: { register: async () => {}, unregister: async () => {} },
    ui: { showToast: async () => {}, openPanel: async () => {} },
    app: { getLocale: async () => "zh-CN" },
    models: { list: async () => [{ key: "mock/model", isDefault: true }] },
    workspace: { get: async () => {
      const value = workspace;
      if (behavior.onWorkspaceRead) { const callback = behavior.onWorkspaceRead; behavior.onWorkspaceRead = null; callback(); }
      return value;
    } },
    session: { getActive: async () => active },
    clipboard: { writeText: async () => {} },
    desktop: { listOperations: async () => ["session/create", "agent/prompt", "agent/getStatus", "session/get", "agent/abort"].map(id => ({ id })), invoke: async (p) => {
      operations.push(p);
      if (behavior.attachments) {
        const input = p.args[0];
        if (p.operation === "session/create") {
          const session = { ...input, id: `side-${sideSessions.size + 1}`, messages: [] }; sideSessions.set(session.id, session); return { session };
        }
        if (p.operation === "agent/prompt") {
          const session = sideSessions.get(input.sessionId);
          const policy = JSON.parse(files.get(path.posix.join(session.projectPath, ".side-chat-policy.json")));
          files.set(path.posix.join(session.projectPath, ".side-chat-ready.json"), JSON.stringify({ sessionId: session.id, nonce: policy.nonce }));
          session.messages.push({ role: "user", content: input.content }, { role: "assistant", content: "attachment backend reply" });
          return { accepted: true, turnId: "side-turn" };
        }
        if (p.operation === "agent/getStatus") return { status: { sessionId: input, isRunning: false, pendingToolConfirmations: 0 } };
        if (p.operation === "agent/abort") return { ok: true };
        if (p.operation === "session/get" && sideSessions.has(input.id)) return { session: sideSessions.get(input.id) };
      }
      if (p.operation === "session/list") return [];
      if (p.operation === "session/get") return { id: p.args[0].id, messages: [{ role: "user", content: `context:${p.args[0].id}` }] };
      return { ok: true };
    } },
    agent: { complete: async (p) => {
      completions.push(p);
      if (delayed) return new Promise((resolve) => { resolveCompletion = resolve; });
      return { text: "# Reply\n\n**done**" };
    } },
  };
  const sandbox = {
    module: { exports: {} }, console, pi, Buffer, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, behavior.fastTimeout ? 5 : ms),
    require(id) {
      if (id === "node:fs/promises") return fakeFs;
      if (id === "node:path") return path.posix;
      if (id.startsWith("./")) return require(path.join(root, id));
      throw new Error(`unexpected require ${id}`);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "main.js"), "utf8"), sandbox);
  const api = sandbox.module.exports;
  return {
    api, files, completions, operations,
    switchTo(id, folder, projectId) {
      active = id ? { sessionId: id, projectPath: folder, activeTurn: null } : null;
      workspace = folder ? { path: folder, name: folder.split(/[\\/]/).at(-1), ...(projectId ? { projectId } : {}) } : null;
    },
    setWorkspace(value) { workspace = value; },
    delay() { delayed = true; },
    finish() { resolveCompletion({ text: "late answer for A" }); },
  };
}
async function settle(h, jobId) {
  for (let i = 0; i < 100; i++) {
    const result = await h.api.onPanelInvoke("chat.poll", { jobId });
    if (result.status !== "running") return result;
    await new Promise(setImmediate);
  }
  throw new Error("mock job did not settle");
}
async function boot(h) { await h.api.onLoad(); return h.api.onPanelInvoke("chat.bootstrap"); }
async function send(h, text) {
  const { context } = await h.api.onPanelInvoke("chat.context");
  return h.api.onPanelInvoke("chat.send", { text, sessionId: context.sessionId, projectKey: context.projectKey });
}

test("follows active session instead of the previously saved selection", async () => {
  const h = host(); const a = await boot(h);
  assert.equal(a.context.sessionId, "a1");
  h.switchTo("a2", "D:/projects/A", "project-a");
  const b = await h.api.onPanelInvoke("chat.context");
  assert.equal(b.context.sessionId, "a2");
  assert.equal(b.context.projectKey, a.context.projectKey);
  const job = await send(h, "question"); await settle(h, job.jobId);
  assert.match(h.completions[0].messages[0].content, /context:a2/);
});

test("project histories stay separate and restore on switching back", async () => {
  const h = host(); const a = await boot(h);
  const job = await send(h, "A only"); await settle(h, job.jobId);
  h.switchTo("b1", "D:/projects/B", "project-b");
  const b = await h.api.onPanelInvoke("chat.context");
  assert.notEqual(a.context.projectKey, b.context.projectKey);
  assert.equal(b.snapshot.conversations[0].messages.length, 0);
  const bj = await send(h, "B only"); await settle(h, bj.jobId);
  h.switchTo("a2", "D:/projects/A", "project-a");
  const again = await h.api.onPanelInvoke("chat.context");
  assert.equal(again.snapshot.conversations[0].messages[0].content, "A only");
  assert.ok(!JSON.stringify(again.snapshot).includes("B only"));
  const persisted = JSON.parse(h.files.get("/private/conversations.json"));
  assert.equal(persisted.version, 2);
  const restored = host(persisted); const loaded = await boot(restored);
  assert.equal(loaded.snapshot.conversations[0].messages[0].content, "A only");
});

test("late replies remain bound to their originating project and conversation", async () => {
  const h = host(); const a = await boot(h); h.delay();
  const job = await send(h, "slow A");
  for (let i = 0; i < 20 && !h.completions.length; i++) await new Promise(setImmediate);
  h.switchTo("b1", "D:/projects/B", "project-b");
  await h.api.onPanelInvoke("chat.context"); h.finish();
  const done = await settle(h, job.jobId);
  assert.equal(done.snapshot.projectKey, a.context.projectKey);
  assert.equal(done.snapshot.conversations[0].messages.at(-1).content, "late answer for A");
  const b = await h.api.onPanelInvoke("chat.context");
  assert.equal(b.snapshot.conversations[0].messages.length, 0);
});

test("stale session/project requests cannot send or write back to the wrong target", async () => {
  const h = host(); const a = await boot(h);
  h.switchTo("b1", "D:/projects/B", "project-b");
  for (const channel of ["chat.send", "chat.insert"]) {
    await assert.rejects(h.api.onPanelInvoke(channel, { text: "stale", sessionId: "a1", projectKey: a.context.projectKey }), { code: "STALE_CONTEXT" });
  }
  assert.equal(h.completions.length, 0);
  assert.equal(h.operations.filter(p => p.operation === "agent/prompt").length, 0);
});

test("version-one history is preserved without assigning it to an arbitrary project", async () => {
  const old = { version: 1, activeId: "old", conversations: [{ id: "old", title: "Old", messages: [{ role: "user", content: "legacy history" }] }] };
  const h = host(old); const data = await boot(h);
  assert.equal(data.snapshot.conversations[0].messages.length, 0);
  const legacy = data.projects.find(p => p.key === "legacy"); assert.ok(legacy);
  const archive = await h.api.onPanelInvoke("chat.history", { projectKey: legacy.key });
  assert.equal(archive.snapshot.conversations[0].messages[0].content, "legacy history");
  assert.deepEqual(JSON.parse(h.files.get("/private/conversations.v1.json")), old);
});

test("project groups use the stable host project id for multiple roots", async () => {
  const h = host(); const a = await boot(h);
  h.switchTo("a2", "D:/projects/A-extra", "project-a");
  h.setWorkspace({ path: "D:/projects/A", name: "A", projectId: "project-a", roots: [{ path: "D:/projects/A" }, { path: "D:/projects/A-extra" }] });
  const b = await h.api.onPanelInvoke("chat.context");
  assert.equal(a.context.projectKey, b.context.projectKey);
});

test("no selected session does not fall back to a saved or unrelated session", async () => {
  const h = host(); await boot(h); h.switchTo(null, null);
  const data = await h.api.onPanelInvoke("chat.context"); assert.equal(data.context.sessionId, "");
  await assert.rejects(h.api.onPanelInvoke("chat.insert", { text: "reply", sessionId: "", projectKey: data.context.projectKey }), { code: "NO_SESSION" });
});

async function takeDraft(h) {
  assert.equal(typeof h.api.onRendererCall, "function", "a declared Renderer draft callback is required");
  for (let i = 0; i < 80; i++) {
    const request = await h.api.onRendererCall("takeDraft", {});
    if (request) return request;
    await new Promise(setImmediate);
  }
  throw new Error("draft request not ready");
}

test("return queues a draft write and only completes after Renderer acknowledgement; never sends", async () => {
  const h = host(); const data = await boot(h);
  const pending = h.api.onPanelInvoke("chat.insert", { text: "reply", ...data.context });
  const request = await takeDraft(h);
  assert.equal(request.text, "reply"); assert.equal(request.sessionId, "a1");
  assert.equal(await h.api.onRendererCall("takeDraft", {}), null, "request must be claimed at most once");
  await h.api.onRendererCall("finishDraft", { id: request.id, ok: true });
  assert.equal((await pending).ok, true);
  assert.equal(h.operations.filter(p => p.operation === "agent/prompt").length, 0);
});

test("unavailable Renderer times out without falling back to sending", async () => {
  const h = host(undefined, { fastTimeout: true }); const data = await boot(h);
  await assert.rejects(h.api.onPanelInvoke("chat.insert", { text: "reply", ...data.context }), { code: "DRAFT_UNAVAILABLE" });
  assert.equal(h.operations.length, 0);
});

test("changing sessions before the Renderer claims a request cancels that draft return", async () => {
  const h = host(); const data = await boot(h);
  const pending = h.api.onPanelInvoke("chat.insert", { text: "reply", ...data.context });
  const rejected = assert.rejects(pending, { code: "STALE_CONTEXT" });
  // Let the original request bind its context before switching.
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
  h.switchTo("b1", "D:/projects/B", "project-b");
  assert.equal(await h.api.onRendererCall("takeDraft", {}), null);
  await rejected;
  assert.equal(h.operations.length, 0);
});

test("oversized draft returns are refused at the official 32 KiB insert limit", async () => {
  const h = host(); const data = await boot(h);
  await assert.rejects(h.api.onPanelInvoke("chat.insert", { text: "字".repeat(12000), ...data.context }), { code: "LIMIT_EXCEEDED" });
  assert.equal(h.operations.length, 0);
});

test("draft failure and unload settle pending calls without sending", async () => {
  const h = host(); const data = await boot(h);
  const first = h.api.onPanelInvoke("chat.insert", { text: "reply", ...data.context });
  const firstRejected = assert.rejects(first, { code: "PLUGIN_DRAFT_STALE" });
  const request = await takeDraft(h);
  await h.api.onRendererCall("finishDraft", { id: request.id, ok: false, code: "PLUGIN_DRAFT_STALE", message: "Draft changed" });
  await firstRejected;
  const second = h.api.onPanelInvoke("chat.insert", { text: "reply", ...data.context });
  const secondRejected = assert.rejects(second, { code: "PLUGIN_UNLOADED" });
  await takeDraft(h);
  await h.api.onUnload();
  await secondRejected;
  assert.equal(h.operations.length, 0);
});

test("failed migration backup stops loading and cannot overwrite original history on unload", async () => {
  const old = { version: 1, activeId: "old", conversations: [{ id: "old", title: "keep", messages: [{ role: "user", content: "keep me" }] }] };
  const h = host(old, { failBackup: true });
  await assert.rejects(h.api.onLoad(), { code: "EACCES" });
  await h.api.onUnload();
  assert.deepEqual(JSON.parse(h.files.get("/private/conversations.json")), old);
});

test("a session switch during workspace lookup cannot mix session A with project B", async () => {
  const behavior = {}; const h = host(undefined, behavior); await boot(h);
  behavior.onWorkspaceRead = () => h.switchTo("b1", "D:/projects/B", "project-b");
  const data = await h.api.onPanelInvoke("chat.context");
  assert.equal(data.context.sessionId, "b1");
  assert.equal(data.context.projectKey, "project:project-b");
});

test("viewing another project's history does not authorize deleting it", async () => {
  const h = host(); const a = await boot(h);
  h.switchTo("b1", "D:/projects/B", "project-b");
  await h.api.onPanelInvoke("chat.context");
  await assert.rejects(h.api.onPanelInvoke("chat.delete", { projectKey: a.context.projectKey, id: a.snapshot.activeId }), { code: "STALE_CONTEXT" });
});

test("all reasoning levels persist; xhigh/max reach completion unchanged and off retains omission", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const levels = manifest.contributes.settings.find(setting => setting.key === "thinkingLevel").enum.map(option => option.value);
  assert.deepEqual(levels, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  const h = host(); await boot(h);
  for (const thinkingLevel of levels) {
    const saved = await h.api.onPanelInvoke("chat.setSettings", { thinkingLevel });
    assert.equal(saved.settings.thinkingLevel, thinkingLevel);
    assert.equal((await h.api.onPanelInvoke("chat.bootstrap")).settings.thinkingLevel, thinkingLevel);
    const job = await send(h, `reasoning ${thinkingLevel}`); await settle(h, job.jobId);
    assert.equal(h.completions.at(-1).thinkingLevel, thinkingLevel === "off" ? undefined : thinkingLevel);
    assert.equal(h.completions.at(-1).modelKey, "mock/model");
  }
  const invalid = await h.api.onPanelInvoke("chat.setSettings", { thinkingLevel: "unknown" });
  assert.equal(invalid.settings.thinkingLevel, "low");
});

test("standalone history has one permanent entry while a project is active", async () => {
  const h = host(); const data = await boot(h);
  assert.equal(data.projects.filter(project => project.key === "general").length, 1);
  assert.equal(data.projects[0].key, "general");
  const standalone = await h.api.onPanelInvoke("chat.history", { projectKey: "general" });
  assert.equal(standalone.snapshot.projectKey, "general");
  assert.equal(standalone.snapshot.conversations[0].messages.length, 0);
  assert.equal((await h.api.onPanelInvoke("chat.context")).context.projectKey, data.context.projectKey);
});

test("all non-project sessions share general history without borrowing an open workspace", async () => {
  const h = host(); const project = await boot(h);
  h.switchTo("standalone-1", null); h.setWorkspace({ path: "D:/projects/A", name: "A", projectId: "project-a" });
  const first = await h.api.onPanelInvoke("chat.context");
  assert.equal(first.context.projectKey, "general");
  assert.equal(first.context.projectPath, "");
  const a = await send(h, "first standalone history"); await settle(h, a.jobId);
  await h.api.onPanelInvoke("chat.new", { sessionId: "standalone-1", projectKey: "general" });
  h.switchTo("standalone-2", null); h.setWorkspace({ path: "D:/projects/B", name: "B", projectId: "project-b" });
  const b = await send(h, "second standalone history"); await settle(h, b.jobId);
  const history = await h.api.onPanelInvoke("chat.history", { projectKey: "general" });
  assert.equal(history.snapshot.conversations.length, 2);
  assert.ok(JSON.stringify(history.snapshot).includes("first standalone history"));
  assert.ok(JSON.stringify(history.snapshot).includes("second standalone history"));
  assert.equal(history.projects.filter(item => item.key === "general").length, 1);
  assert.ok(!history.projects.some(item => item.key === "project:project-b"));
  const untouched = await h.api.onPanelInvoke("chat.history", { projectKey: project.context.projectKey });
  assert.deepEqual(JSON.parse(JSON.stringify(untouched.snapshot)), JSON.parse(JSON.stringify(project.snapshot)));
});

test("existing general records survive reload intact while project and legacy buckets stay unchanged", async () => {
  const state = (id, text) => ({ version: 1, activeId: id, conversations: [{ id, title: text, createdAt: "2026-01-01", updatedAt: "2026-01-01", messages: [{ id: `m-${id}`, role: "user", content: text, createdAt: "2026-01-01", error: false }] }] });
  const general = state("solo-2", "saved standalone two");
  general.conversations.push(...state("solo-1", "saved standalone one").conversations);
  const initial = { version: 2, projects: [
    { key: "project:project-a", name: "A", state: state("a", "project A only") },
    { key: "general", name: "无项目", state: general },
    { key: "project:project-b", name: "B", state: state("b", "project B only") },
    { key: "legacy", name: "Legacy history", state: state("legacy", "unclassified legacy only") },
  ] };
  const h = host(initial); await boot(h);
  const loaded = await h.api.onPanelInvoke("chat.history", { projectKey: "general" });
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.snapshot.conversations)), general.conversations);
  assert.equal(loaded.snapshot.activeId, general.activeId);
  assert.ok(!JSON.stringify(loaded.snapshot).includes("project A only"));
  assert.ok(!JSON.stringify(loaded.snapshot).includes("unclassified legacy only"));
  await h.api.onUnload();
  const saved = JSON.parse(h.files.get("/private/conversations.json"));
  assert.equal(saved.version, 2);
  assert.equal(saved.projects.filter(item => item.key === "general").length, 1);
  assert.deepEqual(saved.projects.find(item => item.key === "general").state, general);
  assert.deepEqual(saved.projects.filter(item => item.key !== "general"), initial.projects.filter(item => item.key !== "general"));
  const restored = host(saved); await boot(restored);
  const again = await restored.api.onPanelInvoke("chat.history", { projectKey: "general" });
  assert.deepEqual(JSON.parse(JSON.stringify(again.snapshot.conversations)), general.conversations);
});

test("a late standalone reply stays out of project history after switching", async () => {
  const h = host(); h.switchTo("standalone-1", null); await boot(h); h.delay();
  const job = await send(h, "slow standalone question");
  for (let i = 0; i < 20 && !h.completions.length; i++) await new Promise(setImmediate);
  h.switchTo("a1", "D:/projects/A", "project-a"); await h.api.onPanelInvoke("chat.context"); h.finish();
  const done = await settle(h, job.jobId);
  assert.equal(done.snapshot.projectKey, "general");
  assert.ok(JSON.stringify(done.snapshot).includes("slow standalone question"));
  const project = await h.api.onPanelInvoke("chat.context");
  assert.equal(project.context.projectKey, "project:project-a");
  assert.equal(project.snapshot.conversations[0].messages.length, 0);
});

test("sharing standalone history does not authorize stale sends or draft returns", async () => {
  const h = host(); h.switchTo("standalone-1", null); const first = await boot(h);
  h.switchTo("standalone-2", null);
  for (const channel of ["chat.send", "chat.insert"]) await assert.rejects(h.api.onPanelInvoke(channel, { text: "stale", projectKey: first.context.projectKey, sessionId: first.context.sessionId }), { code: "STALE_CONTEXT" });
  assert.equal(h.completions.length, 0);
});

async function attachThroughPanel(h, target, name = "note.txt", data = Buffer.from("actual selected text"), mimeType = "text/plain") {
  const { id } = await h.api.onPanelInvoke("chat.attachment.begin", { ...target, name, size: data.length, mimeType });
  await h.api.onPanelInvoke("chat.attachment.chunk", { ...target, id, offset: 0, data: data.toString("base64") });
  return h.api.onPanelInvoke("chat.attachment.finish", { ...target, id });
}
test("panel upload, persistence and send reach an independent read-only attachment session", async () => {
  const h = host(null, { attachments: true }), booted = await boot(h);
  const target = { ...booted.context, conversationId: booted.snapshot.activeId };
  const file = await attachThroughPanel(h, target);
  const sent = await h.api.onPanelInvoke("chat.send", { ...target, text: "", attachments: [file], includeSession: false });
  const done = await settle(h, sent.jobId);
  assert.equal(sent.backend, "agent"); assert.equal(done.status, "done"); assert.equal(done.text, "attachment backend reply");
  assert.equal(h.completions.length, 0);
  const prompt = h.operations.find(op => op.operation === "agent/prompt").args[0];
  assert.equal(prompt.sessionId, "side-1"); assert.equal(prompt.attachments[0].name, "note.txt");
  assert.equal(h.operations.find(op => op.operation === "session/create").args[0].mode, "plan");
  assert.ok(!h.operations.some(op => op.operation === "session/get" && op.args[0].id === "a1"));
  const active = done.snapshot.conversations.find(c => c.id === target.conversationId);
  assert.equal(active.messages[0].attachments[0].id, file.id);
  const again = await h.api.onPanelInvoke("chat.send", { ...target, text: "follow up", includeSession: false }); await settle(h, again.jobId);
  assert.equal(h.operations.filter(op => op.operation === "session/create").length, 1);
  assert.match(h.files.get("/private/conversations.json"), /note\.txt/);
  await h.api.onUnload();
});
test("attachment upload rejects stale conversations and supports old-scope cleanup after switching projects", async () => {
  const h = host(), booted = await boot(h), target = { ...booted.context, conversationId: booted.snapshot.activeId };
  await assert.rejects(h.api.onPanelInvoke("chat.attachment.begin", { ...target, conversationId: "stale", name: "a.txt", size: 1 }), /conversation changed/i);
  const { id } = await h.api.onPanelInvoke("chat.attachment.begin", { ...target, name: "a.txt", size: 1 });
  h.switchTo("b1", "D:/projects/B", "project-b");
  await assert.rejects(h.api.onPanelInvoke("chat.attachment.chunk", { ...target, id, offset: 0, data: "eA==" }), /Session changed/);
  const removed = await h.api.onPanelInvoke("chat.attachment.discard", { ...target, id }); assert.equal(removed.ok, true);
  await h.api.onUnload();
});
test("attachment metadata survives store reload without changing legacy text messages", () => {
  const { createStore } = require("../store.js"), store = createStore();
  store.addUserMessage("plain"); const before = store.active().messages[0];
  const file = { id: "id", name: "note.txt", size: 3, mimeType: "text/plain", kind: "file" };
  store.addUserMessage("", [file]); const restored = createStore(); restored.load(store.snapshot());
  assert.deepEqual(restored.active().messages[0], { ...before, error: false });
  assert.deepEqual(restored.active().messages[1].attachments, [file]);
});

test("cold path and host-ID changes do not list automatic empty shadow histories", async () => {
  const h = host(); h.switchTo("a1", "D:/projects/A"); const cold = await boot(h);
  assert.equal(cold.context.projectKey, "path:d:/projects/a");
  h.setWorkspace({ path: "D:/projects/A", name: "A", projectId: "project-a" });
  const warm = await h.api.onPanelInvoke("chat.context");
  assert.deepEqual(Array.from(warm.projects, p => p.key), ["general", "project:project-a"]);
  h.setWorkspace({ path: "D:/projects/A", name: "A" });
  const missing = await h.api.onPanelInvoke("chat.context");
  assert.deepEqual(Array.from(missing.projects, p => p.key), ["general", "path:d:/projects/a"]);
  h.setWorkspace({ path: "D:/projects/A", name: "A", projectId: "project-a" });
  const again = await h.api.onPanelInvoke("chat.context");
  assert.deepEqual(Array.from(again.projects, p => p.key), ["general", "project:project-a"]);
  await h.api.onUnload();
  const saved = JSON.parse(h.files.get("/private/conversations.json"));
  assert.ok(saved.projects.some(p => p.key === cold.context.projectKey), "hidden shadows must not be deleted");
});
test("legacy project IDs and unrelated empty projects do not pollute the history picker", async () => {
  const h = host(); h.switchTo("a1", "D:/projects/A", "legacy:D:/projects/A"); await boot(h);
  h.switchTo("a2", "D:/projects/A", "project-a");
  let data = await h.api.onPanelInvoke("chat.context");
  assert.deepEqual(Array.from(data.projects, p => p.key), ["general", "project:project-a"]);
  h.switchTo("b1", "D:/projects/B", "project-b"); await h.api.onPanelInvoke("chat.context");
  h.switchTo("a2", "D:/projects/A", "project-a"); data = await h.api.onPanelInvoke("chat.context");
  assert.ok(!data.projects.some(p => p.key === "project:project-b"));
  const target = { sessionId: data.context.sessionId, projectKey: data.context.projectKey };
  const created = await h.api.onPanelInvoke("chat.new", target);
  const selected = await h.api.onPanelInvoke("chat.select", { ...target, id: created.snapshot.activeId });
  const history = await h.api.onPanelInvoke("chat.history", target);
  const removed = await h.api.onPanelInvoke("chat.delete", { ...target, id: created.snapshot.activeId });
  for (const reply of [created, selected, history, removed]) assert.deepEqual(Array.from(reply.projects, p => p.key), ["general", "project:project-a"]);
});
test("hidden empty saved buckets survive reload byte-for-structure while real same-name histories stay separate", async () => {
  const state = (id, messages = [], title = "") => ({ version: 1, activeId: id, conversations: [{ id, title, createdAt: "2026-01-01", updatedAt: "2026-01-01", messages }] });
  const message = value => ({ id: value, role: "user", content: value, createdAt: "2026-01-01", error: false });
  const initial = { version: 2, projects: [
    { key: "path:d:/projects/a", name: "A", state: state("shadow") },
    { key: "project:legacy:D:/projects/A", name: "A", state: state("legacy-shadow") },
    { key: "project:project-a", name: "A", state: state("a", [message("A-only")]) },
    { key: "project:other-a", name: "A", state: state("b", [message("other-A-only")]) },
    { key: "project:named-empty", name: "Named", state: state("named", [], "Deliberately named") },
    { key: "legacy", name: "Legacy history", state: state("old") },
  ] };
  const h = host(initial), data = await boot(h);
  assert.deepEqual(Array.from(data.projects, p => p.key), ["general", "project:project-a", "project:other-a", "project:named-empty", "legacy"]);
  const other = await h.api.onPanelInvoke("chat.history", { projectKey: "project:other-a" });
  assert.equal(other.snapshot.conversations[0].messages[0].content, "other-A-only");
  assert.ok(!JSON.stringify(other.snapshot).includes('"A-only"'));
  await h.api.onUnload();
  const saved = JSON.parse(h.files.get("/private/conversations.json"));
  assert.deepEqual(saved.projects.filter(p => p.key !== "general"), initial.projects);
  const restored = host(saved), again = await boot(restored);
  assert.deepEqual(Array.from(again.projects, p => p.key), Array.from(data.projects, p => p.key));
});
test("two nonempty identities for the same folder retain messages and attachment IDs without merging", async () => {
  const h = host(null, { attachments: true }); h.switchTo("a1", "D:/projects/A"); const cold = await boot(h);
  const target = { ...cold.context, conversationId: cold.snapshot.activeId };
  const file = await attachThroughPanel(h, target, "old.txt", Buffer.from("old scoped attachment"));
  await settle(h, (await h.api.onPanelInvoke("chat.send", { ...target, text: "path history", attachments: [file], includeSession: false })).jobId);
  h.setWorkspace({ path: "D:/projects/A", name: "A", projectId: "project-a" });
  const job = await send(h, "project ID history"); await settle(h, job.jobId);
  const data = await h.api.onPanelInvoke("chat.context");
  assert.equal(data.projects.filter(p => p.name === "A").length, 2, "nonempty histories cannot be merged by name/path");
  const old = await h.api.onPanelInvoke("chat.history", { projectKey: cold.context.projectKey });
  assert.equal(old.snapshot.conversations[0].messages[0].attachments[0].id, file.id);
  assert.ok(!JSON.stringify(old.snapshot).includes("project ID history"));
  await assert.rejects(h.api.onPanelInvoke("chat.delete", { projectKey: cold.context.projectKey, id: old.snapshot.activeId }), { code: "STALE_CONTEXT" });
});
test("repeated context refreshes and Windows slash/case variants do not create duplicate keys", async () => {
  const h = host(); h.switchTo("a1", "D:/projects/A"); const first = await boot(h);
  for (let i = 0; i < 10; i++) {
    h.switchTo("a1", i % 2 ? "d:\\PROJECTS\\a\\" : "D:/projects/A/");
    const data = await h.api.onPanelInvoke("chat.context");
    assert.equal(data.context.projectKey, first.context.projectKey);
    assert.equal(data.projects.filter(p => p.key === first.context.projectKey).length, 1);
  }
});
