import {createLoopbackWsProxy} from './websocket-proxy.mjs'
// Project-local launcher: official assets/auth/session unchanged; supported createServer BFF hook.
await import('/data-ssd/zhongchengkai/agnes/third_party/agnes-harness/node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/loader.mjs')
const {runWebCommand}=await import('/data-ssd/zhongchengkai/agnes/third_party/agnes-harness/packages/cli/launch/web-command.ts')
const {createWebServer}=await import('/data-ssd/zhongchengkai/agnes/third_party/agnes-harness/packages/web-server/src/server.ts')
const {handleDemoUi}=await import('../../demo/final-dashboard/demo-ui-server.mjs')
const {handleDemoRecording}=await import('../../demo/final-dashboard/demo-recording-server.mjs')
const {handleDemoVideoDelivery}=await import('../../demo/final-dashboard/demo-video-delivery.mjs')
const {handleAutonomousReplayDelivery}=await import('../../demo/final-dashboard/autonomous-replay-delivery.mjs')
const {handleProjectFilmDelivery}=await import('../../demo/final-dashboard/project-film-delivery.mjs')
const {handleFrozenMediaDelivery}=await import('../../demo/final-dashboard/frozen-media-delivery.mjs')
const {handleReplayReplacementDelivery}=await import('../../demo/final-dashboard/replay-replacement-delivery.mjs')
const {handlePolishedFilmDelivery}=await import('../../demo/final-dashboard/polished-film-delivery.mjs')
const {handleSubmissionDelivery}=await import('../../demo/final-dashboard/submission-delivery.mjs')
const {handleContinuousFilmDelivery}=await import('../../demo/final-dashboard/continuous-film-delivery.mjs')
const {handleFlowFilmDelivery}=await import('../../demo/final-dashboard/flow-film-delivery.mjs')
const {handleUniformFilmDelivery}=await import('../../demo/final-dashboard/uniform-film-delivery.mjs')
const {handleVoiceLibraryDelivery}=await import('../../demo/final-dashboard/voice-library-delivery.mjs')
const {handleMapCatalog}=await import('../../demo/final-dashboard/map-catalog.mjs')
const root='/data-ssd/zhongchengkai/agnes',local=root+'/third_party/agnes-harness/packages/cli/dist/local'
const resources={mode:'package',root:local,daemonEntry:root+'/scripts/agnes-proxy/daemon.mjs',workerEntry:root+'/scripts/agnes-proxy/worker.mjs',webRoot:local+'/web'}
const createServer=options=>createWebServer({...options,wsUrl:options.origin.replace(/^http/,'ws')+'/agh-rpc',
 handleUpgrade:createLoopbackWsProxy(options.origin,options.wsUrl),handleAdmin:async(req,res)=>{
 const url=new URL(req.url||'/',options.origin)
 if(handleSubmissionDelivery(req,res,url))return true
 if(handleContinuousFilmDelivery(req,res,url))return true
 if(handleFlowFilmDelivery(req,res,url))return true
 if(handleUniformFilmDelivery(req,res,url))return true
 if(handlePolishedFilmDelivery(req,res,url))return true
 if(handleReplayReplacementDelivery(req,res,url))return true
 if(handleAutonomousReplayDelivery(req,res,url))return true
 if(handleDemoVideoDelivery(req,res,url))return true
 if(handleFrozenMediaDelivery(req,res,url))return true
 if(handleProjectFilmDelivery(req,res,url))return true
 if(handleVoiceLibraryDelivery(req,res,url))return true
 if(handleDemoRecording(req,res,url,{origin:options.origin}))return true
 if(await handleMapCatalog(req,res,url,{origin:options.origin}))return true
 if(url.pathname==='/demo'){url.pathname='/';return handleDemoUi(req,res,url)}
 if(url.pathname.startsWith('/api/demo-ui/')||['/demo-ui.css','/demo-ui.js'].includes(url.pathname))return handleDemoUi(req,res,url)
 // Only the existing static-preview upload endpoint. Never proxy physical activation or mission commands.
 if(url.pathname==='/api/map/upload'&&req.method==='POST'){
  if(req.headers.origin!==options.origin||!['same-origin',undefined].includes(req.headers['sec-fetch-site'])){res.writeHead(403);res.end('same-origin required');return true}
  let size=0;const chunks=[]
  for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024){res.writeHead(413);res.end('upload too large');return true}chunks.push(chunk)}
  try{const upstream=await fetch('http://127.0.0.1:4188/api/map/upload',{method:'POST',headers:{'content-type':'application/json'},body:Buffer.concat(chunks),signal:AbortSignal.timeout(65000)});res.writeHead(upstream.status,{'content-type':'application/json','cache-control':'no-store'});res.end(Buffer.from(await upstream.arrayBuffer()))}catch{res.writeHead(503);res.end('preview backend unavailable')}
  return true
 }
 return options.handleAdmin?options.handleAdmin(req,res):false
}})
await runWebCommand(process.argv.slice(2),{env:process.env,cwd:process.cwd(),resources,createServer,signals:process})
