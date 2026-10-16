// Protocol-only test double; contains no planning or robot logic.
import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try { request = JSON.parse(line); } catch {
    console.log(JSON.stringify({ id: null, ok: false, error: { code: 'MALFORMED_REQUEST' } }));
    continue;
  }
  if (request.method === 'silent') continue;
  if (request.method === 'wrong_id') {
    console.log(JSON.stringify({ id: 'not-the-request', ok: true, result: {} }));
    continue;
  }
  if (request.method === 'malformed_output') { console.log('not json'); continue; }
  setTimeout(() => console.log(JSON.stringify({ id: request.id, ok: true, result: request.params })),
             request.params.delay ?? 0);
}
