# Kimi DeepSeek Subagent

让 **Kimi Work／Kimi Code** 把任务委派给现有的 **DeepSeek Harness Desktop**，并共享同一批工作区与持久会话。

这不是一次性 DeepSeek 聊天接口，也不是修改 Kimi 内部模型配置的 workaround。项目由 Harness 内的 MCP 桥接插件和 Kimi 侧插件组成，支持真实 Agent 执行、进度查看、消息注入、取消与断电后的同会话恢复。

## 功能

- 委派任务到 Harness 工作区，新会话正确归入对应项目；
- `continue` 找回当前工作区最近的 DS 会话，不静默创建替代会话；
- 跟进、steering、非唤醒式上下文注入、取消；
- 持久事件游标、超时请求去重、冷会话结果读取；
- DeepSeek Key 留在 Harness，Kimi 只接触独立的本地桥接令牌；
- 支持 Kimi Work 个人插件和 Kimi Code `mcp.json`；
- 安装器、安装 Skill、诊断工具和真实恢复测试可重复使用。

## 已验证环境

- DeepSeek Harness Desktop / CLI：`0.2.1-rc.3`
- Kimi Work 个人插件格式
- Kimi Work／Kimi Code 的 stdio MCP，以及独立认证启动器
- Node.js 24

Harness 仍处于 developer preview。其他版本默认拒绝安装；不要在未审查 API 变化时使用 `--allow-untested`。

## 在其他 PC 上安装：推荐方式

1. 安装并配置好 Harness Desktop 和 Kimi，确保 Harness 已能正常调用模型。
2. 克隆本仓库并进入目录：

   ```sh
   git clone https://github.com/Alvin20350/DSH_MCP_For_Kimiwork.git
   cd kimi-deepseek-subagent
   ```

3. 在 Kimi 中打开该目录，对它说：

   > 阅读 AGENTS.md 和 skills/dsh-subagent-installer/SKILL.md，按其中的流程在这台电脑安装并验收这套系统。

   Kimi 会检查路径与版本、执行安装、提示必要的重启，并分别报告安装、加载、委派、分组和恢复结果。

也可以完全手动安装，详见 [迁移与安装指南](docs/installation.md)。

## 安装后启用

1. 完全重启 Harness Desktop。Kimi 侧启动器会自行读取用户环境令牌，不依赖 Kimi 后台进程继承。
2. Kimi Work：在插件“个人”页点击 **DeepSeek 子代理**的 ＋；旧版本用户点击“更新”。
3. Kimi Code：新建会话，让 MCP 与 Skill 生效。
4. 确认目标项目已经注册为 Harness 工作区。

## 日常使用

直接对 Kimi 说：

- “让 DS 在当前工作区检查测试失败原因，完成后只汇报结论。”
- “查看 DS 当前进度。”
- “把不要修改公开接口注入刚才的 DS 会话。”
- “取消 DS 当前任务，但保留会话。”
- “continue。”

`continue` 只恢复原会话并报告状态，**不会自动发起新的模型工作**。明确说“继续完成 DS 的未完成任务”才会继续执行，并要求先检查已有修改和测试状态，避免重复副作用。

## 诊断

安装依赖后，可随时运行：

```sh
npm ci --prefix packages/harness-plugin
node scripts/doctor.mjs
```

对已注册工作区做一次最小真实委派：

```sh
node scripts/doctor.mjs --delegate "/absolute/path/to/workspace"
```

成功应看到 `DS_DELEGATE_OK`、`WORKSPACE_GROUP_OK`，以及与原会话一致的 `CONTINUE_OK`。

## 项目结构

```text
packages/harness-plugin/          Harness 内的 MCP 桥接插件
packages/personal/deepseek-subagent/
                                  Kimi Work 插件与运行 Skill
packages/kimi-code/               Kimi Code MCP 配置
skills/dsh-subagent-installer/    给安装者 Kimi 使用的安装 Skill
scripts/install.mjs              可重复执行的安装器
scripts/doctor.mjs               独立诊断与真实委派检查
scripts/live-smoke.mjs           隔离的真实断电恢复测试
scripts/check-repo.mjs           仓库交付契约检查
docs/                            架构、安装与发布文档
.github/workflows/test.yml       GitHub Actions CI
```

## 安全边界

- 桥接仅监听 `127.0.0.1`，不要暴露到局域网或公网。
- 桥接令牌不是 DeepSeek Key，不能提交到仓库或写入提示词。
- 默认只允许已注册工作区；额外根目录需要明确配置。
- 高风险审批只能由用户在 Harness Desktop 中处理。
- 实时完整过程在 Harness 中查看，Kimi 获取压缩状态和持久结果，避免编排 token 被事件流耗尽。

详见 [架构与恢复契约](docs/architecture.md) 和 [安全说明](SECURITY.md)。

## 开发与验证

```sh
npm ci --prefix packages/harness-plugin
npm run check
npm test
```

CI 不调用真实 DeepSeek。真实隔离联调使用 `scripts/live-smoke.mjs`，会创建并清理临时 `DSH_HOME`，不使用现有会话。

## 发布

本项目已包含 `.gitignore`、MIT License、安全说明、变更记录和 GitHub Actions。发布与升级流程参见 [GitHub 发布检查单](docs/publishing.md)。
