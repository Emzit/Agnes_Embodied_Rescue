import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
const ROOT='/data-ssd/zhongchengkai/agnes/artifacts/demo-project-film-20261015/flow-refinement-v15';
const API='/api/demo-ui/film-flow';
const FILES=new Map([
 [API+'/film.mp4',['project-film-flow-v15.mp4','video/mp4']],
 [API+'/film.srt',['project-film-flow-v15.zh-CN.srt','application/x-subrip; charset=utf-8']],
 [API+'/manifest.json',['project-film-flow-v15.edit-manifest.json','application/json; charset=utf-8']],
 [API+'/qa.json',['validation.json','application/json; charset=utf-8']],
 [API+'/film-poster.jpg',['film-poster.jpg','image/jpeg']],
 [API+'/audio-validation.json',['audio-validation.json','application/json; charset=utf-8']]
]);
const PAGE='/demo-project-film-flow',MERGED='/demo-project-film-flow';
const safe=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function handleFlowFilmDelivery(req,res,url){
 if(![PAGE,MERGED].includes(url.pathname)&&!FILES.has(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('GET required');return true;}
 const merged=false;
 if([PAGE,MERGED].includes(url.pathname)){
  let info,valid;try{info=JSON.parse(fs.readFileSync(path.join(ROOT,merged?'merged-robot-actions.manifest.json':'project-film-flow-v15.edit-manifest.json'),'utf8'));valid=merged?info.full_decode_passed:JSON.parse(fs.readFileSync(path.join(ROOT,'validation.json'),'utf8')).passed;}catch{}
  if(!valid){res.writeHead(503,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('视频正在完成核对。');return true;}
  const kind=merged?'merged':'film',title=merged?'机器人完整行动回放':'具身救援 · 从指令到行动',desc=merged?'从出生点搜寻到发现人员，再继续开门、进入房间并接近人员。两段真实录像按顺序无损合并。':'已缩短人员复核后的等待，更新演示说明，并收紧 AGH 与视觉子会话之间的衔接。继续使用 9 号声音与统一慢速旁白。';
  const totalSeconds=Math.round(info.duration_seconds),durationLabel=`${Math.floor(totalSeconds/60)}:${String(totalSeconds%60).padStart(2,'0')}`;
  const starts=Object.fromEntries(info.clips.map(c=>[c.id,c.start]));
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}${merged?'':' · 节奏调整版'}</title><style>*{box-sizing:border-box}body{margin:0;background:#F5F6F7;color:#1C1F23;font:16px system-ui,sans-serif}main{max-width:${merged?1480:1190}px;margin:auto;padding:20px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h1{font-size:24px;margin:0}p{color:#74797F;font-size:14px;line-height:1.7}section{background:white;padding:12px;border:1px solid #E0E4E6;border-radius:20px;box-shadow:0 10px 30px #1C1F2308}video{display:block;width:100%;max-height:76vh;aspect-ratio:${merged?'16/9':'1438/1080'};background:#F5F6F7;border-radius:12px}nav{display:flex;flex-wrap:wrap;gap:22px;margin:18px 0;font-size:14px}a{color:#B84D18;text-decoration:none}a:hover{text-decoration:underline}.badge{border:1px solid #DBDFE3;border-radius:99px;padding:8px 14px;color:#74797F;font-size:13px;white-space:nowrap}.chapters{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.chapters button{background:#fff;border:1px solid #F4772D55;border-radius:999px;padding:8px 14px;color:#B84D18;cursor:pointer}.chapters button:hover{background:#FFF3EB}@media(max-width:700px){main{padding:12px}h1{font-size:20px}}</style><main><header><h1>${title}</h1><span class="badge">${merged?'完整实录 · 4:33':`节奏调整版 · ${durationLabel}`}</span></header><p>${desc}</p><section><video controls playsinline preload="metadata" poster="${API}/${kind}-poster.jpg" src="${API}/${kind}.mp4?v=${safe(info.sha256)}"></video></section><div class="chapters"><button data-seek="0">从头播放</button><button data-seek="${starts.start_scan}">修改后的文案</button><button data-seek="${starts.vision+3.3}">AGH 视觉旁白衔接</button><button data-seek="${starts.entry}">开门与人员复核</button><button data-seek="${starts.finish-1.6}">结尾衔接</button></div><nav><a href="${API}/${kind}.mp4?download=1&v=${safe(info.sha256)}">下载本视频</a><a href="/demo-project-film-uniform">查看上一版</a><a href="/demo-action-replays/merged">原合并实录</a><a href="/demo-alpha">查看冻结的阿尔法</a><a href="/demo-action-replays">查看原两段录像</a>${merged?'':`<a href="${API}/film.srt" download="具身救援-节奏调整版.zh-CN.srt">同步字幕</a>`}</nav></main><script>const video=document.querySelector("video");for(const button of document.querySelectorAll("[data-seek]"))button.addEventListener("click",()=>{video.currentTime=Number(button.dataset.seek);video.play().catch(()=>{});});</script></html>`;
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
 const download=url.searchParams.get('download')==='1'&&type==='video/mp4';
 res.writeHead(status,{'content-type':type,'content-length':end-start+1,'cache-control':'no-store','accept-ranges':'bytes','x-content-type-options':'nosniff',...(download?{'content-disposition':`attachment; filename="${url.pathname.endsWith('/merged.mp4')?'merged-robot-actions':'project-film-flow-v15'}.mp4"`}:{}),...(status===206?{'content-range':`bytes ${start}-${end}/${size}`}:{})});
 if(req.method==='HEAD'){res.end();return true;}
 void pipeline(fs.createReadStream(file,{start,end}),res).catch(()=>res.destroy());return true;
}
