# 侧边聊天 0.1.9：宿主主题跟随修复

> 目标插件为 `com.vastsa.side-chat`（侧边聊天），不是KnowStack。未修改PI-Desktop宿主源码，未改变聊天逻辑、历史记录、模型配置、权限或依赖。测试使用真实Chromium、正式插件页面、已安装主题的实际配色变量与模拟宿主事件；未自动安装或声称完成正在运行的宿主GUI验收。

## 根因与最小改动

原页面已通过官方 `app.getAppearance` / `appearance:changed` 接收并注入主题CSS，但插件自身变量仍固定为蓝色浅/深两套，未消费主题的 `--ds-*`。另外，外观指纹只比较CSS长度，同一主题等长改色会被忽略。

生产代码仅改：

- `renderer/index.html`：浅/深色各11个颜色声明映射到宿主变量，原色保留为fallback；补充输入占位文字的宿主颜色映射，变量缺失时以revert保留浏览器默认样式。没有修改布局、内联聊天脚本或页面标记。
- `renderer/appearance.js`：指纹比较从CSS长度改为CSS实际内容，一行修改，既有缓存/外观事件和聊天流程不变。

| 插件颜色 | 宿主变量 | 覆盖 |
| --- | --- | --- |
| `--bg` | `--ds-bg-dock` → `--ds-bg-primary` | 页面、顶部、输入区背景 |
| `--card` | `--ds-bg-elevated-opaque` → `--ds-bg-secondary` | 按钮、输入框、AI气泡、模型菜单 |
| `--ink` / `--muted` | `--ds-text-primary` / `--ds-text-secondary` | 主/次文字 |
| `--line` | `--ds-border-default` | 边框、分隔线 |
| `--accent` / `--accent-ink` | `--ds-accent` / `--ds-bg-primary` | 发送按钮、链接、焦点等 |
| `--user` / `--user-ink` | `--ds-bg-active` / `--ds-text-primary` | 用户气泡及文字 |
| `--danger` / `--ok` | `--ds-error` / `--ds-success` | 状态颜色 |
| 占位文字 | `--ds-placeholder-ink` → `--ds-text-secondary` → revert | 输入占位文字 |

既有默认浅色 `#f5faff`、深色 `#152332` 以及其他原颜色均保留在fallback中；没有替换或强制应用用户主题。

## 两个主题的验证

- **青叶 · 浅绿**：主题工坊实际配置 `pi.theme.studio:custom-3`，light。采集了绿色背景、深绿文字及强调色等实际变量，不用猜测色值。
- **Sax Dark · 浮影**：已安装主题 `adoin.sax-design-theme:sax-dark`，dark。使用其实际颜色变量和必要依赖，不复制字体、图片或宿主布局规则。

测试数据在 `tests/theme-fixtures.json`，标注来源及源CSS指纹，仅用于颜色回归。测试事件使用官方外观payload形状，由现有插件外观处理器消费。

已执行：

- `node --test tests/side-chat.test.cjs tests/draft-bridge.test.mjs`：27项通过。
- `node tests/theme-follow.cjs`：原UI回归26项通过；420px/320px下主题检查24项通过。
- 检查背景、主次文字、边框、按钮、输入框、用户/AI气泡和占位文字；无宿主变量的浅/深色回退；浅→深→浅实时往返；同主题、同基底、同CSS长度的改色。
- 对比主题切换前后的聊天文本、侧聊草稿、历史快照、模型键、思考档位和写操作数量，均不变。
- 改动前新主题测试16项失败；修复后全部通过。占位文字补充用例先复现4项失败，修复后通过。
- 对照任务开始快照，`main.js`、`store.js`、草稿桥、Markdown模块、外观启动模块、原UI夹具及index内联脚本逐字节不变；manifest除版本/changelog外不变。

截图在 `docs/theme-follow-0.1.9/`：浅绿/浮影分别有420px与320px版本，均为模拟聊天数据，不冒充用户真实历史。

## 复现

```bash
# Node 22+、本机Chrome；将PI_SCRATCH_DIR设置到允许的会话/项目临时目录。
export TMP="$PI_SCRATCH_DIR" TEMP="$PI_SCRATCH_DIR" TMPDIR="$PI_SCRATCH_DIR"
node --test tests/side-chat.test.cjs tests/draft-bridge.test.mjs
SIDE_CHAT_THEME_SCREENSHOT_DIR="$PI_SCRATCH_DIR/side-chat-theme-shots" node tests/theme-follow.cjs
```

正常更新插件后保持侧边聊天打开，依次切换宿主“青叶·浅绿”和“浮影”，确认上述各区域立即换色，不重置草稿、历史、选模或思考档位；再切回默认浅/深色，确认不残留上一主题变量。真实补全不是本轮测试所需，不必用重要聊天记录做试删。

## 依据与交付

- [PI-Desktop官方插件API：app与Panel events](https://github.com/vastsa/PI-Desktop/blob/main/docs/spec/07-plugins/03-plugin-api.md)：`pluginTheme.css`、`app.getAppearance`、`appearance:changed`。
- [官方插件开发文档：Theme](https://github.com/vastsa/PI-Desktop/blob/main/docs/plugin-development.md)：与base对应的 `:root[data-theme]` 及 `--ds-*` token。
- [CSS自定义属性与fallback](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)：通过var()级联消费主题，并保留缺失变量的回退。

版本、manifest发布说明及中英文README同步至0.1.9。安装包由官方PluginCheck/PluginPack产生，不手工压缩；因工具限定当前工作区，使用与目标源码逐文件相同的临时副本检查和打包，完成后核对归档与目标源码一致。没有自动安装、Git提交或推送。
