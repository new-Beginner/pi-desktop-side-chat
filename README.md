# Side Chat

PI-Desktop plugin: a chat docked in the right work panel.

- Independent, project-scoped multi-turn history (stored in the plugin private data directory)
- All sidebar messages use independent read-only host Plan Agent sessions; ordinary text no longer calls agent.complete, and provider credentials stay in the host
- Automatically follow the selected host session; optionally attach its transcript
- Optional: return the latest successful reply to the main input as a draft, without sending
- Safely render assistant Markdown with bundled marked / DOMPurify, with no CDN

Version 0.1.18 permits files up to 500 MB (500,000,000 bytes) and up to 10 files/converted outputs per send, removing the former 20 MB cumulative cache quota. Existing source files are still referenced without copying originals. Office/TIFF use official fs.read; upgrading from a version without this grant still requires explicit reload and approval. Side chats remain independent read-only Plan sessions; images need vision. PDF, OCR and full Office rendering remain unsupported.

| Format | Model input |
| --- | --- |
| PNG, JPG/JPEG, WebP, GIF | Source paths through native Read; pathless originals through official image attachments |
| TIF/TIFF | Supported single/multi-page RGB, grayscale or palette TIFF converted to PNG; unsupported variants refused |
| Word: DOC/DOCX | Extracted body text and tables as UTF-8 |
| Excel: XLS/XLSX | Worksheets/tables and saved values; XLSX formula source is also included, without recalculation |
| PowerPoint: PPT/PPTX | Slide text and speaker notes |
| TXT, Markdown, CSV/TSV, JSON, C/C++, CUDA (CU/CUH), etc. | Source paths through native Read/Grep on demand; pathless files retain local decoding, never code execution |

Select, drop or paste real files, or submit explicit absolute paths such as `Read "E:/my files/notes.md"` (quote paths with spaces). Nothing is registered/read until Send. Real paths become references; pathless screenshots/virtual File objects and necessary TIFF PNG pages still require storage. Limits are 10 files/converted outputs and 500 MB per file, with no cumulative cache-size quota or automatic deletion of old attachments. Extracted text remains limited to 256,000 UTF-8 bytes/document and 384,000 bytes of combined document JSON; decoding, pixel, host and model budgets remain unchanged. A 500 MB intake limit does not guarantee complete decoding or one-shot model input for arbitrary 500 MB files. Moving a source invalidates its reference; re-submit changed Office/TIFF paths to refresh extraction. History, optional main context and draft-only return are preserved.

Real-format samples verify extracted content and official prompt parameters. Installed 0.22.0 Runner/sidecar contracts and constructed Chromium paste events have separate regressions; running-host, OS-clipboard and actual model acceptance remain unverified. See [attachment details](docs/attachments-0.1.10.zh-CN.md) for boundaries, official references and reproduction commands.

Project history hides inactive buckets with no titles or messages. Same-name nonempty histories include their distinct keys; they are never merged or deleted. Keep standalone, unassigned legacy and current empty-project entries, with storage and attachment ownership unchanged. See the [history-duplicate investigation](docs/history-duplicates-0.1.15.zh-CN.md).

## Install

1. Open PI-Desktop → Plugins → **Load development plugin**
2. Choose this directory
3. Open the right work panel and pick **Side Chat**

Command palette: `Side Chat: Open` (detached window).

## Permissions

| Permission | Why |
|---|---|
| `ui.view` / `ui.panel` | Docked view and optional window |
| `models.list` | List signed-in models |
| `desktop.control` | Create/prompt/query/abort independent side sessions and optionally read main-session background; never prompt or abort the main session |
| `clipboard.write` | Copy a reply |
| `shell.openExternal` | Open HTTP(S) / mailto Markdown links through the host permission gateway |
| `renderer.extension` | Run trusted host-renderer code to insert a reply into the main draft, without sending or copying the user's existing draft to the plugin process |
| `agent.extension` | Restrict reads to cached attachments and exact registered source files, never parent directories; deny writes, Shell, delegation and session controls; not an OS sandbox |
| `fs.read` | Parse Office/TIFF source files using official directory selection and bounded reads; process-lifetime directory authorization does not grant the Agent access to that directory |

The host owns model networking. Read-only refers to Agent tools, not to the plugin's own history/cache persistence. Explicit agent.extension approval is needed when first enabling it, even without attachments. Optional main-session context and draft-only return stay unchanged. See [read-only sidebar details](docs/attachments-0.1.10.zh-CN.md) for official references, the unified call chain and acceptance.

## Updating from 0.1.0

Version 0.1.3 adds the high-risk `renderer.extension` grant for draft-only return. Explicitly load the same development directory again and review that permission; hot reload must not silently widen grants. Updating from 0.1.0 also adds `shell.openExternal`. If the draft bridge is not authorized or no input is writable, return fails clearly and never falls back to sending.

- Markdown headings, nested lists, fenced code, tables and links are rendered locally and sanitized. Raw HTML is not executed; remote images become alt text. Copy keeps the original Markdown.
- The side chat follows the selected host session. Events update docked views immediately; a two-second read-only pull repairs missed events and covers detached windows. Stale send/writeback requests are refused rather than retargeted.
- The icon-only context switch keeps its saved setting. The return icon sits immediately beside Send and inserts the latest successful assistant reply at the main input's caret without auto-send. Draft generation changes, session switches, timeouts and unload cancel stale writes. A single insert is limited by the host to 32 KiB UTF-8; oversized replies are refused, not truncated.
- The model picker stays on the bottom action row and shares the buttons' 24px height with vertically centered text. As space decreases, hide the chevron first, then the reasoning badge, and only then shrink the model name. Restore these in reverse order as space returns. Hiding the reasoning badge does not change the selected effort or the menu choices. Oversized names retain an ellipsis and full-name tooltip. Other spacing and picker/send behavior are unchanged.
- Histories are stored separately by host project id (or normalized project path on hosts without that metadata). Switch projects to restore the appropriate history, or use the drawer's project filter to browse other projects read-only.
- The permanent **Standalone sessions** entry contains all saved non-project side-chat history, including records previously shown as No project. Its existing `general` storage key is retained. A selected session without a project stays standalone even if another workspace is open; project histories and unassigned legacy records are not merged into it.
- Old unscoped history is backed up as `conversations.v1.json` and remains accessible under “Legacy history (unassigned)”. New history uses a project-scoped v2 file; existing 40-conversation / 80-message limits now apply per project.

Regression checks: `node --test tests/side-chat.test.cjs tests/draft-bridge.test.mjs`; preview `tests/ui.html` for browser checks with a simulated main input and no real model calls. These checks do not replace a reload and permission review in the actual app.

## Repo

https://github.com/vastsa/pi-desktop-side-chat
