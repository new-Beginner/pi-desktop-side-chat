# Side Chat

PI-Desktop plugin: a chat docked in the right work panel.

- Independent multi-turn history (stored in the plugin data directory)
- Completions go through the host (`agent.complete`) using models you already signed in
- Optional: attach the current session transcript as context
- Optional: send the last reply back into that session (`agent/prompt`)

Requires PI-Desktop ≥ 0.14.0.

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
| `desktop.control` | List/read sessions, send a prompt back |
| `clipboard.write` | Copy a reply |

No plugin-owned network. Completions are capped by the host: 8 calls / 60s, 90s timeout.

## Repo

https://github.com/vastsa/pi-desktop-side-chat
