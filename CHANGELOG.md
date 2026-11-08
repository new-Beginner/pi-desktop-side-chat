# Changelog

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
