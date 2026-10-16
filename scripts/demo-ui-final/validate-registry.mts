import fs from 'node:fs';import {WorldRegistry} from '../../services/robot-mcp/src/transport/world-registry.ts';
const p=process.argv[2];if(!p?.startsWith('/data-ssd/zhongchengkai/agnes/'))throw Error('OUTSIDE_PROJECT');
const r=WorldRegistry.load(p);console.log(JSON.stringify({pass:true,locations:r.list().length,start:r.resolve('Start'),source:'unchanged strict Robot MCP WorldRegistry constructor'}));
