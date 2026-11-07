/* Local Markdown only: marked 18.0.11 (MIT), DOMPurify 3.4.17 (MPL-2.0 OR Apache-2.0).
 * Third-party sources and licenses live in ./vendor; no runtime downloads. */
(function () {
  "use strict";
  const renderer = new window.marked.Renderer();
  const escape = (text) => String(text || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  // Never interpret model-authored HTML, and never fetch model-authored images.
  renderer.html = () => "";
  renderer.image = ({ text }) => escape(text);
  const parser = new window.marked.Marked({ renderer, gfm: true, breaks: false, async: false });

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
      return fragment;
    } catch {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode(source));
      return fragment;
    }
  }
  window.SideChatMarkdown = Object.freeze({ render });
})();
