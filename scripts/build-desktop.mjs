import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('build/server',{recursive:true});
await build({entryPoints:['server/index.ts'],outfile:'build/server/index.mjs',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',sourcemap:false});
await copyFile('server/extract-worker.mjs','build/server/extract-worker.mjs');
console.log('Desktop backend compiled; no tsx or Vite required at runtime.');
