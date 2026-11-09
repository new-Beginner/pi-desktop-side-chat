"use strict";
// Offline build: node scripts/vendor-attachment-readers.cjs <dependency-prefix> <esbuild-root>
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const [prefix, builder] = process.argv.slice(2).map(value => path.resolve(value));
if (!prefix || !builder) throw Error("Provide dependency prefix and esbuild package root");
const names = ["containers", "core", "doc", "document", "docx", "office-common", "ppt", "pptx", "utils", "xlsx"];
const pins = [...names.map(name => [`@mdgate/${name}`, "0.6.25"]), ["utif", "3.1.0"], ["pako", "1.0.11"], ["pngjs", "7.0.0"]];
const file = (name, entry) => path.join(prefix, "node_modules", name, entry).replaceAll(path.sep, "/");
for (const [name, version] of pins) {
  const pkg = JSON.parse(fs.readFileSync(file(name, "package.json"), "utf8"));
  if (pkg.name !== name || pkg.version !== version) throw Error(`Unexpected package ${pkg.name}@${pkg.version}`);
}
const esbuild = require(builder);
if (esbuild.version !== "0.25.12") throw Error("Expected esbuild 0.25.12");
const imports = ["doc", "docx", "xlsx", "ppt", "pptx"].map(name => `import {toMarkdown as ${name}} from ${JSON.stringify(file(`@mdgate/${name}`, "dist/index.js"))};`).join("\n");
const source = `${imports}
import {withBudget} from "side-chat-reader-budget";
export async function readOffice(kind, bytes, name) { return withBudget(() => ({doc,docx,xlsx,ppt,pptx})[kind](bytes, {path:name})); }
export {Package,CompoundFile,ns,readRels,resolve,relsPartFor} from ${JSON.stringify(file("@mdgate/containers", "dist/index.js"))};
export {default as TIFF} from ${JSON.stringify(file("utif", "UTIF.js"))};
export {PNG} from ${JSON.stringify(file("pngjs", "lib/png.js"))};`;
// Bound every mdgate decompressor, including compressed Office drawing records.
// This adapter uses only local buffers; no reader gets network or filesystem APIs.
const budget = `
import {AsyncLocalStorage} from "node:async_hooks";
import {inflateRawSync,inflateSync,gunzipSync} from "node:zlib";
import {ConvertError} from ${JSON.stringify(file("@mdgate/core", "dist/index.js"))};
const context=new AsyncLocalStorage();
export const withBudget=fn=>context.run({remaining:32*1024*1024},fn);
export function inflate(kind,bytes,requested=Number.MAX_SAFE_INTEGER){
 const state=context.getStore(),limit=Math.min(8*1024*1024,state?.remaining??32*1024*1024,requested);
 if(limit<1)throw ConvertError.resourceLimit("decoded bytes","attachment expansion limit");
 let out;try{out=({raw:inflateRawSync,zlib:inflateSync,gzip:gunzipSync})[kind](bytes,{maxOutputLength:limit});}
 catch(error){if(error.code==="ERR_BUFFER_TOO_LARGE")throw ConvertError.resourceLimit("decoded bytes","attachment expansion limit");throw error;}
 if(state)state.remaining-=out.length;return new Uint8Array(out.buffer,out.byteOffset,out.byteLength);
}`;
const safeUtils = `
export * from ${JSON.stringify(file("@mdgate/utils", "dist/index.js"))};
import {inflate} from "side-chat-reader-budget";
export const inflateRaw=(bytes,limit)=>inflate("raw",bytes,limit);
export const inflateZlib=(bytes,limit)=>inflate("zlib",bytes,limit);
export const inflateGzip=(bytes,limit)=>inflate("gzip",bytes,limit);`;
(async () => {
  const built = await esbuild.build({
    stdin: { contents: source, resolveDir: prefix, sourcefile: "attachment-readers-entry.mjs" },
    absWorkingDir: prefix, bundle: true, write: false, format: "cjs", platform: "node", target: "node22",
    minify: true, legalComments: "inline", metafile: true,
    plugins: [{ name: "bounded-office-readers", setup(build) {
      build.onResolve({ filter: /^side-chat-reader-budget$/ }, () => ({ path: "budget", namespace: "side-chat" }));
      build.onResolve({ filter: /^@mdgate\/utils$/ }, () => ({ path: "utils", namespace: "side-chat" }));
      build.onResolve({ filter: /.*/, namespace: "side-chat" }, args => path.isAbsolute(args.path) ? { path: args.path, namespace: "file" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "side-chat" }, args => ({ contents: args.path === "budget" ? budget : safeUtils, loader: "js", resolveDir: prefix }));
    } }],
  });
  const out = path.resolve(__dirname, "../renderer/vendor"), bytes = built.outputFiles[0].contents;
  const licenseNames = ["@mdgate/core", "utif", "pako", "pngjs"];
  const licenses = licenseNames.map(name => `===== ${name}${name.startsWith("@mdgate") ? " (all bundled @mdgate packages)" : ""} =====\n${fs.readFileSync(file(name, "LICENSE"), "utf8")}`).join("\n\n");
  fs.writeFileSync(path.join(out, "attachment-readers.cjs"), bytes);
  fs.writeFileSync(path.join(out, "attachment-readers.LICENSE.txt"), licenses);
  const metadata = { packages: Object.fromEntries(pins), esbuild: esbuild.version, boundedDecompression: "8 MiB per stream / 32 MiB per document", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
  fs.writeFileSync(path.join(out, "attachment-readers.meta.json"), JSON.stringify(metadata, null, 2) + "\n");
  console.log(JSON.stringify(metadata, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
