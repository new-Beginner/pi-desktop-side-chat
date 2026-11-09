"use strict";
// Official pi ExtensionAPI hooks. This is a Q&A tool policy, not a security sandbox.
const fs = require("node:fs");
const path = require("node:path");
const { POLICY_FILE, READY_FILE, PREFIX } = require("../attachments.cjs");
module.exports = function (pi) {
  let bound = null;
  pi.on("before_agent_start", (event, ctx) => {
    if (!String(event.prompt || "").startsWith(PREFIX)) { bound = null; return; }
    let stage = "cwd";
    try {
      const cwd = fs.realpathSync(ctx.cwd);
      stage = "policy";
      const policy = JSON.parse(fs.readFileSync(path.join(cwd, POLICY_FILE), "utf8"));
      // before_agent_start.sessionId is optional (absent in the installed 0.22.0 Runner).
      // Bind through this private cwd + nonce; reject an explicit foreign identity.
      if (policy.pluginId !== "com.vastsa.side-chat" || (event.sessionId !== undefined && policy.sessionId !== event.sessionId) || !event.prompt.startsWith(`${PREFIX}${policy.nonce}]]\n`)) return;
      stage = "files";
      bound = { cwd, files: fs.realpathSync(path.join(cwd, "files")) };
      stage = "tools";
      pi.setActiveTools(pi.getAllTools().filter(t => /^(Read|Glob|Grep)$/i.test(t.name)).map(t => t.name));
      stage = "ack";
      fs.writeFileSync(path.join(cwd, READY_FILE), JSON.stringify({ sessionId: policy.sessionId, nonce: policy.nonce }));
      return { systemPrompt: event.systemPrompt + "\nThis sidebar session is read-only. Only Read, Glob and Grep are available, restricted to the supplied files/ directory. Answer questions, do not write files or control any session." };
    } catch (error) {
      bound = null;
      // Let the official Runner publish handler_error; never log prompt/file contents.
      const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/i.test(error.code) ? error.code : "ERROR";
      throw new Error(`Side Chat attachment guard failed at ${stage} (${code})`);
    }
  });
  pi.on("tool_call", (event, ctx) => {
    if (!bound) return;
    const block = { block: true, reason: "Side Chat permits only read tools on its supplied attachments" };
    try {
      if (fs.realpathSync(ctx.cwd) !== bound.cwd) return;
      if (!/^(Read|Glob|Grep)$/i.test(event.toolName)) return block;
      const input = event.input || event.args || {};
      const value = input.file_path ?? input.path ?? input.directory;
      if (typeof value !== "string") return block;
      const target = fs.realpathSync(path.resolve(bound.cwd, value));
      const relative = path.relative(bound.files, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return block;
      if (typeof input.pattern === "string" && /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(input.pattern)) return block;
    } catch { return block; }
  });
  pi.on("agent_end", () => { bound = null; });
};
