# Markdown 粗体与公式渲染修复

仅修复侧聊的显示层。未修改宿主、发送流程、模型设置、权限、历史存储、复制或回填逻辑；未提交、推送、打包或安装。本说明不代表已完成正在运行的宿主 GUI 验收或全平台测试。

## 原因与证据

| 可复现输入/现象 | 原因 | 修复位置 |
| --- | --- | --- |
| `**中文句子。**后文` 中星号外露 | CommonMark 强调分隔符的标点/相邻字符规则与无空格中文行文不匹配；Marked 解析阶段已输出字面星号，不是主题或 DOMPurify 删除粗体 | `renderer/markdown.js` 的 CJK `emStrong` 扩展 |
| `\(K_s\)`、`\[...\]` 显示成括号及 TeX 原文 | 原先只有通用 GFM 解析，没有数学分词与排版；反斜杠分隔符先被 Markdown 当作转义消耗 | 同文件的 `mathToken`、`renderMath` |
| 接入数学后的源文重复/公式容器出现竖向滚动条 | DOMPurify 的 MathML profile 默认移除了语义包装；横向 auto 溢出也使纵向变成 auto | 仅为生成的 MathML 保留 `semantics/annotation/encoding`；公式容器单独控制纵向溢出并留白 |

截图可见内容被重建为 `tests/markdown-checks.js` 中的测试文本，不读取或改写用户真实聊天记录。修复前专项用例复现 12 项失败，原有 UI 26 项、主题 32 项仍通过。

## 最小改动

- `renderer/markdown.js`：保留 Marked 18.0.11、DOMPurify 3.4.17 和原有 HTML/图片禁用策略；通过 Marked 官方扩展 API 接入 `marked-cjk-friendly` 0.1.3 的 `emStrong`，不替换 GFM 删除线规则。数学分词在普通转义之前执行，支持 `\(...\)`、`\[...\]`、`$...$`、`$$...$$`，不解析代码块和行内代码。
- 公式交给本地 KaTeX 0.16.47，采用官方 `output: "mathml"`，由 Chromium 原生排版，不加载字体、额外样式表或 CDN。以 `trust: false` 禁止外部资源与 HTML 扩展；限制大小、宏展开次数及公式长度，每个公式使用独立宏表。生成结果再次通过 DOMPurify MathML profile 清理，禁止链接、样式、图片及 `annotation-xml`。无效或未闭合公式保留可读原文，错误消息不写入 HTML。
- `renderer/index.html`：只增加两条本地脚本引用和一条 `.markdown .math-display` 公式专用 CSS；其他页面标记、原有样式和内联业务脚本不变。
- `renderer/vendor/`：新增 CJK 浏览器包、KaTeX 浏览器包及各自 MIT 许可证。`scripts/vendor-markdown-extras.cjs` 校验 CJK 0.1.3、KaTeX 0.16.47、esbuild 0.25.12 后离线生成资源；原 Marked/DOMPurify 资源字节不变。CJK 发布包的 SHA-512 已与 npm registry integrity 对上。
- `tests/markdown-checks.js`：17 项专项检查；由现有 `tests/theme-follow.html` / `tests/theme-follow.cjs` 调用，不改动原 `tests/ui-harness.js`。

历史存储仍保存原始 Markdown，复制与回填仍读取原始消息字符串，不从公式 DOM 反向抽取或修改原文。不把任意普通括号、文件路径或价格强行转换为公式。

## 文档依据

1. [PI-Desktop 官方插件开发文档](https://github.com/vastsa/PI-Desktop/blob/main/docs/plugin-development.md)：Panel UI 为插件自有页面；本次不借用宿主内部 React 组件或扩大权限。
2. [CommonMark 0.31.2：强调与粗体](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis)：分隔符及 flanking 规则。中文兼容是明确的扩展，不宣称是原规范默认行为。
3. [Marked 官方扩展机制](https://marked.js.org/using_pro)：独立 `Marked` 实例、tokenizer 与 inline extensions；[官方选项](https://marked.js.org/using_advanced)要求另外清理输出 HTML。
4. [CJK 扩展作者仓库与发布包 README](https://github.com/tats-u/markdown-cjk-friendly)：明确记录 `**中文。**后文` 问题及 `Marked` 扩展用法。该扩展由第三方作者维护，不冒称 PI-Desktop 内置 API。
5. [KaTeX 官方选项](https://katex.org/docs/options.html)、[安全说明](https://katex.org/docs/security.html)、[分隔符说明](https://katex.org/docs/autorender.html)：MathML 输出、不信任输入、宏和尺寸限制、数学分隔符。本次使用 tokenizer 接入，不在整页运行 auto-render。
6. [DOMPurify 官方配置](https://github.com/cure53/DOMPurify#can-i-configure-dompurify)：MathML profile、标签/属性精确扩展与禁止列表。普通 Markdown 的清理白名单没有放宽。

## 自动验证

要求 Node 22+、本机 Chrome，并将 `PI_SCRATCH_DIR` 设置为会话或项目允许的临时目录。现有测试不发送真实模型请求。

```bash
export TMP="$PI_SCRATCH_DIR" TEMP="$PI_SCRATCH_DIR" TMPDIR="$PI_SCRATCH_DIR"
node --test tests/side-chat.test.cjs tests/draft-bridge.test.mjs
SIDE_CHAT_MARKDOWN_SCREENSHOT_DIR="$PI_SCRATCH_DIR/markdown-fixed-shots" node tests/theme-follow.cjs
git diff --check
```

本次结果：后端/Renderer 27 项、原 UI 26 项、主题 32 项、Markdown 17 项全部通过；官方 PluginCheck 通过，保留既有两条权限提示。浅绿/浮影主题分别在 420px、320px 下输出截图并检查公式存在、具有实际排版高度、页面无横向溢出。

额外差异核对：忽略 Git LF 与 Windows 工作区 CRLF 的表示差异后，`index.html` 除上述三条新增行外一致；主进程、存储、草稿桥、外观模块、manifest 和原 UI 测试均与本轮起始提交一致。

## 手动复验

1. 在内置浏览器预览 `tests/theme-follow.html`。测试不访问真实历史；浏览器控制台执行 `await runMarkdownChecks()`，应为 17 passed、0 failed；执行 `previewMarkdown(420)` 可查看重建的截图内容。
2. 开发插件加载本地修改并重载后，打开原来显示异常的历史回复，无需再付费请求模型。确认中文粗体没有外露 `**`；Green–Ampt、面积加权公式有分数、下标、求和符号；列表里的 `K_s` 等显示为行内公式。
3. 切换浅色/深色主题，缩窄至约 320px：公式不出现多余竖向滚动条，页面和原有底栏布局不变。
4. 复制该回复并检查主输入框回填：应仍是原始 Markdown/TeX，不变成 DOM 文本，不自动发送。代码块中的 `**`、`\(...\)` 保持字面内容；无效公式显示原文而不是整条回复消失。
