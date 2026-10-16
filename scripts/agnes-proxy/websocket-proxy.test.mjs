import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {createLoopbackWsProxy} from './websocket-proxy.mjs';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));
function handshake(port,path,origin){return new Promise((resolve,reject)=>{
 let text='';const c=net.connect(port,'127.0.0.1',()=>c.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nProxy-Authorization: test-only\r\n\r\n`));
 c.setTimeout(2000,()=>c.destroy(Error('timeout')));c.on('error',reject);
 c.on('data',b=>{text+=b.toString();if(text.includes('\r\n\r\n'))c.destroy();});c.on('close',()=>resolve(text));
});}
test('same-origin fixed WS path forwards the real upgrade and daemon origin',async()=>{
 let observed;const sockets=new Set();const upstream=http.createServer();upstream.on('upgrade',(q,s)=>{sockets.add(s);observed={url:q.url,origin:q.headers.origin,host:q.headers.host,proxyAuthorization:q.headers['proxy-authorization']};s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');});await listen(upstream);
 const front=http.createServer();await listen(front);const origin=`http://127.0.0.1:${front.address().port}`;front.on('upgrade',createLoopbackWsProxy(origin,`ws://127.0.0.1:${upstream.address().port}/`));
 try{assert.match(await handshake(front.address().port,'/agh-rpc',origin),/^HTTP\/1.1 101/);assert.deepEqual(observed,{url:'/',origin,host:`127.0.0.1:${upstream.address().port}`,proxyAuthorization:undefined});}
 finally{for(const socket of sockets)socket.destroy();await close(front);await close(upstream);}
});
test('other origins and paths cannot reach the daemon',async()=>{
 const front=http.createServer();await listen(front);const origin=`http://127.0.0.1:${front.address().port}`;front.on('upgrade',createLoopbackWsProxy(origin,'ws://127.0.0.1:1/'));
 try{assert.match(await handshake(front.address().port,'/agh-rpc','http://untrusted.invalid'),/^HTTP\/1.1 403/);assert.match(await handshake(front.address().port,'/other',origin),/^HTTP\/1.1 403/);assert.throws(()=>createLoopbackWsProxy(origin,'ws://remote.invalid/'),/LOOPBACK/);}
 finally{await close(front);}
});
