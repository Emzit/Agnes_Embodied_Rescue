import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline}from'node:stream/promises';
const ROOT='/data-ssd/zhongchengkai/agnes/artifacts/media-archive/alpha';
// User-frozen identity. This hash and the alpha archive must never track "latest".
const HASH='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e';
const API='/api/demo-ui/frozen-media';
const files=new Map([[API+'/alpha.mp4',['alpha.mp4','video/mp4']],[API+'/alpha.srt',['alpha.zh-CN.srt','application/x-subrip; charset=utf-8']],[API+'/alpha.json',['frozen.json','application/json; charset=utf-8']]]);
export function handleFrozenMediaDelivery(req,res,url){
 if(url.pathname!=='/demo-alpha'&&!files.has(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('GET required');return true;}
 const movie=path.join(ROOT,'alpha.mp4');
 if(!fs.existsSync(movie)||crypto.createHash('sha256').update(fs.readFileSync(movie)).digest('hex')!==HASH){res.writeHead(409,{'content-type':'text/plain; charset=utf-8'});res.end('阿尔法存档校验失败；不会使用其他版本替代。');return true;}
 if(url.pathname==='/demo-alpha'){
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>阿尔法 · 冻结展示视频</title><style>body{margin:0;padding:28px;background:#F5F6F7;color:#1C1F23;font:16px system-ui,sans-serif}main{max-width:1280px;margin:auto}h1{font-size:28px}p{color:#697078}video{width:100%;max-height:76vh;background:#1C1F23;border-radius:16px}nav{display:flex;gap:24px;margin:20px 0}a{color:#b84d18}</style><main><h1>阿尔法 · 具身救援 · 从指令到行动</h1><p>已冻结 · 最终展示版 V11 · 3 分 36 秒</p><video controls preload="metadata" src="${API}/alpha.mp4?v=${HASH}"></video><nav><a href="${API}/alpha.mp4" download="阿尔法.mp4">下载阿尔法 MP4</a><a href="${API}/alpha.srt" download="阿尔法.zh-CN.srt">中文字幕</a><a href="${API}/alpha.json">冻结存档记录</a></nav><nav><a href="/demo-action-replays">两段机器人实录</a><a href="/demo">实时界面</a></nav></main></html>`;
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 const [name,type]=files.get(url.pathname),file=path.join(ROOT,name);const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
 if(req.headers.range){const m=String(req.headers.range).match(/^bytes=(\d+)-(\d*)$/);if(!m){res.writeHead(416);res.end();return true;}start=Number(m[1]);end=m[2]?Math.min(end,Number(m[2])):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return true;}status=206;}
 res.writeHead(status,{'content-type':type,'content-length':end-start+1,'cache-control':'no-store','accept-ranges':'bytes','x-content-type-options':'nosniff',...(status===206?{'content-range':`bytes ${start}-${end}/${size}`}:{})});if(req.method==='HEAD'){res.end();return true;}void pipeline(fs.createReadStream(file,{start,end}),res).catch(()=>res.destroy());return true;
}
