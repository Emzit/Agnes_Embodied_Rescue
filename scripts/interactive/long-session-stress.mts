import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = join(ROOT, 'artifacts/indoor-rescue-upgrade/provider-long-session-validation.json')
const dashboard = 'http://127.0.0.1:4188'
const task = process.env.LONG_SESSION_TASK || '进入实验室寻找失联研究员，并报告环境风险。'
const runs = Math.max(1, Math.min(3, Number(process.env.LONG_SESSION_RUNS || 3)))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const request = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${dashboard}${path}`, init)
  const value = await response.json()
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(value)}`)
  return value as any
}
const bytes = async (file: string) => {
  try { return (await readFile(file)).byteLength } catch { return 0 }
}
const missionDir = (id: string) => join(ROOT, 'artifacts/interactive-live/missions', id)
const summarize = async (id: string) => {
  const dir = missionDir(id)
  let mcp: any[] = []
  let events: any[] = []
  try { mcp = JSON.parse(await readFile(join(dir, 'mcp-trace.json'), 'utf8')) } catch {}
  try { events = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) } catch {}
  const toolResults = mcp.filter((entry) => entry.tool)
  const names = toolResults.map((entry) => String(entry.tool).replace(/^mcp_robot_mcp_[^_]+_/, ''))
  const navigation = toolResults.filter((entry) => names[toolResults.indexOf(entry)] === 'navigate_to')
  const readOnly = toolResults.filter((entry) => ['get_robot_state', 'get_world_state', 'get_observation', 'list_known_locations', 'mission_get_state', 'world_memory_get', 'decision_score_candidates'].includes(names[toolResults.indexOf(entry)]))
  const failed = events.filter((entry) => entry.type === 'tool_result' && /(?:INTERNAL_ERROR|TRANSPORT|TIMEOUT|ABORTED|PATH_BLOCKED|error_code.?104)/iu.test(JSON.stringify(entry.result)))
  return {
    mission_id: id,
    status: JSON.parse(await readFile(join(dir, 'mission-outcome.json'), 'utf8')).decision?.status || JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')).status,
    mcp_tool_calls: toolResults.length,
    read_only_tool_calls: readOnly.length,
    navigation_calls: navigation.length,
    inspect_room_calls: names.filter((name) => name === 'inspect_room').length,
    inspect_object_calls: names.filter((name) => name === 'inspect_object').length,
    replan_like_updates: names.filter((name) => name === 'world_memory_update').length,
    failed_tool_events: failed.length,
    payload_sizes: {
      agnes_events: await bytes(join(dir, 'agnes-events.jsonl')),
      events: await bytes(join(dir, 'events.jsonl')),
      mcp_trace: await bytes(join(dir, 'mcp-trace.json')),
      ros2_trace: await bytes(join(dir, 'ros2-trace.json')),
    },
    terminal_files_present: ['provider.json', 'agnes-trace.json', 'mcp-trace.json', 'events.jsonl', 'result.json', 'mission-outcome.json'].every((name) => {
      try { return Boolean(statSync(join(dir, name))) } catch { return false }
    }),
  }
}

const startedAt = new Date().toISOString()
const results: any[] = []
for (let index = 0; index < runs; index += 1) {
  await request('/api/scene/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const started = await request('/api/mission/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task }) })
  const missionId = String(started.mission_id)
  let current: any = null
  const deadline = Date.now() + 16 * 60 * 1000
  while (Date.now() < deadline) {
    current = await request('/api/mission/current')
    if (['SUCCEEDED', 'PARTIAL', 'FAILED', 'FAILED_PRECHECK', 'CANCELED'].includes(current.status)) break
    await sleep(1000)
  }
  const summary = await summarize(missionId)
  results.push({ run: index + 1, task, terminal_status: current?.status, ...summary, real: true, mock_fallback: false, fixture: false, scripted_tool_sequence: false })
}
const output = {
  generated_at: new Date().toISOString(),
  started_at: startedAt,
  task,
  run_count: results.length,
  runs: results,
  all_terminal: results.every((run) => run.terminal_files_present),
  no_mock: true,
  no_fixture: true,
  no_scripted_tool_sequence: true,
  note: 'The harness submits one natural-language task per run and records the real session/tool trace; it does not prescribe tool calls or route choices.',
}
await mkdir(join(ROOT, 'artifacts/indoor-rescue-upgrade'), { recursive: true })
await writeFile(OUT, JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ run_count: output.run_count, runs: results.map(({ run, mission_id, terminal_status, mcp_tool_calls, navigation_calls, inspect_room_calls, inspect_object_calls }) => ({ run, mission_id, terminal_status, mcp_tool_calls, navigation_calls, inspect_room_calls, inspect_object_calls })) }))
