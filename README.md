# Side Chat

PI-Desktop plugin: a chat docked in the right work panel.

- Independent, project-scoped multi-turn history (stored in the plugin private data directory)
- Completions go through the host (`agent.complete`) using models you already signed in
- Automatically follow the selected host session; optionally attach its transcript
- Optional: return the latest successful reply to the main input as a draft, without sending
- Safely render assistant Markdown with bundled marked / DOMPurify, with no CDN

Version 0.1.5 targets PI-Desktop 0.21.1 builds (including prereleases) with the official selected-session and Renderer draft APIs.

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
| `agent.complete` | Side completion (host holds the keys) |
| `desktop.control` | Read the followed session context, never send a prompt |
| `clipboard.write` | Copy a reply |
| `shell.openExternal` | Open HTTP(S) / mailto Markdown links through the host permission gateway |
| `renderer.extension` | Run trusted host-renderer code to insert a reply into the main draft, without sending or copying the user's existing draft to the plugin process |

No plugin-owned network. Completions are capped by the host: 8 calls / 60s, 90s timeout.

## Updating from 0.1.0

Version 0.1.3 adds the high-risk `renderer.extension` grant for draft-only return. Explicitly load the same development directory again and review that permission; hot reload must not silently widen grants. Updating from 0.1.0 also adds `shell.openExternal`. If the draft bridge is not authorized or no input is writable, return fails clearly and never falls back to sending.

- Markdown headings, nested lists, fenced code, tables and links are rendered locally and sanitized. Raw HTML is not executed; remote images become alt text. Copy keeps the original Markdown.
- The side chat follows the selected host session. Events update docked views immediately; a two-second read-only pull repairs missed events and covers detached windows. Stale send/writeback requests are refused rather than retargeted.
- The icon-only context switch keeps its saved setting. The return icon sits immediately beside Send and inserts the latest successful assistant reply at the main input's caret without auto-send. Draft generation changes, session switches, timeouts and unload cancel stale writes. A single insert is limited by the host to 32 KiB UTF-8; oversized replies are refused, not truncated.
- The model picker joins the action row when the available gap fits its dynamically calculated width: the name's characters and font metrics plus the reasoning label, chevron and padding. Short names need less space; long names move above the actions when necessary. Oversized names use an ellipsis with the full name in the tooltip. The context, return and Send controls share a 24px height; other spacing is unchanged.
- Histories are stored separately by host project id (or normalized project path on hosts without that metadata). Switch projects to restore the appropriate history, or use the drawer's project filter to browse other projects read-only.
- Old unscoped history is backed up as `conversations.v1.json` and remains accessible under “Legacy history (unassigned)”. New history uses a project-scoped v2 file; existing 40-conversation / 80-message limits now apply per project.

Regression checks: `node --test tests/side-chat.test.cjs tests/draft-bridge.test.mjs`; preview `tests/ui.html` for browser checks with a simulated main input and no real model calls. These checks do not replace a reload and permission review in the actual app.

## Repo

https://github.com/vastsa/pi-desktop-side-chat
