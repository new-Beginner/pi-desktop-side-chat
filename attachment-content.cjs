"use strict";
// File content preparation only; no model, network, shell, Office or MCP calls.
const path = require("node:path"), zlib = require("node:zlib");
const readers = require("./renderer/vendor/attachment-readers.cjs");
const LIMITS = Object.freeze({ input: 10_000_000, part: 8 * 1024 * 1024, expanded: 32 * 1024 * 1024, text: 256_000, documents: 384_000, pixels: 16_000_000, outputs: 8 });
const fail = (code, message) => Object.assign(new Error(message), { code });
const imageExtensions = new Map(Object.entries({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", tif: "image/tiff", tiff: "image/tiff" }));
const officeExtensions = new Map(Object.entries({ doc: "doc", docx: "docx", xls: "xlsx", xlsx: "xlsx", ppt: "ppt", pptx: "pptx" }));
const textExtensions = new Set("txt md markdown rst csv tsv json jsonl ndjson xml yaml yml toml ini cfg conf log c h cc cpp cxx hpp hxx cu cuh py js mjs cjs ts tsx jsx html htm css sh bat ps1 sql f f90 for m ipynb cmake".split(" "));
const extension = name => path.extname(name).slice(1).toLowerCase();
function imageMime(name, mime = "") { mime = String(mime || "").toLowerCase(); return imageExtensions.get(extension(name)) || ([...imageExtensions.values()].includes(mime) ? mime : null); }
function validateImage(mime, bytes) {
  const valid = mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === "image/gif" ? /^GIF8[79]a/.test(bytes.subarray(0, 6).toString())
    : mime === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
    : mime === "image/tiff" && bytes.length >= 8 && ((bytes[0] === 73 && bytes[1] === 73 && [42, 43].includes(bytes[2]) && bytes[3] === 0) || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && [42, 43].includes(bytes[3])));
  if (!valid) throw fail("INVALID_ATTACHMENT", "Attachment image signature does not match its type");
}
function inspectContainer(bytes) {
  if (bytes[0] === 80 && bytes[1] === 75) {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
    if (end < 0) throw fail("ATTACHMENT_PARSE_FAILED", "Office ZIP directory is missing");
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
    if (count === 65535 || size === 0xffffffff || offset === 0xffffffff || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw fail("ATTACHMENT_UNSUPPORTED", "ZIP64 and split Office archives are not supported");
    if (count > 4096 || offset + size > end) throw fail("ATTACHMENT_CONTENT_LIMIT", "Office archive exceeds the entry limit");
    let cursor = offset, expanded = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > offset + size || bytes.readUInt32LE(cursor) !== 0x02014b50) throw fail("ATTACHMENT_PARSE_FAILED", "Office ZIP directory is invalid");
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20), plain = bytes.readUInt32LE(cursor + 24), names = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
      if (flags & 1) throw fail("ATTACHMENT_ENCRYPTED", "Encrypted Office files are not supported");
      if (plain > LIMITS.part || expanded + plain > LIMITS.expanded) throw fail("ATTACHMENT_CONTENT_LIMIT", "Expanded Office content is too large");
      if (cursor + 46 + names + extra + comment > offset + size || local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50) throw fail("ATTACHMENT_PARSE_FAILED", "Office ZIP entry is invalid");
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > offset) throw fail("ATTACHMENT_PARSE_FAILED", "Office ZIP entry is truncated");
      const packed = bytes.subarray(start, start + compressed), decoded = method === 0 ? packed : method === 8 ? zlib.inflateRawSync(packed, { maxOutputLength: Math.min(LIMITS.part, LIMITS.expanded - expanded) || 1 }) : null;
      if (!decoded) throw fail("ATTACHMENT_UNSUPPORTED", "Unsupported Office ZIP compression");
      if (decoded.length !== plain) throw fail("ATTACHMENT_PARSE_FAILED", "Office ZIP entry length is inconsistent");
      expanded += decoded.length; cursor += 46 + names + extra + comment;
    }
  } else if (bytes.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]))) {
    const compound = readers.CompoundFile.open(bytes);
    // Pinned mdgate 0.6.25 metadata is checked before any stream allocation.
    if (!Array.isArray(compound.entries) || compound.entries.some(entry => !Number.isSafeInteger(entry.size) || entry.size > bytes.length)) throw fail("ATTACHMENT_CONTENT_LIMIT", "Office compound stream size is invalid");
    if (compound.exists("EncryptionInfo") || compound.exists("EncryptedPackage")) throw fail("ATTACHMENT_ENCRYPTED", "Encrypted Office files are not supported");
  } else throw fail("ATTACHMENT_PARSE_FAILED", "Office file signature does not match its format");
}
function decodeText(bytes) {
  let encoding = "utf-8";
  if (bytes[0] === 255 && bytes[1] === 254) encoding = "utf-16le";
  else if (bytes[0] === 254 && bytes[1] === 255) encoding = "utf-16be";
  let content;
  try { content = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch {
    if (encoding !== "utf-8") throw fail("ATTACHMENT_PARSE_FAILED", "Invalid text encoding; save the file as UTF-8");
    try { content = new TextDecoder("gb18030", { fatal: true }).decode(bytes); encoding = "gb18030"; }
    catch { throw fail("ATTACHMENT_PARSE_FAILED", "Cannot decode this file; save it as UTF-8"); }
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) throw fail("ATTACHMENT_UNSUPPORTED", "Binary data cannot be supplied as text");
  return { content, encoding };
}
function excelFormulae(bytes) {
  if (bytes[0] !== 80 || bytes[1] !== 75) return "";
  const pkg = readers.Package.open(bytes), main = "xl/workbook.xml", spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  if (!pkg.hasPart(main)) return "";
  const rels = readers.readRels(pkg, readers.relsPartFor(main)), lines = [];
  for (const sheet of pkg.requiredXmlPart(main).descendants(spreadsheet, "sheet")) {
    const id = sheet.attrQualified(readers.ns.R, "id"), target = id ? rels.internalTarget(id) : null;
    if (!target) continue;
    const part = readers.resolve(main, target).path;
    for (const cell of pkg.requiredXmlPart(part).descendants(spreadsheet, "c")) {
      const formula = cell.find(spreadsheet, "f"); if (!formula) continue;
      lines.push(`${sheet.attrAny("name") || part}!${cell.attrAny("r") || "?"}: =${formula.text()} [saved value: ${cell.find(spreadsheet, "v")?.text() || "not cached; not recalculated"}]`);
    }
  }
  return lines.length ? "\n\nFormula source (not executed or recalculated):\n" + lines.join("\n") : "";
}
function tiffImages(source, bytes) {
  validateImage("image/tiff", bytes);
  const little = bytes[0] === 73, u16 = at => little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at), u32 = at => little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
  if (u16(2) !== 42) throw fail("ATTACHMENT_UNSUPPORTED", "BigTIFF is not supported; export a standard TIFF or PNG");
  let at = u32(4), pages = 0, values = 0; const seen = new Set();
  while (at) {
    if (seen.has(at) || at + 2 > bytes.length) throw fail("ATTACHMENT_PARSE_FAILED", "Invalid TIFF page directory");
    seen.add(at); const tags = u16(at); pages++;
    if (pages > LIMITS.outputs || tags > 4096 || at + 2 + tags * 12 + 4 > bytes.length) throw fail("ATTACHMENT_CONTENT_LIMIT", "TIFF has too many pages or metadata entries");
    for (let i = 0; i < tags; i++) {
      const entry = at + 2 + i * 12, type = u16(entry + 2), count = u32(entry + 4), unit = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4][type];
      values += count;
      if (!unit || values > 1_000_000 || (count * unit > 4 && u32(entry + 8) + count * unit > bytes.length)) throw fail("ATTACHMENT_CONTENT_LIMIT", "TIFF metadata is invalid or too large");
    }
    at = u32(at + 2 + tags * 12);
  }
  if (!pages) throw fail("ATTACHMENT_PARSE_FAILED", "TIFF has no pages");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), frames = readers.TIFF.decode(buffer), result = []; let pixels = 0, expanded = 0;
  for (const [index, frame] of frames.entries()) {
    const width = frame.t256?.[0], height = frame.t257?.[0], bits = frame.t258 || [1], compression = frame.t259?.[0] || 1;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || (pixels += width * height) > LIMITS.pixels) throw fail("ATTACHMENT_CONTENT_LIMIT", "TIFF exceeds the 16-million-pixel decoded limit");
    if (!bits.every(value => [1, 2, 4, 8, 16].includes(value)) || (frame.t339 || [1]).some(value => value !== 1) || ![1, 5, 8, 32773, 32946].includes(compression)) throw fail("ATTACHMENT_UNSUPPORTED", "Unsupported TIFF sample/compression; export integer uncompressed, LZW, Deflate or PackBits TIFF/PNG");
    const photo = frame.t262?.[0], samples = frame.t277?.[0] || bits.length, depth = bits[0];
    const supportedColor = bits.every(value => value === depth) && bits.length === samples && (
      (photo === 0 && samples === 1 && [1, 4, 8].includes(depth)) ||
      (photo === 1 && samples === 1 && [1, 2, 8, 16].includes(depth)) ||
      (photo === 2 && [8, 16].includes(depth) && (samples === 3 || (samples === 4 && frame.t338?.[0] === 2))) ||
      (photo === 3 && samples === 1 && depth === 8 && frame.t320?.length === 768));
    if (!supportedColor || (frame.t284?.[0] || 1) !== 1 || (frame.t274?.[0] || 1) !== 1 || (frame.t266?.[0] || 1) !== 1 || frame.t322 || ![1, 2].includes(frame.t317?.[0] || 1) || (frame.t317?.[0] === 2 && depth < 8)) throw fail("ATTACHMENT_UNSUPPORTED", "Unsupported TIFF color/sample/layout; export a top-left, interleaved RGB/grayscale TIFF or PNG");
    const strips = frame.t273 || [], lengths = frame.t279 || [], rows = frame.t278?.[0] || height;
    if (!Number.isSafeInteger(rows) || rows < 1 || strips.length !== Math.ceil(height / rows) || strips.length !== lengths.length || strips.some((offset, i) => !Number.isSafeInteger(offset) || !Number.isSafeInteger(lengths[i]) || lengths[i] < 1 || offset + lengths[i] > bytes.length)) throw fail("ATTACHMENT_PARSE_FAILED", "Invalid or truncated TIFF strips");
    if (compression === 1 && lengths.some((length, i) => length < Math.ceil(width * depth * samples / 8) * Math.min(rows, height - i * rows))) throw fail("ATTACHMENT_PARSE_FAILED", "Incomplete TIFF pixel data");
    if ([8, 32946].includes(compression)) {
      const offsets = frame.t273 || frame.t324 || [], sizes = frame.t279 || frame.t325 || [];
      if (offsets.length !== sizes.length || offsets.length > 65536) throw fail("ATTACHMENT_PARSE_FAILED", "Invalid TIFF compressed strips");
      for (let i = 0; i < offsets.length; i++) {
        if (offsets[i] + sizes[i] > bytes.length) throw fail("ATTACHMENT_PARSE_FAILED", "Truncated TIFF compressed strip");
        const raw = zlib.inflateSync(bytes.subarray(offsets[i], offsets[i] + sizes[i]), { maxOutputLength: 128 * 1024 * 1024 - expanded }); expanded += raw.length;
      }
    }
    // UTIF handles Deflate under tag 8, not the legacy equivalent 32946.
    if (compression === 32946) frame.t259 = [8];
    readers.TIFF.decodeImage(buffer, frame);
    const data = readers.TIFF.toRGBA8(frame);
    if (data.length !== width * height * 4) throw fail("ATTACHMENT_PARSE_FAILED", "TIFF did not decode to a complete image");
    const png = readers.PNG.sync.write({ width, height, data: Buffer.from(data) });
    if (png.length > LIMITS.input) throw fail("ATTACHMENT_CONTENT_LIMIT", "Converted TIFF page exceeds 10 MB");
    result.push({ ...source, name: `${source.name.slice(0, 220)} [page ${index + 1}].png`, kind: "image", mimeType: "image/png", size: png.length, bytes: png, derived: `page-${index + 1}.png` });
  }
  if (result.length !== pages) throw fail("ATTACHMENT_PARSE_FAILED", "Not every TIFF page was decoded");
  return result;
}
async function prepareContent(sources, readFile) {
  const files = [], documents = [];
  for (const source of sources) {
    try {
      const bytes = Buffer.from(await readFile(source.path));
      if (bytes.length > LIMITS.input) throw fail("ATTACHMENT_CONTENT_LIMIT", "Attachment exceeds 10 MB");
      const mime = imageMime(source.name, source.mimeType), ext = extension(source.name);
      if (mime) {
        validateImage(mime, bytes);
        if (mime === "image/tiff") files.push(...tiffImages(source, bytes));
        else files.push({ ...source, kind: "image", mimeType: mime, size: bytes.length });
      } else {
        const office = officeExtensions.get(ext); let decoded;
        if (office) {
          inspectContainer(bytes);
          decoded = { encoding: "extracted UTF-8", content: await readers.readOffice(office, bytes, source.name) };
          if (office === "xlsx") decoded.content += excelFormulae(bytes);
        } else if (textExtensions.has(ext) || !ext || source.mimeType?.startsWith("text/")) decoded = decodeText(bytes);
        else throw fail("ATTACHMENT_UNSUPPORTED", "Unsupported file format; provide a supported document, image or UTF-8 text file");
        if (!decoded.content.trim()) throw fail("ATTACHMENT_PARSE_FAILED", "No readable text was found in this attachment");
        const utf8 = Buffer.from(decoded.content, "utf8");
        if (utf8.length > LIMITS.text) throw fail("ATTACHMENT_CONTENT_LIMIT", "Extracted text exceeds 256000 bytes; split the document before sending");
        documents.push({ id: source.id, name: source.name, format: office || "text", encoding: decoded.encoding, content: decoded.content });
        files.push({ ...source, kind: "file", mimeType: "text/plain", size: utf8.length, ...(!utf8.equals(bytes) ? { bytes: utf8, derived: "content.txt" } : {}) });
      }
      if (files.length > LIMITS.outputs) throw fail("ATTACHMENT_CONTENT_LIMIT", "Converted files/pages exceed 8 attachments; split the input");
      if (Buffer.byteLength(JSON.stringify(documents), "utf8") > LIMITS.documents) throw fail("ATTACHMENT_CONTENT_LIMIT", "Combined extracted text exceeds 384000 bytes; split the input");
    } catch (error) {
      if (error.code?.startsWith("ATTACHMENT_") || error.code === "INVALID_ATTACHMENT") throw error;
      if (error.code === "encrypted") throw fail("ATTACHMENT_ENCRYPTED", `Cannot read encrypted attachment: ${source.name}`);
      if (error.code === "resourceLimit" || error.code === "ERR_BUFFER_TOO_LARGE") throw fail("ATTACHMENT_CONTENT_LIMIT", `Attachment expansion limit exceeded: ${source.name}`);
      throw fail("ATTACHMENT_PARSE_FAILED", `Cannot extract readable content from ${source.name}; check its format or export a supported copy`);
    }
  }
  return { files, documents };
}
module.exports = { prepareContent, imageMime, validateImage, LIMITS };
