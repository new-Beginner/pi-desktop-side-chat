"use strict";
window.runAttachmentChecks = async function () {
  const win = document.getElementById("app").contentWindow, doc = win.document, $ = id => doc.getElementById(id);
  const original = win.pluginBridge.invoke, history = JSON.stringify(win.__mock.snapshots), mainDraft = document.getElementById("mainDraft").value;
  const rows = [], uploads = new Map(), sends = []; let next = 0, rejectUpload = false, pickerClicks = 0;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw Error("Attachment UI timed out"); };
  const check = async (name, fn) => { try { await fn(); rows.push({ name, passed: true }); } catch (error) { rows.push({ name, passed: false, error: error.message }); } };
  const pngSource = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3sAAAAASUVORK5CYII=";
  const image = new win.File([Uint8Array.from(atob(pngSource), c => c.charCodeAt(0))], "pixel.png", { type: "image/png" });
  const file = new win.File(["SIDE-FILE-123 中文文本"], "note.txt", { type: "text/plain" });
  const select = files => { const data = new win.DataTransfer(); files.forEach(f => data.items.add(f)); $("attachmentInput").files = data.files; $("attachmentInput").dispatchEvent(new win.Event("change", { bubbles: true })); };
  const removeAll = () => [...doc.querySelectorAll(".attachment-chip button")].forEach(b => b.click());
  const trackPicker = () => { pickerClicks++; };
  $("attachmentInput").addEventListener("click", trackPicker);
  const paste = (selected, { text = "", html = "", itemsOnly = false } = {}) => {
    const data = new win.DataTransfer(); selected.forEach(file => data.items.add(file));
    if (text) data.setData("text/plain", text); if (html) data.setData("text/html", html);
    const event = new win.ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    if (itemsOnly) Object.defineProperty(event, "clipboardData", { value: { files: [], items: data.items, getData: type => data.getData(type) } });
    $("input").dispatchEvent(event); return event;
  };
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
    await check("粘贴事件一次加入图片与文件，不打开选择器、不上传或发送", () => {
      removeAll(); const sent = sends.length, uploaded = uploads.size; $("input").value = "保留已有问题";
      const event = paste([image, file]);
      assert(event.defaultPrevented && doc.querySelectorAll(".attachment-chip").length === 2, "clipboard files missing or duplicated");
      assert($("input").value === "保留已有问题" && pickerClicks === 0, "paste changed text or opened file picker");
      assert(sends.length === sent && uploads.size === uploaded, "paste uploaded or sent immediately"); removeAll();
    });
    await check("粘贴附件经过原上传链路发送，PNG与UTF-8字节不变", async () => {
      removeAll(); const sent = sends.length, uploaded = uploads.size; paste([image, file]);
      $("input").value = "读取粘贴的附件"; $("form").requestSubmit(); await wait(() => sends.length === sent + 1 && !$("sendBtn").disabled);
      assert(sends.at(-1).attachments?.length === 2 && sends.at(-1).text === "读取粘贴的附件", "pasted files lost from send payload");
      const added = [...uploads.values()].slice(uploaded), picture = added.find(item => item.name === "pixel.png"), note = added.find(item => item.name === "note.txt");
      assert(picture && note && picture.chunks[0] === pngSource, "pasted PNG bytes changed");
      assert(new TextDecoder().decode(Uint8Array.from(atob(note.chunks[0]), c => c.charCodeAt(0))) === "SIDE-FILE-123 中文文本", "pasted text file bytes changed");
      assert($("attachmentList").hidden && $("input").value === "", "accepted pasted selection not cleared");
    });
    await check("仅clipboardData.items提供文件时仍能直接粘贴", () => {
      removeAll(); const event = paste([image], { itemsOnly: true });
      assert(event.defaultPrevented && doc.querySelectorAll(".attachment-chip").length === 1, "file item fallback failed"); removeAll();
    });
    await check("文字与文件混合粘贴保留浏览器原生文字插入", () => {
      removeAll(); $("input").value = "已有文字"; const event = paste([file], { text: "追加的文字" });
      assert(!event.defaultPrevented && doc.querySelectorAll(".attachment-chip").length === 1, "mixed paste swallowed text or file");
      assert($("input").value === "已有文字", "handler rewrote the draft instead of allowing native insertion"); removeAll();
    });
    await check("普通文本、路径及HTML粘贴不拦截，不自动读取路径或网页图片", () => {
      removeAll(); const sent = sends.length, uploaded = uploads.size;
      const event = paste([], { text: "D:/not-selected.txt\n中文文本", html: '<img src="https://example.invalid/image.png">' });
      assert(!event.defaultPrevented && $("attachmentList").hidden, "ordinary text treated as an attachment");
      assert(sends.length === sent && uploads.size === uploaded && !$("attachmentList").querySelector("img"), "paste imported an unselected path or HTML image");
    });
    await check("粘贴继续遵守8个附件与单文件10MB限制", () => {
      removeAll(); paste(Array.from({ length: 9 }, (_, i) => new win.File(["x"], `paste-${i}.txt`, { type: "text/plain" })));
      assert(doc.querySelectorAll(".attachment-chip").length === 8 && $("hint").textContent === win.t("attachmentLimit"), "paste bypassed attachment count limit"); removeAll();
      paste([new win.File([new Uint8Array(10_000_001)], "too-large.bin")]);
      assert($("attachmentList").hidden && $("hint").textContent === win.t("attachmentLimit"), "paste bypassed file size limit");
    });
    await check("忙碌及跨项目只读时忽略粘贴附件，主草稿保持不变", async () => {
      removeAll(); const state = win.eval("state"), pending = state.pending;
      try { state.pending = true; win.renderAll(); paste([file]); assert($("attachmentList").hidden, "busy conversation accepted pasted files"); }
      finally { state.pending = pending; win.renderAll(); }
      const current = win.scope().projectKey, other = current === "project:a" ? "project:b" : "project:a";
      try { await win.showHistory("chat.history", { projectKey: other }); paste([file]); assert($("attachmentList").hidden, "read-only history accepted pasted files"); }
      finally { await win.showHistory("chat.history", { projectKey: current }); }
      assert(document.getElementById("mainDraft").value === mainDraft && pickerClicks === 0, "paste changed main draft or used picker");
    });
  } finally {
    rejectUpload = false; removeAll(); win.pluginBridge.invoke = original;
    $("attachmentInput").removeEventListener("click", trackPicker);
    const saved = JSON.parse(history); for (const key of Object.keys(win.__mock.snapshots)) delete win.__mock.snapshots[key]; Object.assign(win.__mock.snapshots, saved);
    $("input").value = ""; await win.refreshContext(); win.renderAll(); win.hint("");
  }
  return { passed: rows.filter(r => r.passed).length, failed: rows.filter(r => !r.passed).length, rows };
};
