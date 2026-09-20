# 侧边聊天

PI-Desktop 插件：停靠在右侧工作面板的独立聊天。

- 自己的多轮历史（存在插件数据目录）
- 走宿主 `agent.complete`，用你已经登录的模型，插件拿不到密钥
- 可选：把当前会话 transcript 当上下文
- 可选：把上一句回复发回该会话（`agent/prompt`）

需要 PI-Desktop ≥ 0.14.0。

## 安装

1. PI-Desktop → 插件 → **加载开发插件**
2. 选这个目录
3. 打开右侧工作面板，选 **侧边聊天**

命令面板：`Side Chat: Open`（独立窗口）。

## 权限

| 权限 | 用途 |
|---|---|
| `ui.view` / `ui.panel` | 停靠视图 / 独立窗口 |
| `models.list` | 列出已登录模型 |
| `agent.complete` | 旁路补全（密钥留在宿主） |
| `desktop.control` | 列/读会话，把回复发回去 |
| `clipboard.write` | 复制回复 |

插件自己不联网。宿主限制：每 60 秒最多 8 次补全，超时 90 秒。

## 仓库

https://github.com/vastsa/pi-desktop-side-chat
