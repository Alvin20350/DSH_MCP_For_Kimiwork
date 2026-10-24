# Kimi 工作指南

本仓库包含两个不同用途的 Skill，不要混用。

- 用户要求**安装、迁移、修复或验收**本系统：先完整阅读 `skills/dsh-subagent-installer/SKILL.md`，再按其中的检查顺序执行。
- 用户要求**使用 DeepSeek 子代理处理其他任务**：使用 `packages/personal/deepseek-subagent/skills/deepseek-subagent/SKILL.md` 中的运行规则。

通用要求：

- 不向用户索要 DeepSeek API Key，不打印或写入任何密钥。
- 不把开发机器上的绝对路径当作其他电脑的既定路径；先检测，缺失时只询问必要信息。
- 不用 `--allow-untested` 绕过版本检查，除非用户明确接受对应风险。
- 不用新建会话冒充 `continue` 恢复，不在仅恢复连接时自动启动模型工作。
- 安装后如实区分“文件已写入”“应用已加载”“真实委派已通过”，不得相互替代。
