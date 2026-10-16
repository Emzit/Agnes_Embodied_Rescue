#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createClient, memoryJournal } from '../../third_party/agnes-harness/packages/sdk/src/index.node.ts';

const ROOT = '/data-ssd/zhongchengkai/agnes';
const OUT = `${ROOT}/artifacts/indoor-rescue-upgrade/provider-smoke.json`;
const startedAt = new Date().toISOString();
const trace = [];
const safeError = (error) => ({ name: error?.name, code: error?.code, message: String(error?.message ?? error), stack: String(error?.stack ?? '').split('\n').slice(0, 4) });
let client;
let session;
let iterator;
let reader;
let reason = null;
let promptResult = null;
let output = '';
const eventText = (data) => {
  if (typeof data === 'string') return data;
  if (typeof data?.text === 'string') return data.text;
  if (Array.isArray(data?.content)) return data.content.map((item) => typeof item?.text === 'string' ? item.text : '').join('');
  return '';
};
const record = (event) => {
  const data = event?.data ?? {};
  trace.push({
    seq: event?.seq,
    type: event?.type,
    ts: event?.ts,
    origin: event?.origin,
    data: {
      state: data.state,
      reason: data.reason,
      stopReason: data.stopReason,
      model: data.model,
      route: data.route,
      code: data.error?.code,
      message: data.error?.message,
      chars: data.chars,
      response: data.response ? { status: data.response.status, headerNames: data.response.headerNames } : undefined,
      text: event?.type === 'assistant/message' ? eventText(data) : undefined,
    },
  });
};
try {
  const owner = JSON.parse(await readFile(`${ROOT}/.agh-home-step7/data/daemon/owner.json`, 'utf8'));
  client = createClient({ transport: { kind: 'unix', path: owner.socketPath }, auth: { kind: 'local' }, journal: memoryJournal() });
  await client.initialize();
  const config = await client.config.get();
  session = await client.session.new({ cwd: ROOT, preset: 'standard', sessionKey: `provider-smoke-${Date.now()}` });
  await session.attach();
  iterator = session.events()[Symbol.asyncIterator]();
  reader = (async () => {
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      const event = next.value;
      record(event);
      if (event?.type === 'assistant/message') output += eventText(event.data);
    }
  })();
  promptResult = await session.prompt('只回复 OK。', { titleLocale: 'zh-CN' });
  reason = promptResult?.reason ?? null;
} catch (error) {
  reason = 'error';
  trace.push({ error: safeError(error) });
} finally {
  await iterator?.return?.().catch?.(() => {});
  await reader?.catch?.(() => {});
  await session?.close?.().catch?.(() => {});
  await client?.close?.().catch?.(() => {});
}
const finishedAt = new Date().toISOString();
const result = {
  generated_at: finishedAt,
  started_at: startedAt,
  finished_at: finishedAt,
  pass: reason === 'completed' && /\bOK\b/u.test(output),
  status: reason === 'completed' ? 'COMPLETED' : 'FAILED',
  reason,
  output,
  provider: { id: 'agnes-ai', model: 'agnes-3.0-flash', route: 'account-agnes-official', real: true },
  scope: 'real provider/session only; no Robot MCP attached by this smoke',
  session_id: session?.id ?? null,
  prompt: '只回复 OK。',
  trace,
  no_mock: true,
  no_fixture: true,
  no_scripted_tool_sequence: true,
};
await mkdir(`${ROOT}/artifacts/indoor-rescue-upgrade`, { recursive: true });
await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, status: result.status, reason: result.reason, output: result.output, session_id: result.session_id }));
if (!result.pass) process.exitCode = 1;
