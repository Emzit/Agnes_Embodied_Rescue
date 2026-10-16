import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createClient, memoryJournal } from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts'
import { PiAdapter } from '../../third_party/agnes-harness/packages/ai/src/adapters/pi/index.ts'
import { mcpLocalToolPrefix } from '../../third_party/agnes-harness/packages/base/src/mcp/naming.ts'
import { TOOLS_CORE } from '../../third_party/agnes-harness/packages/base/extensions/tools-core/src/index.ts'
import { TOOLS_SEARCH } from '../../third_party/agnes-harness/packages/base/extensions/tools-search/src/index.ts'
import { compactTool } from '../../third_party/agnes-harness/packages/base/extensions/compaction/src/tool.ts'
import { subagentForkTool } from '../../third_party/agnes-harness/packages/base/extensions/subagent/src/tools.ts'
import { createRunCodeTool } from '../../third_party/agnes-harness/packages/code/src/extensions/code-mode/run-code.ts'
import { toolSearchTool, toolDescribeTool } from '../../third_party/agnes-harness/packages/base/extensions/mcp-search/src/search-tools.ts'
import { toolSchemaHash } from '../../third_party/agnes-harness/packages/ai/src/stamp.ts'

const ROOT = '/data-ssd/zhongchengkai/agnes'
const OUT = `${ROOT}/artifacts/indoor-rescue-upgrade/provider-mcp-tool-probe.json`
const route = 'account-agnes-official'
const modelId = 'agnes-3.0-flash'
const secret = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/secrets/agnes-ai/account-9bc1eadcfe0010c0ef93cb9d-r1`, 'utf8')).value
const record: any = { id: modelId, name: 'Agnes 3.0 Flash', input: ['text', 'image'], reasoning: false, contextWindow: 200000, maxTokens: 65536, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { maxTokensField: 'max_tokens' } }
const decl: any = { route, api: 'openai-completions', baseUrl: 'https://api.agnes-ai.cn/v1', credentialRef: 'secret://agnes-ai/account-9bc1eadcfe0010c0ef93cb9d-r1', models: [record] }
const pluginDefinitions: any[] = []
const plugin = await import(`${ROOT}/.agh-home-step7/data/profiles/local-dev/packages/embodied-rescue-plugin/index.mjs`)
plugin.embodiedRescuePlugin.apply({ extension: () => ({ registerTool: (definition: any) => { pluginDefinitions.push(definition); return () => undefined } }) })
const bundledDefinitions: any[] = []
for (const [path, exportName] of [
  [`${ROOT}/.agh-home-step7/data/profiles/local-dev/packages/@agnes__mcp-helper/index.mjs`, 'mcpHelper'],
  [`${ROOT}/.agh-home-step7/data/profiles/local-dev/packages/@agnes__plugin-helper/index.mjs`, 'pluginHelper'],
  [`${ROOT}/.agh-home-step7/data/profiles/local-dev/packages/@agnes__skill-helper/index.mjs`, 'skillHelper'],
] as const) {
  const loaded = await import(path)
  loaded[exportName].apply({ extension: () => ({ registerTool: (definition: any) => { bundledDefinitions.push(definition); return () => undefined } }) })
}
const normalizeDefinitions = (definitions: any[]) => definitions.map((definition) => ({ name: definition.name, description: definition.description, parameters: JSON.parse(JSON.stringify(definition.parameters)) }))
const pluginTools = normalizeDefinitions(pluginDefinitions)
const bundledTools = normalizeDefinitions(bundledDefinitions)
const baseTools = normalizeDefinitions([...TOOLS_CORE, ...TOOLS_SEARCH, compactTool, subagentForkTool, createRunCodeTool({ acquire: async () => { throw new Error('probe') }, bridge: () => ({}), limits: () => ({ wallMs: 1, maxOutputChars: 1 }) }), toolSearchTool({ search: () => [], get: () => undefined } as any), toolDescribeTool({ get: () => undefined } as any)])
const run = async (label: string, tools: any[], system = '') => {
  const adapter = new PiAdapter({ manualRoutes: [decl], maxRetries: 0, sleep: async () => undefined })
  adapter.bindCredential(route, secret)
  const events: any[] = []
  const request: any = { route, model: modelId, sessionKey: `mcp-tool-probe-${label}-${Date.now()}`, system, messages: [{ role: 'user', content: [{ type: 'text', text: '只回复 OK。' }] }], tools }
  for await (const event of adapter.stream(route, request, { signal: new AbortController().signal, toolNames: tools.map((tool) => tool.name), sessionKey: request.sessionKey, timeoutMs: { firstToken: 30000, total: 180000 } })) events.push({ type: event.type, code: event.code, message: event.message, response: event.response, text: event.delta })
  return { label, tool_count: tools.length, system_bytes: Buffer.byteLength(system), tool_schema_hash: toolSchemaHash(tools), names: tools.map((tool) => tool.name), events, pass: events.some((event) => event.type === 'done') }
}

const owner = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/data/daemon/owner.json`, 'utf8'))
const client = createClient({ transport: { kind: 'unix', path: owner.socketPath }, auth: { kind: 'local' }, journal: memoryJournal() })
let result: any
try {
  await client.initialize()
  const robot = await client.mcp.servers.tools.list({ profile: 'local-dev', serverId: 'robot-mcp' })
  const env = await client.mcp.servers.tools.list({ profile: 'local-dev', serverId: 'envdoor' })
  const convert = (serverId: string, items: any[]) => items.map((item) => ({ name: `${mcpLocalToolPrefix(serverId)}${item.name}`, description: item.description || item.name, parameters: item.inputSchema || { type: 'object', properties: {} } }))
  const robotTools = convert('robot-mcp', robot.items)
  const envTools = convert('envdoor', env.items)
  const singleRobot = []
  for (const tool of robotTools) singleRobot.push(await run(`single-${tool.name}`, [tool]))
  const representativeSystem = `${pluginDefinitions.map((d) => d.description).join('\n')}\n${'Observed-context '.repeat(4000)}`
  result = { generated_at: new Date().toISOString(), daemon_generation: owner.generation, robot_tool_count: robotTools.length, environment_tool_count: envTools.length, plugin_tool_count: pluginTools.length, bundled_tool_count: bundledTools.length, base_tool_count: baseTools.length, remote_catalog: { robot: robot.items, environment: env.items }, probes: [...singleRobot, await run('robot-only', robotTools), await run('robot-env', [...robotTools, ...envTools]), await run('plugin-only', pluginTools), await run('plugin-robot-env', [...pluginTools, ...robotTools, ...envTools]), await run('plugin-robot-env-system', [...pluginTools, ...robotTools, ...envTools], representativeSystem), await run('all-project-tools', [...bundledTools, ...pluginTools, ...robotTools, ...envTools]), await run('all-known-tools', [...baseTools, ...bundledTools, ...pluginTools, ...robotTools, ...envTools]), await run('all-known-tools-system', [...baseTools, ...bundledTools, ...pluginTools, ...robotTools, ...envTools], representativeSystem)], real: true, mock_fallback: false, fixture: false, scripted_tool_sequence: false }
} finally { await client.close?.().catch?.(() => undefined) }
await mkdir(`${ROOT}/artifacts/indoor-rescue-upgrade`, { recursive: true })
await writeFile(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ probes: result.probes.map((probe: any) => ({ label: probe.label, tool_count: probe.tool_count, pass: probe.pass, events: probe.events.map((event: any) => ({ type: event.type, code: event.code, message: event.message })) })) }))
