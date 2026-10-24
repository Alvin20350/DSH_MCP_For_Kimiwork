---
name: deepseek-subagent
description: 当用户要求 DeepSeek、DS、外挂子代理处理任务，或要求查看 DS 进度、继续 DS 会话、向 DS 注入消息、取消 DS 任务时使用。通过 DeepSeek Harness Desktop 的持久会话执行，不把 DeepSeek 当作一次性聊天接口。
---

# DeepSeek 子代理

通过 `deepseek-subagent` MCP 使用当前电脑已启动的 DeepSeek Harness Desktop。Kimi 负责拆解、委派和复核；DSH 负责独立工作区、持久会话与实际执行。

## 启动检查

1. 首次使用或连接失败时调用 `ds_health`。
2. 若 `ok` 为 `false` 或无法连接，请用户启动 Harness Desktop 并确认桥接插件已启用；不要尝试读取 DeepSeek Key，也不要把连接失败当作任务失败。
3. `tested=false` 时表示当前 Harness 版本尚未验证，明确提示兼容性风险，不要声称一定可用。

## 委派新任务

1. 使用当前 Kimi 工作区的绝对路径作为 `cwd`。不确定时先确认，不要猜路径。
2. 必要时调用 `ds_workspaces`。若返回 `WORKSPACE_NOT_ALLOWED`，请用户在 Harness 中注册该工作区或由管理员配置允许根目录，不要换到未经允许的目录。
3. 为每个逻辑任务生成一个唯一 `requestId`；同一任务的网络重试必须复用原值，不同任务绝不能复用。
4. 调用 `ds_delegate`，保留返回的 `sessionId`、`requestId` 和 `cwd`。任务接受不代表已完成。
5. 主 Agent 不应把完整实时事件流搬进上下文。默认先向用户汇报已启动和会话编号，需要结果时调用 `ds_result`。

## continue 与断电恢复

- 用户只说 `continue`、重新连接或恢复上次 DS 会话时，调用 `ds_continue`，只传当前 `cwd`，不要传 `prompt`。该操作只恢复原会话并报告状态，不启动新模型工作。
- 不得用 `ds_delegate` 新建会话来冒充恢复。找不到绑定时返回 `ds_sessions`，让用户选择。
- 用户明确要求“继续完成任务”时，在恢复后使用新的 `requestId` 调用 `ds_continue`，附上继续指令。指令应先要求 DS 检查现有修改、日志和测试状态，再执行未完成步骤，避免重复副作用。
- 恢复后通过 `ds_result` 或 `ds_status` 把原会话上下文摘要接回 Kimi，再继续编排。

## 进度与结果

- `ds_status`：查看运行、脱离、回合中断和待审批状态，不启动模型工作。
- `ds_result`：读取最近的已提交助手结果。
- `ds_watch`：需要增量进度时使用，并保存返回的 `cursor`；下次传回。并行消费者使用不同 `consumerId`。
- 不要高频轮询。需要等待时将 `waitMs` 设为 10000–20000，避免把每个 token 或每条工具日志转发给主模型。

## 会话中插入信息

- `followup`：排队到下一回合，适合补充新任务。
- `steer`：在当前工作的后续步骤生效，适合纠正方向。
- `inject`：只注入上下文，不主动唤醒 Agent；适合补充约束和背景。
- 统一通过 `ds_send` 并为每次新内容使用新的 `requestId`；重试复用同一个值。

## 审批与取消

- 待审批事项只报告给用户，由用户在 Harness Desktop 中处理。绝不代替用户批准高风险操作。
- 使用 `ds_cancel` 只取消当前执行，保留会话和待处理输入；不要删除会话或工作区。

## 完成标准

汇报 DS 的最终结论、修改摘要和验证状态。关键代码改动由 Kimi 再复核；如果 DS 等待审批、连接中断或结果尚未产生，应明确说明，不能把已接受任务描述为已完成。
