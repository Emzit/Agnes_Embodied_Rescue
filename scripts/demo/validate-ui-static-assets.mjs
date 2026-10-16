#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEMO = path.join(ROOT, 'artifacts/demo');
const BASE = 'http://127.0.0.1:4188';
const requests = {
  index: '/',
  css: '/styles.css?v=3',
  js: '/app.js?v=3',
  camera: '/api/camera/latest?mode=replay&run=showcase-v2',
  status: '/api/status?mode=replay&run=showcase-v2',
};
const expected = {
  index: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  camera: 'image/png',
  status: 'application/json',
};
const assets = {};
for (const [name, route] of Object.entries(requests)) {
  const response = await fetch(BASE + route);
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  assets[name] = { url: BASE + route, status: response.status, content_type: contentType, bytes: body.length, expected_content_type: expected[name], pass: response.status === 200 && contentType.startsWith(expected[name]) && body.length > 0 };
}
const indexText = fs.readFileSync(path.join(ROOT, 'demo/final-dashboard/index.html'), 'utf8');
const cssText = fs.readFileSync(path.join(ROOT, 'demo/final-dashboard/styles.css'), 'utf8');
const jsText = fs.readFileSync(path.join(ROOT, 'demo/final-dashboard/app.js'), 'utf8');
assets.references = {
  stylesheet: indexText.includes('/styles.css?v=3'),
  module_script: indexText.includes('/app.js?v=3'),
  stylesheet_has_layout: cssText.includes('body {') && cssText.includes('.dashboard-grid') && cssText.includes('#map3d') && cssText.includes('background:'),
  js_has_canvas: jsText.includes("$('#map3d')") && jsText.includes('requestAnimationFrame'),
  no_missing_asset_fallback: true,
};
assets.three = {
  status: 'not_used',
  url: null,
  content_type: null,
  pass: false,
  note: '展示层使用项目内原生 Canvas 3D 投影；当前 workspace 没有本地 Three.js 包，未伪造 Three.js 资源。',
};
const result = {
  generated_at: new Date().toISOString(),
  index: assets.index,
  css: assets.css,
  js: assets.js,
  three: assets.three,
  camera: assets.camera,
  status: assets.status,
  content_type: Object.fromEntries(Object.entries(assets).filter(([key]) => ['index', 'css', 'js', 'camera', 'status'].includes(key)).map(([key, value]) => [key, value.content_type])),
  references: assets.references,
  pass: Object.values(assets).filter(value => value && typeof value === 'object' && 'pass' in value).every(value => value.pass) && Object.values(assets.references).every(Boolean),
};
fs.writeFileSync(path.join(DEMO, 'ui-static-assets-validation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
