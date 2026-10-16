import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { PiAdapter } from '../../third_party/agnes-harness/packages/ai/src/adapters/pi/index.ts'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const route = 'account-agnes-official'
const model = 'agnes-3.0-flash'
const secret = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/secrets/agnes-ai/account-9bc1eadcfe0010c0ef93cb9d-r1`, 'utf8')).value
const record: any = { id: model, name: 'Agnes 3.0 Flash', input: ['text', 'image'], reasoning: false, contextWindow: 200000, maxTokens: 65536, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { maxTokensField: 'max_tokens' } }
const decl: any = { route, api: 'openai-completions', baseUrl: 'https://api.agnes-ai.cn/v1', credentialRef: 'secret://agnes-ai/account-9bc1eadcfe0010c0ef93cb9d-r1', models: [record] }
const keys = ['provider-probe-standard', 'provider-smoke', 'interactive-provider-smoke', 'interactive-1791380043951', 'agnes:t:a:cli:dm:probe']
const run = async (prefix: string) => {
  const sessionKey = `${prefix}-${Date.now()}`
  const adapter = new PiAdapter({ manualRoutes: [decl], maxRetries: 0, sleep: async () => undefined })
  adapter.bindCredential(route, secret)
  const events: any[] = []
  for await (const event of adapter.stream(route, { route, model, sessionKey, system: 'Reply with OK.', messages: [{ role: 'user', content: [{ type: 'text', text: '只回复 OK。' }] }], tools: [] } as any, { signal: new AbortController().signal, toolNames: [], sessionKey, timeoutMs: { firstToken: 30000, total: 180000 } })) events.push({ type: event.type, code: event.code, message: event.message, text: event.delta })
  return { prefix, sessionKey, events, pass: events.some((event) => event.type === 'done') }
}
const results = []
for (const prefix of keys) results.push(await run(prefix))
const output = { generated_at: new Date().toISOString(), results, real: true, mock_fallback: false, fixture: false, scripted_tool_sequence: false }
await mkdir(`${ROOT}/artifacts/indoor-rescue-upgrade`, { recursive: true })
await writeFile(`${ROOT}/artifacts/indoor-rescue-upgrade/provider-session-key-probe.json`, JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify(output))
