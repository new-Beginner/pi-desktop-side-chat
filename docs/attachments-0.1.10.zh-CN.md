# 0.1.10–0.1.13：侧聊图片与文件输入

**使用前提：首次增加权限时重新加载插件并明确授权 `agent.extension`，不能只靠热更新；已授权但握手失败不等于未授权。** 宿主须提供 `session/create`、`agent/prompt`、`agent/getStatus`、`session/get`、`agent/abort` 和可信扩展钩子。`before_agent_start.sessionId` 是可选字段，不作为硬性前提。图片问答须选择视觉模型；本版的文件工具只有 Read/Glob/Grep，不保证 PDF、Word、Excel 等二进制格式都能解析。

实现未修改宿主源码。自动验证使用正式插件HTML、真实Chromium、私有临时文件与模拟IPC，另加载安装版0.22.0 Runner并查询独立侧车状态，均不发起模型请求。这不等于运行中宿主的系统剪贴板、授权或真实识图验收。

## 0.1.13：在输入框直接粘贴

复制截图/图片或剪贴板提供的文件后，聚焦侧聊输入框按 Ctrl+V（macOS为Cmd+V），即可一次加入多个附件，不必打开文件选择器。仍须点击发送，粘贴本身不上传、不调用模型。纯文本和混合内容中的文字保留浏览器原生插入，不重写现有草稿。

最小实现仅在 `renderer/attachments.js` 增加输入框 `paste` 监听：优先读取 `ClipboardEvent.clipboardData.files`，为空时从 `items` 的文件条目调用 `getAsFile()`；只取其中一路，避免同一文件重复入队。复用原有 `addFiles`、数量/体积限制、忙碌/只读判断、项目归属与分块上传。没有修改后端、守卫、布局或主草稿桥，没有新增剪贴板权限，也不调用 `navigator.clipboard.read()`。

边界：只有复制来源向浏览器提供真实文件数据时才能作为附件。若来源仅提供路径、网页HTML或链接，它仍是文字；插件不按路径读取文件，也不下载HTML中的远程图片。

依据：[官方插件开发的Panel UI边界](https://github.com/vastsa/PI-Desktop/blob/main/docs/plugin-development.md)保持普通HTML输入及既有插件桥；用户粘贴数据按[ClipboardEvent.clipboardData](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData)与[DataTransferItem.getAsFile](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFile)标准读取，不虚构宿主剪贴板文件API。

验证：新增7项真实Chromium测试，涵盖图片+文件一次粘贴、无选择器/无自动发送、items回退、混合文字不拦截、路径/HTML不导入、8文件及10MB限制、忙碌/只读忽略附件、主草稿不变和发送时PNG/TXT字节一致。先运行旧实现得到5项失败，增加9行实现后全部通过。测试用真实 File/DataTransfer/ClipboardEvent 构造粘贴事件，不能替代操作系统剪贴板或运行中宿主的Ctrl+V验收。

手动验收：加载0.1.13后，先在输入框写一段文字；截图复制到剪贴板，再聚焦输入框按Ctrl+V，应保留文字并显示图片附件，不弹出文件选择器、不立即发送。再复制文字检查光标处正常插入；来源支持文件剪贴板时一次复制多个文件，确认每个仅出现一次。最后点击发送检查图片/文件内容回答，移除附件、原有拖放和主草稿也应保持正常。

## 0.1.12：后台状态响应解包

截图中的 `Side Agent status identity mismatch` 出现在只读扩展确认之后，与权限或守卫加载失败不同。根因是 `attachments.cjs` 把正式 `{ status: AgentStatus }` 响应当成扁平的 AgentStatus：读取外层 `sessionId` 得到 undefined，随即触发身份拒绝。

依据：[官方IPC处理](https://github.com/vastsa/PI-Desktop/blob/main/apps/desktop/electron/main/ipc/agent-ipc.ts)原样转发 `agent.getStatus`；[AgentStatus类型](https://github.com/vastsa/PI-Desktop/blob/main/packages/shared/src/types/sessions.ts)明确状态对象有 `sessionId` 和布尔 `isRunning`。另外启动本机安装版独立 `sidecar.js`，不创建会话，只读查询空运行时，实际得到 `{"status":{"sessionId":"side-1","isRunning":false,"pendingToolConfirmations":0}}`，确认包裹结构而非推测字段可选。

最小修复：只在附件轮询处读取 `response.status`，先验证其对象结构、非空会话ID和布尔运行标记，再继续原有严格身份比较。畸形响应报 `ATTACHMENTS_STATUS_INVALID`，不能被当作已结束，也不能读取主会话或中断主任务。守卫入口仍为 `agent/attachment-guard-0.1.11.js`，本次不修改守卫、UI、权限或其它业务逻辑。

两个旧测试替身都错误地返回扁平状态，现已按正式结构修正。补充运行中连续轮询、结束后读取回复、外部会话ID拒绝、7类畸形响应及真实侧车IPC集成回归；真实侧车响应被送入附件管理器的模拟发送/回复链路，不调用模型。先跑旧代码得到15项失败（含真实侧车响应复现同一错误），修复后60项后端测试全部通过。同步版本元数据至0.1.12，没有打包或安装。

## 0.1.11：重载后仍失败的缓存修复

审查范围：本项目待提交的附件启动链路、manifest 和对应测试；没有扩大到主题、Markdown、底栏、主会话逻辑或宿主源码。新截图表明页面和后端错误文案已更新，但不能证明 Agent 侧车采用了新版守卫。

| 问题 | 判断依据 | 最小修复与验证 |
| --- | --- | --- |
| P1：同名入口复用旧守卫工厂 | 安装版 Runner 的工厂 Map 按扩展入口 ID 缓存；主进程以入口真实路径作为 ID。重载相同入口没有刷新该缓存。侧车进程启动早于旧守卫加载，且整个失败重试期间未重启 | 将实际实现迁移至 `agent/attachment-guard-0.1.11.js`，manifest 只声明新入口。没有保留导入旧守卫的转发壳，因为真实 Jiti 对此仍会复用旧模块 |
| P2：初始化异常被静默吞掉 | 旧 `catch` 只清空绑定并返回，Runner 因而无法记录 `handler_error`，用户最终只看到通用握手超时 | 标记 `cwd/policy/files/tools/ack` 阶段并重新抛出脱敏错误，交由官方 Runner 记录；不写确认文件、不打印问题或文件内容、不改变侧聊专属中断策略 |
| P1测试缺口：只验冷进程 | 上一轮真实 Runner 测试在新进程中加载当前文件，且未按 manifest 入口建立旧工厂缓存 | 测试改按 manifest 加载，加入“旧守卫先缓存→同入口替换仍不确认→新版实际入口成功确认”的同进程回归；保留身份/nonce/目录与工具限制检查 |

本机无模型复现结果：旧工厂 `loaded/ready=false`；修复代码写回同一入口仍 `loaded/ready=false`；完整修复实现改为新入口后 `loaded/ready=true`，工具设置请求为 Read/Glob/Grep。先补回归得到3项失败，再实施修复后通过。初始化失败另经真实 Runner 验证为 `handler_error`，诊断不含测试问题文本。测试工具桥仍为替身，不代表真实模型端到端验收。

官方依据：[可信扩展 §3、§4.3、§4.4、§6](https://github.com/vastsa/PI-Desktop/blob/main/docs/spec/07-plugins/16-trusted-extensions.md)允许 manifest 声明插件内相对入口，说明每会话 Runner 与共享模块、加载/处理器诊断机制。缓存复用细节额外以安装版0.22.0的 `runner-4ND7F7PK.js` 和 `sidecar.js` 交叉验证，而非只假设最新版文档等于本机行为。不调用内部刷新API、不修改宿主或自动批准权限。

版本推进到0.1.11，同步 manifest、变更记录和中英文README；未打包、安装、提交、推送或发送模型请求。检查时宿主登记快照仍显示0.1.10，因此没有声称运行中已升级。加载该版本后确认扩展入口为 `agent/attachment-guard-0.1.11.js`，再按下方步骤验收；不要只以“页面文案变了”判断守卫已更新。若仍失败，需补充该入口的实际加载状态和 `handler_error` 阶段/错误码。

## 0.1.10：初次握手的可选身份修复

**根因不是用户未授权，而是插件误把官方可选字段当作必填。** 本机插件登记已有 `agent.extension`；安装版 `resources/agent-runtime/chunks/runner-4ND7F7PK.js` 的 `emitBeforeAgentStart(prompt, systemPrompt)` 只传 `type/messageType/prompt/systemPrompt/systemPromptOptions`，没有 `sessionId`。守卫原先无条件比较 `policy.sessionId !== event.sessionId`，因此直接退出：不缩减工具、不写 `.side-chat-ready.json`；10秒后后台报错，UI又把它统一翻译为“重新加载并授权”。反复重载无法补出宿主没有发送的字段。

| 证据 | 结论 | 修复路径 |
| --- | --- | --- |
| 真实 Runner 报告 `loaded`，三个钩子已注册，但旧代码不产生确认文件；诊断为空 | 不是工厂导出/加载失败，守卫在身份匹配处直接返回 | `agent/attachment-guard.js`：字段缺失时使用规范化的私有工作目录、策略归属及随机 nonce 绑定；字段存在但不匹配仍拒绝 |
| 官方可信扩展 §6 明确身份字段可选、缺失保持未知；§7 明确 `ctx.cwd` 来自当前会话工作目录 | 不依赖 UI 当前会话或未支持的身份查询API | 保留既有 Plan、Read/Glob/Grep 与附件路径限制；不修改主侧隔离和权限 |
| 旧测试直接代写确认文件，守卫单测人为提供 `sessionId` | 模拟测试掩盖了真实事件兼容问题 | `tests/attachments.test.cjs` 改由真实守卫生成确认；新增缺字段、匹配/不匹配身份、错误nonce、外部cwd/插件和真实安装版Runner回归 |
| 握手超时旧错误硬编码为重载授权 | 提示把多种失败错误归因于用户授权 | `attachments.cjs` 使用 `ATTACHMENTS_GUARD_UNCONFIRMED`；`renderer/index.html` 单独本地化，真正权限错误仍保留授权提示 |

此阶段先补回归，后端7项、浏览器1项失败，修改后三处冷加载实现均通过；但它只解决了缺少可选身份的代码错误，没有覆盖长驻侧车的旧工厂缓存。上一轮132项通过不能证明已运行的宿主采用了新版守卫，0.1.11的热缓存回归补齐了这一缺口。以上测试均不创建真实宿主会话、不请求模型。

## 使用

1. 聚焦输入框后可直接Ctrl+V粘贴图片/文件；也可点击附件按钮选择或拖放到输入框。允许一次多个，可点击 `×` 移除。
2. 输入问题后发送，也允许只发送附件。添加文件本身不会上传或发送；点击发送时才上传选中文件的内容。
3. 单次最多8个文件，单文件上限10,000,000字节，每个侧聊的私有附件缓存上限20,000,000字节。缓存已满时请新建侧聊。
4. 普通文本仍走原有 `agent.complete`。某个侧聊使用过附件后，后续追问走该侧聊独立的后台 Agent，保留附件上下文。

PNG/JPEG/WebP/GIF 被标记为图片，并检查文件签名；其它文件作为文件引用发送。文本、Markdown、CSV、JSON及代码文件适合 Read 工具。二进制文件能被添加与传入，并不等于工具能解释其内容；应以实际读取结果为准。敏感文件名如 `.env`、`.env.*`、私钥/证书扩展名被拒绝。

## 修改位置与目的

| 文件 | 变更 | 目的 |
| --- | --- | --- |
| `renderer/index.html` | 输入框内增加隐藏多选文件控件、附件按钮及待发列表；提交前上传；消息显示附件元数据 | 最小化接入原有输入/发送事件，不移动底栏模型与操作按钮 |
| `renderer/attachments.js` | 文件选择、拖放、移除、列表绘制、分块上传、失败保留及作用域校验 | 使用标准 File/Blob 内容，不提交任意客户端路径；名称只以文本绘制 |
| `main.js` | 四个附件桥方法、能力检测、附件元数据校验、发送后端分流和卸载清理 | 复用现有 send/poll、项目归属、回复落库与回填逻辑 |
| `attachments.cjs` | 私有上传缓存、目录/附件 ID 映射、独立后台会话、只读扩展确认、结果关联和中断处理 | 不借用主输入框附件队列，不对主会话投递 prompt/abort |
| `agent/attachment-guard-0.1.11.js` | 官方 `before_agent_start`、`tool_call`、`agent_end` 钩子及初始化阶段诊断 | 版本化实际入口避开旧工厂缓存；只对识别出的侧聊开放 Read/Glob/Grep，规范化路径并拦截写入、Shell、委派与会话控制 |
| `store.js` | 可选附件元数据字段及纯附件标题回退 | 不改变旧文本消息、项目分组、迁移策略或主历史格式 |
| `manifest.json` | 初始0.1.10新增扩展能力，0.1.11切换版本化入口并同步版本 | 正式声明能力和授权；本次修复不新增权限 |
| `CHANGELOG.md`、中英文 README | 同步版本、前提和限制 | 避免将未授权、非视觉模型或不支持格式误称为可用 |
| `tests/attachments.test.cjs`、`tests/attachment-ui.js`及既有测试入口 | 模块、集成及浏览器附件用例 | 验证图片/文件字节、元数据、发送归属和失败行为；保留原有回归 |

### 文件与会话通路

文件来自用户选择器或真实拖放的 File 对象。页面分256 KiB块读取并编码，主进程只把内容写入 `pi.plugin.getDataPath()` 管理的插件私有目录；不接受用户指定的源/目标磁盘路径。缓存按项目键与侧聊对话 ID 的哈希隔离，实际文件名使用随机 ID，原名仅保留为元数据。

后台会话以该侧聊自己的缓存工作区创建，使用所选模型和思考档位，模式为 Plan；主会话不是这个后台 ID。`agent/prompt` 的 `attachments` 提供缓存中的真实路径、原名、类型与大小；宿主负责验证路径、向视觉模型内嵌图片或追加文件引用。提示中另外提供原名与缓存路径的对应关系，避免多份同类文件混淆。

只有 `agent/prompt` 接受请求不等于完成。插件核对扩展的会话/随机值确认，等待 `agent/getStatus` 结束，再从该后台会话的历史中匹配本次请求与回复。没有有效回复、身份不符、工具策略未加载或超时均报错；超时/卸载只请求中断插件拥有的后台会话和对应 turnId，不降级为向主会话发送。

选择模型、思考档位或上下文开关变化时会创建新的独立后端并重放侧聊自己的历史；尤其关闭“带上会话”时，不复用保留旧主上下文的后台会话。后台会话是宿主持久会话，可能在宿主列表中看到，不会自动切换为当前主会话；插件不静默删除这些会话，也不自动批准危险操作。私有缓存及宿主后台记录会保留，删除本地侧聊记录不等于销毁宿主后台历史。

### 隔离与只读范围

保留用户明确指定的两个例外：启用“带上会话”才读取主对话背景；主动“发回会话”仍通过原草稿桥插入主输入框，不自动发送。其它发送、回复、附件、历史及运行任务只绑定侧聊，不操作主模型设置、主草稿或主运行任务。

只读问答采用 Plan 原生模式、模型工具列表缩减和同步工具调用拦截；Read/Grep/Glob 的文件访问也限于该侧聊的附件子目录。它不是 OS 沙箱或不可绕过的安全边界：官方说明扩展异常/超时采用 fail-open 语义。不要用它执行不受信任程序或承载高强度安全隔离任务。本版不开放 Shell 或额外文档解析工具；这也是部分二进制格式不保证可读的原因。

## 官方依据

- [插件 API：plugin、desktop control、agent.complete](https://github.com/vastsa/PI-Desktop/blob/main/docs/spec/07-plugins/03-plugin-api.md)：私有数据目录；审查过的桌面操作；插件发起 `session/create`/`agent/prompt` 不切换当前会话；普通 complete 为 `tools: []`，因此不把附件路径塞进纯补全冒充读取。
- [可信扩展 §5、§6、§7](https://github.com/vastsa/PI-Desktop/blob/main/docs/spec/07-plugins/16-trusted-extensions.md)：支持 `getAllTools/setActiveTools`、会话工作目录 `ctx.cwd`、`before_agent_start` 的可选会话身份、可阻止执行的 `tool_call`、`agent_end`；同时明确钩子不是强制安全检查机制。
- [插件开发 §6.3、§6.11](https://github.com/vastsa/PI-Desktop/blob/main/docs/plugin-development.md)：插件私有数据、Agent扩展入口与 `agent.extension` 高风险授权；权限增加须重载并由用户确认。
- [官方 AgentPromptRequest / AgentPromptAttachment](https://github.com/vastsa/PI-Desktop/blob/main/packages/shared/src/types/agent.ts)：支持 `attachments`，每项含 `path/name/kind/mimeType/size`。
- [审查操作目录](https://github.com/vastsa/PI-Desktop/blob/main/apps/desktop/electron/main/mcp-control.ts)：创建/发送/查询/中断的参数；主 Composer 的选取/导入操作不向插件网关开放，本实现不绕用这些内部通道。
- [宿主附件处理](https://github.com/vastsa/PI-Desktop/blob/main/apps/desktop/electron/main/prompt-attachments.ts)：只接受项目、目标会话 scratch 或附件库中的路径；视觉模型图片内嵌与文件引用回退。这里缓存工作区是独立后台会话明确绑定的项目目录。
- [MDN File](https://developer.mozilla.org/en-US/docs/Web/API/File)、[Blob.arrayBuffer](https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer)：浏览器读取用户选中的文件内容，不用 Node 绕过文件访问授权。

## 自动验证

Node 22+、Chrome，并将 `PI_SCRATCH_DIR` 设置到允许的会话/项目临时目录：

```bash
export TMP="$PI_SCRATCH_DIR" TEMP="$PI_SCRATCH_DIR" TMPDIR="$PI_SCRATCH_DIR"
# 本机0.22.0 Runner的无模型请求兼容测试；其它机器按实际安装位置设置此变量。
export SIDE_CHAT_HOST_RUNNER='D:/Mypi_deskktop/PI-Desktop/resources/agent-runtime/chunks/runner-4ND7F7PK.js'
# 可选：安装版侧车的只读状态IPC契约测试，不创建真实会话。
export SIDE_CHAT_HOST_SIDECAR='D:/Mypi_deskktop/PI-Desktop/resources/agent-runtime/sidecar.js'
export JITI_FS_CACHE=0 JITI_CACHE_DIR="$PI_SCRATCH_DIR/jiti-cache"
node --test tests/side-chat.test.cjs tests/draft-bridge.test.mjs tests/attachments.test.cjs
node tests/theme-follow.cjs
git diff --check
```

本次60项后端/集成用例（含安装版真实Runner的冷/热缓存与侧车状态IPC）、26项原UI、32项主题、17项Markdown、16项附件UI用例均通过，共151项。不设置 `SIDE_CHAT_HOST_RUNNER` 时跳过两项Runner测试，不设置 `SIDE_CHAT_HOST_SIDECAR` 时跳过一项侧车IPC测试。剪贴板用例模拟用户paste事件，不读取或改写当前系统剪贴板；实际宿主及模型验收仍按下方步骤执行。

## 在实际宿主中验收

1. 确认宿主已加载0.1.13。守卫沿用 `agent/attachment-guard-0.1.11.js`，没有新增权限。先验证输入框Ctrl+V产生附件列表且保留原文字，再验证实际内容问答；仅首次增加 `agent.extension` 时需要明确授权，缺少策略不得回退向主会话发送。
2. **图片**：选择支持图片的模型，添加一张带明显颜色与独有文字的 PNG（例如红色方块和 `SIDE-IMAGE-731`，不要把答案放在文件名），问“图中是什么颜色、写了什么”。正确描述内容才算识图通过，不以返回文件名作为成功。
3. **文件**：创建 UTF-8 TXT，内含 `SIDE-FILE-926` 和独有最后一行，添加并问“给出文件内验证码和最后一行”。结果必须对应内容。再混合添加 PNG/TXT，并测试仅附件发送与发送前移除其中一项。
4. **工具与上下文**：关闭“带上会话”，在主草稿中预填一段文字并记住主会话模型/历史。侧聊读取附件和追问时，主草稿、历史、模型及任务不应变化；查看工具调用只应出现允许的读工具。要求侧聊写文件或执行Shell时，不应执行。随后开启上下文，验证仅此开关允许读取主背景；主动发回时只插入草稿，等待用户确认发送。
5. **失败与切换**：超大文件应拒绝；上传中切换项目/历史应停止且清理未完成上传；未授权扩展、非视觉模型图片请求或无法解析的格式应有明确失败/限制说明，不应假装已经读到内容。

如果此次修复后仍无法确认启动，请提供宿主“侧边聊天”的可信扩展诊断（加载状态及错误文字）、宿主版本和附件报错发生时间；不要发送模型密钥或完整主会话。无诊断时再核对扩展项目启用范围。本轮没有替用户执行上述真实模型/运行中宿主步骤，不能把模拟桥或独立Runner测试当成已经完成这一验收。
