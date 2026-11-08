import {deflateSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
const size=256;
const pixels=Buffer.alloc((size*4+1)*size);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const offset=y*(size*4+1)+1+x*4;
 const corner=Math.hypot(Math.max(0,Math.abs(x-127.5)-85),Math.max(0,Math.abs(y-127.5)-85));
 const dx=x-128,dy=y-128,r=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
 const line=Math.abs(Math.sin(angle*4))*r<7&&r<83;
 const dark=(line||r<9);
 pixels[offset]=dark?20:153;pixels[offset+1]=dark?29:157;pixels[offset+2]=dark?51:252;pixels[offset+3]=corner>41?0:255;
}
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]);const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(body));return Buffer.concat([head,body,tail]);}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
await mkdir('electron/assets',{recursive:true});await writeFile('electron/assets/icon.ico',Buffer.concat([ico,png]));
