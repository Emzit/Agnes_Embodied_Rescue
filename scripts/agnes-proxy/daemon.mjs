// Project-local daemon entry. The packaged supervisor is reused; only worker bootstrap is overlaid.
await import('/data-ssd/zhongchengkai/agnes/third_party/agnes-harness/node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/loader.mjs')
const { runAgnesd } = await import('/data-ssd/zhongchengkai/agnes/third_party/agnes-harness/packages/daemon/src/supervisor/supervisor.ts')
const argv = process.argv.slice(2)
const next = (i, flag) => { const v=argv[i+1]; if (!v) throw new Error(`${flag} needs a value`); return v }
const args = { profile: 'local-dev' }
let localWeb
for (let i=0;i<argv.length;i++) {
  const v=argv[i]
  if (v==='--profile') args.profile=next(i++,v)
  else if (v==='--workspace') args.workspace=next(i++,v)
  else if (v==='--data-dir') args.dataDir=next(i++,v)
  else if (v==='--home') args.home=next(i++,v)
  else if (v==='--local-web-addr') { localWeb={addr:next(i++,v),origin:localWeb?.origin??''} }
  else if (v==='--local-web-origin') { localWeb={addr:localWeb?.addr??'127.0.0.1:0',origin:next(i++,v)} }
}
if (args.home) process.env.AGH_HOME=args.home
await runAgnesd(args, {
  workerEntry: '/data-ssd/zhongchengkai/agnes/scripts/agnes-proxy/worker.mjs',
  ...(localWeb ? {localWeb} : {}),
})
