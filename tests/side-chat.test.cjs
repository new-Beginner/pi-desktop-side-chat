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
  const fakeFs = {
    readFile: async (p) => { if (!files.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(p); },
    mkdir: async () => {},
    writeFile: async (p, text, options) => {
      if (behavior.failBackup && p.endsWith("conversations.v1.json")) throw Object.assign(new Error("backup denied"), { code: "EACCES" });
      if (options?.flag === "wx" && files.has(p)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      files.set(p, text);
    },
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
    desktop: { invoke: async (p) => {
      operations.push(p);
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
