"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { createAttachments, POLICY_FILE, READY_FILE } = require("../attachments.cjs");
const fixtures = path.join(__dirname, "fixtures/content");
const scope = { projectKey: "formats-project", conversationId: "formats-chat" };
const marker = "Extracted file content (quoted JSON data):\n";
async function setup(t) {
  assert.ok(process.env.PI_SCRATCH_DIR);
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR, "content-formats-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [], sessions = new Map(); let clock = 0;
  const invoke = async input => {
    calls.push(input); const value = input.args[0];
    if (input.operation === "session/create") { const session = { ...value, id: "side-format", supportsVision: true }; sessions.set(session.id, { ...session, messages: [] }); return { session }; }
    if (input.operation === "agent/prompt") {
      const session = sessions.get(value.sessionId), policy = JSON.parse(await fs.readFile(path.join(session.projectPath, POLICY_FILE), "utf8"));
      await fs.writeFile(path.join(session.projectPath, READY_FILE), JSON.stringify({ sessionId: session.id, nonce: policy.nonce }));
      session.messages.push({ role: "user", content: value.content }, { role: "assistant", content: "fixture reply" }); return { accepted: true, turnId: "format-turn" };
    }
    if (input.operation === "agent/getStatus") return { status: { sessionId: value, isRunning: false, pendingToolConfirmations: 0 } };
    if (input.operation === "session/get") return { session: sessions.get(value.id) };
    if (input.operation === "agent/abort") return { ok: true };
    throw Error("Unexpected operation " + input.operation);
  };
  const manager = createAttachments({ io: fs, dataPath: root, invoke, getMainId: async () => "main", now: () => clock, sleep: async ms => { clock += ms; }, guardTimeout: 100, timeout: 1000 });
  const upload = async (name, bytes, mimeType = "application/octet-stream") => {
    const started = await manager.begin(scope, { name, size: bytes.length, mimeType });
    for (let offset = 0; offset < bytes.length; offset += 256 * 1024) await manager.chunk(scope, { id: started.id, offset, data: bytes.subarray(offset, offset + 256 * 1024).toString("base64") });
    return manager.finish(scope, { id: started.id });
  };
  const run = async files => {
    assert.equal(await manager.run({ ...scope, sessionId: "main", modelKey: "fixture/model", thinkingLevel: "high", includeSession: false, messages: [{ role: "user", content: "Read the actual contents", attachments: files }] }, ""), "fixture reply");
    return calls.findLast(call => call.operation === "agent/prompt").args[0];
  };
  return { root, manager, calls, upload, run };
}
function documents(prompt) {
  assert.ok(prompt.content.includes(marker), "actual extracted contents are missing from the model input");
  return JSON.parse(prompt.content.split(marker)[1].split("\n")[0]);
}
for (const [name, expected] of [
  ["sample.docx", ["DOCX-SIDE-420", "DOCX-LAST-620", "泥石流", "12.5"]],
  ["sample.xlsx", ["XLSX-SIDE-421", "XLSX-LAST-621", "监测数据", "12.5", "SUM(B2:B3)"]],
  ["sample.pptx", ["PPTX-SIDE-422", "PPTX-LAST-622", "PPTX-NOTE-722"]],
  ["legacy.doc", ["Fixture Document", "Wide head"]],
  ["legacy.xls", ["Merged Grid", "1234.5"]],
  ["legacy.ppt", ["Deck Title Slide", "42", "Second slide notes"]],
]) test(`${name}: real Office contents reach agent/prompt as extracted UTF-8`, async t => {
  const h = await setup(t), bytes = await fs.readFile(path.join(fixtures, name)), file = await h.upload(name, bytes), prompt = await h.run([file]);
  const doc = documents(prompt).find(item => item.id === file.id);
  assert.equal(doc.name, name); for (const token of expected) assert.ok(doc.content.includes(token), `${name} lost ${token}`);
  const supplied = prompt.attachments[0]; assert.equal(supplied.kind, "file"); assert.equal(supplied.mimeType, "text/plain");
  assert.equal(await fs.readFile(supplied.path, "utf8"), doc.content);
  assert.deepEqual(await fs.readFile((await h.manager.resolve(scope, [file]))[0].path), bytes, "original file must remain unchanged");
});
for (const [name, value] of [
  ["note.txt", "中文正文\nTEXT-CONTENT-450\n最后一行"],
  ["data.json", '{"验证码":"JSON-CONTENT-451","velocity":12.5}'],
  ["source.c", "// 中文注释\nint main(void) { return 452; }\n"],
  ["kernel.cu", "__global__ void velocity(float *p) { p[threadIdx.x] = 453; }\n"],
  ["kernel.cuh", "#pragma once\n__device__ float depth = 454;\n"],
]) test(`${name}: text/code is preserved as data, not executed`, async t => {
  const h = await setup(t), prompt = await h.run([await h.upload(name, Buffer.from(value))]);
  assert.equal(documents(prompt)[0].content, value);
});
test("UTF-16 JSON and GB18030 C source are decoded and supplied as UTF-8", async t => {
  const h = await setup(t), json = '{"说明":"中文UTF16-460"}';
  const first = await h.upload("utf16.json", Buffer.concat([Buffer.from([255, 254]), Buffer.from(json, "utf16le")]));
  const second = await h.upload("gbk.c", await fs.readFile(path.join(fixtures, "sample-gbk.c")));
  const docs = documents(await h.run([first, second])); assert.equal(docs[0].content, json); assert.match(docs[1].content, /中文编码/);
});
for (const [source, name] of [["sample.png", "picture.PNG"], ["sample.jpg", "picture.jpg"], ["sample.jpg", "picture.jpeg"], ["sample.webp", "picture.webp"]]) test(`${name}: missing browser MIME is inferred, original image bytes reach the host`, async t => {
  const h = await setup(t), bytes = await fs.readFile(path.join(fixtures, source)), file = await h.upload(name, bytes, "");
  assert.equal(file.kind, "image"); const prompt = await h.run([file]); assert.equal(prompt.attachments[0].kind, "image");
  assert.deepEqual(await fs.readFile(prompt.attachments[0].path), bytes);
});
for (const [name, count] of [["single.tif", 1], ["multipage.tiff", 2], ["gray16.tif", 1]]) test(`${name}: all TIFF pages become real PNG image attachments`, async t => {
  const h = await setup(t), file = await h.upload(name, await fs.readFile(path.join(fixtures, name)), "image/tiff"), prompt = await h.run([file]);
  assert.equal(prompt.attachments.length, count);
  const { PNG } = require("../renderer/vendor/attachment-readers.cjs");
  for (const [index, image] of prompt.attachments.entries()) {
    assert.equal(image.mimeType, "image/png"); assert.equal(image.kind, "image");
    const bytes = await fs.readFile(image.path), decoded = PNG.sync.read(bytes); assert.ok(decoded.width > 0 && decoded.height > 0);
    if (name === "multipage.tiff") assert.deepEqual([...decoded.data.subarray(0, 4)], index === 0 ? [240, 20, 10, 255] : [10, 20, 240, 255]);
    if (name === "gray16.tif") assert.deepEqual([...decoded.data.subarray(0, 4)], [255, 255, 255, 255]);
  }
});
test("unsupported binary and malformed Office files fail before a model prompt", async t => {
  for (const [name, bytes] of [["broken.docx", Buffer.from("not a zip")], ["program.bin", Buffer.from([0, 1, 255, 0])]]) {
    const h = await setup(t), file = await h.upload(name, bytes);
    await assert.rejects(h.run([file]), error => /^ATTACHMENT_(PARSE_FAILED|UNSUPPORTED)$/.test(error.code));
    assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
  }
});
test("same-name attachments retain separate IDs and extracted contents", async t => {
  const h = await setup(t), a = await h.upload("same.txt", Buffer.from("FIRST-470")), b = await h.upload("same.txt", Buffer.from("SECOND-471"));
  const docs = documents(await h.run([a, b])); assert.deepEqual(docs.map(item => item.content), ["FIRST-470", "SECOND-471"]); assert.notEqual(docs[0].id, docs[1].id);
});

test("encrypted ZIP entry flags are refused before prompting", async t => {
  const h = await setup(t), bytes = Buffer.from(await fs.readFile(path.join(fixtures, "sample.docx")));
  const at = bytes.indexOf(Buffer.from([80, 75, 1, 2])); bytes.writeUInt16LE(bytes.readUInt16LE(at + 8) | 1, at + 8);
  const file = await h.upload("protected.docx", bytes);
  await assert.rejects(h.run([file]), { code: "ATTACHMENT_ENCRYPTED" }); assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
});
test("oversized Office expansion is rejected before decompression or prompting", async t => {
  const h = await setup(t), bytes = Buffer.from(await fs.readFile(path.join(fixtures, "sample.docx")));
  const at = bytes.indexOf(Buffer.from([80, 75, 1, 2])); bytes.writeUInt32LE(9 * 1024 * 1024, at + 24);
  const file = await h.upload("expanded.docx", bytes);
  await assert.rejects(h.run([file]), { code: "ATTACHMENT_CONTENT_LIMIT" }); assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
});
test("TIFF pixel overflow and cyclic page directories are rejected before prompting", async t => {
  for (const cycle of [false, true]) {
    const h = await setup(t), bytes = Buffer.from(await fs.readFile(path.join(fixtures, "single.tif"))), at = bytes.readUInt32LE(4), count = bytes.readUInt16LE(at);
    if (cycle) bytes.writeUInt32LE(at, at + 2 + count * 12);
    else for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if ([256, 257].includes(bytes.readUInt16LE(entry))) {
        if (bytes.readUInt16LE(entry + 2) === 3) bytes.writeUInt16LE(65535, entry + 8);
        else bytes.writeUInt32LE(65535, entry + 8);
      }
    }
    const file = await h.upload("invalid.tif", bytes, "image/tiff");
    await assert.rejects(h.run([file]), error => ["ATTACHMENT_CONTENT_LIMIT", "ATTACHMENT_PARSE_FAILED"].includes(error.code));
    assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
  }
});
test("oversized extracted text is refused rather than silently losing the ending", async t => {
  const h = await setup(t), file = await h.upload("large.cu", Buffer.from("x".repeat(256_001) + "LAST-LINE-MUST-NOT-DISAPPEAR"));
  await assert.rejects(h.run([file]), { code: "ATTACHMENT_CONTENT_LIMIT" }); assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
});
test("combined quoted content budget is checked before any prompt", async t => {
  const h = await setup(t), a = await h.upload("a.txt", Buffer.from("a".repeat(200_000))), b = await h.upload("b.txt", Buffer.from("b".repeat(200_000)));
  await assert.rejects(h.run([a, b]), { code: "ATTACHMENT_CONTENT_LIMIT" }); assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
});
test("multi-page conversion cannot bypass the eight-output limit", async t => {
  const h = await setup(t), bytes = await fs.readFile(path.join(fixtures, "multipage.tiff")), files = [];
  for (let i = 0; i < 5; i++) files.push(await h.upload(`pages-${i}.tiff`, bytes, "image/tiff"));
  await assert.rejects(h.run(files), { code: "ATTACHMENT_CONTENT_LIMIT" }); assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
});
test("derived copies are reused, persisted and included in the conversation cache limit", async t => {
  const h = await setup(t), original = await fs.readFile(path.join(fixtures, "sample.docx")), file = await h.upload("report.docx", original);
  const first = await h.run([file]), second = await h.run([file]); assert.equal(first.attachments[0].path, second.attachments[0].path);
  const root = path.dirname(path.dirname(first.attachments[0].path)), catalog = JSON.parse(await fs.readFile(path.join(root, "catalog.json"), "utf8"));
  assert.equal(catalog.derived.length, 1); assert.equal(catalog.derived[0].size, Buffer.byteLength(documents(first)[0].content));
  const reloaded = createAttachments({ io: fs, dataPath: h.root }); await reloaded.resolve(scope, [file]);
  const start = await reloaded.begin(scope, { name: "filler.bin", size: 10_000_000 });
  for (let offset = 0; offset < 10_000_000; offset += 256 * 1024) await reloaded.chunk(scope, { id: start.id, offset, data: Buffer.alloc(Math.min(256 * 1024, 10_000_000 - offset), 97).toString("base64") });
  await reloaded.finish(scope, { id: start.id });
  const tooMuch = 20_000_000 - original.length - catalog.derived[0].size - 10_000_000 + 1;
  await assert.rejects(reloaded.begin(scope, { name: "over-limit.bin", size: tooMuch }), /20 MB/);
});
test("a failed converted-catalog write removes new copies and allows a clean retry", async t => {
  const h = await setup(t), file = await h.upload("report.docx", await fs.readFile(path.join(fixtures, "sample.docx"))), write = fs.writeFile;
  try {
    fs.writeFile = async (name, ...args) => { if (String(name).endsWith("catalog.json.tmp")) throw Object.assign(Error("fixture IO failure"), { code: "EIO" }); return write(name, ...args); };
    await assert.rejects(h.run([file]), { code: "EIO" });
  } finally { fs.writeFile = write; }
  const original = (await h.manager.resolve(scope, [file]))[0].path;
  assert.ok(!(await fs.readdir(path.dirname(original))).some(name => name.startsWith("derived-v1-")));
  assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
  assert.match(documents(await h.run([file]))[0].content, /DOCX-SIDE-420/);
});
test("unload while a document is being read cannot send a late model prompt", { timeout: 10000 }, async t => {
  const h = await setup(t), file = await h.upload("report.docx", await fs.readFile(path.join(fixtures, "sample.docx"))), read = fs.readFile;
  let resume, entered; const waiting = new Promise(resolve => { resume = resolve; }), started = new Promise(resolve => { entered = resolve; });
  try {
    fs.readFile = async (name, ...args) => { if (String(name).endsWith(".docx")) { entered(); await waiting; } return read(name, ...args); };
    const rejected = assert.rejects(h.run([file]), { code: "CANCELLED" }); await started;
    await h.manager.close(); resume(); await rejected;
    assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
  } finally { fs.readFile = read; resume(); }
});
test("Office links and formula strings never cause a network request or formula execution", async t => {
  const h = await setup(t), file = await h.upload("report.xlsx", await fs.readFile(path.join(fixtures, "sample.xlsx"))), fetch = global.fetch; let network = 0;
  try {
    global.fetch = () => { network++; throw Error("Network must not be used for document parsing"); };
    const text = documents(await h.run([file]))[0].content;
    assert.match(text, /HYPERLINK/); assert.match(text, /not cached; not recalculated/); assert.equal(network, 0);
  } finally { global.fetch = fetch; }
});
for (const [name, expected] of [["deflate.tif", [240, 20, 10, 255]], ["gray.tif", [85, 85, 85, 255]], ["mono.tif", [255, 255, 255, 255]], ["rgba.tif", [240, 20, 10, 128]], ["palette.tif", [240, 20, 10, 255]]]) test(`${name}: TIFF conversion preserves every pixel`, async t => {
  const h = await setup(t), prompt = await h.run([await h.upload(name, await fs.readFile(path.join(fixtures, name)))]);
  const { PNG } = require("../renderer/vendor/attachment-readers.cjs"), image = PNG.sync.read(await fs.readFile(prompt.attachments[0].path));
  for (let at = 0; at < image.data.length; at += 4) assert.deepEqual([...image.data.subarray(at, at + 4)], expected);
});
for (const [tag, value] of [[262, 6], [262, 8], [284, 2], [262, 3]]) test(`unsupported TIFF tag ${tag}=${value} is rejected, not sent as blank/wrong pixels`, async t => {
  const h = await setup(t), bytes = Buffer.from(await fs.readFile(path.join(fixtures, "single.tif"))), at = bytes.readUInt32LE(4), count = bytes.readUInt16LE(at); let changed = false;
  for (let i = 0; i < count; i++) { const entry = at + 2 + i * 12; if (bytes.readUInt16LE(entry) === tag) { bytes.writeUInt16LE(value, entry + 8); changed = true; } }
  assert.ok(changed, "fixture must contain the mutated TIFF tag");
  await assert.rejects(h.run([await h.upload("unsupported.tif", bytes)]), { code: "ATTACHMENT_UNSUPPORTED" });
  assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
});
test("cancelled first extraction retries with complete side history and old attachments", { timeout: 10000 }, async t => {
  const h = await setup(t), file = await h.upload("history.txt", Buffer.from("OLD-ATTACHMENT-CONTENT-780")), read = fs.readFile;
  const messages = [{ role: "user", content: "OLD-QUESTION-781", attachments: [file] }, { role: "user", content: "NEW-QUESTION-782" }];
  const job = { ...scope, sessionId: "main", modelKey: "fixture/model", thinkingLevel: "high", messages };
  let resume, entered; const waiting = new Promise(resolve => { resume = resolve; }), started = new Promise(resolve => { entered = resolve; });
  try {
    fs.readFile = async (name, ...args) => { if (String(name).includes("file-") && String(name).endsWith(".txt")) { entered(); await waiting; } return read(name, ...args); };
    const rejected = assert.rejects(h.manager.run(job, ""), { code: "CANCELLED" }); await started; job.cancelled = true; resume(); await rejected;
  } finally { fs.readFile = read; resume(); }
  assert.ok(!h.calls.some(call => call.operation === "agent/prompt"));
  assert.equal(await h.manager.run({ ...job, cancelled: false }, ""), "fixture reply");
  const prompt = h.calls.findLast(call => call.operation === "agent/prompt").args[0];
  assert.match(prompt.content, /OLD-QUESTION-781/); assert.match(prompt.content, /NEW-QUESTION-782/);
  assert.equal(documents(prompt)[0].content, "OLD-ATTACHMENT-CONTENT-780");
});
test("legacy Deflate TIFF compression is normalized before decoding", async t => {
  const h = await setup(t), bytes = Buffer.from(await fs.readFile(path.join(fixtures, "deflate.tif"))), at = bytes.readUInt32LE(4), count = bytes.readUInt16LE(at);
  for (let i = 0; i < count; i++) { const entry = at + 2 + i * 12; if (bytes.readUInt16LE(entry) === 259) bytes.writeUInt16LE(32946, entry + 8); }
  const prompt = await h.run([await h.upload("legacy-deflate.tif", bytes)]), { PNG } = require("../renderer/vendor/attachment-readers.cjs");
  const image = PNG.sync.read(await fs.readFile(prompt.attachments[0].path));
  for (let i = 0; i < image.data.length; i += 4) assert.deepEqual([...image.data.subarray(i, i + 4)], [240, 20, 10, 255]);
});
test("pre-extraction backend policies replay historical document contents after upgrade", async t => {
  const h = await setup(t), file = await h.upload("old-report.docx", await fs.readFile(path.join(fixtures, "sample.docx")));
  const initial = await h.run([file]), root = path.dirname(path.dirname(initial.attachments[0].path));
  const policyFile = path.join(root, POLICY_FILE), policy = JSON.parse(await fs.readFile(policyFile, "utf8"));
  policy.config = "fixture/model\0high\0false"; await fs.writeFile(policyFile, JSON.stringify(policy));
  const messages = [{ role: "user", content: "old attachment question", attachments: [file] }, { role: "user", content: "Read the old document's last paragraph" }];
  assert.equal(await h.manager.run({ ...scope, sessionId: "main", modelKey: "fixture/model", thinkingLevel: "high", messages }, ""), "fixture reply");
  const prompt = h.calls.findLast(call => call.operation === "agent/prompt").args[0];
  assert.match(documents(prompt)[0].content, /DOCX-LAST-620/);
  assert.equal(h.calls.filter(call => call.operation === "session/create").length, 2);
});
