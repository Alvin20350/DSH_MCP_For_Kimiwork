# GitHub 发布检查单

## 发布前

- [ ] 将 README 的仓库地址替换为实际仓库地址。
- [ ] 检查 `git status`，确认没有 `node_modules`、`.env`、会话、日志或本机备份文件。
- [ ] 运行 `npm ci --prefix packages/harness-plugin`、`npm run check`、`npm test`。
- [ ] 在至少一台干净环境执行安装与 `doctor --delegate`。
- [ ] 确认 CHANGELOG 与包版本一致。
- [ ] 确认仓库中不包含 DeepSeek Key、桥接令牌或用户私人路径（示例中的开发机路径应及时替换）。

## 创建仓库

```sh
git init
git add .
git commit -m "feat: reconnectable DeepSeek subagents for Kimi"
git branch -M main
git remote add origin https://github.com/Alvin20350/DSH_MCP_For_Kimiwork.git
git push -u origin main
```

也可以使用 GitHub CLI：

```sh
gh repo create DSH_MCP_For_Kimiwork --public --source . --remote origin --push
```

推送属于对外发布操作，执行前再次检查差异和仓库可见性。

## 发布后验收

- 在另一台电脑从 GitHub 克隆，而不是复制开发目录。
- 让目标 Kimi 按 `AGENTS.md` 与安装 Skill 完成安装。
- 验证 Harness 插件、Kimi Work 个人插件和 Kimi Code MCP 分别可用。
- 执行一次真实委派、工作区分组检查与 `continue`。
- 确认 GitHub Actions 通过。

## 升级原则

- Harness 破坏性变化先更新兼容层和测试，再新增 `TESTED_HARNESS_VERSIONS`。
- 替换已加载的 Harness 插件后提示用户重启 Desktop。
- 不改变 `continue` 的安全语义：仅恢复连接时不自动启动模型工作。
- 版本升级应记录协议变化、迁移步骤和旧会话兼容性。
