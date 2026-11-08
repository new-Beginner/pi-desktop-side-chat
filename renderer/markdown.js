/* Local rendering: marked 18.0.11, DOMPurify 3.4.17,
 * marked-cjk-friendly 0.1.3 and KaTeX 0.16.47. Licenses in ./vendor; no downloads. */
(function () {
  "use strict";
  const renderer = new window.marked.Renderer();
  const escape = (text) => String(text || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  // Never interpret model-authored HTML, and never fetch model-authored images.
  renderer.html = () => "";
  renderer.image = ({ text }) => escape(text);
  const parser = new window.marked.Marked({ renderer, gfm: true, breaks: false, async: false });
  // Only extend emphasis; leave the existing GFM deletion tokenizer unchanged.
  parser.use({ tokenizer: { emStrong: window.SideChatCjk.default().tokenizer.emStrong } });

  // Inline extensions run before Markdown's backslash escapes, but not inside code tokens.
  function mathToken(src) {
    const match = /^(\\\[|\\\(|\$\$|\$(?!\$))/.exec(src);
    if (!match) return;
    const left = match[0], right = left === "\\[" ? "\\]" : left === "\\(" ? "\\)" : left;
    const display = left === "\\[" || left === "$$";
    if (left === "$" && /\s/.test(src[1] || " ")) return;
    for (let end = left.length; end < src.length; end += 1) {
      if (src.startsWith(right, end)) {
        // Do not consume ordinary prices such as "$5 and $10".
        if (left === "$" && (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] || ""))) return;
        return { type: "sidechatMath", raw: src.slice(0, end + right.length), text: src.slice(left.length, end), display };
      }
      if (!display && src[end] === "\n") break;
      if (src[end] === "\\") end += 1;
    }
    // Preserve a dangling TeX opener rather than letting Markdown remove its slash.
    if (left[0] === "\\") return { type: "sidechatMath", raw: left, literal: true };
  }
  parser.use({ extensions: [{
    name: "sidechatMath", level: "inline",
    start: src => src.search(/\\[\[(]|\$/),
    tokenizer: mathToken,
    renderer: token => token.literal ? escape(token.raw)
      : `<code class="language-sidechat-math" title="math">${escape(token.raw)}</code>`,
  }] });

  function renderMath(fragment) {
    // Only our tokenizer emits CODE with this title; model HTML remains disabled.
    for (const node of fragment.querySelectorAll('code.language-sidechat-math[title="math"]')) {
      const token = mathToken(node.textContent), element = document.createElement("span");
      element.className = token.display ? "math-display" : "math-inline";
      try {
        if (token.text.length > 16 * 1024) throw new Error("Formula too long");
        const math = window.katex.renderToString(token.text, {
          output: "mathml", displayMode: token.display, throwOnError: true,
          trust: false, maxSize: 20, maxExpand: 1000, macros: {},
        });
        element.appendChild(window.DOMPurify.sanitize(math, {
          RETURN_DOM_FRAGMENT: true, USE_PROFILES: { mathMl: true },
          ADD_TAGS: ["semantics", "annotation"], ADD_ATTR: ["encoding"],
          FORBID_TAGS: ["annotation-xml"], FORBID_ATTR: ["href", "xlink:href", "src", "style"],
          ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
        }));
      } catch {
        element.textContent = token.raw;
      }
      node.replaceWith(element);
    }
  }

  function render(text) {
    const source = String(text ?? "");
    try {
      const fragment = window.DOMPurify.sanitize(parser.parse(source), {
        RETURN_DOM_FRAGMENT: true,
        ALLOWED_TAGS: ["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "del", "ul", "ol", "li", "blockquote", "pre", "code", "a", "hr", "table", "thead", "tbody", "tr", "th", "td"],
        ALLOWED_ATTR: ["href", "title", "start", "class"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
      });
      for (const node of fragment.querySelectorAll("[class]")) {
        if (node.tagName !== "CODE" || !/^language-[\w+-]+$/.test(node.className)) node.removeAttribute("class");
      }
      for (const link of fragment.querySelectorAll("a")) {
        const href = link.getAttribute("href") || "";
        // The click handler uses the same protocol allowlist and the official host bridge.
        if (!/^(https?:\/\/|mailto:)/i.test(href)) link.removeAttribute("href");
        link.setAttribute("rel", "noopener noreferrer");
      }
      renderMath(fragment);
      return fragment;
    } catch {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode(source));
      return fragment;
    }
  }
  window.SideChatMarkdown = Object.freeze({ render });
})();
