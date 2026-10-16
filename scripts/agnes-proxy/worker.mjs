// Project-local runtime adapter. It leaves the packaged worker unchanged and
// installs the same environment proxy dispatcher used by the direct adapter
// before the packaged worker creates any provider request.  NODE_USE_ENV_PROXY
// is not sufficient for every bundled fetch/undici combination, so this is an
// explicit process-local dispatcher; NO_PROXY still governs loopback traffic.
import { EnvHttpProxyAgent, setGlobalDispatcher } from '/data-ssd/zhongchengkai/agnes/third_party/agnes-harness/node_modules/.pnpm/undici@8.10.2/node_modules/undici/index.js'

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent())
}
await import('/data-ssd/zhongchengkai/agnes/third_party/agnes-harness/node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/loader.mjs')
await import('/data-ssd/zhongchengkai/agnes/third_party/agnes-harness/packages/cli/dist/local/worker.mjs')
