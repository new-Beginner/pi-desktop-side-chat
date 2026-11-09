"use strict";
(function () {
  const signature = s => `${s.projectKey}\0${s.conversationId}`;
  function label(file) { return `${file.kind === "image" || file.type?.startsWith("image/") ? "🖼" : "📄"} ${file.name} (${Math.ceil(file.size / 1024)} KB)`; }
  function renderMessage(files) {
    const list = document.createElement("div"); list.className = "message-attachments";
    for (const file of files || []) { const item = document.createElement("span"); item.textContent = label(file); list.append(item); }
    return list;
  }
  function create({ invoke, scope, ready, t, hint }) {
    const button = document.getElementById("attachBtn"), input = document.getElementById("attachmentInput"), list = document.getElementById("attachmentList"), box = document.getElementById("input").closest(".box");
    let files = [], selectedScope = "";
    function sync() {
      const current = signature(scope());
      if (selectedScope && selectedScope !== current) { files = []; selectedScope = ""; }
      button.disabled = !ready(); input.disabled = button.disabled; list.hidden = !files.length; list.replaceChildren();
      for (const item of files) {
        const chip = document.createElement("span"); chip.className = "attachment-chip"; chip.title = item.file.name;
        const name = document.createElement("span"); name.textContent = label(item.file);
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = t("removeAttachment"); remove.disabled = !ready();
        remove.addEventListener("click", () => { files = files.filter(f => f !== item); sync(); });
        chip.append(name, remove); list.append(chip);
      }
    }
    function addFiles(selected) {
      if (!ready()) return;
      sync(); selectedScope = signature(scope());
      for (const file of selected) {
        if (files.length >= 8 || file.size > 10_000_000 || files.reduce((n, f) => n + f.file.size, 0) + file.size > 20_000_000) { hint(t("attachmentLimit")); break; }
        files.push({ file });
      }
      sync();
    }
    function assertScope(target) {
      const current = scope();
      if (signature(current) !== signature(target) || current.sessionId !== target.sessionId) throw Error(t("sessionChanged"));
    }
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; });
    box.addEventListener("dragover", event => { if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault(); });
    box.addEventListener("drop", event => { if (event.dataTransfer?.files.length) { event.preventDefault(); addFiles([...event.dataTransfer.files]); } });
    return {
      sync, addFiles,
      hasFiles: () => { sync(); return files.length > 0; },
      clear(target) { if (signature(target) === selectedScope) { files = []; selectedScope = ""; sync(); } },
      async upload(target) {
        assertScope(target); const selected = [...files], result = [];
        for (const item of selected) {
          if (item.staged) { result.push(item.staged); continue; }
          let id;
          try {
            assertScope(target);
            ({ id } = await invoke("chat.attachment.begin", { ...target, name: item.file.name, size: item.file.size, mimeType: item.file.type }));
            for (let offset = 0; offset < item.file.size; offset += 256 * 1024) {
              const bytes = new Uint8Array(await item.file.slice(offset, offset + 256 * 1024).arrayBuffer()); let binary = "";
              for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
              assertScope(target);
              await invoke("chat.attachment.chunk", { ...target, id, offset, data: btoa(binary) });
            }
            assertScope(target);
            item.staged = await invoke("chat.attachment.finish", { ...target, id }); result.push(item.staged);
          } catch (error) {
            if (id) await invoke("chat.attachment.discard", { ...target, id }).catch(() => {});
            throw error;
          }
        }
        assertScope(target); return result;
      },
    };
  }
  window.SideChatAttachments = Object.freeze({ create, renderMessage });
})();
