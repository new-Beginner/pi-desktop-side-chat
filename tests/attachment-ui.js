"use strict";
window.runAttachmentChecks = async function () {
  const win = document.getElementById("app").contentWindow, doc = win.document, $ = id => doc.getElementById(id);
  const original = win.pluginBridge.invoke, history = JSON.stringify(win.__mock.snapshots), mainDraft = document.getElementById("mainDraft").value;
  const rows = [], uploads = new Map(), sends = []; let next = 0, rejectUpload = false;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw Error("Attachment UI timed out"); };
  const check = async (name, fn) => { try { await fn(); rows.push({ name, passed: true }); } catch (error) { rows.push({ name, passed: false, error: error.message }); } };
  const pngSource = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3sAAAAASUVORK5CYII=";
  const image = new win.File([Uint8Array.from(atob(pngSource), c => c.charCodeAt(0))], "pixel.png", { type: "image/png" });
  const file = new win.File(["SIDE-FILE-123 中文文本"], "note.txt", { type: "text/plain" });
  const select = files => { const data = new win.DataTransfer(); files.forEach(f => data.items.add(f)); $("attachmentInput").files = data.files; $("attachmentInput").dispatchEvent(new win.Event("change", { bubbles: true })); };
  const removeAll = () => [...doc.querySelectorAll(".attachment-chip button")].forEach(b => b.click());
  win.pluginBridge.invoke = async (channel, payload) => {
    if (channel === "chat.attachment.begin") {
      if (rejectUpload) throw Error("test upload failed");
      const id = "upload-" + ++next; uploads.set(id, { ...payload, chunks: [], received: 0 }); return { id };
    }
    if (channel === "chat.attachment.chunk") {
      const item = uploads.get(payload.id); assert(item.conversationId === payload.conversationId && item.projectKey === payload.projectKey, "upload scope changed");
      assert(item.received === payload.offset, "upload offset changed"); item.chunks.push(payload.data); item.received += atob(payload.data).length; return { received: item.received };
    }
    if (channel === "chat.attachment.finish") {
      const item = uploads.get(payload.id); assert(item.received === item.size, "file bytes not fully uploaded");
      return { id: payload.id, name: item.name, size: item.size, mimeType: item.mimeType, kind: item.mimeType.startsWith("image/") ? "image" : "file" };
    }
    if (channel === "chat.attachment.discard") { uploads.delete(payload.id); return { ok: true }; }
    if (channel === "chat.send") {
      sends.push(payload); const result = await original(channel, payload);
      if (payload.attachments?.length) {
        const state = win.__mock.snapshots[payload.projectKey], conv = state.conversations.find(c => c.id === state.activeId);
        conv.messages.at(-1).attachments = payload.attachments;
        result.snapshot = JSON.parse(JSON.stringify(state)); result.backend = "agent";
      }
      return result;
    }
    return original(channel, payload);
  };
  try {
    await check("附件入口位于输入框内，支持多个文件且不改变底栏高度", () => {
      assert($("input").closest(".box").contains($("attachBtn")), "attachment button missing from box");
      assert($("attachmentInput").multiple && $("attachmentList").hidden, "file input configuration wrong");
      assert(Math.abs($("sendBtn").getBoundingClientRect().height - 24) < 0.2, "footer height changed");
    });
    await check("图片与文本文件可同时添加，添加本身不发送", () => {
      select([image, file]); assert(doc.querySelectorAll(".attachment-chip").length === 2, "files not added");
      assert($("attachmentList").textContent.includes("pixel.png") && $("attachmentList").textContent.includes("note.txt"), "file labels missing");
      assert(sends.length === 0, "adding files sent a message");
    });
    await check("可移除附件并通过拖放重新添加", () => {
      doc.querySelector(".attachment-chip button").click(); assert(doc.querySelectorAll(".attachment-chip").length === 1, "remove failed");
      const transfer = new win.DataTransfer(); transfer.items.add(image);
      $("input").closest(".box").dispatchEvent(new win.DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      assert(doc.querySelectorAll(".attachment-chip").length === 2, "drop failed");
    });
    await check("图片、文本字节与消息一起发送，历史显示两种附件", async () => {
      $("input").value = "读取这两个附件"; $("form").requestSubmit(); await wait(() => sends.length === 1 && !$("sendBtn").disabled);
      assert(sends[0].attachments.length === 2 && sends[0].text === "读取这两个附件", "send payload lost text/attachments");
      const picture = [...uploads.values()].find(f => f.name === "pixel.png"), note = [...uploads.values()].find(f => f.name === "note.txt");
      assert(picture.chunks[0] === pngSource, "PNG bytes changed");
      assert(new TextDecoder().decode(Uint8Array.from(atob(note.chunks[0]), c => c.charCodeAt(0))) === "SIDE-FILE-123 中文文本", "UTF-8 bytes changed");
      assert($("attachmentList").hidden && doc.querySelectorAll(".message-attachments span").length >= 2, "accepted files not cleared/rendered");
    });
    await check("仅附件也能提交，普通文本输入无需强制占位文字", async () => {
      select([file]); $("input").value = ""; $("form").requestSubmit(); await wait(() => sends.length === 2 && !$("sendBtn").disabled);
      assert(sends[1].text === "" && sends[1].attachments.length === 1, "attachment-only message rejected");
    });
    await check("上传失败保留草稿与选择，且不调用发送", async () => {
      rejectUpload = true; select([file]); $("input").value = "不能丢掉的草稿"; $("form").requestSubmit();
      await wait(() => !$("sendBtn").disabled && $("hint").textContent.includes("test upload failed"));
      assert(sends.length === 2 && $("input").value === "不能丢掉的草稿" && !$("attachmentList").hidden, "failed upload lost draft or sent");
      rejectUpload = false; removeAll();
    });
    await check("跨项目历史不继承待发附件，历史只读时附件入口禁用", async () => {
      select([file]); const current = win.scope().projectKey, other = current === "project:a" ? "project:b" : "project:a";
      await win.showHistory("chat.history", { projectKey: other });
      assert($("attachmentList").hidden && $("attachBtn").disabled, "attachment crossed history scope");
      await win.showHistory("chat.history", { projectKey: current });
    });
    await check("附件名称按文本显示、主草稿与主会话调用不受影响", () => {
      select([new win.File(["safe"], '<img onerror="bad">.txt', { type: "text/plain" })]);
      assert(!$("attachmentList").querySelector("img") && $("attachmentList").textContent.includes("<img"), "attachment label interpreted as HTML");
      assert(document.getElementById("mainDraft").value === mainDraft, "main draft changed"); removeAll();
    });
    await check("扩展握手未确认不再误报为需要重新授权", () => {
      const message = win.formatError("Side Chat read-only extension did not confirm startup; check trusted extension diagnostics");
      assert(message === win.t("attachmentsUnconfirmed"), "guard timeout was not localized separately");
      assert(!/授权|重新加载|grant|reload/i.test(message), "guard timeout blamed user authorization");
      assert(win.formatError("PERMISSION_DENIED: agent.extension") === win.t("attachmentsReload"), "actual permission error lost its guidance");
    });
  } finally {
    rejectUpload = false; removeAll(); win.pluginBridge.invoke = original;
    const saved = JSON.parse(history); for (const key of Object.keys(win.__mock.snapshots)) delete win.__mock.snapshots[key]; Object.assign(win.__mock.snapshots, saved);
    $("input").value = ""; await win.refreshContext(); win.renderAll(); win.hint("");
  }
  return { passed: rows.filter(r => r.passed).length, failed: rows.filter(r => !r.passed).length, rows };
};
