"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const helpers = () => require("../source-references.cjs");
test("explicit absolute paths are extracted without importing URLs or relative examples", () => {
  const { sourcePaths } = helpers();
  assert.deepEqual(sourcePaths('请读取 "E:\\my files\\笔记.md" 和 `D:/data/code.cu`。'), ["E:\\my files\\笔记.md", "D:/data/code.cu"]);
  assert.deepEqual(sourcePaths("读取 E:\\data\\note.txt，解释内容\n/sources/note.md"), ["E:\\data\\note.txt", "/sources/note.md"]);
  assert.deepEqual(sourcePaths("读取E:\\data\\note.txt，解释内容"), ["E:\\data\\note.txt"]);
  assert.deepEqual(sourcePaths("https://example.com/a.txt ./relative.txt 普通文字"), []);
  assert.deepEqual(sourcePaths('"/sources/my note.txt" "/sources/my note.txt"'), ["/sources/my note.txt"]);
});
test("official source reader asks for a directory once and reads bounded byte ranges", async () => {
  const { createSourceReader } = helpers(), bytes = Buffer.alloc(600_000, 71), calls = []; let picks = 0, checks = 0;
  const api = {
    requestDirectory: async () => { picks++; return { path: "/sources", name: "sources" }; },
    stat: async p => { assert.equal(p, "/sources/file.docx"); return { size: bytes.length, mtimeMs: 12 }; },
    readRange: async (p, offset, length) => { calls.push({ p, offset, length }); return { bytes: new Uint8Array(bytes.subarray(offset, offset + length)), totalSize: bytes.length }; },
  };
  const read = createSourceReader(api, path.posix), source = { path: "/sources/file.docx", size: bytes.length };
  assert.deepEqual(await read(source, async () => { checks++; }), bytes);
  assert.equal(picks, 1); assert.equal(calls.length, 3); assert.ok(calls.every(call => call.length <= 256 * 1024)); assert.ok(checks >= 3);
  await read(source, async () => {}); assert.equal(picks, 1);
});
for (const kind of ["denied", "wrong root", "missing API", "changed", "short read", "cancelled"]) test(`official source reader fails closed: ${kind}`, async () => {
  const { createSourceReader } = helpers(); let reads = 0, stats = 0;
  const api = {
    requestDirectory: async () => kind === "denied" ? null : { path: kind === "wrong root" ? "/other" : "/sources" },
    stat: async () => ({ size: 3, mtimeMs: kind === "changed" ? ++stats : 1 }),
    readRange: async () => { reads++; return { bytes: new Uint8Array(kind === "short read" ? [1] : [1, 2, 3]), totalSize: 3 }; },
  };
  const read = createSourceReader(kind === "missing API" ? {} : api, path.posix);
  await assert.rejects(read({ path: "/sources/file.docx", size: 3 }, async () => { if (kind === "cancelled") throw Object.assign(Error("cancelled"), { code: "CANCELLED" }); }));
  if (["denied", "wrong root", "missing API", "cancelled"].includes(kind)) assert.equal(reads, 0);
});

test("selected directory aliases are canonicalized and concurrent conversions keep their own root", async () => {
  const { createSourceReader } = helpers(); let root = "", pick = 0;
  const api = {
    requestDirectory: async () => { const chosen = ["/alias", "/other"][pick++]; root = chosen === "/alias" ? "/real" : chosen; return { path: chosen }; },
    stat: async file => { assert.ok(file.startsWith(root + "/")); return { size: 1, mtimeMs: 1 }; },
    readRange: async file => { await new Promise(setImmediate); assert.ok(file.startsWith(root + "/")); return { bytes: new Uint8Array([1]), totalSize: 1 }; },
  };
  const read = createSourceReader(api, path.posix, async file => file === "/alias" ? "/real" : file);
  const results = await Promise.all(["/real/a.docx", "/other/b.docx"].map(file => read({ path: file, size: 1 }, async () => {})));
  assert.equal(pick, 2); assert.deepEqual(results, [Buffer.from([1]), Buffer.from([1])]);
});

test("official reader allows exactly 500 MB metadata but refuses one byte more before reading", async () => {
  const { createSourceReader } = helpers(); let size = 500_000_000, reads = 0;
  const api = { requestDirectory: async () => ({ path: "/sources" }), stat: async () => ({ size, mtimeMs: 1 }), readRange: async (_file, offset, length) => { reads++; assert.equal(offset, 0); assert.equal(length, 256 * 1024); throw Object.assign(Error("boundary reached without allocating the full file"), { code: "BOUNDARY_REACHED" }); } };
  const read = createSourceReader(api, path.posix);
  await assert.rejects(read({ path: "/sources/large.docx" }, async () => {}), { code: "BOUNDARY_REACHED" });
  assert.equal(reads, 1); size++;
  await assert.rejects(read({ path: "/sources/large.docx" }, async () => {}), /500 MB/); assert.equal(reads, 1);
});
