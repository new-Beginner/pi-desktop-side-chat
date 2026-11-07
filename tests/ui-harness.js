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
  const names = { "project:a": "泥石流模拟 A", "project:b": "边界校验 B", legacy: "Legacy history" };
  const snapshots = {};
  for (const key of Object.keys(names)) {
    const id = `chat-${key}`;
    snapshots[key] = { version: 1, projectKey: key, projectName: names[key], activeId: id, conversations: [{
      id, title: key === "project:a" ? "A 的进度检查" : key === "legacy" ? "旧版记录" : "B 的边界校验",
      messages: key === "project:a" ? [{ role: "user", content: "现在进行到哪一步了？" }, { role: "assistant", content: fixtureMarkdown }]
        : [{ role: "user", content: key === "legacy" ? "旧版原始记录" : "B 项目专有消息" }],
    }] };
  }
  let settings = { modelKey: "mock/model", thinkingLevel: "high", includeSession: true };
  const listeners = new Map(), calls = [], jobs = new Map();
  const rendererCalls = [];
  const context = () => ({ projectKey, sessionId, projectName: names[projectKey], projectPath: `D:/projects/${projectKey}` });
  const projects = () => Object.entries(names).map(([key, name]) => ({ key, name }));
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
    await check("三个底部操作统一24px高，模型箭头为12px线条SVG", () => {
      const heights = ["ctxBtn", "insertBtn", "sendBtn"].map(id => $(id).getBoundingClientRect().height);
      for (const height of heights) assert(Math.abs(height - 24) < 0.2, `unexpected action height ${height}`);
      const arrow = $("modelMenuButton").querySelector("svg.model-chevron");
      assert(arrow && arrow.getAttribute("aria-hidden") === "true", "SVG chevron missing");
      assert(Math.abs(arrow.getBoundingClientRect().width - 12) < 0.2, "chevron size mismatch");
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
    await check("剩余空间达到模型最小宽度即并入底行，临界前后1px及常用宽度不越界", async () => {
      window.__layoutResults = [];
      const footer = doc.querySelector(".composer-footer"), actions = doc.querySelector(".composer-actions");
      const style = win.getComputedStyle(footer), minimum = parseFloat(style.getPropertyValue("--model-min-width")), gap = parseFloat(style.columnGap);
      assert(minimum > 0, "model minimum width not declared");
      const threshold = Math.ceil(win.innerWidth - footer.clientWidth + $("ctxBtn").offsetWidth + actions.offsetWidth + gap * 2 + minimum);
      const widths = [...new Set([260, 300, 320, threshold - 1, threshold, threshold + 1, 360, 420, 504, 640])].sort((a, b) => a - b);
      for (const width of widths) {
        frame.style.width = `${width}px`;
        await waitFor(() => {
          const room = footer.clientWidth - $("ctxBtn").offsetWidth - actions.offsetWidth - gap * 2;
          return win.innerWidth === width && footer.dataset.modelStacked === String(room < minimum);
        }, `layout did not settle at ${width}`);
        assert(doc.documentElement.scrollWidth <= win.innerWidth + 1, `page overflow at ${width}`);
        const a = $("ctxBtn").getBoundingClientRect(), b = $("insertBtn").getBoundingClientRect(), send = $("sendBtn").getBoundingClientRect(), model = $("modelMenuButton").getBoundingClientRect();
        assert(send.right <= win.innerWidth && a.left >= 0, `control overflow ${width}`);
        assert(Math.abs(a.top - b.top) < 1 && Math.abs(b.top - send.top) < 1, `actions not on one row ${width}`);
        assert(send.left - b.right >= 0 && send.left - b.right <= 8, `return not adjacent to send ${width}`);
        const available = footer.clientWidth - $("ctxBtn").offsetWidth - actions.offsetWidth - gap * 2;
        const stacked = available < minimum;
        if (stacked) assert(model.bottom + 4 <= send.top, `model should remain above at ${width}`);
        else assert(Math.abs(model.top + model.height / 2 - send.top - send.height / 2) < 1, `model should move down once ${minimum}px fits at ${width}`);
        for (const height of [a.height, b.height, send.height]) assert(Math.abs(height - 24) < 0.2, `action height differs at ${width}`);
        window.__layoutResults.push({ width, available, minimum, stacked, modelTop: model.top, switchTop: a.top, returnTop: b.top, sendTop: send.top, heights: [a.height, b.height, send.height], returnSendGap: send.left - b.right });
        $("modelMenuButton").click();
        const menu = $("modelMenu").getBoundingClientRect(), trigger = $("modelMenuButton").getBoundingClientRect();
        assert(menu.left >= 0 && menu.right <= win.innerWidth && menu.top >= 0 && menu.bottom <= trigger.top, `menu outside viewport ${width}`);
        for (const level of ["xhigh", "max"]) {
          const option = doc.querySelector(`[data-level="${level}"]`).getBoundingClientRect();
          assert(option.left >= menu.left && option.right <= menu.right && option.top >= menu.top && option.bottom <= menu.bottom, `reasoning option clipped ${level} at ${width}`);
        }
        $("modelMenuButton").click();
      }
      frame.style.width = "420px";
    });
    await check("模型占位随名称字符动态变化，短名下移、长名上移且不越界", async () => {
      const footer = doc.querySelector(".composer-footer"), actions = doc.querySelector(".composer-actions");
      const model = win.eval('state.models.find(model => model.key === state.settings.modelKey)'), originalAlias = model.alias;
      const names = ["x", "gpt-6.1-sol", "gemini-4-argon-high", "中文模型🚀", "W".repeat(120)];
      window.__dynamicLayoutResults = [];
      const minima = [];
      try {
        for (const name of names) {
          model.alias = name; win.renderModelPicker();
          const minimum = parseFloat(win.getComputedStyle(footer).getPropertyValue("--model-min-width"));
          minima.push(minimum);
          for (const width of [260, 360, 640]) {
            frame.style.width = `${width}px`;
            const available = () => footer.clientWidth - $("ctxBtn").offsetWidth - actions.offsetWidth - parseFloat(win.getComputedStyle(footer).columnGap) * 2;
            await waitFor(() => win.innerWidth === width && footer.dataset.modelStacked === String(available() < minimum), `name layout not settled: ${name.length}/${width}`);
            assert($("modelValue").textContent === name, "model name changed during measurement");
            assert(doc.documentElement.scrollWidth <= win.innerWidth + 1, `long name overflow: ${width}`);
            const trigger = $("modelMenuButton").getBoundingClientRect(), arrow = doc.querySelector(".model-chevron").getBoundingClientRect(), badge = $("thinkingValue").getBoundingClientRect();
            assert(trigger.left >= 0 && trigger.right <= win.innerWidth, "trigger outside viewport");
            assert(badge.right <= arrow.left && arrow.right <= trigger.right, "badge/arrow overlap");
            const label = $("modelValue"), truncated = label.scrollWidth > label.clientWidth + 1;
            if (minimum <= footer.clientWidth) assert(!truncated, `name truncated despite enough space: ${name}/${width}`);
            else assert(truncated && $("modelMenuButton").title.includes(name), "oversized name has no ellipsis/full title");
            window.__dynamicLayoutResults.push({ name, characters: [...name].length, width, minimum, stacked: footer.dataset.modelStacked === "true", truncated });
          }
        }
        assert(minima[0] < minima[1] && minima[1] < minima[2] && minima[4] > minima[2], "name length did not change required width");
        const at360 = window.__dynamicLayoutResults.filter(result => result.width === 360);
        assert(!at360[0].stacked && !at360[1].stacked && at360[2].stacked, "short/long names still share one fixed breakpoint");
      } finally { model.alias = originalAlias; frame.style.width = "420px"; win.renderSelects(); }
    });
    await check("推理标签变长或变短时同步重算模型占位", () => {
      const footer = doc.querySelector(".composer-footer"), original = $("thinkSelect").value, widths = {};
      try {
        for (const level of ["off", "minimal", "xhigh", "max"]) {
          $("thinkSelect").value = level; win.renderModelPicker();
          widths[level] = parseFloat(win.getComputedStyle(footer).getPropertyValue("--model-min-width"));
        }
        assert(widths.minimal > widths.off && widths.xhigh > widths.max, "reasoning badge width was ignored");
      } finally { $("thinkSelect").value = original; win.renderSelects(); }
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
    $("log").scrollTop = 0;
    window.__testResult = { passed: results.length, failed: 0, results };
    output.textContent = `${results.join("\n")}\n\nRESULT: ${results.length}/${results.length} passed`;
  } catch (error) {
    window.__testResult = { passed: results.length, failed: 1, error: error.message, results };
    output.textContent = `${results.join("\n")}\nFAIL: ${error.stack}`;
    console.error(error);
  }
})();
