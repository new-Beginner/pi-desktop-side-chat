"use strict";
// Reconstructed from the reported screenshots; no private chat history is loaded.
const markdownRegression = String.raw`## Green–Ampt 与 CN

**所以：SCS-CN 主要回答“这一场雨产生多少直接径流”；Green–Ampt 主要回答“这一时刻能渗进去多快、累计渗进去多少”。**后者还需结合截留、地表蓄水和汇流等计算。

它描述的是：**初期干土吸水作用强，入渗能力较大；随着湿润锋下移，入渗能力逐渐接近 \(K_s\)。**实际入渗还受雨水供应限制。

\[
f_c=K_s\left(1+\frac{\psi_f\Delta\theta}{F}\right)
\]

- \(K_s\)：饱和导水率；
- \(\psi_f\)：湿润锋吸力水头；
- \(\Delta\theta\)：湿润前后土壤含水率之差。

常用面积加权：

\[ CN_{\text{综合}}=\frac{\sum_i A_i CN_i}{\sum_i A_i} \]

其中 \(A_i\) 是第 \(i\) 类地表面积。
`;
window.runMarkdownChecks = async function () {
  const win = document.getElementById("app").contentWindow, doc = win.document, rows = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const render = source => { const el = doc.createElement("div"); el.className = "markdown"; el.append(win.SideChatMarkdown.render(source)); return el; };
  const check = (name, fn) => { try { fn(); rows.push({ name, passed: true }); } catch (error) { rows.push({ name, passed: false, error: error.message }); } };
  const snapshot = JSON.stringify(win.__mock.snapshots), calls = win.__mock.calls.length;
  check("截图：中文句号紧邻粗体结束符", () => {
    const node = render(markdownRegression);
    assert(node.querySelectorAll("strong").length === 2, "screenshot strong delimiters remain literal");
    assert(!node.textContent.includes("**"), "visible strong marker");
  });
  check("中文粗体内的公式不破坏强调范围", () => {
    const node = render(markdownRegression);
    assert(node.querySelector("strong math msub"), "inline math inside strong is missing");
    assert(!node.querySelectorAll("strong")[1].textContent.includes("实际入渗"), "strong swallowed following text");
  });
  check("截图：Green–Ampt 独立公式", () => {
    const node = render(markdownRegression);
    assert(node.querySelector('math[display="block"] mfrac'), "display fraction is not rendered");
    assert(node.querySelector('math[display="block"] msub'), "display subscripts are missing");
  });
  check("截图：面积加权公式、求和及中文下标", () => {
    const node = render(markdownRegression), math = node.querySelectorAll('math[display="block"]')[1];
    assert(math?.querySelector("mfrac"), "CN fraction is missing");
    assert(math.textContent.includes("∑") && math.textContent.includes("综合"), "sum or Chinese subscript missing");
  });
  check("截图：列表和段落中的行内公式", () => {
    const node = render(markdownRegression);
    assert(node.querySelectorAll("li math").length === 3, "list math is missing");
    assert([...node.querySelectorAll("math")].filter(m => m.getAttribute("display") !== "block").length === 6, "inline math count differs");
    assert(node.querySelector("math").namespaceURI === "http://www.w3.org/1998/Math/MathML", "not native MathML");
  });
  check("美元分隔符与普通价格不混淆", () => {
    const node = render(String.raw`行内 $x_i$，价格 $5 和 $10。

$$\frac{1}{2}$$`);
    assert(node.querySelectorAll("math").length === 2, "dollar math count differs");
    assert(node.textContent.includes("$5 和 $10"), "ordinary prices changed");
  });
  check("段落中间的显示公式仍为块级数学", () => {
    const node = render(String.raw`前文 \[x^2\] 后文`);
    assert(node.querySelector('math[display="block"] msup'), "mid-paragraph display math is missing");
    assert(node.textContent.trim().startsWith("前文") && node.textContent.trim().endsWith("后文"), "surrounding text changed");
  });
  check("嵌套强调、英文强调、删除线和链接不回归", () => {
    const node = render('**中文 *重点*。**后文\n\n**English.** after ~~old~~ [guide](https://example.com/guide)');
    assert(node.querySelector("strong em") && node.querySelectorAll("strong").length === 2 && node.querySelector("del"), "nested or ordinary Markdown changed");
    assert(node.querySelector("a").getAttribute("href") === "https://example.com/guide", "link changed");
  });
  check("代码块、行内代码与转义星号保持原样", () => {
    const source = String.raw`\(K_s\) **中文。**后文`, node = render('`'+source+'`\n\n```tex\n'+source+'\n```\n\n\\*\\*字面星号\\*\\*');
    assert(!node.querySelector("math,strong"), "code or escaped markers were interpreted");
    assert(node.querySelector("pre code").textContent.trim() === source, "fenced source changed");
    assert(node.querySelector("code").textContent === source && node.textContent.includes("**字面星号**"), "inline or escaped source changed");
  });
  check("公式中的 Markdown 字符不被二次解析", () => {
    const node = render(String.raw`\(\text{a*b\_c}\)`);
    assert(node.querySelector("math") && !node.querySelector("em,strong"), "math was parsed as Markdown");
    assert(node.querySelector("annotation").textContent === String.raw`\text{a*b\_c}`, "TeX source changed");
  });
  check("显示公式容器没有多余竖向滚动条且保留排版空间", () => {
    const node = render(markdownRegression), log = doc.getElementById("log"), top = log.scrollTop;
    log.append(node);
    try {
      for (const math of node.querySelectorAll(".math-display")) {
        const style = win.getComputedStyle(math);
        assert(style.overflowY === "hidden" && parseFloat(style.paddingTop) >= 4 && parseFloat(style.paddingBottom) >= 4, "formula can show a vertical scrollbar or clip glyphs");
        assert(math.clientHeight >= math.querySelector("math").getBoundingClientRect().height + 7, "formula vertical space missing");
      }
    } finally { node.remove(); log.scrollTop = top; }
  });
  check("MathML 语义包装保留，不额外显示 TeX 原文", () => {
    const math = render(String.raw`\(x_i\)`).querySelector("math");
    assert(math?.children.length === 1 && math.firstElementChild.localName === "semantics", "math semantics stripped");
    assert(math.querySelector('annotation[encoding="application/x-tex"]')?.textContent === "x_i", "hidden TeX annotation stripped");
    assert([...math.childNodes].every(n => n.nodeType === 1), "TeX source escaped outside annotation");
  });
  check("未闭合及无效公式保留可读原文", () => {
    for (const source of [String.raw`前文 \(x 后文`, String.raw`\(\frac{1}{\)`]) {
      const node = render(source);
      assert(node.textContent.trim() === source, "invalid or unclosed formula source lost");
    }
  });
  check("宏展开受限且宏不跨消息共享", () => {
    const first = render(String.raw`\(\gdef\sidechatmacro{SECRET}\sidechatmacro\)`);
    assert(first.querySelector("math"), "macro fixture did not render");
    const second = render(String.raw`\(\sidechatmacro\)`);
    assert(!second.querySelector("math") && second.textContent.trim() === String.raw`\(\sidechatmacro\)`, "macro leaked to another render");
    const loop = render(String.raw`\(\def\loop{\loop}\loop\)`);
    assert(!loop.querySelector("math") && loop.textContent.includes("\\loop"), "recursive macro not bounded");
  });
  check("数学命令不得引入外链、图片、样式或事件", () => {
    const node = render(String.raw`\(\includegraphics{https://example.com/pixel}\)

\(\href{javascript:alert(1)}{x}\)

\(\htmlStyle{background:url(https://example.com/pixel)}{x}\)

\(\text{<img src=x onerror=alert(1)>}\)`);
    assert(!node.querySelector("a,img,svg,script,style,iframe,[href],[src],[style],[onerror]"), "math introduced an active element");
  });
  check("原有 HTML 清理与语言类名白名单不变", () => {
    const node = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![remote](https://example.com/pixel)\n\n```js\nconst x = 1;\n```');
    assert(!node.querySelector("img,script,iframe,svg,[onerror],[style]"), "unsafe HTML remains");
    assert(!node.querySelector("a[href]") && node.querySelector("code.language-js"), "URL or code class policy changed");
  });
  check("渲染不改动历史、设置或发送/回填调用", () => {
    assert(JSON.stringify(win.__mock.snapshots) === snapshot && win.__mock.calls.length === calls, "render mutated business state");
  });
  return { passed: rows.filter(r => r.passed).length, failed: rows.filter(r => !r.passed).length, rows };
};
window.previewMarkdown = function (width) {
  const frame = document.getElementById("app"), win = frame.contentWindow, doc = win.document;
  frame.style.width = width + "px";
  doc.getElementById("markdown-preview")?.remove();
  const msg = doc.createElement("div"); msg.id = "markdown-preview"; msg.className = "msg";
  const node = doc.createElement("div"); node.className = "markdown"; node.append(win.SideChatMarkdown.render(markdownRegression)); msg.append(node);
  const log = doc.getElementById("log"); log.prepend(msg); log.scrollTop = 0;
  return frame.getBoundingClientRect().toJSON();
};
