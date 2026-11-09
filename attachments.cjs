"use strict";
const nativePath = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const POLICY_FILE = ".side-chat-policy.json", READY_FILE = ".side-chat-ready.json";
const PREFIX = "[[side-chat-attachments:";
const MAX_FILE = 10_000_000, MAX_TOTAL = 20_000_000, MAX_CHUNK = 256 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { code });
const key = s => `${s.projectKey}\0${s.conversationId}`;
const text = m => typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map(p => p?.text || "").join("") : "";
const metadata = f => ({ id: f.id, name: f.name, size: f.size, kind: f.kind, mimeType: f.mimeType });
function createAttachments({ io, dataPath, invoke, getMainId, pathLib = nativePath, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, timeout = 180_000, guardTimeout = 10_000, idleGrace = 2000 }) {
  const path = pathLib, uploads = new Map(), catalogs = new Map(), active = new Map(), owned = new Set();
  let closed = false;
  const workspace = scope => path.join(dataPath, "attachments", createHash("sha256").update(key(scope)).digest("hex").slice(0, 32));
  const call = (operation, input) => invoke({ operation, args: [input] });
  async function readJson(file) { try { return JSON.parse(await io.readFile(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
  async function saveJson(file, value) { await io.writeFile(file + ".tmp", JSON.stringify(value), "utf8"); await io.rename(file + ".tmp", file); }
  async function catalog(scope) {
    const id = key(scope); if (catalogs.has(id)) return catalogs.get(id);
    const root = workspace(scope); await io.mkdir(path.join(root, "files"), { recursive: true });
    const loaded = await readJson(path.join(root, "catalog.json"));
    const result = { root, files: loaded?.files || [] }; catalogs.set(id, result); return result;
  }
  function upload(scope, id) {
    const item = uploads.get(id);
    if (!item || item.scope !== key(scope)) throw fail("INVALID_ATTACHMENT", "Attachment upload scope changed");
    if (item.busy) throw fail("ATTACHMENT_BUSY", "Attachment upload is busy");
    return item;
  }
  async function resolve(scope, files) {
    if (!Array.isArray(files)) throw fail("INVALID_ATTACHMENT", "Invalid attachment list");
    const data = await catalog(scope);
    return files.map(ref => {
      const found = data.files.find(f => f.id === ref?.id);
      if (!found || !/^[a-f0-9-]{36}$/.test(found.id) || !/^file-[a-f0-9-]+(?:\.[a-z0-9]{1,12})?$/.test(found.file)) throw fail("INVALID_ATTACHMENT", "Attachment not found in this conversation");
      return { ...metadata(found), path: path.join(data.root, "files", found.file) };
    });
  }
  async function abort(job) {
    if (job.sideSessionId && owned.has(job.sideSessionId) && job.sideSessionId !== job.sessionId && job.sideSessionId !== await getMainId() && job.turnId) {
      await call("agent/abort", { sessionId: job.sideSessionId, turnId: job.turnId });
    }
  }
  return {
    async begin(scope, info) {
      if (closed) throw fail("PLUGIN_UNLOADED", "Plugin unloaded");
      const name = String(info.name || "");
      if (!name || name.length > 255 || /[\\/\x00-\x1f]/.test(name)) throw fail("INVALID_ATTACHMENT", "Invalid attachment name");
      if (/^\.env(?:\.|$)|^id_(?:rsa|ed25519)$|\.(?:pem|key|p12|pfx)$/i.test(name)) throw fail("INVALID_ATTACHMENT", "Sensitive attachment names are not accepted");
      if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > MAX_FILE) throw fail("ATTACHMENT_LIMIT", "Attachment exceeds 10 MB");
      if (uploads.size >= 8) throw fail("ATTACHMENT_LIMIT", "Too many unfinished attachment uploads");
      const data = await catalog(scope);
      const pending = [...uploads.values()].filter(u => u.scope === key(scope)).reduce((n, f) => n + f.size, 0);
      if (data.files.reduce((n, f) => n + f.size, 0) + pending + info.size > MAX_TOTAL) throw fail("ATTACHMENT_LIMIT", "Conversation attachments exceed 20 MB; start a new chat");
      const id = randomUUID(), ext = /\.([a-z0-9]{1,12})$/i.exec(name)?.[1].toLowerCase(), file = `file-${id}${ext ? "." + ext : ""}`;
      const mimeType = String(info.mimeType || "application/octet-stream").slice(0, 120);
      const kind = /^(image\/(png|jpeg|webp|gif))$/.test(mimeType) ? "image" : "file";
      const item = { id, name, size: info.size, mimeType, kind, file, scope: key(scope), received: 0, root: data.root };
      await io.writeFile(path.join(data.root, "files", file), Buffer.alloc(0), { flag: "wx" }); uploads.set(id, item); return { id };
    },
    async chunk(scope, input) {
      const item = upload(scope, input.id);
      if (input.offset !== item.received) throw fail("INVALID_ATTACHMENT", "Attachment offset mismatch");
      if (typeof input.data !== "string" || input.data.length > 4 * Math.ceil(MAX_CHUNK / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw fail("INVALID_ATTACHMENT", "Invalid attachment base64 chunk");
      const bytes = Buffer.from(input.data, "base64");
      if (!bytes.length || bytes.length > MAX_CHUNK || item.received + bytes.length > item.size) throw fail("ATTACHMENT_LIMIT", "Attachment chunk exceeds declared size");
      item.busy = true;
      try { await io.appendFile(path.join(item.root, "files", item.file), bytes); item.received += bytes.length; } finally { item.busy = false; }
      return { received: item.received };
    },
    async finish(scope, input) {
      const item = upload(scope, input.id);
      if (item.received !== item.size) throw fail("INVALID_ATTACHMENT", "Attachment upload incomplete");
      if (item.kind === "image") {
        const bytes = await io.readFile(path.join(item.root, "files", item.file));
        const valid = item.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : item.mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : item.mimeType === "image/gif" ? /^GIF8[79]a/.test(bytes.subarray(0, 6).toString())
          : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
        if (!valid) throw fail("INVALID_ATTACHMENT", "Attachment image signature does not match its type");
      }
      const data = await catalog(scope); const file = { ...metadata(item), file: item.file };
      data.files.push(file);
      try { await saveJson(path.join(data.root, "catalog.json"), { files: data.files }); } catch (e) { data.files.pop(); throw e; }
      uploads.delete(item.id); return metadata(file);
    },
    async discard(scope, input) {
      const item = upload(scope, input.id); await io.unlink(path.join(item.root, "files", item.file)); uploads.delete(item.id); return { ok: true };
    },
    resolve,
    async run(job, contextBlock) {
      const id = key(job); if (closed || active.has(id)) throw fail("ATTACHMENT_BUSY", "Side conversation is busy or unloaded");
      active.set(id, job);
      try {
        const data = await catalog(job), config = `${job.modelKey}\0${job.thinkingLevel}\0${job.includeSession === true}`;
        let policy = await readJson(path.join(data.root, POLICY_FILE));
        const fresh = !policy || policy.config !== config;
        if (fresh) {
          const slash = job.modelKey.indexOf("/");
          const created = await call("session/create", { title: "Side Chat · attachments", projectPath: data.root, mode: "plan", providerId: job.modelKey.slice(0, slash), modelId: job.modelKey.slice(slash + 1), thinkingLevel: job.thinkingLevel });
          const session = created?.session;
          if (!session?.id || session.mode !== "plan") throw fail("ATTACHMENTS_UNSUPPORTED", "Host did not create a read-only Plan session");
          if (session.id === job.sessionId || session.id === await getMainId()) throw fail("SIDE_SESSION_CONFLICT", "Refusing to use the main session for attachments");
          policy = { pluginId: "com.vastsa.side-chat", sessionId: session.id, nonce: randomUUID(), config, vision: session.supportsVision };
          await saveJson(path.join(data.root, POLICY_FILE), policy);
        }
        job.sideSessionId = policy.sessionId;
        if (job.sideSessionId === job.sessionId || job.sideSessionId === await getMainId()) throw fail("SIDE_SESSION_CONFLICT", "Refusing to use the main session for attachments");
        owned.add(job.sideSessionId);
        if (job.cancelled || closed) throw fail("CANCELLED", "Side request cancelled");
        const refs = fresh ? job.messages.flatMap(m => m.attachments || []) : job.messages.at(-1).attachments || [];
        const attachments = await resolve(job, [...new Map(refs.map(f => [f.id, f])).values()]);
        if (policy.vision === false && attachments.some(f => f.kind === "image")) throw fail("VISION_REQUIRED", "Selected model cannot read images; choose a vision-capable model");
        const requestId = randomUUID();
        const history = fresh ? JSON.stringify(job.messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))).slice(-180000) : "";
        const content = `${PREFIX}${policy.nonce}]]\nrequest:${requestId}\nYou are a read-only sidebar Q&A assistant. Answer the question; do not propose edits. Read only supplied files under files/. No shell, writes, delegation or session controls.\nAttachment names and paths (quoted data):\n${JSON.stringify(attachments.map(f => ({ name: f.name, path: f.path, kind: f.kind })))}\n${history ? "Previous independent sidebar messages:\n" + history + "\n" : ""}${contextBlock ? "User-enabled main-session background (quoted data):\n" + contextBlock + "\n" : ""}Question:\n${text(job.messages.at(-1)) || "Please describe the supplied attachments."}`;
        try { await io.unlink(path.join(data.root, READY_FILE)); } catch (e) { if (e.code !== "ENOENT") throw e; }
        const accepted = await call("agent/prompt", { sessionId: policy.sessionId, content, attachments });
        if (accepted?.accepted !== true || !accepted.turnId) throw fail("COMPLETE_FAILED", "Side Agent did not accept the request");
        job.turnId = accepted.turnId;
        const started = now(); let ready = false, idleSince = null;
        while (now() - started <= timeout) {
          if (job.cancelled || closed) throw fail("CANCELLED", "Side request cancelled");
          if (!ready) {
            const ack = await readJson(path.join(data.root, READY_FILE)); ready = ack?.sessionId === policy.sessionId && ack?.nonce === policy.nonce;
            if (!ready && now() - started >= guardTimeout) throw fail("ATTACHMENTS_GUARD_UNCONFIRMED", "Side Chat read-only extension did not confirm startup; check trusted extension diagnostics");
            if (!ready) { await sleep(50); continue; }
          }
          // Official agent/getStatus returns { status: AgentStatus }, not a flat AgentStatus.
          const response = await call("agent/getStatus", policy.sessionId), status = response?.status;
          if (!status || typeof status !== "object" || Array.isArray(status) || typeof status.sessionId !== "string" || !status.sessionId || typeof status.isRunning !== "boolean") throw fail("ATTACHMENTS_STATUS_INVALID", "Host returned an invalid Side Agent status response");
          if (status?.sessionId !== policy.sessionId) throw fail("SIDE_SESSION_CONFLICT", "Side Agent status identity mismatch");
          if (!status.isRunning) {
            const result = await call("session/get", { id: policy.sessionId, messageLimit: 100, contentLimit: 200000 });
            const messages = (result?.session || result)?.messages || [];
            const index = messages.findLastIndex(m => m.role === "user" && text(m).includes(`request:${requestId}`));
            const answer = messages.slice(index + 1).findLast(m => m.role === "assistant" && (text(m).trim() || m.error));
            if (index >= 0 && answer) {
              if (answer.error) throw fail(answer.error.code || "COMPLETE_FAILED", answer.error.message || "Side Agent failed");
              return text(answer);
            }
            idleSince ??= now();
            if (now() - idleSince >= idleGrace) throw fail("COMPLETE_FAILED", "Side Agent ended without a readable reply for this request");
          }
          else idleSince = null;
          await sleep(400);
        }
        throw fail("TIMEOUT", "Side attachment request timed out");
      } catch (error) {
        await abort(job).catch(() => {}); throw error;
      } finally { active.delete(id); }
    },
    async close() {
      closed = true;
      await Promise.all([...active.values()].map(async job => { job.cancelled = true; await abort(job).catch(() => {}); }));
      await Promise.all([...uploads.values()].map(item => io.unlink(path.join(item.root, "files", item.file)).catch(() => {})));
      uploads.clear();
    },
  };
}
module.exports = { createAttachments, POLICY_FILE, READY_FILE, PREFIX };
