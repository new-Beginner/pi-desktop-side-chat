"use strict";
// Offline, pinned asset generation; no install hooks, downloads or host runtime imports.
// node scripts/vendor-markdown-extras.cjs <marked-cjk-friendly-root> <katex-root> <esbuild-root>
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const roots = process.argv.slice(2).map(p => path.resolve(p));
if (roots.length !== 3) throw Error("Provide the CJK, KaTeX and esbuild package directories");
for (const [index, name, version] of [[0, "marked-cjk-friendly", "0.1.3"], [1, "katex", "0.16.47"], [2, "esbuild", "0.25.12"]]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(roots[index], "package.json"), "utf8"));
  if (pkg.name !== name || pkg.version !== version) throw Error(`Unexpected package: ${pkg.name}@${pkg.version}`);
}
const esbuild = require(roots[2]);
const cjk = esbuild.buildSync({
  entryPoints: [path.join(roots[0], "dist/index.js")], bundle: true, write: false,
  format: "iife", globalName: "SideChatCjk", platform: "browser", target: "es2020",
  minify: true, legalComments: "inline",
}).outputFiles[0].contents;
const assets = [
  ["marked-cjk-friendly.js", cjk],
  ["marked-cjk-friendly.LICENSE", fs.readFileSync(path.join(roots[0], "LICENSE"))],
  ["katex.min.js", fs.readFileSync(path.join(roots[1], "dist/katex.min.js"))],
  ["katex.LICENSE", fs.readFileSync(path.join(roots[1], "LICENSE"))],
];
const out = path.resolve(__dirname, "../renderer/vendor");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
fs.mkdirSync(out, { recursive: true });
for (const [name, bytes] of assets) {
  const file = path.join(out, name);
  fs.writeFileSync(file, bytes);
  if (hash(fs.readFileSync(file)) !== hash(bytes)) throw Error(`Verification failed: ${name}`);
  console.log(`${name}: ${bytes.length} bytes; sha256 ${hash(bytes)}`);
}
