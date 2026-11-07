"use strict";
// Reproducible, offline asset generation. Run only when updating vendored dependencies:
// node scripts/vendor-markdown.cjs <marked-package-directory> <dompurify-package-directory>
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const [markedRoot, purifyRoot] = process.argv.slice(2);
if (!markedRoot || !purifyRoot) throw new Error("Provide the two installed package directories");
const out = path.resolve(__dirname, "../renderer/vendor");
const dependencies = [
  { root: markedRoot, name: "marked", version: "18.0.11", files: [["lib/marked.umd.js", "marked.umd.js"], ["LICENSE", "marked.LICENSE"]] },
  { root: purifyRoot, name: "dompurify", version: "3.4.17", files: [["dist/purify.min.js", "purify.min.js"], ["LICENSE", "dompurify.LICENSE"], ["LICENSE-MPL", "dompurify.LICENSE-MPL"]] },
];
// Validate every source before writing any output. Third-party bytes are never transformed.
const assets = dependencies.flatMap(dep => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dep.root, "package.json"), "utf8"));
  if (pkg.name !== dep.name || pkg.version !== dep.version) throw new Error(`Unexpected package: ${pkg.name}@${pkg.version}`);
  return dep.files.map(([source, target]) => ({ target, bytes: fs.readFileSync(path.join(dep.root, source)) }));
});
fs.mkdirSync(out, { recursive: true });
for (const asset of assets) {
  const dest = path.join(out, asset.target);
  fs.writeFileSync(dest, asset.bytes);
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  if (hash(fs.readFileSync(dest)) !== hash(asset.bytes)) throw new Error(`Verification failed: ${asset.target}`);
  console.log(`${asset.target}: ${asset.bytes.length} bytes; sha256 ${hash(asset.bytes)}`);
}
