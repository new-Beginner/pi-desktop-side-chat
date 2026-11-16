"use strict";
const fail = (code, message) => Object.assign(new Error(message), { code });
// Parse only explicit absolute references from the submitted user text, never model/context text.
// Paths containing spaces must be quoted; ordinary paste remains a native text operation.
function sourcePaths(text) {
  const found = [];
  const remaining = String(text).replace(/(["'`])((?:[a-z]:[\\/]|\/)[^\r\n]*?)\1/gi, (match, quote, file, index) => { found.push({ file, index }); return " ".repeat(match.length); });
  const bare = /(?<![a-z0-9_:\\/])([a-z]:[\\/][^\s"'`<>，。；！？、)）\]]+)|(?:^|[\s(（])(\/[^\s"'`<>，。；！？、)）\]]+)/gi;
  for (const match of remaining.matchAll(bare)) found.push({ file: (match[1] || match[2]).replace(/[.,;!?]+$/, ""), index: match.index });
  return [...new Set(found.sort((a, b) => a.index - b.index).map(item => item.file))];
}
function createSourceReader(api, path, realpath = async value => value) {
  let root = "", chain = Promise.resolve();
  const inside = file => { const relative = path.relative(root, file); return relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative); };
  async function read(source, check) {
    if (!api?.requestDirectory || !api?.stat || !api?.readRange) throw fail("SOURCE_PERMISSION_REQUIRED", "Reload the plugin and grant fs.read to parse Office/TIFF source references");
    await check();
    if (!root || !inside(source.path)) {
      const picked = await api.requestDirectory(); await check();
      root = picked?.path ? await realpath(picked.path) : ""; await check();
      if (!root || !inside(source.path)) throw fail("SOURCE_PERMISSION_REQUIRED", "Select the source file's containing directory to authorize read-only Office/TIFF parsing");
    }
    const before = await api.stat(source.path); await check();
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > 500_000_000) throw fail("ATTACHMENT_CONTENT_LIMIT", "Source exceeds 500 MB");
    const chunks = [];
    for (let offset = 0; offset < before.size;) {
      await check(); const length = Math.min(256 * 1024, before.size - offset);
      const part = await api.readRange(source.path, offset, length); await check();
      if (!(part?.bytes instanceof Uint8Array) || part.totalSize !== before.size || part.bytes.length !== length) throw fail("SOURCE_CHANGED", "Source changed or could not be read completely; send it again");
      chunks.push(Buffer.from(part.bytes)); offset += length;
    }
    const after = await api.stat(source.path); await check();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw fail("SOURCE_CHANGED", "Source changed while being read; send it again");
    return Buffer.concat(chunks);
  }
  // The official API has one process-lifetime selected root. Serialize conversions across side chats.
  return (source, check) => { const result = chain.then(() => read(source, check)); chain = result.catch(() => {}); return result; };
}
module.exports = { sourcePaths, createSourceReader };
