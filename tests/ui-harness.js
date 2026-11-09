"use strict";
const fixtureMarkdown = [
  "# 项目进度", "", "已完成 **模型检查**，下一步做 *网格测试*。", "",
  "1. 核对边界条件", "2. 检查计算结果", "   - 子项一", "   - 子项二", "",
  "> 这是当前项目的独立侧聊。", "", "```js", 'const value = "<safe>";', "```", "",
  "[开发指南](https://example.com/guide)", "", "| 项目 | 状态 |", "| --- | --- |", "| 模拟 A | 已完成 |",
].join("\n");

window.installSideChatMock = function (win) {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  let projectKey = "project:a", sessionId = "session-a-0001", base = "light";
  const names = { general: "No project", "project:a": "泥石流模拟 A", "project:b": "边界校验 B", legacy: "Legacy history" };
  const snapshots = {};
  for (const key of Object.keys(names)) {
    const id = `chat-${key}`;
    snapshots[key] = { version: 1, projectKey: key, projectName: names[key], activeId: id, conversations: [{
      id, title: key === "project:a" ? "A 的进度检查" : key === "legacy" ? "旧版记录" : "B 的边界校验",
      messages: key === "project:a" ? [{ role: "user", content: "现在进行到哪一步了？" }, { role: "assistant", content: fixtureMarkdown }]
        : [{ role: "user", content: key === "legacy" ? "旧版原始记录" : "B 项目专有消息" }],
    }] };
  }
  snapshots.general = { version: 1, projectKey: "general", projectName: "No project", activeId: "standalone-2", conversations: [
    { id: "standalone-2", title: "独立记录二", messages: [{ role: "user", content: "非项目历史二" }] },
    { id: "standalone-1", title: "独立记录一", messages: [{ role: "user", content: "非项目历史一" }] },
  ] };
  let settings = { modelKey: "mock/model", thinkingLevel: "high", includeSession: true };
  const listeners = new Map(), calls = [], jobs = new Map();
  const rendererCalls = [];
  const context = () => ({ projectKey, sessionId, projectName: names[projectKey], projectPath: projectKey === "general" ? "" : `D:/projects/${projectKey}` });
  let projectRows = null;
  const projects = () => projectRows || Object.entries(names).map(([key, name]) => ({ key, name }));
  const current = () => ({ context: context(), snapshot: copy(snapshots[projectKey]), projects: projects() });
  function emit(event, data) { for (const fn of listeners.get(event) || []) fn(data); }
  win.pluginBridge = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn); return () => listeners.get(event).delete(fn);
    },
    async invoke(channel, payload = {}) {
      calls.push({ channel, payload: copy(payload) });
      if (channel === "app.getAppearance") return { base, locale: "zh-CN" };
      if (channel === "chat.bootstrap") return { ...current(), settings, locale: "zh-CN", models: [
        { key: "mock/model", label: "gemini-3.8-flash-high / very long model label", providerId: "gemini", providerName: "gemini" },
        { key: "other/model", label: "gpt-6.1-sol (OpenAI (ChatGPT Plus/Pro))", providerId: "openai", providerName: "OpenAI (ChatGPT Plus/Pro)" },
        { key: "mock/model-2", label: "gemini-4-argon-high", alias: "gemini-4-argon-high（自定义别名）", providerId: "gemini", providerName: "gemini" },
      ] };
      if (channel === "chat.context") return current();
      if (channel === "chat.setSettings") return { settings: settings = { ...settings, ...payload } };
      if (channel === "chat.copy" || channel === "shell.openExternal") return { ok: true };
      if (channel === "chat.insert") {
        if (payload.sessionId !== sessionId || payload.projectKey !== projectKey) throw new Error("Session changed");
        const { deliverPendingDraft } = await import("../renderer/draft-bridge.mjs");
        const state = { active: true, generation: 1 };
        const input = document.getElementById("mainDraft");
        let claimed = false, acknowledged;
        await deliverPendingDraft({ async dispatch(action, data) {
          rendererCalls.push({ action, data: copy(data) });
          if (action === "plugin.call" && data.method === "takeDraft") {
            if (claimed) return null;
            claimed = true;
            return { id: "mock-draft", text: payload.text, expiresAt: Date.now() + 8000 };
          }
          if (action === "composer.readDraft") return { text: input.value, marks: [], generation: state.generation };
          if (action === "composer.insertText") { input.value += data.text; input.focus(); return { ok: true, generation: ++state.generation }; }
          if (action === "plugin.call" && data.method === "finishDraft") { acknowledged = data.args; return { ok: true }; }
          throw new Error(`Unexpected renderer action: ${action}`);
        } }, state);
        if (!acknowledged?.ok) throw new Error(acknowledged?.message || "draft insertion failed");
        return { ok: true };
      }
      if (channel === "chat.history" || channel === "chat.select" || channel === "chat.delete") {
        const snap = snapshots[payload.projectKey];
        if (channel === "chat.select") snap.activeId = payload.id;
        if (channel === "chat.delete") snap.conversations = snap.conversations.filter(c => c.id !== payload.id);
        return { snapshot: copy(snap), projects: projects() };
      }
      if (channel === "chat.new") {
        const snap = snapshots[payload.projectKey]; const id = `new-${snap.conversations.length}`;
        snap.conversations.unshift({ id, title: "", messages: [] }); snap.activeId = id;
        return { snapshot: copy(snap), projects: projects() };
      }
      if (channel === "chat.send") {
        const snap = snapshots[payload.projectKey], conv = snap.conversations.find(c => c.id === snap.activeId);
        conv.messages.push({ role: "user", content: payload.text });
        const id = `job-${jobs.size}`;
        jobs.set(id, { status: "running", snapshot: copy(snap) });
        win.setTimeout(() => {
          conv.messages.push({ role: "assistant", content: "## 在途回复\n\n仅属于项目 A。" });
          jobs.set(id, { status: "done", snapshot: copy(snap) });
        }, 180);
        return { jobId: id, snapshot: copy(snap), settings };
      }
      if (channel === "chat.poll") return copy(jobs.get(payload.jobId));
      throw new Error(`Unexpected mock channel: ${channel}`);
    },
  };
  win.__mock = {
    calls, snapshots, rendererCalls,
    setProjects(rows) { projectRows = rows ? copy(rows) : null; },
    change(key, nextSession, push = true) {
      projectKey = key; sessionId = nextSession;
      if (push) { emit("session:activated", { sessionId, projectPath: context().projectPath }); emit("workspace:changed", { path: context().projectPath }); }
    },
    theme(next) { base = next; emit("appearance:changed", { base, locale: "zh-CN" }); },
  };
};

(async () => {
  const output = document.getElementById("results"), frame = document.getElementById("app");
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async (fn, message) => {
    for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error(message);
  };
  const check = (name, fn) => Promise.resolve().then(fn).then(() => { results.push(`PASS ${results.length + 1}: ${name}`); output.textContent = results.join("\n"); });
  try {
    const html = await (await fetch("../renderer/index.html")).text();
    const base = new URL("../renderer/", location.href).href;
    frame.srcdoc = html.replace("<head>", `<head><base href="${base}"><script>parent.installSideChatMock(window);<\/script>`);
    await new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
    const win = frame.contentWindow, doc = win.document, $ = id => doc.getElementById(id);
    await waitFor(() => win.scope().sessionId === "session-a-0001" && doc.querySelector(".markdown h1"), "initial render not ready");
    await check("输入框独立；图标开关和回填按钮均在框外", () => {
      assert(!$("currentSession") && !doc.querySelector(".current-session"), "readonly session field remains");
      const box = $("input").closest(".box");
      for (const id of ["sendBtn", "ctxBtn", "insertBtn", "modelMenuButton"]) assert(!box.contains($(id)), `${id} remains in input box`);
      assert(!doc.querySelector(".top").contains($("modelSelect")), "model control remains in header");
      const input = box.getBoundingClientRect();
      for (const id of ["sendBtn", "ctxBtn", "insertBtn", "modelMenuButton"]) assert($(id).getBoundingClientRect().top >= input.bottom, `${id} not below input`);
    });
    await check("输入框聚焦没有蓝框，外框与按钮键盘焦点保留", () => {
      $("input").focus();
      assert(doc.activeElement === $("input"), "textarea not focused");
      assert(win.getComputedStyle($("input")).outlineStyle === "none", "textarea focus outline remains");
      assert(parseFloat(win.getComputedStyle($("input").closest(".box")).borderTopWidth) > 0, "input outer border removed");
      const focusRule = [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]).find(rule => rule.selectorText === "button:focus-visible, select:focus-visible");
      assert(focusRule?.style.outline === "2px solid var(--accent)" && focusRule.style.outlineOffset === "2px", "button/select focus rule changed");
    });
    await check("模型名去除中英文和嵌套括号后缀，模型键不变", () => {
      const expected = new Map([["mock/model", "gemini-3.8-flash-high / very long model label"], ["other/model", "gpt-6.1-sol"], ["mock/model-2", "gemini-4-argon-high"]]);
      for (const [key, label] of expected) {
        assert(doc.querySelector(`[data-model-key="${key}"] .model-name`).textContent === label, `model row label mismatch: ${key}`);
        assert([...$("modelSelect").options].find(option => option.value === key)?.textContent === label, `select label/key mismatch: ${key}`);
      }
      assert(win.modelDisplayName({ key: "provider/plain-model" }) === "provider/plain-model", "key fallback changed");
      assert($("modelValue").textContent === expected.get("mock/model"), "selected model label mismatch");
    });
    await check("模型与左右操作均为24px且垂直居中，箭头保留原SVG", () => {
      const send = $("sendBtn").getBoundingClientRect(), center = rect => rect.top + rect.height / 2;
      for (const id of ["ctxBtn", "modelMenuButton", "insertBtn", "sendBtn"]) {
        const rect = $(id).getBoundingClientRect();
        assert(Math.abs(rect.height - 24) < 0.2, `unexpected control height: ${id}/${rect.height}`);
        assert(Math.abs(center(rect) - center(send)) < 0.25, `control not centered: ${id}`);
      }
      for (const id of ["modelValue", "thinkingValue"]) if (win.getComputedStyle($(id)).display !== "none") assert(Math.abs(center($(id).getBoundingClientRect()) - center(send)) < 0.25, `model text not centered: ${id}`);
      const arrow = $("modelMenuButton").querySelector("svg.model-chevron");
      assert(arrow && arrow.getAttribute("aria-hidden") === "true" && parseFloat(win.getComputedStyle(arrow).width) === 12, "SVG chevron changed");
      assert(!$("modelMenuButton").textContent.includes("⌄"), "text arrow remains");
    });
    await check("上下文仅显示图标与开关，状态可切换并保存", async () => {
      assert($("ctxBtn").getAttribute("role") === "switch" && $("ctxBtn").querySelector("svg") && $("ctxBtn").querySelector(".switch-track"), "icon/switch missing");
      assert($("ctxBtn").textContent.trim() === "" && $("ctxBtn").getAttribute("aria-label"), "toggle has visible text or no accessible label");
      assert($("insertBtn").querySelector("svg") && $("insertBtn").textContent.trim() === "", "return must be icon-only");
      $("ctxBtn").click(); await waitFor(() => $("ctxBtn").getAttribute("aria-checked") === "false", "switch did not turn off");
      assert(win.__mock.calls.some(c => c.channel === "chat.setSettings" && c.payload.includeSession === false), "switch state not saved");
      $("ctxBtn").click(); await waitFor(() => $("ctxBtn").getAttribute("aria-checked") === "true", "switch did not turn on");
    });
    await check("标题、嵌套列表、粗体、代码块、引用、链接、表格按语义渲染", () => {
      for (const tag of ["h1", "ol", "ul", "strong", "em", "pre code", "blockquote", "a", "table"]) assert(doc.querySelector(`.markdown ${tag}`), `missing ${tag}`);
      assert(doc.querySelector("pre code").textContent.includes("<safe>"), "code text changed");
      assert(!doc.querySelector(".markdown h1").textContent.includes("#"), "heading marker visible");
    });
    await check("危险 HTML/协议不能执行，远程图片不加载", () => {
      const target = doc.createElement("div");
      target.appendChild(win.SideChatMarkdown.render('<img src="https://example.com/leak" onerror="window.__xss=1"><script>window.__xss=1</script>\n\n[bad](javascript:alert(1))\n\n![remote](https://example.com/pixel)\n\n<a href="data:text/html,evil" onclick="window.__xss=1">bad</a>'));
      assert(!target.querySelector("script,img,svg,iframe,object,style"), "active or remote element remains");
      assert(!target.querySelector('[onclick],[onerror],[onload]'), "event attribute remains");
      for (const a of target.querySelectorAll("a[href]")) assert(/^(https?:\/\/|mailto:)/i.test(a.getAttribute("href")), "unsafe scheme remains");
      assert(!win.__xss, "script executed");
    });
    await check("外链只调用官方 shell.openExternal 桥", async () => {
      doc.querySelector('.markdown a[href="https://example.com/guide"]').click();
      await waitFor(() => win.__mock.calls.some(c => c.channel === "shell.openExternal" && c.payload.url === "https://example.com/guide"), "link not brokered");
    });
    await check("无搜索的模型弹层：提供商筛选、选模、思考保存、Esc/点击外部关闭", async () => {
      $("modelMenuButton").click();
      assert(!$("modelMenu").hidden && !$("modelMenu").querySelector("input"), "menu missing or unexpected search field");
      assert(doc.querySelectorAll(".model-option").length === 3, "model list incomplete");
      doc.querySelector('[data-provider="openai"]').click();
      assert(doc.querySelectorAll(".model-option").length === 1, "provider filter failed");
      doc.querySelector('[data-model-key="other/model"]').click();
      await waitFor(() => $("modelSelect").value === "other/model" && win.__mock.calls.some(c => c.channel === "chat.setSettings" && c.payload.modelKey === "other/model"), "model not saved");
      assert($("modelValue").textContent === "gpt-6.1-sol" && !/[()（）]/.test($("modelMenuButton").title), "trigger still has provider suffix");
      $("modelMenuButton").click();
      doc.querySelector('[data-level="medium"]').click();
      await waitFor(() => $("thinkSelect").value === "medium" && $("thinkingValue").textContent === "medium", "effort not saved");
      $("modelMenu").dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      assert($("modelMenu").hidden && doc.activeElement === $("modelMenuButton"), "Escape focus contract failed");
      $("modelMenuButton").click();
      $("projectLabel").dispatchEvent(new win.MouseEvent("pointerdown", { bubbles: true }));
      assert($("modelMenu").hidden, "outside click did not close menu");
    });
    await check("七档推理可选，xhigh/max 保存并在重绘后保留", async () => {
      const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
      assert([...$("thinkSelect").options].map(option => option.value).join() === levels.join(), "reasoning levels incomplete");
      for (const level of ["xhigh", "max"]) {
        $("modelMenuButton").click();
        doc.querySelector(`[data-level="${level}"]`).click();
        await waitFor(() => win.eval("state.settings.thinkingLevel") === level, `not saved: ${level}`);
        win.renderSelects();
        assert($("thinkSelect").value === level && $("thinkingValue").textContent === level, `level changed after render: ${level}`);
        assert(doc.querySelector(`[data-level="${level}"]`).getAttribute("aria-pressed") === "true", `selection lost: ${level}`);
        $("modelMenuButton").click();
      }
      $("modelMenuButton").click();
      doc.querySelector('[data-level="medium"]').click();
      await waitFor(() => win.eval("state.settings.thinkingLevel") === "medium", "original effort not restored");
      $("modelMenuButton").click();
    });
    await check("中间消息区四角8px圆角，内容仍可滚动", () => {
      const log = $("log"), style = win.getComputedStyle(log);
      for (const corner of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"]) assert(style[corner] === "8px", `missing corner: ${corner}`);
      assert(style.backgroundColor === win.getComputedStyle(doc.querySelector(".msg:not(.user)")).backgroundColor, "message area must use card palette");
      assert(style.overflowY === "auto", "scroll behavior changed");
      const before = log.scrollTop, probe = doc.createElement("div");
      probe.style.cssText = `flex:none;height:${log.clientHeight}px`; log.appendChild(probe);
      try {
        log.scrollTop = log.scrollHeight;
        assert(log.scrollHeight > log.clientHeight && log.scrollTop > 0, "message area cannot scroll");
      } finally { probe.remove(); log.scrollTop = before; }
    });
    await check("回填实际写入模拟主输入框，保留已有草稿且不发送", async () => {
      const main = document.getElementById("mainDraft"); main.value = "已有主草稿：";
      $("input").value = "侧聊未发送草稿";
      const sendsBefore = win.__mock.calls.filter(c => c.channel === "chat.send").length;
      $("insertBtn").click();
      await waitFor(() => $("hint").textContent.includes("未发送") && !$("insertBtn").disabled, "draft return not acknowledged");
      assert(main.value === "已有主草稿：" + fixtureMarkdown, "main draft was not filled or was overwritten");
      assert($("input").value === "侧聊未发送草稿", "side-chat draft unexpectedly changed");
      assert(win.__mock.calls.filter(c => c.channel === "chat.send").length === sendsBefore, "return triggered send");
      assert(win.__mock.rendererCalls.filter(c => c.action === "composer.insertText").length === 1, "draft inserted more than once");
    });
    await check("宿主会话事件即时跟随，同项目保留历史", async () => {
      win.__mock.change("project:a", "session-a-0002");
      await waitFor(() => win.scope().sessionId === "session-a-0002", "session not followed");
      assert($("log").textContent.includes("项目进度"), "same-project history lost");
    });
    await check("跨项目自动切换，返回后历史恢复", async () => {
      win.__mock.change("project:b", "session-b-0001");
      await waitFor(() => $("log").textContent.includes("B 项目专有消息"), "B not shown");
      assert(!$("log").textContent.includes("项目进度"), "A history leaked into B");
      win.__mock.change("project:a", "session-a-0002");
      await waitFor(() => $("log").textContent.includes("项目进度"), "A not restored");
    });
    await check("按项目浏览历史、旧版记录保留、跨项目浏览禁发", async () => {
      $("historySelect").value = "legacy"; $("historySelect").dispatchEvent(new win.Event("change"));
      await waitFor(() => $("log").textContent.includes("旧版原始记录"), "legacy inaccessible");
      assert($("sendBtn").disabled && $("insertBtn").disabled && !$("returnBtn").hidden, "cross-project send enabled");
      $("returnBtn").click(); await waitFor(() => !$("sendBtn").disabled, "return not restored");
    });
    await check("在途回复到达时不覆盖已切换的项目", async () => {
      $("input").value = "慢速回复测试"; $("form").requestSubmit();
      await waitFor(() => win.__mock.calls.some(c => c.channel === "chat.send"), "send missing");
      const sent = win.__mock.calls.find(c => c.channel === "chat.send");
      assert(sent.payload.modelKey === "other/model" && sent.payload.thinkingLevel === "medium", "new controls changed send settings");
      win.__mock.change("project:b", "session-b-0001");
      await waitFor(() => $("log").textContent.includes("B 项目专有消息"), "B missing while pending");
      await waitFor(() => !$("sendBtn").disabled, "job not settled");
      assert(!$("log").textContent.includes("在途回复"), "late A reply overwrote B");
      win.__mock.change("project:a", "session-a-0002");
      await waitFor(() => $("log").textContent.includes("在途回复"), "A late reply lost");
    });
    await check("缺少推送时，独立窗口的只读查询恢复跟随", async () => {
      win.__mock.change("project:a", "session-a-0003", false);
      await waitFor(() => win.scope().sessionId === "session-a-0003", "pull recovery failed");
    });
    await check("缩窄依次隐藏箭头、思考深度、最后缩名，放宽时按逆序恢复", async () => {
      const footer = doc.querySelector(".composer-footer"), actions = doc.querySelector(".composer-actions"), arrow = doc.querySelector(".model-chevron");
      const model = win.eval('state.models.find(model => model.key === state.settings.modelKey)'), originalAlias = model.alias;
      const setWidth = async width => { frame.style.width = `${width}px`; await waitFor(() => { if (win.innerWidth !== width) return false; win.updateFooterLayout(); return true; }, `priority width not ready: ${width}`); };
      window.__priorityResults = [];
      try {
        for (const name of ["gpt-6.1-sol", "gemini-4-argon-high", "中文模型🚀", "W".repeat(120)]) {
          model.alias = name; win.renderModelPicker(); await setWidth(2000);
          const style = win.getComputedStyle($("modelMenuButton")), gap = parseFloat(style.columnGap), padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
          const full = parseFloat(win.getComputedStyle(footer).getPropertyValue("--model-min-width"));
          const noArrow = full - Math.round(parseFloat(win.getComputedStyle(arrow).width) + gap);
          const nameOnly = Math.ceil($("modelValue").getBoundingClientRect().width + padding);
          const fixed = win.innerWidth - footer.clientWidth + $("ctxBtn").offsetWidth + actions.offsetWidth + parseFloat(win.getComputedStyle(footer).columnGap) * 2;
          const cases = [[full + 1, true, true, false], [full, true, true, false], [full - 1, false, true, false], [noArrow + 1, false, true, false], [noArrow, false, true, false], [noArrow - 1, false, false, false], [nameOnly + 1, false, false, false], [nameOnly, false, false, false], [nameOnly - 1, false, false, null], [nameOnly - 4, false, false, true]];
          for (const [available, arrowVisible, thinkingVisible, clipped] of [...cases, ...cases.slice().reverse()]) {
            const width = Math.ceil(fixed + available); await setWidth(width);
            for (let repeat = 0; repeat < 3; repeat++) {
              win.updateFooterLayout();
              assert((win.getComputedStyle(arrow).display !== "none") === arrowVisible, `arrow priority mismatch: ${name}/${width}`);
              assert((win.getComputedStyle($("thinkingValue")).display !== "none") === thinkingVisible, `thinking priority mismatch: ${name}/${width}`);
            }
            const truncated = $("modelValue").scrollWidth > $("modelValue").clientWidth + 1;
            if (clipped !== null) assert(truncated === clipped, `name shrank at wrong stage: ${name}/${width}`);
            assert(!thinkingVisible || !truncated, "name truncated before thinking depth disappeared");
            assert($("modelMenuButton").title.includes(name), "full-name tooltip changed");
            const trigger = $("modelMenuButton").getBoundingClientRect(), send = $("sendBtn").getBoundingClientRect();
            assert(Math.abs(trigger.top - send.top) < 0.25 && Math.abs(trigger.height - send.height) < 0.25, "priority change moved the model off the bottom row");
            window.__priorityResults.push({ name, width, available, arrowVisible, thinkingVisible, truncated });
          }
        }
      } finally { model.alias = originalAlias; frame.style.width = "420px"; win.renderSelects(); }
    });
    await check("模型固定底栏，临界宽度隐藏箭头、缩小名称且不改变按钮位置", async () => {
      window.__layoutResults = [];
      const footer = doc.querySelector(".composer-footer"), actions = doc.querySelector(".composer-actions"), center = rect => rect.top + rect.height / 2;
      const minimum = parseFloat(win.getComputedStyle(footer).getPropertyValue("--model-min-width")), gap = parseFloat(win.getComputedStyle(footer).columnGap);
      const threshold = Math.ceil(win.innerWidth - footer.clientWidth + $("ctxBtn").offsetWidth + actions.offsetWidth + gap * 2 + minimum);
      const widths = [...new Set([260, 300, 320, threshold - 1, threshold, threshold + 1, 360, 420, 504, 640])].sort((a, b) => a - b);
      for (const width of widths) {
        frame.style.width = `${width}px`;
        await waitFor(() => win.innerWidth === width && footer.dataset.modelCompact === String(footer.clientWidth - $("ctxBtn").offsetWidth - actions.offsetWidth - gap * 2 < minimum), `compact layout did not settle: ${width}`);
        const send = $("sendBtn").getBoundingClientRect(), model = $("modelMenuButton").getBoundingClientRect(), context = $("ctxBtn").getBoundingClientRect(), insert = $("insertBtn").getBoundingClientRect();
        for (const id of ["ctxBtn", "modelMenuButton", "insertBtn", "sendBtn", "modelValue", "thinkingValue"]) if (win.getComputedStyle($(id)).display !== "none") assert(Math.abs(center($(id).getBoundingClientRect()) - center(send)) < 0.25, `not centered on bottom row: ${id}/${width}`);
        assert(Math.abs(footer.getBoundingClientRect().height - 24) < 0.2, `footer expanded into extra rows: ${width}`);
        assert(context.right <= model.left && model.right <= insert.left && insert.right <= send.left, `controls overlap: ${width}`);
        assert(send.right <= win.innerWidth && doc.documentElement.scrollWidth <= win.innerWidth + 1, `page overflow: ${width}`);
        assert(send.left - insert.right <= 8, "return/send spacing changed");
        const compact = footer.dataset.modelCompact === "true", arrow = doc.querySelector(".model-chevron");
        assert((win.getComputedStyle(arrow).display === "none") === compact, `arrow visibility mismatch: ${width}`);
        if (compact) assert(arrow.getBoundingClientRect().width === 0, "hidden arrow still occupies space");
        window.__layoutResults.push({ width, compact, nameWidth: $("modelValue").getBoundingClientRect().width, modelCenter: center(model), sendCenter: center(send), footerHeight: footer.getBoundingClientRect().height });
        $("modelMenuButton").click();
        const menu = $("modelMenu").getBoundingClientRect();
        assert(menu.left >= 0 && menu.right <= win.innerWidth && menu.top >= 0 && menu.bottom <= model.top, `menu outside viewport: ${width}`);
        for (const level of ["xhigh", "max"]) { const option = doc.querySelector(`[data-level="${level}"]`).getBoundingClientRect(); assert(option.left >= menu.left && option.right <= menu.right && option.bottom <= menu.bottom, "reasoning option clipped"); }
        $("modelMenuButton").click();
      }
      assert(window.__layoutResults.find(row => row.width === 260).nameWidth < window.__layoutResults.find(row => row.width === 640).nameWidth, "name area did not shrink");
      frame.style.width = "420px";
    });
    await check("长短及Unicode模型都不离开底栏，箭头隐藏状态稳定且全名可查", async () => {
      const footer = doc.querySelector(".composer-footer"), actions = doc.querySelector(".composer-actions");
      const model = win.eval('state.models.find(model => model.key === state.settings.modelKey)'), originalAlias = model.alias;
      window.__dynamicLayoutResults = [];
      try {
        for (const name of ["x", "gpt-6.1-sol", "gemini-4-argon-high", "中文模型🚀", "W".repeat(120)]) {
          model.alias = name; win.renderModelPicker();
          const minimum = parseFloat(win.getComputedStyle(footer).getPropertyValue("--model-min-width"));
          for (const width of [260, 360, 640]) {
            frame.style.width = `${width}px`;
            const expected = () => String(footer.clientWidth - $("ctxBtn").offsetWidth - actions.offsetWidth - parseFloat(win.getComputedStyle(footer).columnGap) * 2 < minimum);
            await waitFor(() => win.innerWidth === width && footer.dataset.modelCompact === expected(), `name layout not settled: ${name.length}/${width}`);
            for (let i = 0; i < 3; i++) { win.updateFooterLayout(); assert(footer.dataset.modelCompact === expected(), "arrow visibility oscillates on remeasurement"); }
            const trigger = $("modelMenuButton").getBoundingClientRect(), send = $("sendBtn").getBoundingClientRect();
            assert(Math.abs(trigger.top - send.top) < 0.25 && Math.abs(trigger.height - send.height) < 0.25, "model left the bottom row");
            assert(doc.documentElement.scrollWidth <= win.innerWidth + 1, "long name causes overflow");
            assert($("modelValue").textContent === name && $("modelMenuButton").title.includes(name), "display text/full-name tooltip changed");
            assert($("thinkingValue").getBoundingClientRect().right <= trigger.right + 0.5, "badge spills beyond model control");
            const compact = footer.dataset.modelCompact === "true", truncated = $("modelValue").scrollWidth > $("modelValue").clientWidth + 1;
            assert((win.getComputedStyle(doc.querySelector(".model-chevron")).display === "none") === compact, "arrow visibility mismatch");
            if (truncated) assert(win.getComputedStyle($("thinkingValue")).display === "none", "thinking depth must hide before the name shrinks");
            window.__dynamicLayoutResults.push({ name, width, compact, truncated, nameWidth: $("modelValue").clientWidth });
          }
        }
        assert(window.__dynamicLayoutResults.some(row => row.truncated), "long names were not constrained");
      } finally { model.alias = originalAlias; frame.style.width = "420px"; win.renderSelects(); }
    });
    await check("窄底栏隐藏思考标记但保留七档选择值和菜单", async () => {
      const footer = doc.querySelector(".composer-footer"), original = $("thinkSelect").value;
      frame.style.width = "260px"; await waitFor(() => win.innerWidth === 260, "narrow width not ready");
      try {
        for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
          $("thinkSelect").value = level; win.renderModelPicker();
          const badge = $("thinkingValue").getBoundingClientRect(), trigger = $("modelMenuButton").getBoundingClientRect(), send = $("sendBtn").getBoundingClientRect();
          assert($("thinkingValue").textContent === level, `reasoning value changed: ${level}`);
          assert(Math.abs(trigger.top - send.top) < 0.25 && win.getComputedStyle($("thinkingValue")).display === "none" && badge.width === 0, `reasoning badge not hidden: ${level}`);
          assert(footer.dataset.modelCompact === "true" && win.getComputedStyle(doc.querySelector(".model-chevron")).display === "none", "narrow arrow remains");
          $("modelMenuButton").click();
          assert(doc.querySelectorAll(".thinking-option").length === 7, "hiding the badge removed reasoning choices");
          $("modelMenu").dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
      } finally { $("thinkSelect").value = original; frame.style.width = "420px"; win.renderSelects(); }
    });
    await check("浅色/深色下顶部、消息区、输入区配色一致", () => {
      for (const theme of ["light", "dark"]) {
        win.__mock.theme(theme);
        assert(doc.documentElement.dataset.theme === theme, "theme did not follow host");
        const bg = win.getComputedStyle(doc.body).backgroundColor;
        assert(bg === win.getComputedStyle(doc.querySelector(".top")).backgroundColor, "header palette mismatch");
        assert(bg === win.getComputedStyle(doc.querySelector(".composer")).backgroundColor, "composer palette mismatch");
      }
      win.__mock.theme("light");
    });
    await check("xhigh/max 发送载荷保留真实模型键和档位", async () => {
      for (const level of ["xhigh", "max"]) {
        $("modelMenuButton").click();
        doc.querySelector(`[data-level="${level}"]`).click();
        await waitFor(() => $("thinkingValue").textContent === level, `level not ready: ${level}`);
        $("modelMenuButton").click();
        $("input").value = `reasoning ${level}`;
        $("form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
        await waitFor(() => win.__mock.calls.some(c => c.channel === "chat.send" && c.payload.thinkingLevel === level && c.payload.modelKey === "other/model"), `send payload mismatch: ${level}`);
        await waitFor(() => !$("sendBtn").disabled, `send not settled: ${level}`);
      }
    });
    await check("独立会话入口唯一，汇总全部非项目记录，项目选项展示不变", async () => {
      const options = () => [...$("historySelect").options];
      assert(options().filter(option => option.value === "general").length === 1, "standalone entry missing/duplicated");
      assert(options().find(option => option.value === "general").textContent === "独立会话", "standalone entry still shown as no project");
      assert(options().find(option => option.value === "project:a").textContent === "泥石流模拟 A (当前项目)", "current project label changed");
      assert(options().find(option => option.value === "project:b").textContent === "边界校验 B", "other project label changed");
      $("historySelect").value = "general"; $("historySelect").dispatchEvent(new win.Event("change"));
      await waitFor(() => doc.querySelectorAll(".conv").length === 2 && $("historySelect").value === "general", "standalone history not shown");
      assert($("sendBtn").disabled && $("insertBtn").disabled, "browsing standalone history enabled cross-context writes");
      for (const [title, text] of [["独立记录一", "非项目历史一"], ["独立记录二", "非项目历史二"]]) {
        [...doc.querySelectorAll(".conv")].find(row => row.querySelector("div").textContent === title).click();
        await waitFor(() => $("log").textContent.includes(text), `standalone record inaccessible: ${title}`);
      }
      $("returnBtn").click(); await waitFor(() => $("historySelect").value === "project:a" && !$("sendBtn").disabled, "project context not restored");
      assert($("log").textContent.includes("项目进度") && !$("log").textContent.includes("非项目历史"), "standalone history leaked into project A");
    });
    await check("多个非项目会话共用独立入口，切回项目后历史仍隔离", async () => {
      win.__mock.change("general", "standalone-host-1");
      await waitFor(() => win.scope().sessionId === "standalone-host-1" && $("historySelect").value === "general", "standalone context not followed");
      assert($("projectLabel").textContent === "独立会话", "standalone header still looks like a project");
      assert([...$("historySelect").options].find(option => option.value === "general").textContent === "独立会话", "standalone entry marked as current project");
      assert(!$("sendBtn").disabled && doc.querySelectorAll(".conv").length === 2, "standalone history unavailable");
      win.__mock.change("general", "standalone-host-2");
      await waitFor(() => win.scope().sessionId === "standalone-host-2", "second standalone session not followed");
      assert(doc.querySelectorAll(".conv").length === 2 && $("log").textContent.includes("非项目历史二"), "standalone history split by session id");
      win.__mock.change("project:b", "session-b-0002");
      await waitFor(() => $("log").textContent.includes("B 项目专有消息"), "project B history not restored");
      assert(!$("log").textContent.includes("非项目历史"), "standalone history leaked into project B");
      win.__mock.change("project:a", "session-a-0003"); await waitFor(() => $("historySelect").value === "project:a", "project A not restored");
    });
    await check("从独立会话浏览项目历史只读，返回入口指向独立会话", async () => {
      win.__mock.change("general", "standalone-host-2"); await waitFor(() => $("historySelect").value === "general", "standalone not ready");
      $("historySelect").value = "project:a"; $("historySelect").dispatchEvent(new win.Event("change"));
      await waitFor(() => $("log").textContent.includes("项目进度") && !$("returnBtn").hidden, "project history not shown");
      assert($("sendBtn").disabled && $("returnBtn").textContent === "返回独立会话", "standalone return/read-only state incorrect");
      $("returnBtn").click(); await waitFor(() => $("historySelect").value === "general" && !$("sendBtn").disabled, "return did not restore standalone");
      win.__mock.change("project:a", "session-a-0003"); await waitFor(() => $("historySelect").value === "project:a", "project context not restored");
    });
    await check("有内容的同名项目以完整身份区分，选择与只读边界不变", async () => {
      win.__mock.setProjects([{ key: "general", name: "No project" }, { key: "project:a", name: "同名项目" }, { key: "project:b", name: "同名项目" }, { key: "legacy", name: "Legacy history" }]);
      win.__mock.change("project:a", "history-label-check");
      await waitFor(() => win.scope().sessionId === "history-label-check" && $("historySelect").textContent.includes("同名项目"), "history label fixture not rendered");
      const a = [...$("historySelect").options].find(o => o.value === "project:a"), b = [...$("historySelect").options].find(o => o.value === "project:b");
      assert(a.textContent.includes("project:a") && b.textContent.includes("project:b"), "same-name identities remain visually indistinguishable");
      assert(a.textContent.includes("当前项目") && !b.textContent.includes("当前项目"), "current-project marker changed");
      $("historySelect").value = b.value; $("historySelect").dispatchEvent(new win.Event("change"));
      await waitFor(() => $("historySelect").value === "project:b" && $("log").textContent.includes("B 项目专有消息"), "same-name history cannot be selected");
      assert($("sendBtn").disabled && $("insertBtn").disabled, "same-name label bypassed read-only browsing");
      win.__mock.setProjects(null); win.__mock.change("project:a", "session-a-0003");
      await waitFor(() => $("historySelect").value === "project:a" && !$("sendBtn").disabled, "normal context not restored");
    });
    await check("重复刷新不追加历史选项，项目名只按文字显示", async () => {
      const suspicious = '<img src=x onerror="alert(1)">';
      win.__mock.setProjects([{ key: "project:a", name: suspicious }, { key: "project:b", name: suspicious }]);
      for (let i = 0; i < 3; i++) {
        win.__mock.change("project:a", `history-repeat-${i}`);
        await waitFor(() => win.scope().sessionId === `history-repeat-${i}` && $("historySelect").options.length === 2, "history options accumulated");
        assert([...$("historySelect").options].every(o => o.textContent.includes(suspicious) && o.textContent.includes(o.value)), "history identity/name not preserved as text");
        assert(!$("historySelect").querySelector("img"), "history label interpreted as HTML");
      }
      win.__mock.setProjects(null); win.__mock.change("project:a", "session-a-0003");
      await waitFor(() => $("historySelect").value === "project:a" && $("historySelect").options.length === 4, "normal history options not restored");
    });
    $("log").scrollTop = 0;
    window.__testResult = { passed: results.length, failed: 0, results };
    output.textContent = `${results.join("\n")}\n\nRESULT: ${results.length}/${results.length} passed`;
  } catch (error) {
    window.__testResult = { passed: results.length, failed: 1, error: error.message, results };
    output.textContent = `${results.join("\n")}\nFAIL: ${error.stack}`;
    console.error(error);
  }
})();
