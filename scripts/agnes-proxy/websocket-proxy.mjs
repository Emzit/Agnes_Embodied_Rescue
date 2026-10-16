/** Forward only the local AGH WebSocket, preserving daemon origin checks. */
import net from 'node:net';
export function createLoopbackWsProxy(origin, wsUrl) {
 const target=new URL(wsUrl);
 if(target.protocol!=='ws:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password||target.search||target.hash)
  throw Error('LOOPBACK_WEBSOCKET_REQUIRED');
 return (request,socket,head)=>{
  if(request.url!=='/agh-rpc'||request.method!=='GET'||request.headers.origin!==origin||
     String(request.headers.upgrade||'').toLowerCase()!=='websocket') {
   socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;
  }
  const upstream=net.connect({host:target.hostname,port:Number(target.port||80)});
  upstream.setTimeout(5000,()=>upstream.destroy());
  upstream.once('connect',()=>{
   let headers=`GET ${target.pathname||'/'} HTTP/1.1\r\nHost: ${target.host}\r\n`;
   for(let i=0;i<request.rawHeaders.length;i+=2){
    const key=request.rawHeaders[i];
    if(!['host','proxy-authorization'].includes(key.toLowerCase()))headers+=`${key}: ${request.rawHeaders[i+1]}\r\n`;
   }
   upstream.write(headers+'\r\n');if(head.length)upstream.write(head);
   socket.pipe(upstream);upstream.pipe(socket);
  });
  upstream.once('data',()=>upstream.setTimeout(0));
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
  socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
 };
}
