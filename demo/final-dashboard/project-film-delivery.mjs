import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
const ROOT='/data-ssd/zhongchengkai/agnes/artifacts/demo-project-film-20261014/final';
const FILES=new Map([
 ['/api/demo-ui/project-film/final.mp4',['project-film.mp4','video/mp4']],
 ['/api/demo-ui/project-film/subtitles.srt',['project-film.zh-CN.srt','application/x-subrip; charset=utf-8']],
 ['/api/demo-ui/project-film/manifest.json',['project-film.edit-manifest.json','application/json; charset=utf-8']],
 ['/api/demo-ui/project-film/video-bundle.zip',['project-videos-20261015.zip','application/zip']],
 ['/api/demo-ui/project-film/video-bundle-manifest.json',['video-bundle.manifest.json','application/json; charset=utf-8']]
]);
export function handleProjectFilmDelivery(req,res,url){
 if(url.pathname!=='/demo-project-film'&&!FILES.has(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'allow':'GET, HEAD'});res.end('GET required');return true;}
 if(url.pathname==='/demo-project-film'){
  const ready=['project-film.mp4','project-film.zh-CN.srt','project-film.edit-manifest.json'].every(name=>fs.existsSync(path.join(ROOT,name)));
  const bundled=fs.existsSync(path.join(ROOT,'project-videos-20261015.zip'));
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>具身救援 · 从指令到行动</title><style>body{margin:0;padding:28px;background:#f3f5f8;color:#1c2838;font:16px system-ui,sans-serif}main{max-width:1280px;margin:auto}video{width:100%;max-height:76vh;background:#15202b;border-radius:16px}nav{display:flex;flex-wrap:wrap;gap:20px;margin:18px 0}a{color:#94502c}p{color:#5c6876;line-height:1.7}</style><main><h1>具身救援 · 从指令到行动</h1>'+
   (ready?'<video controls preload="metadata" src="/api/demo-ui/project-film/final.mp4"></video><nav><a href="/api/demo-ui/project-film/final.mp4" download="具身救援-从指令到行动.mp4">下载 MP4</a><a href="/api/demo-ui/project-film/subtitles.srt" download="具身救援-从指令到行动.zh-CN.srt">中文字幕</a><a href="/api/demo-ui/project-film/manifest.json">影片与来源记录</a></nav>':'<p>新版项目展示影片正在制作。</p>')+
   (bundled?'<nav><a href="/api/demo-ui/project-film/video-bundle.zip" download="具身救援-三段视频合集-20261015.zip">下载三段视频 ZIP（约54 MB）</a></nav>':'')+
   '<nav><a href="/demo-action-replays">查看两段机器人实录</a><a href="/demo">返回实时演示</a></nav></main></html>';
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 const [name,type]=FILES.get(url.pathname),file=path.join(ROOT,name);
 if(!fs.existsSync(file)){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('影片尚未准备完成');return true;}
 const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
 if(req.headers.range){
  const m=String(req.headers.range).match(/^bytes=(\d+)-(\d*)$/);
  if(!m){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return true;}
  start=Number(m[1]);end=m[2]?Math.min(end,Number(m[2])):end;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return true;}status=206;
 }
 res.writeHead(status,{...(type==='application/zip'?{'content-disposition':"attachment; filename=project-videos-20261015.zip; filename*=UTF-8''"+encodeURIComponent('具身救援-三段视频合集-20261015.zip')}:{}) ,'content-type':type,'content-length':end-start+1,'cache-control':'no-store','x-content-type-options':'nosniff','accept-ranges':'bytes',...(status===206?{'content-range':'bytes '+start+'-'+end+'/'+size}:{})});
 if(req.method==='HEAD'){res.end();return true;}
 void pipeline(fs.createReadStream(file,{start,end}),res).catch(()=>res.destroy());return true;
}
