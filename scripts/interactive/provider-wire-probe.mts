import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { PiAdapter, toPiModel } from '../../third_party/agnes-harness/packages/ai/src/adapters/pi/index.ts'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = `${ROOT}/artifacts/indoor-rescue-upgrade/provider-wire-probe.json`
const route = 'account-agnes-official'
const modelId = 'agnes-3.0-flash'
const credential = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/secrets/agnes-ai/account-9bc1eadcfe0010c0ef93cb9d-r1`, 'utf8')).value
const record: any = {
  id: modelId,
  name: 'Agnes 3.0 Flash',
  input: ['text', 'image'],
  reasoning: false,
  contextWindow: 200000,
  maxTokens: 65536,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  samplingParams: { temperature: { min: 0, max: 2, step: 0.01 }, top_p: { min: 0, max: 1, step: 0.01 } },
  compat: { maxTokensField: 'max_tokens' },
}
const decl: any = {
  route,
  api: 'openai-completions',
  baseUrl: 'https://api.agnes-ai.cn/v1',
  credentialRef: 'secret://agnes-ai/account-9bc1eadcfe0010c0ef93cb9d-r1',
  models: [record],
}
const adapter = new PiAdapter({ manualRoutes: [decl], maxRetries: 0, sleep: async () => undefined })
adapter.bindCredential(route, credential)
const events: any[] = []
const request: any = {
  route,
  model: modelId,
  sessionKey: `wire-probe-${Date.now()}`,
  messages: [{ role: 'user', content: [{ type: 'text', text: '只回复 OK。' }] }],
  tools: [],
}
for await (const event of adapter.stream(route, request, {
  signal: new AbortController().signal,
  toolNames: [],
  sessionKey: request.sessionKey,
  timeoutMs: { firstToken: 30000, total: 180000 },
})) {
  events.push({ type: event.type, reason: event.reason, code: event.code, message: event.message, response: event.response, text: event.delta })
}
const result = {
  generated_at: new Date().toISOString(),
  route,
  model: modelId,
  request: { message_count: request.messages.length, tool_count: request.tools.length, session_key: request.sessionKey },
  events,
  pass: events.some((event) => event.type === 'done'),
  real: true,
  mock_fallback: false,
  fixture: false,
  scripted_tool_sequence: false,
}
await mkdir(`${ROOT}/artifacts/indoor-rescue-upgrade`, { recursive: true })
await writeFile(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ pass: result.pass, events: result.events.map((event) => ({ type: event.type, code: event.code, message: event.message })) }))
