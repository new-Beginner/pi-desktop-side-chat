# Changelog

## 0.1.18

- Raise all plugin file intake/reference checks to 500 MB (500,000,000 bytes) and single-send file/converted-output checks to 10, including the actual Agent guard and official source reader.
- Remove the conflicting 20 MB cumulative queue/cache quota. Source originals remain copy-free; pathless inputs, converted image pages and old attachments still need storage and are not deleted.
- Retain read-only authorization, isolation, supported formats and decoded-content budgets; add boundary/no-copy/ten-file regressions. Use a new full guard entry to avoid cached old factories; no new permissions.

## 0.1.17

- Reference real local File paths and explicit absolute paths in submitted user messages without copying originals; keep pathless clipboard/picker uploads and old cached histories compatible.
- Scope source reads to exact per-conversation registered files, revalidate canonical paths and reject directories, neighboring files and changed link targets; keep native host authorization and all write/control denials.
- Reuse Office/TIFF conversion through official fs.read with a user-selected root and bounded readRange; quote Office text in the prompt and cache only necessary converted image pages. Add the fs.read grant and a new complete guard entry for Runner factory-cache compatibility.
- Retain file/output/content limits, apply the 20 MB cache budget only to actually saved bytes, and add backend, path/parser, reader authorization and browser no-upload regressions. No layout, model, draft-return or host-source changes.

## 0.1.16

- Route every sidebar message, including ordinary text and standalone chats, through the existing independent read-only Plan Agent backend; remove agent.complete calls and fallback behavior.
- Keep Read/Glob/Grep, per-conversation scope, guard acknowledgement, strict status identity, side-only aborts, optional main context and draft-only return. Reuse the unchanged versioned guard entry.
- Remove the unused agent.complete permission, generalize startup guidance and preserve all seven reasoning values through session/create, including explicit off.
- Add text-only guard, backend-reuse, legacy-history replay and failure-without-fallback regressions. Leave attachment input, formats, quotas, filesystem scope and layout unchanged.

## 0.1.15

- Hide inactive, untitled and message-free project buckets from the history picker; keep the current project, standalone and unassigned legacy entries.
- Distinguish same-name nonempty histories by their full project key without merging stores, rewriting IDs or moving attachment caches.
- Reproduce cold path/host-ID and legacy-ID transitions, verify hidden data survives reload unchanged and retain cross-project read-only boundaries.

## 0.1.14

- Extract DOC/DOCX, XLS/XLSX, PPT/PPTX, text, JSON, C and CUDA contents locally into the official agent/prompt content field, instead of relying on tools to decode Office binaries.
- Infer image MIME from supported extensions and convert supported single/multi-page TIFF images to real PNG attachments with bounded offline readers and bundled licenses.
- Retain original files, count extracted copies against the private cache quota, reject unsupported/encrypted/oversized inputs and preserve history when retrying a cancelled first extraction or upgrading an old attachment backend.
- Add real-format content, formula/cache, pixel, limit, rollback and cancellation regressions. Keep picker/drop/paste, UI, read-only tools, permissions and main/side isolation unchanged.

## 0.1.13

- Accept clipboard images and files directly in the sidebar input using standard paste events, including multiple files and file-item fallback.
- Preserve native text paste and reuse the existing attachment queue, limits and upload path; pasting never opens the picker, uploads or sends automatically.
- Add clipboard UI regressions without new permissions or backend/layout changes.

## 0.1.12

- Read agent/getStatus as the official { status: AgentStatus } envelope instead of treating it as a flat object.
- Reject malformed responses before reading replies; keep strict side-session identity checks and side-only aborts.
- Correct both bridge fixtures and add real installed-sidecar status IPC and running/idle/invalid-response regressions without model calls.

## 0.1.11

- Use a versioned, full Agent-extension entry so PI-Desktop 0.22.0 does not reuse the cached pre-fix attachment guard after plugin reload.
- Publish sanitized initialization-stage failures through the official extension diagnostics instead of swallowing them.
- Add manifest-entry and warm-factory regressions using the installed Runner; preserve read-only limits, isolation, UI and permissions.

## 0.1.10

- Add image/file selection, removal, drag-and-drop and attachment-only messages with bounded chunked uploads into private conversation caches.
- Send attachment conversations through independent Plan-mode host Agent sessions; explicitly granted Agent extension narrows tools to Read/Glob/Grep and rejects out-of-cache access.
- Preserve ordinary text completions, optional main-session context, history grouping and draft-only return. Require a reload for the new agent.extension permission; do not auto-approve tools.

## 0.1.9

- Map the plugin palette to host --ds-* tokens with the existing light/dark defaults as fallbacks.
- Follow live theme CSS updates even when the new stylesheet has the same length.
- Verify Qingye light green and Sax Dark floating-shadow palettes without changing chat, history, model settings or host source.

## 0.1.8

- Add a permanent Standalone sessions history entry for all non-project chats, reusing the existing general bucket without splitting or discarding saved records.
- Respect a selected session's null project path instead of borrowing an unrelated workspace; leave project IDs/path grouping and unassigned legacy history unchanged.

## 0.1.7

- On shrinking widths, hide the footer chevron first, the reasoning badge second, and truncate the model name only after both are hidden. Restore them in reverse order as space returns.
- Keep the bottom row, alignment, reasoning selection and send/draft behavior unchanged.

## 0.1.6

- Center the model control vertically with the existing 24px footer buttons.
- Keep the model picker on the bottom action row at every width; shrink its name and hide the chevron when space is insufficient, without changing picker or send behavior.

## 0.1.5

- Calculate the model picker's required width from the displayed name's characters and font metrics, reasoning badge, chevron and padding instead of reserving 160px for every model.
- Recalculate on model, reasoning and window-size changes; keep oversized names ellipsized with a full-name tooltip.
- Remove the textarea focus outline, trim parenthesized model-label suffixes, add xhigh/max reasoning options and soften the message area's corners.

## 0.1.4

- Move the model picker onto the action row as soon as the measured gap fits its minimum width, rather than using a fixed container breakpoint.
- Replace the text dropdown arrow with a matching line-style SVG chevron.
- Unify the context, draft-return and Send controls at 24px height without changing their behavior.

## 0.1.3

- Use an icon-only context switch and place the return icon directly next to Send.
- Keep model/thinking on the action row in wide views; move it above the actions in narrow views.
- Return the latest reply to the main draft through declared Renderer APIs, preserving existing draft content without auto-send; require renderer.extension approval.

## 0.1.2

- Remove the read-only followed-session field without changing automatic session following.
- Move model and thinking controls below the input, with a provider/model picker and no search field.
- Place session actions and Send on one row outside the input box; keep the model controls outside it as well.

## 0.1.1

- Render assistant Markdown locally with bundled marked and DOMPurify; open safe links through the host's shell.openExternal permission.
- Follow the host's current session automatically and reject stale send/writeback targets.
- Unify the sidebar palette and align responsive controls and Markdown content.
- Isolate history per project, keep v1 history under an unassigned legacy group, and preserve a conversations.v1.json backup.

## 0.1.0

- First release: docked Side Chat with local history, host-owned completions, optional session context, and send-to-session.
