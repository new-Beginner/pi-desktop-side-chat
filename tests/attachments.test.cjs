"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), sync = require("node:fs"), path = require("node:path");
const { createAttachments, POLICY_FILE, READY_FILE, PREFIX } = require("../attachments.cjs");
const manifest = require("../manifest.json");
const guardEntry = path.resolve(__dirname, "..", manifest.contributes.agentExtensions[0]);
const guardFactory = require(guardEntry);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3sAAAAASUVORK5CYII=", "base64");
const scope = { projectKey: "project:a", conversationId: "conversation-a" };
async function setup(t, behavior = {}) {
  assert.ok(process.env.PI_SCRATCH_DIR, "PI_SCRATCH_DIR required");
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR, "side-attachments-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [], sessions = new Map(); let counter = 0, clock = 0;
  const invoke = async (input) => {
    calls.push(input); const value = input.args?.[0];
    if (input.operation === "session/create") {
      const session = { ...value, supportsVision: behavior.noVision !== true, id: behavior.mainId || `side-${++counter}` }; sessions.set(session.id, { session, messages: [] }); return { session };
    }
    if (input.operation === "agent/prompt") {
      const record = sessions.get(value.sessionId);
      if (!behavior.noGuard) {
        const handlers = {};
        guardFactory({ on: (name, fn) => { handlers[name] = fn; }, getAllTools: () => ["Read", "Glob", "Grep", "Write"].map(name => ({ name })), setActiveTools: names => { record.activeTools = names; } });
        // Installed 0.22.0 emits no sessionId here. Do not manufacture the acknowledgement.
        handlers.before_agent_start({ type: "before_agent_start", messageType: "user", prompt: value.content, systemPrompt: "base" }, { cwd: record.session.projectPath });
      }
      record.messages.push({ role: "user", content: value.content });
      if (!behavior.noReply) record.messages.push({ role: "assistant", content: "read attachment content" });
      return { accepted: true, turnId: `turn-${calls.length}` };
    }
    if (input.operation === "agent/getStatus") {
      if (Object.hasOwn(behavior, "statusReply")) return typeof behavior.statusReply === "function" ? behavior.statusReply(value) : behavior.statusReply;
      return { status: { sessionId: value, isRunning: behavior.running === true, pendingToolConfirmations: 0 } };
    }
    if (input.operation === "session/get") return { session: { id: value.id, messages: sessions.get(value.id).messages } };
    if (input.operation === "agent/abort") return { ok: true };
    throw Error("Unexpected operation " + input.operation);
  };
  const manager = createAttachments({ io: fs, dataPath: root, invoke, getMainId: async () => "main-a", now: () => clock, sleep: async ms => { clock += ms; }, timeout: 1000, guardTimeout: 100, idleGrace: 200 });
  return { manager, calls, sessions, root };
}
async function upload(manager, name = "note.txt", bytes = Buffer.from("unique text: side-file"), mimeType = "text/plain", target = scope) {
  const begin = await manager.begin(target, { name, size: bytes.length, mimeType });
  if (bytes.length) await manager.chunk(target, { id: begin.id, offset: 0, data: bytes.toString("base64") });
  return manager.finish(target, { id: begin.id });
}
function job(files, extra = {}) {
  return { ...scope, sessionId: "main-a", modelKey: "mock/model", thinkingLevel: "high", includeSession: false,
    messages: [{ role: "user", content: "read this", attachments: files }], ...extra };
}
test("PNG and text bytes are staged privately and paths are not returned to the panel", async t => {
  const h = await setup(t), image = await upload(h.manager, "image.png", png, "image/png"), file = await upload(h.manager);
  assert.equal(image.kind, "image"); assert.equal(file.kind, "file"); assert.equal(image.path, undefined);
  const resolved = await h.manager.resolve(scope, [image, file]);
  assert.equal(resolved.length, 2); assert.deepEqual(await fs.readFile(resolved[0].path), png);
  assert.match(await fs.readFile(resolved[1].path, "utf8"), /unique text/);
});
test("upload validation rejects sensitive names, oversize data, wrong offsets and forged IDs", async t => {
  const { manager } = await setup(t);
  await assert.rejects(manager.begin(scope, { name: ".env", size: 2 }), /sensitive/i);
  await assert.rejects(manager.begin(scope, { name: "huge", size: 10000001 }), /10 MB/);
  const part = await manager.begin(scope, { name: "x.txt", size: 3 });
  await assert.rejects(manager.chunk(scope, { id: part.id, offset: 1, data: "YWJj" }), /offset/i);
  await assert.rejects(manager.chunk(scope, { id: part.id, offset: 0, data: "../bad" }), /base64/i);
  await assert.rejects(manager.finish(scope, { id: part.id }), /incomplete/i);
  await assert.rejects(manager.resolve(scope, [{ id: "../../elsewhere" }]), /attachment/i);
  const forged = await manager.begin(scope, { name: "fake.png", size: 3, mimeType: "image/png" });
  await manager.chunk(scope, { id: forged.id, offset: 0, data: "YWJj" });
  await assert.rejects(manager.finish(scope, { id: forged.id }), /signature/i);
});
test("another project/conversation cannot consume an upload or persisted attachment", async t => {
  const { manager } = await setup(t), file = await upload(manager);
  await assert.rejects(manager.resolve({ ...scope, projectKey: "project:b" }, [file]), /attachment/i);
  const pending = await manager.begin(scope, { name: "test.txt", size: 3 });
  await assert.rejects(manager.chunk({ ...scope, conversationId: "other" }, { id: pending.id, offset: 0, data: "YWJj" }), /scope/i);
});
test("file attachments and replies use a private Plan-mode session, never the main session", async t => {
  const h = await setup(t), file = await upload(h.manager), image = await upload(h.manager, "image.png", png, "image/png");
  const result = await h.manager.run(job([file, image]), ""); assert.equal(result, "read attachment content");
  const create = h.calls.find(c => c.operation === "session/create").args[0]; assert.equal(create.mode, "plan");
  assert.ok(create.projectPath.startsWith(h.root));
  const prompt = h.calls.find(c => c.operation === "agent/prompt").args[0];
  assert.equal(prompt.sessionId, "side-1"); assert.equal(prompt.attachments.length, 2); assert.match(prompt.content, /read this/);
  assert.ok(prompt.content.startsWith(PREFIX));
  for (const c of h.calls.filter(c => c.operation !== "session/create")) assert.ok(!JSON.stringify(c.args).includes('"main-a"'), "main session reached");
});
test("follow-ups reuse side context, but changing include-session/model starts a clean backend", async t => {
  const h = await setup(t), file = await upload(h.manager);
  await h.manager.run(job([file], { includeSession: true }), "MAIN_CONTEXT");
  await h.manager.run(job([], { includeSession: true, messages: [{ role: "user", content: "follow up", attachments: [file] }] }), "MAIN_CONTEXT_2");
  assert.equal(h.calls.filter(c => c.operation === "session/create").length, 1);
  await h.manager.run(job([file]), "");
  const prompts = h.calls.filter(c => c.operation === "agent/prompt").map(c => c.args[0]);
  assert.equal(prompts[2].sessionId, "side-2"); assert.ok(!prompts[2].content.includes("MAIN_CONTEXT"));
});
test("a host returning the main session ID is refused before any prompt", async t => {
  const h = await setup(t, { mainId: "main-a" }), file = await upload(h.manager);
  await assert.rejects(h.manager.run(job([file]), ""), /main session/i);
  assert.ok(!h.calls.some(c => c.operation === "agent/prompt"));
});
test("missing read-only guard or timeout aborts only the owned side turn", async t => {
  for (const behavior of [{ noGuard: true }, { running: true }]) {
    const h = await setup(t, behavior), file = await upload(h.manager);
    await assert.rejects(h.manager.run(job([file]), ""), behavior.noGuard ? { code: "ATTACHMENTS_GUARD_UNCONFIRMED", message: /did not confirm startup/ } : /timed out/);
    const abort = h.calls.find(c => c.operation === "agent/abort"); assert.equal(abort.args[0].sessionId, "side-1"); assert.ok(abort.args[0].turnId);
  }
});
test("guard narrows only its own session to read tools and rejects write/control/outside paths", async t => {
  const h = await setup(t), file = await upload(h.manager); await h.manager.run(job([file]), "");
  const record = h.sessions.get("side-1"), root = record.session.projectPath, policy = JSON.parse(await fs.readFile(path.join(root, POLICY_FILE), "utf8"));
  const handlers = {}, active = [];
  guardFactory({ on: (name, fn) => { handlers[name] = fn; }, getAllTools: () => ["Read", "Glob", "Grep", "Bash", "Write", "SessionTask"].map(name => ({ name })), setActiveTools: names => active.push(names) });
  handlers.before_agent_start({ sessionId: "main-a", prompt: "ordinary main question" }, { cwd: h.root }); assert.equal(active.length, 0);
  handlers.before_agent_start({ sessionId: "side-1", prompt: `${PREFIX}${policy.nonce}]]\nquestion`, systemPrompt: "original" }, { cwd: root });
  assert.deepEqual(active[0], ["Read", "Glob", "Grep"]);
  const local = (await h.manager.resolve(scope, [file]))[0].path;
  assert.equal(handlers.tool_call({ toolName: "Read", input: { path: local } }, { cwd: root }), undefined);
  for (const toolName of ["Write", "Edit", "Bash", "SessionTask", "ToolSearch"]) assert.equal(handlers.tool_call({ toolName, input: {} }, { cwd: root }).block, true);
  assert.equal(handlers.tool_call({ toolName: "Write", input: {} }, { cwd: h.root }), undefined, "foreign/main cwd must not be restricted");
  assert.equal(handlers.tool_call({ toolName: "Read", input: { path: path.join(h.root, "outside") } }, { cwd: root }).block, true);
  assert.ok(sync.existsSync(path.join(root, READY_FILE)));
  handlers.agent_end();
  assert.equal(handlers.tool_call({ toolName: "Write", input: {} }, { cwd: root }), undefined, "finished binding must be cleared");
});

test("multiple chunks preserve exact bytes and attachment catalog survives reload", async t => {
  const h = await setup(t), bytes = Buffer.alloc(600000, 97);
  const { id } = await h.manager.begin(scope, { name: "large.txt", size: bytes.length, mimeType: "text/plain" });
  for (let offset = 0; offset < bytes.length; offset += 256 * 1024) await h.manager.chunk(scope, { id, offset, data: bytes.subarray(offset, offset + 256 * 1024).toString("base64") });
  const file = await h.manager.finish(scope, { id });
  const reloaded = createAttachments({ io: fs, dataPath: h.root });
  assert.deepEqual(await fs.readFile((await reloaded.resolve(scope, [file]))[0].path), bytes);
});
test("unsupported vision is rejected before prompting and ended empty turns fail promptly", async t => {
  const noVision = await setup(t, { noVision: true }), image = await upload(noVision.manager, "picture.png", png, "image/png");
  await assert.rejects(noVision.manager.run(job([image]), ""), /vision-capable/);
  assert.ok(!noVision.calls.some(c => c.operation === "agent/prompt"));
  const empty = await setup(t, { noReply: true }), file = await upload(empty.manager);
  await assert.rejects(empty.manager.run(job([file]), ""), /ended without a readable reply/);
  assert.ok(empty.calls.filter(c => c.operation === "agent/getStatus").length < 5);
});

for (const scenario of [
  { name: "absent optional sessionId", accepted: true },
  { name: "matching sessionId", sessionId: "side-policy", accepted: true },
  { name: "mismatched sessionId", sessionId: "main-a" },
  { name: "wrong nonce", nonce: "wrong" },
  { name: "ordinary main prompt", prompt: "ordinary question" },
  { name: "foreign cwd", foreignCwd: true },
  { name: "foreign plugin policy", pluginId: "other.plugin" },
]) test(`guard handshake: ${scenario.name}`, async t => {
  const h = await setup(t), root = path.join(h.root, "private-side");
  await fs.mkdir(path.join(root, "files"), { recursive: true });
  await fs.writeFile(path.join(root, POLICY_FILE), JSON.stringify({ pluginId: scenario.pluginId || "com.vastsa.side-chat", sessionId: "side-policy", nonce: "expected-nonce" }));
  const handlers = {}, active = [];
  guardFactory({ on: (name, fn) => { handlers[name] = fn; }, getAllTools: () => ["Read", "Glob", "Grep", "Write"].map(name => ({ name })), setActiveTools: names => active.push(names) });
  const event = { type: "before_agent_start", messageType: "user", prompt: scenario.prompt || `${PREFIX}${scenario.nonce || "expected-nonce"}]]\nquestion`, systemPrompt: "base" };
  if (scenario.sessionId !== undefined) event.sessionId = scenario.sessionId;
  const start = () => handlers.before_agent_start(event, { cwd: scenario.foreignCwd ? h.root : root });
  const result = scenario.foreignCwd ? (assert.throws(start, /Side Chat attachment guard failed at policy \(ENOENT\)/), undefined) : start();
  assert.equal(sync.existsSync(path.join(root, READY_FILE)), scenario.accepted === true);
  assert.deepEqual(active, scenario.accepted ? [["Read", "Glob", "Grep"]] : []);
  if (scenario.accepted) {
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, READY_FILE), "utf8")), { sessionId: "side-policy", nonce: "expected-nonce" });
    assert.ok(result.systemPrompt.startsWith("base\n"));
    assert.equal(handlers.tool_call({ toolName: "Write", input: {} }, { cwd: root }).block, true);
  } else assert.equal(result, undefined);
});

test("installed host Runner loads guard and confirms startup without a model request", { skip: !process.env.SIDE_CHAT_HOST_RUNNER }, async t => {
  const { pathToFileURL } = require("node:url");
  const { TrustedExtensionRunner } = await import(pathToFileURL(path.resolve(process.env.SIDE_CHAT_HOST_RUNNER)).href);
  const h = await setup(t), root = h.root, active = [];
  await fs.mkdir(path.join(root, "files"));
  await fs.writeFile(path.join(root, POLICY_FILE), JSON.stringify({ pluginId: "com.vastsa.side-chat", sessionId: "side-installed", nonce: "installed-nonce" }));
  const runner = new TrustedExtensionRunner({
    specs: [{ id: guardEntry, label: "Side Chat", entry: guardEntry }],
    bridge: { cwd: root, publishCommands() {}, publishDiagnostics() {}, getAllTools: () => ["Read", "Glob", "Grep", "Write"].map(name => ({ name })), setActiveTools: names => active.push(names) },
  });
  t.after(() => runner.dispose());
  const reports = await runner.load();
  assert.equal(reports[0].state, "loaded");
  const result = await runner.emitBeforeAgentStart(`${PREFIX}installed-nonce]]\nquestion`, "base");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, READY_FILE), "utf8")), { sessionId: "side-installed", nonce: "installed-nonce" });
  assert.deepEqual(active, [["Read", "Glob", "Grep"]]);
  assert.ok(result.startsWith("base\n"));
  assert.deepEqual(runner.getDiagnostics(), []);
  await fs.unlink(path.join(root, READY_FILE));
  await fs.rmdir(path.join(root, "files"));
  assert.equal(await runner.emitBeforeAgentStart(`${PREFIX}installed-nonce]]\nPRIVATE_PROMPT_SENTINEL`, "base"), undefined);
  const diagnostic = runner.getDiagnostics().find(item => item.kind === "handler_error");
  assert.equal(diagnostic?.member, "before_agent_start");
  assert.match(diagnostic.message, /failed at files \(ENOENT\)/);
  assert.ok(!JSON.stringify(diagnostic).includes("PRIVATE_PROMPT_SENTINEL"));
  assert.ok(!sync.existsSync(path.join(root, READY_FILE)));
});

test("guard initialization failures reach official diagnostics without leaking prompt text", async t => {
  const h = await setup(t), handlers = {};
  await fs.mkdir(path.join(h.root, "files"));
  await fs.writeFile(path.join(h.root, POLICY_FILE), JSON.stringify({ pluginId: "com.vastsa.side-chat", sessionId: "side-errors", nonce: "error-nonce" }));
  guardFactory({
    on: (name, fn) => { handlers[name] = fn; },
    getAllTools() { throw Object.assign(Error("PRIVATE_PROMPT_SENTINEL"), { code: "E_TOOLS_TEST" }); },
    setActiveTools() { assert.fail("must not acknowledge after tool setup fails"); },
  });
  assert.throws(() => handlers.before_agent_start({ prompt: `${PREFIX}error-nonce]]\nPRIVATE_PROMPT_SENTINEL`, systemPrompt: "base" }, { cwd: h.root }), error => {
    assert.match(error.message, /Side Chat attachment guard failed at tools \(E_TOOLS_TEST\)/);
    assert.ok(!error.message.includes("PRIVATE_PROMPT_SENTINEL")); return true;
  });
  assert.ok(!sync.existsSync(path.join(h.root, READY_FILE)));
  assert.equal(handlers.tool_call({ toolName: "Write", input: {} }, { cwd: h.root }), undefined);
});

test("declared entry confirms startup after the installed Runner caches the legacy factory", { skip: !process.env.SIDE_CHAT_HOST_RUNNER }, async t => {
  const { pathToFileURL } = require("node:url");
  const { TrustedExtensionRunner } = await import(pathToFileURL(path.resolve(process.env.SIDE_CHAT_HOST_RUNNER)).href);
  const h = await setup(t), plugin = path.join(h.root, "plugin"), cwd = path.join(h.root, "private"), runners = [], active = [];
  await fs.mkdir(path.join(plugin, "agent"), { recursive: true }); await fs.mkdir(path.join(cwd, "files"), { recursive: true });
  await fs.copyFile(path.resolve(__dirname, "../attachments.cjs"), path.join(plugin, "attachments.cjs"));
  await fs.writeFile(path.join(cwd, POLICY_FILE), JSON.stringify({ pluginId: "com.vastsa.side-chat", sessionId: "side-warm", nonce: "warm-nonce" }));
  const current = await fs.readFile(guardEntry, "utf8"), legacy = current.replace("(event.sessionId !== undefined && policy.sessionId !== event.sessionId)", "policy.sessionId !== event.sessionId");
  assert.notEqual(current, legacy, "legacy reconstruction must retain the original mismatch");
  const legacyEntry = path.join(plugin, "agent", "attachment-guard.js"); await fs.writeFile(legacyEntry, legacy);
  const bridge = { cwd, publishCommands() {}, publishDiagnostics() {}, getAllTools: () => ["Read", "Glob", "Grep", "Write"].map(name => ({ name })), setActiveTools: names => active.push(names) };
  t.after(async () => { for (const runner of runners) await runner.dispose(); });
  const start = async entry => {
    const runner = new TrustedExtensionRunner({ bridge, specs: [{ id: sync.realpathSync(entry), entry, label: "Side Chat" }] }); runners.push(runner);
    assert.equal((await runner.load())[0].state, "loaded");
    return runner.emitBeforeAgentStart(`${PREFIX}warm-nonce]]\nquestion`, "base");
  };
  await start(legacyEntry); assert.ok(!sync.existsSync(path.join(cwd, READY_FILE)), "legacy factory should reproduce missing acknowledgement");
  await fs.writeFile(legacyEntry, current);
  await start(legacyEntry); assert.ok(!sync.existsSync(path.join(cwd, READY_FILE)), "same-entry reload should reproduce cached legacy code");
  const declaredEntry = path.join(plugin, manifest.contributes.agentExtensions[0]); await fs.writeFile(declaredEntry, current);
  const result = await start(declaredEntry);
  assert.ok(sync.existsSync(path.join(cwd, READY_FILE)), "release entry still reused the cached legacy factory");
  assert.deepEqual(active, [["Read", "Glob", "Grep"]]); assert.ok(result.startsWith("base\n"));
});

test("wrapped status is polled until idle before reading the side reply", async t => {
  let polls = 0;
  const h = await setup(t, { statusReply: id => ({ status: { sessionId: id, isRunning: ++polls < 3, pendingToolConfirmations: 0 } }) });
  assert.equal(await h.manager.run(job([await upload(h.manager)]), ""), "read attachment content");
  assert.equal(polls, 3);
  const read = h.calls.findIndex(call => call.operation === "session/get");
  assert.equal(h.calls.slice(0, read).filter(call => call.operation === "agent/getStatus").length, 3);
  assert.ok(h.calls.filter(call => call.operation === "agent/getStatus").every(call => call.args[0] === "side-1"));
});

test("wrapped status with a foreign identity is rejected without reading or aborting the main session", async t => {
  const h = await setup(t, { statusReply: { status: { sessionId: "main-a", isRunning: false, pendingToolConfirmations: 0 } } });
  await assert.rejects(h.manager.run(job([await upload(h.manager)]), ""), { code: "SIDE_SESSION_CONFLICT" });
  assert.ok(!h.calls.some(call => call.operation === "session/get"));
  assert.equal(h.calls.find(call => call.operation === "agent/abort").args[0].sessionId, "side-1");
});

for (const [name, statusReply] of [
  ["missing reply", undefined],
  ["missing envelope", {}],
  ["null status", { status: null }],
  ["missing running flag", { status: { sessionId: "side-1" } }],
  ["non-boolean running flag", { status: { sessionId: "side-1", isRunning: "false" } }],
  ["missing identity", { status: { isRunning: false } }],
  ["obsolete flat test response", { sessionId: "side-1", isRunning: false }],
]) test(`invalid status is not treated as idle: ${name}`, async t => {
  const h = await setup(t, { statusReply });
  await assert.rejects(h.manager.run(job([await upload(h.manager)]), ""), { code: "ATTACHMENTS_STATUS_INVALID" });
  assert.ok(!h.calls.some(call => call.operation === "session/get"));
  assert.equal(h.calls.find(call => call.operation === "agent/abort").args[0].sessionId, "side-1");
});

test("installed sidecar status IPC response reaches the attachment reply path without a model request", { skip: !process.env.SIDE_CHAT_HOST_SIDECAR, timeout: 20000 }, async t => {
  const { spawn } = require("node:child_process"), { createInterface } = require("node:readline");
  const child = spawn(process.execPath, [path.resolve(process.env.SIDE_CHAT_HOST_SIDECAR)], { stdio: ["pipe", "pipe", "ignore"], env: process.env });
  const lines = createInterface({ input: child.stdout }); let timer;
  const response = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Error("Installed sidecar status contract timed out")), 15000);
    child.once("error", reject); child.once("exit", () => reject(Error("Installed sidecar exited before status response")));
    lines.on("line", line => {
      try { const result = JSON.parse(line); if (result.id === 1) result.error ? reject(Error(result.error.message)) : resolve(result.result); }
      catch (error) { reject(error); }
    });
  });
  child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "agent.getStatus", params: { sessionId: "side-1" } }) + "\n");
  let statusReply;
  try { statusReply = await response; } finally { clearTimeout(timer); lines.close(); child.kill(); }
  assert.deepEqual(statusReply, { status: { sessionId: "side-1", isRunning: false, pendingToolConfirmations: 0 } });
  const h = await setup(t, { statusReply });
  assert.equal(await h.manager.run(job([await upload(h.manager)]), ""), "read attachment content");
});
