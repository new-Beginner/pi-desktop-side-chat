# 0.1.15：项目历史重复排查与无损修复

## 结论与范围

**截图所示主要是插件历史列表问题，不是已发现的聊天正文复制，也没有证据表明宿主损坏了历史。** 宿主项目元数据可在无ID的路径快照、`legacy:路径`和正式项目ID之间变化；插件按不同键创建分仓，又将没有内容的分仓全部列出，并只显示同一个项目名称，于是同一项目出现多个选项。

本轮只修复列表筛选与同名标签，源码版本为0.1.15。不改分仓键、不自动合并、不删除任何分仓、对话、消息或附件。上一轮未提交的多格式附件实现原样保留；未打包、安装、提交或推送。

现有数据没有记录每个分仓创建时的宿主快照，因此不能反推“哪一次启动或切换”产生了每个空分仓。能确认的是数据形态、造成它的代码路径，以及可重复触发的身份切换。

## 逐项验证

| 可能原因 | 证据 / 验证 | 判断 |
| --- | --- | --- |
| 界面刷新时不断追加选项 | `renderer/index.html` 的 `fillSelect` 先调用 `replaceChildren()`；Chromium测试连续刷新不增加选项 | 排除为此次主因 |
| 存储中重复的项目键或对话ID | 只读统计本机插件私有 `conversations.json`：15个分仓，重复键0，每仓重复对话ID0 | 不是同一键被存了多次；不据此宣称已审计每条正文的语义重复 |
| 同一路径先按path、后按project分仓 | 数据同时存在 `path:规范化目录` 和正式项目ID；`currentContext` 在宿主无ID时回退到路径。测试模拟无ID→有ID→ID暂缺→恢复 | 已复现 |
| 宿主旧项目身份转成正式ID | 同名项目还存在 `project:legacy:目录`；官方 `project-archive.ts` 为旧目录生成 `legacy:` 身份。测试模拟legacy→正式ID | 正常兼容身份被插件作为额外空历史展示 |
| 仅查看/轮询就留下空分仓 | `contextSnapshot → projectStore → createStore` 创建记录，`snapshot` 自动确保一条空对话；旧 `projectList` 不过滤任何分仓，后续persist保存它们 | 已证实的插件列表缺陷 |
| 不同目录的真实项目恰好同名 | 旧列表只显示name；用两个不同键、均有内容的同名项目验证选择和只读边界 | 合法情况，不能简单按名称去重；已增加身份标识 |
| Windows大小写、斜杠和末尾斜杠 | 原 `normalizedPath` 已处理；10轮不同写法的回归仍只有一个键 | 本次测试排除，不扩大到软链接/任意路径别名 |
| v1历史迁移重复分配 | v1仍只归入独立legacy分仓并保留备份；既有迁移测试通过 | 未发现此次问题来自v1迁移 |
| 多个插件安装副本同时提供列表 | 本机登记的同ID插件条目为dev/ready，路径为当前工作区；installed目录虽有0.1.0，但不是该条目使用的路径 | 未发现两个启用实例；登记的0.1.10版本元数据不能证明热更新进程具体加载版本 |

诊断只输出项目身份、名称、数量和哈希，不输出聊天正文、密钥或完整宿主登记文件。没有操作运行中PI-Desktop界面，也没有直接改写用户的真实历史数据。

## 修复实现

### 仅列出实际历史

`main.js` 的 `projectList(currentProjectKey)` 保留以下项目：

- 当前项目，即使尚未发送消息；
- 固定的 `general` 独立会话入口与 `legacy` 未归类旧历史入口；
- 至少有一个对话带标题或消息的其它分仓。

非当前、所有对话均无标题且无消息的分仓只是不出现在列表中，**仍保存在原存储里**。bootstrap/context、新建、选择、删除及历史浏览响应均使用相同规则，避免切换后旧选项重新出现。刻意命名但暂时没有消息的对话仍可见。

### 区分同名但有内容的历史

`renderer/index.html` 的 `historyLabel` 只在名称冲突时追加完整分仓键，例如：

```text
模拟项目 [project:project-a] (当前项目)
模拟项目 [path:d:/projects/simulation]
```

选项value仍为原键，标签仍通过 `textContent` 写入，不将名称作为HTML。当前标记、跨项目浏览只读、删除权限和发送归属不变。没有调整布局、主题、主草稿桥、守卫、权限或附件缓存。

## 验证结果

- 先在旧实现运行新增回归：3项Node失败，Chromium同名标签用例失败，确认测试确实捕获缺陷。
- 修复后108项Node、93项浏览器检查全部通过，共201项；包含既有多格式附件、草稿桥、隔离、Markdown、主题与底栏回归。
- 新增5项Node、2项浏览器检查，覆盖路径/ID/legacy身份变化、原记录重载保持、同名非空历史不合并、附件ID归属、连续刷新、路径写法与标签文本安全。
- 将本机历史送入内存文件系统离线重放：原15个分仓的列表变成5项；内存持久化后仍有15仓，对话/消息ID全部保留；真实历史文件前后SHA-256一致。列表对应独立会话、未归类旧历史及三个有内容的项目。该结果针对当时的当前项目快照，不是承诺所有环境都只有5项。
- 语法和 `git diff --check` 已通过。安装版Runner测试最初因旧哈希文件名不存在失败，定位当前 `runner-J5MIE7JK.js` 后完整重跑通过；这与历史列表缺陷无关。
- 上述是源码、内存重放和真实Chromium的模拟桥验证，不等同于已在用户正在运行的侧栏中目视验收。

复现完整检查（从项目根执行，`PI_SCRATCH_DIR`须为当前允许的会话临时目录；安装路径变化时按实际路径设置Runner）：

```bash
export TMP="$PI_SCRATCH_DIR" TEMP="$PI_SCRATCH_DIR" TMPDIR="$PI_SCRATCH_DIR"
export JITI_FS_CACHE=0 JITI_CACHE_DIR="$PI_SCRATCH_DIR/jiti-cache"
export SIDE_CHAT_HOST_RUNNER='D:/Mypi_deskktop/PI-Desktop/resources/agent-runtime/chunks/runner-J5MIE7JK.js'
export SIDE_CHAT_HOST_SIDECAR='D:/Mypi_deskktop/PI-Desktop/resources/agent-runtime/sidecar.js'
node --test tests/side-chat.test.cjs tests/draft-bridge.test.mjs tests/attachments.test.cjs tests/content-formats.test.cjs
node tests/theme-follow.cjs
node --check main.js
node --check tests/ui-harness.js
git diff --check
```

## 官方依据与后续方向

- [workspace-roots.ts](https://github.com/vastsa/PI-Desktop/blob/main/apps/desktop/electron/main/workspace-roots.ts)：宿主项目快照未准备好或不可用时，可以返回没有projectId/roots的单目录载荷。
- [plugin-runtime.ts](https://github.com/vastsa/PI-Desktop/blob/main/apps/desktop/electron/main/plugin-runtime.ts)：丰富工作区元数据是可选增量，回退到单路径是正式兼容行为。
- [project-archive.ts](https://github.com/vastsa/PI-Desktop/blob/main/apps/desktop/src/lib/project-archive.ts)：旧目录使用 `legacy:路径`，有正式项目组时使用组身份。
- 本轮没有引入新宿主API，也没有为“消除重复”修改宿主数据库或项目组。

当前无需用户补充资料。确认侧栏使用0.1.15后，重新打开历史抽屉应不再出现截图中的空影子项；已有内容应仍可查看。若仍看到多个带不同键、且都有真实消息的同名项，请只提供它们的分仓键、目录归属及是否均有内容，不需聊天正文或密钥。

**有内容的历史合仓不属于本次无损列表修复。** 若未来要统一path/legacy/project历史，需要可验证的项目根映射、原文件备份、对话冲突处理以及依赖projectKey哈希的附件缓存迁移；不能按相同名称或不完整快照直接合并。元数据暂缺时当前空分仓仍可能与旧非空分仓同时存在，二者将显示不同身份而非被误合并。
