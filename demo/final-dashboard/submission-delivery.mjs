import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
const ROOT='/data-ssd/zhongchengkai/agnes/artifacts/submission-materials-G002-manualtrace-20261015';
const API='/api/demo-ui/submission';
const files=new Map([
 [API+'/bundle.zip',['硕博组-G002-今天不想做正事-郭煜.zip','application/zip']],
 [API+'/report.json',['package-report.json','application/json; charset=utf-8']],
 [API+'/manual.md',['package/00_审核入口/提交内容说明.md','text/plain; charset=utf-8']],
 [API+'/readme.md',['package/00_审核入口/阅读入口.md','text/plain; charset=utf-8']],
 [API+'/fields.json',['field-status.json','application/json; charset=utf-8']],
 [API+'/publication.png',['package/06_声明与公开材料/Bilibili投稿发布截图.png','image/png']],
 [API+'/publication.md',['package/06_声明与公开材料/公开内容与视频发布登记.md','text/plain; charset=utf-8']],
 [API+'/publication.json',['package/06_声明与公开材料/公开发布核查.json','application/json; charset=utf-8']],
 [API+'/manual-trace.zip',['package/04_可核查运行证据/AGH手工导出/agh-diagnostics-autonomo-20261015-032028.zip','application/zip']],
 [API+'/manual-trace-check.json',['package/04_可核查运行证据/AGH手工导出/手工导出核查.json','application/json; charset=utf-8']],
 [API+'/manual-trace.md',['package/04_可核查运行证据/AGH手工导出/手工导出说明.md','text/plain; charset=utf-8']],
 [API+'/trace-viewer.html',['trace-preview/index.html','text/html; charset=utf-8']],
 ...[['form','01_提交表/参赛提交信息'],['technical','02_项目报告/具身救援项目技术报告'],['reproduction','03_复现与测试/运行复现与测试说明'],['declaration','06_声明与公开材料/成员声明与第三方来源'],['independence','06_声明与公开材料/成员独立完成声明']].flatMap(([id,file])=>[['pdf','application/pdf'],['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['md','text/plain; charset=utf-8']].map(([ext,type])=>[API+'/'+id+'.'+ext,['package/'+file+'.'+ext,type]]))
]);
export function handleSubmissionDelivery(req,res,url){
 const page=url.pathname==='/demo-submission';if(!page&&!files.has(url.pathname))return false;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return true;}
 if(page){
  let info;try{info=JSON.parse(fs.readFileSync(path.join(ROOT,'package-report.json'),'utf8'));}catch{}
  if(!info?.prepared){res.writeHead(503);res.end('材料正在核查。');return true;}
  const cards=[['form','参赛提交信息','报名信息、作品说明和视频链接'],['technical','项目技术报告','任务会话、多模态视觉、定位、门操作与骨架复用'],['reproduction','复现与三类测试','安装入口、真实正常与失败案例、19项边界回归'],['declaration','成员声明与来源','成员声明、第三方和 AI 辅助、公开材料登记'],['independence','成员独立完成声明','本队成员的独立完成责任、第三方组件及 AI 辅助使用范围']];
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>具身救援 · 参赛材料</title><style>*{box-sizing:border-box}body{margin:0;background:#F5F6F7;color:#1C1F23;font:16px system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:36px 24px}h1{font-size:30px;margin:0 0 10px}p{line-height:1.8;color:#69717A}a{color:#B24D1C;text-decoration:none}a:hover{text-decoration:underline}.summary,.card,.check{background:white;border:1px solid #DCE1E5;border-radius:20px;padding:24px;margin-top:20px;box-shadow:0 8px 30px #1C1F2306}.summary{display:flex;gap:20px;align-items:center;justify-content:space-between}.download{display:inline-block;background:#F4772D;color:white;border-radius:999px;padding:13px 24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card h2{font-size:20px}.card nav{display:flex;gap:22px}.meta{font-size:14px}.check li{margin:10px 0;line-height:1.7}footer{display:flex;gap:24px;margin-top:24px;font-size:14px}@media(max-width:650px){.grid{grid-template-columns:1fr}.summary{display:block}h1{font-size:25px}}</style><main><h1>具身救援参赛材料</h1><p>硕博组 · G002 · 今天不想做正事。队长郭煜、队员林路辰，均为东南大学研究生。我们以项目源码、复现说明、技术报告、运行证据和公开视频提交参赛作品。</p><div class="summary"><div><strong>提交包 · ${(info.bytes/1000000).toFixed(2)} MB</strong><p class="meta">5份 Word · 5份 PDF · 当前源码快照 · 原生执行证据<br>ZIP CRC 与文件哈希检查通过，低于200 MB。</p></div><a class="download" href="${API}/bundle.zip?download=1">下载完整提交材料</a></div><div class="grid">${cards.map(([id,title,desc])=>`<section class="card"><h2>${title}</h2><p>${desc}</p><nav><a href="${API}/${id}.pdf">预览 PDF</a><a href="${API}/${id}.docx?download=1">下载 Word</a><a href="${API}/${id}.md">查看 Markdown</a></nav></section>`).join('')}</div><section class="check"><h2>AGH 原生手工导出轨迹</h2><p>我们通过 AGH 原生 Web 手工导出本场搜寻会话，保留下载的原始 ZIP。共2轮任务、1397条连续事件、80组工具调用与结果，无导出警告，账本未截断。</p><p class="meta">导出时间：2026年10月15日 11:20:28（北京时间） · 原包已加入完整提交材料</p><nav><a href="${API}/trace-viewer.html">查看原生轨迹</a>　<a href="${API}/manual-trace.zip?download=1">下载原始导出ZIP</a>　<a href="${API}/manual-trace.md">查看核查说明</a></nav></section><section class="check"><h2>公开发布信息已补齐</h2><p><strong>《拯救伪人》</strong> · 哔哩哔哩（Bilibili）<br>发布时间：2026年10月15日 09:53:37（北京时间） · 平台时长3分42秒</p><p><a href="https://www.bilibili.com/video/BV1F1J66YEkB/" target="_blank" rel="noopener">打开公开视频</a>　<a href="${API}/publication.md">查看公开登记</a>　<a href="${API}/publication.png">查看投稿截图</a></p><img src="${API}/publication.png" alt="本队 Bilibili 投稿列表截图，包含标题与发布时间" style="display:block;width:100%;max-width:890px;border:1px solid #DCE1E5;border-radius:10px"><p class="meta">我们已发布项目演示视频，并附上投稿截图、公开页面核查记录与《成员独立完成声明》。Word、PDF 和 Markdown 同步提供。</p><a href="${API}/manual.md">查看材料交付说明</a>　<a href="${API}/fields.json">查看信息完整性记录</a></section><footer><a href="/demo-project-film-continuous">查看新版连贯旁白视频</a><a href="${API}/readme.md">材料阅读入口</a></footer></main></html>`;
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 const [name,type]=files.get(url.pathname),file=path.join(ROOT,name);if(!fs.existsSync(file)){res.writeHead(404);res.end();return true;}const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
 if(req.headers.range){const match=String(req.headers.range).match(/^bytes=(\d+)-(\d*)$/);if(!match){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return true;}start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;if(!Number.isSafeInteger(start)||start<0||start>end||start>=size){res.writeHead(416,{'content-range':'bytes */'+size});res.end();return true;}status=206;}
 const download=url.searchParams.get('download')==='1';res.writeHead(status,{'content-type':type,'content-length':end-start+1,'cache-control':'no-store','accept-ranges':'bytes','x-content-type-options':'nosniff',...(status===206?{'content-range':`bytes ${start}-${end}/${size}`}:{}) ,...(download?{'content-disposition':`attachment; filename="submission.${path.extname(name).slice(1)}"; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`}:{})});
 if(req.method==='HEAD'){res.end();return true;}void pipeline(fs.createReadStream(file,{start,end}),res).catch(()=>res.destroy());return true;
}
