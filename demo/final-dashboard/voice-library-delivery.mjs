import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';

const ROOT='/data-ssd/zhongchengkai/agnes/artifacts/demo-project-film-20261014/voice-library-v1';
const IDS=Array.from({length:10},(_,i)=>String(i+1).padStart(2,'0'));
const FILES=new Map(IDS.map(id=>['/api/demo-ui/voice-library/voice-'+id+'.mp3', ['voice-'+id+'.mp3','audio/mpeg',id]]));
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const asText=value=>typeof value==='string'?value:'';
const externalLink=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}};

function library(){
 let data={};try{data=JSON.parse(fs.readFileSync(path.join(ROOT,'index.json'),'utf8'));}catch{}
 const rows=Array.isArray(data.voices)?data.voices:[];
 const ready=IDS.flatMap(id=>{
  const row=rows.find(v=>String(v?.id)===id),fileName='voice-'+id+'.mp3';
  if(!row||row.file!==fileName||!Number.isFinite(row.duration_seconds)||row.duration_seconds<=0||!String(row.sha256||'').match(/^[a-f0-9]{64}$/))return [];
  const file=path.join(ROOT,fileName);
  let stat;try{stat=fs.lstatSync(file);}catch{return [];}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0)return [];
  const sha=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(sha!==row.sha256)return [];
  return [{id,name:asText(row.name)||'声线 '+id,description:asText(row.description),
   file:fileName,url:'/api/demo-ui/voice-library/'+fileName+'?v='+sha,duration_seconds:row.duration_seconds,sha256:sha,
   model:asText(row.model)||asText(data.model),license:asText(row.license)||asText(data.license),
   language:asText(row.language)||asText(data.language)||'普通话',
   source_url:externalLink(row.source_url||data.source_url),provenance_file:asText(row.provenance_file)}];
 });
 return {version:data.version||1,ready_count:ready.length,sample_text:asText(data.sample_text),kind:'通用生成成年女性普通话声线',voices:ready};
}
function page(info){
 const cards=IDS.map(id=>{
  const v=info.voices.find(v=>v.id===id);
  if(!v)return '<article class="card pending"><span class="number">'+id+'</span><h2>声线 '+id+'</h2><p>样音正在准备。</p></article>';
  const source=v.source_url?'<a href="'+escape(v.source_url)+'" target="_blank" rel="noopener noreferrer">官方来源</a>':'';
  return '<article class="card"><span class="number">'+id+'</span><h2>'+escape(v.name)+'</h2><p class="description">'+escape(v.description)+'</p><audio controls preload="metadata" aria-label="'+escape('试听声线 '+id+' '+v.name)+'" src="'+escape(v.url)+'"></audio><div class="meta"><span>'+Math.round(v.duration_seconds)+' 秒 · 普通话</span><a href="'+escape(v.url)+'" download="EmberScout-普通话女声-'+id+'.mp3">下载样音</a></div><details><summary>声音来源</summary><p>本地生成的通用成年女性声线，不对应真人或真人克隆。</p><p>'+escape(v.model)+' · '+escape(v.license)+'</p>'+source+'</details></article>';
 }).join('');
 return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EmberScout · 普通话女声试听</title><style>'+
 ':root{color-scheme:light;--bg:#F5F6F7;--ink:#1C1F23;--orange:#F4772D;--muted:#73777E}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px Inter,"Noto Sans CJK SC","Source Han Sans SC",system-ui,sans-serif}main{max-width:1200px;margin:0 auto;padding:48px 28px}header{max-width:850px;margin-bottom:32px}.eyebrow{font-size:14px;letter-spacing:.04em;color:var(--orange);font-weight:600}h1{font-size:clamp(27px,4vw,40px);font-weight:600;line-height:1.3;margin:16px 0}p{color:var(--muted);line-height:1.8;margin:12px 0}.sample{background:#fff;border-radius:20px;padding:20px 24px;border:1px solid #E7E8EA;font-size:17px;margin-top:22px;color:var(--ink)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.card{position:relative;background:#fff;border-radius:24px;padding:26px 28px;box-shadow:0 8px 24px #1C1F2307;border:1px solid #ECEDEF;min-width:0}.number{display:inline-flex;width:38px;height:38px;align-items:center;justify-content:center;border-radius:12px;background:#FFF2E9;color:var(--orange);font-weight:600}h2{font-size:23px;margin:14px 0 6px;font-weight:600}.description{min-height:58px;margin:6px 0 14px}audio{display:block;width:100%;height:42px;margin:18px 0}.meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:14px;color:var(--muted)}a{color:#BC541D;text-decoration:none}a:hover{text-decoration:underline}details{margin-top:18px;padding-top:16px;border-top:1px solid #F0F1F2;color:var(--muted);font-size:13px}summary{cursor:pointer}details p{margin:7px 0}.pending{opacity:.65}nav{display:flex;flex-wrap:wrap;gap:24px;margin:36px 0 8px;font-size:15px}@media(max-width:740px){main{padding:32px 18px}.grid{grid-template-columns:1fr}.card{padding:23px}.description{min-height:0}}</style></head><body><main><header><span class="eyebrow">焰境智巡 · EmberScout</span><h1>选择你的普通话旁白</h1><p>10 种通用成年女性声线。每段使用同一段文字，方便比较音色、清晰度和讲述节奏。选好后告诉我声线编号。</p>'+
 (info.sample_text?'<div class="sample">'+escape(info.sample_text)+'</div>':'')+
 '<p>这些是开源语音模型生成的声线，不是 10 位官方预设说话人，也不对应真人。</p></header><section class="grid" aria-label="普通话女声样音">'+cards+'</section><nav><a href="/demo-project-film">返回项目展示影片</a><a href="/demo">返回实时演示</a></nav></main><script>document.addEventListener("play",event=>{if(event.target.tagName!=="AUDIO")return;document.querySelectorAll("audio").forEach(other=>{if(other!==event.target)other.pause()})},true)</script></body></html>';
}
function sendFile(req,res,file,type){
 const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
 if(req.headers.range){
  const m=String(req.headers.range).match(/^bytes=(\d*)-(\d*)$/);
  if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return;}
  if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
  else{const count=Number(m[2]);if(!Number.isSafeInteger(count)||count<=0){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return;}start=Math.max(0,size-count);}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return;}status=206;
 }
 res.writeHead(status,{'content-type':type,'content-length':end-start+1,'cache-control':'no-store','x-content-type-options':'nosniff','accept-ranges':'bytes',...(status===206?{'content-range':'bytes '+start+'-'+end+'/'+size}:{})});
 if(req.method==='HEAD'){res.end();return;}void pipeline(fs.createReadStream(file,{start,end}),res).catch(()=>res.destroy());
}
export function handleVoiceLibraryDelivery(req,res,url){
 if(!['/demo-voice-library','/api/demo-ui/voice-library/index.json'].includes(url.pathname)&&!FILES.has(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'allow':'GET, HEAD'});res.end('GET required');return true;}
 const info=library();
 if(url.pathname==='/demo-voice-library'){
  const html=page(info);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 if(url.pathname==='/api/demo-ui/voice-library/index.json'){
  res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:JSON.stringify(info));return true;
 }
 const [name,type,id]=FILES.get(url.pathname),row=info.voices.find(v=>v.id===id);
 if(!row){res.writeHead(404,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('该样音尚未准备完成');return true;}
 sendFile(req,res,path.join(ROOT,name),type);return true;
}
