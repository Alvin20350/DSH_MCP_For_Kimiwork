const DEFAULT_TEXT_LIMIT = 1200

function textOf(content, limit = DEFAULT_TEXT_LIMIT) {
  if (typeof content === 'string') return content.slice(0, limit)
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()
  return text ? text.slice(0, limit) : undefined
}

function compactData(event, limit) {
  const data = event.data ?? {}
  switch (event.type) {
    case 'assistant/message':
    case 'user/message':
    case 'developer/message':
    case 'system/message':
    case 'compaction/summary':
      return { text: textOf(data.message?.content ?? data.content ?? data.summary, limit) }
    case 'tool/call':
      return {
        name: data.name ?? data.tool ?? data.call?.name,
        callId: data.callId ?? data.id ?? data.call?.id,
        args: textOf(JSON.stringify(data.args ?? data.arguments ?? data.call?.args ?? {}), 400),
      }
    case 'tool/result':
      return {
        name: data.name ?? data.tool,
        callId: data.callId ?? data.id,
        ok: data.ok ?? !data.error,
        text: textOf(data.content ?? data.result ?? data.error, limit),
      }
    case 'turn/end':
      return { turn: data.turn, reason: data.reason }
    case 'turn/start':
    case 'step/start':
    case 'step/end':
      return { turn: data.turn, step: data.step }
    case 'approval/asked':
      return { approval: data, note: 'Approval must be answered in Harness Desktop' }
    case 'approval/decided':
      return { decision: data.decision ?? data.outcome }
    case 'session/title':
      return { title: data.title }
    case 'workspace/changes':
      return { changes: data }
    default:
      return Object.keys(data).length ? data : undefined
  }
}

export function compactEvent(event, limit = DEFAULT_TEXT_LIMIT) {
  return {
    seq: event.seq,
    type: event.type,
    ...compactData(event, limit) ?? {},
  }
}

export function latestAssistantText(events, limit = 6000) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'assistant/message') continue
    const text = textOf(event.data?.message?.content ?? event.data?.content, limit)
    if (text) return { text, seq: event.seq }
  }
  return undefined
}

export function lastTurnState(events) {
  const last = [...events].reverse().find((event) => event.type === 'turn/end')
  if (last) return { state: 'ended', reason: last.data?.reason, seq: last.seq }
  const open = [...events].reverse().find((event) => event.type === 'turn/start')
  if (open) return { state: 'open', turn: open.data?.turn, seq: open.seq }
  return { state: 'no-turns' }
}

export function pendingApprovals(events) {
  const answered = new Set()
  const pending = []
  for (const event of events) {
    const data = event.data ?? {}
    const id = data.approvalId ?? data.rpcId ?? data.id
    if (event.type === 'approval/decided') answered.add(id)
    if (event.type === 'approval/asked' && !answered.has(id)) pending.push({ seq: event.seq, id })
  }
  return pending.filter((item) => !answered.has(item.id))
}
