---
name: dsh-subagent-installer
description: 当用户要求在其他电脑安装、迁移、诊断或验收 Kimi DeepSeek Subagent，或要求把此仓库配置到 Kimi Work／Kimi Code 与 DeepSeek Harness Desktop 时使用。
---

# 安装与迁移 Kimi DeepSeek Subagent

目标：在不接触 DeepSeek API Key 的前提下，将仓库中的双侧插件安装到用户现有的 Kimi 与 DeepSeek Harness Desktop，并验证真实委派和重连。

## 原则

- 不假设安装路径、profile、`DSH_HOME`、Kimi home 或操作系统环境。先检测，无法检测时只问缺失项。
- 不索要、读取、显示或复制 DeepSeek API Key。桥接令牌与 DeepSeek Key 是不同凭据。
- 不直接编辑 Harness 的 `package.json`、`cordis.patch.yml` 或 Kimi Work 的模型配置；使用仓库安装器。
- 安装器可重复执行，但不能把“安装文件成功”说成“应用已经生效”。
- 真实模型调用只使用最小测试，不要求修改项目文件。

## 1. 检查仓库与前置条件

确认当前目录包含 `scripts/install.mjs`、`packages/harness-plugin` 和 `packages/personal/deepseek-subagent`。

需要：

- Node.js（建议 24）；
- DeepSeek Harness Desktop，且模型已在 UI 中配置；
- Kimi Work、Kimi Code，或两者；
- 一个已注册或允许注册的 Harness 工作区。

先运行 `node scripts/install.mjs --help` 查看可用参数。不要立即使用 `--allow-untested`。

## 2. 确定安装参数

安装器会尝试自动发现 Harness CLI、Kimi Work CLI 和共享目录。

- 找不到 Harness CLI：请用户提供 Desktop 安装目录，用 `--dsh-cli` 指定其 `resources/runtime/cli/bin/dsh` 或 `dsh.cmd`。
- 安装 Kimi Work：优先使用运行 Kimi 时已有的 `DAIMON_RUNTIME_BINARY_PATH` 和 `KIMI_SHARE_DIR`；缺失时传 `--kimi-daimon` 与 `--kimi-share`。
- 安装 Kimi Code：传 `--kimi-code-home`，通常是用户目录下的 `.kimi-code`。
- 只需 Harness 与令牌：使用 `--skip-work`；只需 Kimi 配置：使用 `--skip-harness`。
- 非 Windows：安装器不会假装 shell export 能配置 GUI。若提示缺少令牌，先指导用户在 GUI 用户环境设置 `KIMI_DSH_BRIDGE_TOKEN`，再继续。

## 3. 执行安装

在仓库根目录运行安装器，按需组合参数：

```sh
node scripts/install.mjs --kimi-code-home "<用户的 .kimi-code 路径>"
```

Windows 会让安装器生成并保存独立桥接令牌。已有令牌必须复用，不能每次重装都轮换。

安装器应完成版本检查、Harness profile 挂载、Kimi Work 注册以及可选的 Kimi Code 合并。若任一步失败，保留错误并停止声称成功。

## 4. 应用内启用

- 完全重启 Harness Desktop，使桥接插件和令牌生效。
- Kimi Work：在插件“个人”页点击“DeepSeek 子代理”的 ＋ 安装。
- Kimi Code：新建会话，使新增 MCP 生效。
- 如果只是更新 Harness 插件代码，通常只需重启 Harness Desktop。

## 5. 验收

先确保 Harness 插件依赖已安装，再运行：

```sh
npm ci --prefix packages/harness-plugin
node scripts/doctor.mjs
```

健康结果必须包括 `ok: true`、正确的协议版本和桥接版本。随后确认目标目录出现在 `ds_workspaces` 中。

经用户同意进行一次最小真实调用：

```sh
node scripts/doctor.mjs --delegate "<已注册工作区的绝对路径>"
```

通过标准：返回 `DS_DELEGATE_OK`、出现 `WORKSPACE_GROUP_OK`，并且 `CONTINUE_OK` 的会话编号与委派编号一致。若未注册工作区，请用户在 Harness UI 中注册，不要任意选择其他目录。

## 6. 故障处理

- 端口无法连接：Harness 未启动、插件未启用或重启未完成。
- 401：两端桥接令牌不一致；不要改成 DeepSeek Key。
- `WORKSPACE_NOT_ALLOWED`：注册工作区或明确配置允许根目录。
- 会话在“未分组”：使用 0.1.1 或更新版本；旧会话不会自动迁移。
- `continue` 找不到会话：列出 `ds_sessions` 并明确选择，不新建替代会话。
- 版本不受支持：保留错误，核对变更后再决定是否需要用户明确接受 `--allow-untested`。

最后分别报告：安装是否完成、应用是否加载、真实委派是否通过、工作区分组是否正确、重连是否通过。
