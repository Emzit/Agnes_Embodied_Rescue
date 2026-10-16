import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
const ROOT='/data-ssd/zhongchengkai/agnes/artifacts/demo-video-20261013/final';
const FILES=new Map([
 ['/api/demo-ui/demo-video/final.mp4',['demo.mp4','video/mp4']],
 ['/api/demo-ui/demo-video/voice-sample.mp3',['voice-sample.mp3','audio/mpeg']],
 ['/api/demo-ui/demo-video/fire-music-sample.mp3',['fire-music-sample.mp3','audio/mpeg']],
 ['/api/demo-ui/demo-video/fire-music-only.mp3',['fire-music-only.mp3','audio/mpeg']],
 ['/api/demo-ui/demo-video/subtitles.srt',['demo.zh-CN.srt','application/x-subrip; charset=utf-8']],
 ['/api/demo-ui/demo-video/edit-manifest.json',['demo.edit-manifest.json','application/json; charset=utf-8']]
]);
export function handleDemoVideoDelivery(req,res,url){
 if(!['/demo-video','/demo-voice-sample','/demo-fire-music-sample'].includes(url.pathname)&&!FILES.has(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('GET required');return true;}
 if(url.pathname==='/demo-voice-sample'){
  const ready=fs.existsSync(path.join(ROOT,'voice-sample.mp3'));
  let info={duration_seconds:0,display_text:'',sha256:''};try{info=JSON.parse(fs.readFileSync(path.join(ROOT,'voice-sample.info.json'),'utf8'));}catch{}
  const safe=value=>String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const seconds=Number.isFinite(info.duration_seconds)?Math.round(info.duration_seconds):0;
  const version=/^[a-f0-9]{64}$/.test(info.sha256||'')?info.sha256:'current';
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>普通话配音样音</title><style>body{margin:0;padding:32px;background:#f3f5f8;color:#1c2838;font:17px system-ui,sans-serif}main{max-width:720px;margin:30px auto;padding:28px;background:white;border-radius:20px}audio{width:100%;margin:18px 0}p{line-height:1.8;color:#566477}a{color:#94502c}</style><main><h1>普通话配音样音 · 新声线</h1><p>约'+seconds+'秒。点击下方播放按钮，试听新的普通话样音。</p>'+
   (ready?'<audio controls preload="metadata" src="/api/demo-ui/demo-video/voice-sample.mp3?v='+version+'"></audio><p>'+safe(info.display_text)+'</p><p><a href="/api/demo-ui/demo-video/voice-sample.mp3?v='+version+'" download="普通话配音样音.mp3">下载样音</a></p>':'<p>样音尚未准备完成。</p>')+
   '<p><a href="/demo">返回实时演示</a> · <a href="/demo-video">返回视频页面</a></p></main>';
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 if(url.pathname==='/demo-fire-music-sample'){
  const ready=fs.existsSync(path.join(ROOT,'fire-music-sample.mp3')),onlyReady=fs.existsSync(path.join(ROOT,'fire-music-only.mp3'));
  let info={duration_seconds:0,description:'',sha256:''},onlyInfo={duration_seconds:0,sha256:''};
  try{info=JSON.parse(fs.readFileSync(path.join(ROOT,'fire-music-sample.info.json'),'utf8'));}catch{}
  try{onlyInfo=JSON.parse(fs.readFileSync(path.join(ROOT,'fire-music-only.info.json'),'utf8'));}catch{}
  const safe=value=>String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const version=value=>/^[a-f0-9]{64}$/.test(value||'')?value:'current';
  const mixedVersion=version(info.sha256),onlyVersion=version(onlyInfo.sha256||info.music_only_sha256);
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>火灾背景音乐试听</title><style>body{margin:0;padding:32px;background:#f3f5f8;color:#1c2838;font:17px system-ui,sans-serif}main{max-width:720px;margin:30px auto;padding:28px;background:white;border-radius:20px}audio{width:100%;margin:12px 0}h2{margin-top:28px;font-size:21px}p{line-height:1.8;color:#566477}a{color:#94502c}</style><main><h1>火灾背景音乐试听</h1><p>两段约20秒。先听背景音乐本身，再听它与现有普通话旁白搭配的效果。</p><h2>背景音乐单独试听</h2>'+
   (onlyReady?'<audio controls preload="metadata" src="/api/demo-ui/demo-video/fire-music-only.mp3?v='+onlyVersion+'"></audio><p><a href="/api/demo-ui/demo-video/fire-music-only.mp3?v='+onlyVersion+'" download="火灾背景音乐.mp3">下载背景音乐试听</a></p>':'<p>背景音乐试听正在准备。</p>')+
   '<h2>与现有旁白混合试听</h2>'+
   (ready?'<audio controls preload="metadata" src="/api/demo-ui/demo-video/fire-music-sample.mp3?v='+mixedVersion+'"></audio>'+(info.description?'<p>'+safe(info.description)+'</p>':'')+'<p><a href="/api/demo-ui/demo-video/fire-music-sample.mp3?v='+mixedVersion+'" download="火灾背景音乐与旁白试听.mp3">下载混合试听</a></p>':'<p>混合试听正在准备。</p>')+
   '<p><a href="/demo-video">返回视频页面</a> · <a href="/demo">返回实时演示</a></p></main>';
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 if(url.pathname==='/demo-video'){
  const ready=fs.existsSync(path.join(ROOT,'demo.mp4'))&&fs.existsSync(path.join(ROOT,'demo.edit-manifest.json'));
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agnes · 室内火灾人员搜寻演示</title><style>body{margin:0;padding:28px;background:#f3f5f8;color:#1c2838;font:16px system-ui,sans-serif}main{max-width:1280px;margin:auto}video{width:100%;max-height:76vh;background:#15202b;border-radius:16px}nav{display:flex;gap:20px;margin:18px 0}a{color:#94502c}p{color:#5c6876;line-height:1.7}</style><main><h1>Agnes · 室内火灾人员搜寻演示</h1>'+
   (ready?'<video controls preload="metadata" src="/api/demo-ui/demo-video/final.mp4"></video><nav><a href="/demo-voice-sample">试听普通话样音</a><a href="/api/demo-ui/demo-video/final.mp4" download="Agnes-室内火灾人员搜寻演示.mp4">下载 MP4</a><a href="/api/demo-ui/demo-video/subtitles.srt" download>中文字幕</a><a href="/api/demo-ui/demo-video/edit-manifest.json">剪辑与来源记录</a></nav><p>预设搜寻路线，由 Agnes Harness 实时执行。动作与观测以原始执行记录为准；等待加速或剪辑在视频中标明。</p>':'<p>正式录制和剪辑尚未完成。此页不会用技术测试视频代替实际演示。</p>')+'<a href="/demo">返回实时演示</a></main></html>';
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 const [name,type]=FILES.get(url.pathname),file=path.join(ROOT,name);
 if(!fs.existsSync(file)){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('正式成片尚未就绪');return true;}
 const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
 if(req.headers.range){
  const m=String(req.headers.range).match(/^bytes=(\d+)-(\d*)$/);
  if(!m){res.writeHead(416);res.end();return true;}
  start=Number(m[1]);end=m[2]?Math.min(end,Number(m[2])):end;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return true;}status=206;
 }
 res.writeHead(status,{'content-type':type,'content-length':end-start+1,'cache-control':'no-store','x-content-type-options':'nosniff','accept-ranges':'bytes',...(status===206?{'content-range':'bytes '+start+'-'+end+'/'+size}:{})});
 if(req.method==='HEAD'){res.end();return true;}
 void pipeline(fs.createReadStream(file,{start,end}),res).catch(()=>res.destroy());return true;
}
