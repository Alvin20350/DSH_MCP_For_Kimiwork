# 迁移与安装指南

## 1. 迁移前检查

目标电脑需要：

- 已安装且能正常调用模型的 DeepSeek Harness Desktop；
- Kimi Work、Kimi Code，或两者；
- Node.js（建议 24）；
- 本仓库源码；
- 一个允许 DS 使用的项目目录。

不需要复制开发机的 `.dsh`、Kimi 会话、桥接状态文件或任何 API Key。Harness 的持久会话仍在原电脑；**本系统迁移的是安装与运行能力，不是自动迁移旧会话内容**。

## 2. 推荐：让目标电脑的 Kimi 安装

在目标 Kimi 中打开仓库，发送：

> 阅读 AGENTS.md 和 skills/dsh-subagent-installer/SKILL.md，检查本机环境并安装这套系统。不要向我要 DeepSeek Key。完成后分别验证桥接、委派、工作区分组和 continue 恢复。

安装 Skill 会只在缺少必要信息时提问。Kimi Work 的运行环境通常已经带有 `DAIMON_RUNTIME_BINARY_PATH` 与 `KIMI_SHARE_DIR`，因此比纯终端手动配置更顺畅。

## 3. 手动安装

在仓库根目录执行：

```sh
node scripts/install.mjs --kimi-code-home "<用户的 .kimi-code 路径>"
```

安装器支持：

| 参数 | 用途 |
|---|---|
| `--dsh-cli <path>` | Harness CLI 不在常见位置时显式指定 |
| `--profile <name>` | 非默认 Harness profile，默认 `desktop` |
| `--kimi-daimon <path>` | Kimi Work daemon CLI |
| `--kimi-share <path>` | Kimi Work 共享数据目录 |
| `--kimi-code-home <path>` | 同时配置 Kimi Code |
| `--skip-harness` | 不安装 Harness 桥接 |
| `--skip-work` | 不注册 Kimi Work 插件 |
| `--allow-untested` | 明确接受未验证 Harness 版本的风险 |

Windows 会自动生成或复用用户环境中的 `KIMI_DSH_BRIDGE_TOKEN`。其他操作系统需要先在 GUI 用户环境中配置该变量，再运行安装器；安装器不会把 shell export 误当成 GUI 配置。

## 4. 应用内启用

- 完全重启 Harness Desktop。Kimi 侧 stdio 启动器会自行读取用户环境令牌，不要求 Kimi 后台进程继承它。
- Kimi Work：插件 → 个人 → DeepSeek 子代理 → ＋；旧版本用户点击“更新”。
- Kimi Code：新建会话。
- 在 Harness UI 注册目标工作区。默认不接受任意未注册目录。

## 5. 验收

```sh
npm ci --prefix packages/harness-plugin
node scripts/doctor.mjs
node scripts/doctor.mjs --delegate "<已注册工作区绝对路径>"
```

依次确认：

1. `ok: true`，版本符合预期；
2. 真实返回 `DS_DELEGATE_OK`；
3. 出现 `WORKSPACE_GROUP_OK`，不是“未分组”；
4. `CONTINUE_OK` 的会话编号与委派编号一致。

## 6. 常见问题

### 端口 37841 无法连接

Harness 未启动、插件未加载或更新后未重启。先检查应用状态，不要修改 Kimi 模型配置。

### MCP 返回 401

两端桥接令牌不一致。复用同一个 `KIMI_DSH_BRIDGE_TOKEN`，不要换成 DeepSeek Key。

### `WORKSPACE_NOT_ALLOWED`

在 Harness UI 注册工作区，或由管理员明确配置 `allowedRoots`。不要选择其他目录绕过。

### 版本被拒绝

当前只验证了 `0.2.1-rc.3`。先审查新版本 API；不要默认使用 `--allow-untested`。

### `continue` 找不到会话

当前工作区没有最近的委派绑定。通过 `ds_sessions` 列出已有会话并明确选择；不要新建一个会话冒充恢复。

### 旧会话在“未分组”

0.1.1 只保证新会话正确挂载，旧会话不会自动迁移。

## 7. 卸载或重装

安装器可重复执行并复用令牌。卸载时先在 Kimi Work 移除插件、从 Kimi Code `mcp.json` 删除 `deepseek-subagent`，再从 Harness 的 desktop profile 移除 `@local/dsh-kimi-bridge`。是否删除 Harness 会话与桥接状态应由用户单独决定，不能随插件静默删除。
