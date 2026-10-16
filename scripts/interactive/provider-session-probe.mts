import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createClient, memoryJournal } from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = `${ROOT}/artifacts/indoor-rescue-upgrade/provider-session-probe.json`
const probeCount = Math.max(1, Math.min(5, Number(process.env.PROVIDER_SHORT_SMOKES || 2)))
const textOf = (data: any): string =>
  typeof data === 'string'
    ? data
    : typeof data?.text === 'string'
      ? data.text
      : Array.isArray(data?.content)
        ? data.content.map(textOf).join('')
        : ''

const probe = async (client: any, label: string, options: Record<string, unknown>) => {
  const session = await client.session.new({ cwd: ROOT, ...options, sessionKey: `provider-probe-${label}-${Date.now()}` })
  const events: any[] = []
  const output: string[] = []
  const iterator = session.events()[Symbol.asyncIterator]()
  const reader = (async () => {
    for (;;) {
      const next = await iterator.next()
      if (next.done) return
      const event = next.value
      events.push({
        seq: event?.seq,
        type: event?.type,
        data: {
          reason: event?.data?.reason,
          code: event?.data?.code || event?.data?.error?.code,
          message: event?.data?.message || event?.data?.error?.message,
          response: event?.data?.response,
          model: event?.data?.model,
          route: event?.data?.route,
          text: event?.type === 'assistant/message' ? textOf(event.data) : undefined,
        },
      })
      if (event?.type === 'assistant/message') output.push(textOf(event.data))
    }
  })()
  let response: any = null
  let error: any = null
  try {
    response = await session.prompt('只回复 OK。', { signal: AbortSignal.timeout(180000), titleLocale: 'zh-CN' })
  } catch (caught: any) {
    error = { code: caught?.code, message: String(caught?.message ?? caught) }
  }
  await iterator.return?.().catch?.(() => undefined)
  await reader.catch(() => undefined)
  await session.close?.().catch?.(() => undefined)
  return { label, options, session_id: session.id, response_reason: response?.reason, output: output.join(''), error, events }
}

const owner = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/data/daemon/owner.json`, 'utf8'))
const client = createClient({ transport: { kind: 'unix', path: owner.socketPath }, auth: { kind: 'local' }, journal: memoryJournal() })
const startedAt = new Date().toISOString()
let result: any
try {
  await client.initialize()
  const config = await client.config.get()
  const probes = []
  for (let index = 0; index < probeCount; index += 1) {
    probes.push(await probe(client, `standard-${index + 1}`, { preset: 'standard' }))
  }
  result = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    daemon_generation: owner.generation,
    socket: owner.socketPath,
    provider: { id: config.provider?.id, model: config.provider?.model, route: config.provider?.route },
    requested_probe_count: probeCount,
    probes,
    real: true,
    mock_fallback: false,
    fixture: false,
    scripted_tool_sequence: false,
  }
} finally {
  await client.close?.().catch?.(() => undefined)
}
await mkdir(`${ROOT}/artifacts/indoor-rescue-upgrade`, { recursive: true })
await writeFile(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ probes: result?.probes?.map((p: any) => ({ label: p.label, response_reason: p.response_reason, error: p.error })) }))
