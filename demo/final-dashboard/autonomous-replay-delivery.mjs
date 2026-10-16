import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
const ROOT='/data-ssd/zhongchengkai/agnes/artifacts/demo-video/autonomous-delivery-20261014';
const API='/api/demo-ui/action-replays';
const FILES=new Map([
 [API+'/initial.mp4',['initial-search.mp4','video/mp4']],
 [API+'/supplement.mp4',['supplement-open-approach.mp4','video/mp4']],
 [API+'/initial-poster.jpg',['initial-poster.jpg','image/jpeg']],
 [API+'/supplement-poster.jpg',['supplement-poster.jpg','image/jpeg']],
 [API+'/manifest.json',['manifest.json','application/json; charset=utf-8']]
]);
const PAGE='/demo-action-replays';
const safe=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function player(kind,info){
 const initial=kind==='initial',name=initial?'第一段 · 从起点搜寻到发现人员':'第二段 · 开门进入并接近人员';
 const text=initial?'机器人与房门已复位，在新会话中只发送「请找到一个待救援人员。」随后由 Agnes 自行搜寻。':'延续第一段的现场状态，按后续任务打开右前方门，进入房间、复核人员并正常停止。只展示相机与导航。';
 const entry=info?.videos?.find(v=>v.id===kind),ready=entry&&fs.existsSync(path.join(ROOT,initial?'initial-search.mp4':'supplement-open-approach.mp4'));
 const duration=entry?`${Math.floor(entry.duration_seconds/60)}:${String(Math.round(entry.duration_seconds%60)).padStart(2,'0')}`:'';
 return `<section><header><h2>${name}</h2><span>${duration}</span></header><p>${text}</p>${ready?`<video controls playsinline preload="metadata" poster="${API}/${kind}-poster.jpg" src="${API}/${kind}.mp4?v=${safe(entry.sha256)}"></video><nav><a href="${API}/${kind}.mp4?v=${safe(entry.sha256)}" download="${initial?'01-从起点到发现人员':'02-开门接近人员补录'}.mp4">下载 MP4</a><a href="${PAGE}/${kind}">单独观看</a></nav>`:'<p>视频正在导出。</p>'}</section>`;
}
export function handleAutonomousReplayDelivery(req,res,url){
 if(![PAGE,PAGE+'/initial',PAGE+'/supplement'].includes(url.pathname)&&!FILES.has(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('GET required');return true;}
 if(url.pathname.startsWith(PAGE)){
  let info;try{info=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));}catch{}
  const kinds=url.pathname.endsWith('/initial')?['initial']:url.pathname.endsWith('/supplement')?['supplement']:['initial','supplement'];
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>机器人行动回放 · 两段实录</title><style>*{box-sizing:border-box}body{margin:0;background:#F5F6F7;color:#1C1F23;font:16px system-ui,sans-serif}main{max-width:1600px;margin:auto;padding:28px}h1{font-size:28px;margin:0 0 8px}.intro{color:#697078;line-height:1.8}.videos{display:grid;grid-template-columns:repeat(${kinds.length},minmax(0,1fr));gap:22px;margin:24px 0}section{background:white;border:1px solid #E3E6E8;border-radius:22px;padding:22px;box-shadow:0 8px 24px #1c1f2308}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:20px;margin:0}header span{color:#74797F;white-space:nowrap}section p{min-height:52px;color:#697078;line-height:1.7;font-size:14px}video{display:block;width:100%;aspect-ratio:16/9;background:#1C1F23;border-radius:12px}nav{display:flex;gap:22px;margin-top:18px}a{color:#b84d18;text-decoration:none}a:hover{text-decoration:underline}.links{font-size:14px;display:flex;gap:24px}@media(max-width:900px){.videos{grid-template-columns:1fr}main{padding:16px}section p{min-height:0}}</style><main><h1>机器人行动回放</h1><p class="intro">两段独立实录，均已裁去底部空白并精简等待。第一段为自主搜寻，第二段为你要求的后续补录。</p><div class="videos">${kinds.map(k=>player(k,info)).join('')}</div><div class="links"><a href="${PAGE}">查看两段视频</a><a href="${API}/manifest.json">录像与剪辑记录</a><a href="/demo">返回实时画面</a></div></main><script>const videos=[...document.querySelectorAll('video')];for(const v of videos)v.addEventListener('play',()=>videos.forEach(other=>{if(other!==v)other.pause()}));</script></html>`;
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 const [name,type]=FILES.get(url.pathname),file=path.join(ROOT,name);
 if(!fs.existsSync(file)){res.writeHead(404);res.end('Video not ready');return true;}
 const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
 if(req.headers.range){
  const match=String(req.headers.range).match(/^bytes=(\d+)-(\d*)$/);
  if(!match){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return true;}
  start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return true;}status=206;
 }
 res.writeHead(status,{'content-type':type,'content-length':end-start+1,'cache-control':'no-store','accept-ranges':'bytes','x-content-type-options':'nosniff',...(status===206?{'content-range':`bytes ${start}-${end}/${size}`}:{})});
 if(req.method==='HEAD'){res.end();return true;}
 void pipeline(fs.createReadStream(file,{start,end}),res).catch(()=>res.destroy());return true;
}
