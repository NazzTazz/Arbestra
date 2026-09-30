import { mkdir, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { URL } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 128;
const OUT = new URL('../apps/world-web/public/tiles/', import.meta.url);
await mkdir(OUT, { recursive: true });

const rgba = (hex, alpha = 255) => [...hex.match(/../g).map((part) => parseInt(part, 16)), alpha];
const grassColors = ['536b36', '5d713b', '657744', '596f3b', '6b7b47', '607541', '617449', '58703e'];
const soil = rgba('684326');
const images = [];
const hash = (x, y, seed) => {
  let n = (Math.imul(x + 17, 374761393) + Math.imul(y + 29, 668265263) + Math.imul(seed + 11, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 0x100000000;
};
function blank() { return new Uint8Array(SIZE * SIZE * 4); }
function blend(pixels, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const at = (y * SIZE + x) * 4;
  const a = color[3] / 255;
  const behind = pixels[at + 3] / 255;
  const total = a + behind * (1 - a);
  if (!total) return;
  for (let channel = 0; channel < 3; channel++)
    pixels[at + channel] = Math.round((color[channel] * a + pixels[at + channel] * behind * (1 - a)) / total);
  pixels[at + 3] = Math.round(total * 255);
}
function rect(pixels, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, y0); y < Math.min(SIZE, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(SIZE, x1); x++) blend(pixels, x, y, color);
}
function diamond(pixels, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      if (Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1) blend(pixels, x, y, color);
}
function grass(index) {
  const pixels = blank();
  const base = rgba(grassColors[index]);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const coarse = hash(Math.floor(x / 19), Math.floor(y / 23), index) - 0.5;
    const fine = hash(x, y, index) - 0.5;
    const delta = Math.round(coarse * 7 + fine * 3);
    const at = (y * SIZE + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels[at + channel] = Math.max(0, Math.min(255, base[channel] + delta));
    pixels[at + 3] = 255;
  }
  for (let i = 0; i < 25; i++) {
    const x = 8 + Math.floor(hash(i, 51, index) * 112);
    const y = 8 + Math.floor(hash(i, 83, index) * 112);
    const shade = i % 3 === 0 ? rgba('81904d', 35) : rgba('314d29', 30);
    diamond(pixels, x, y, 2 + i % 2, 4, shade);
  }
  return pixels;
}
function garden(stage) {
  const pixels = blank();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const variation = Math.round((hash(Math.floor(x / 11), Math.floor(y / 9), 70) - 0.5) * 11
      + (hash(x, y, 71) - 0.5) * 5);
    const at = (y * SIZE + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels[at + channel] = soil[channel] + variation;
    pixels[at + 3] = 255;
  }
  for (const row of [28, 64, 100]) {
    rect(pixels, 4, row - 10, 124, row - 6, rgba('825a32', 120));
    rect(pixels, 5, row - 5, 123, row + 7, rgba('392819', 195));
    rect(pixels, 9, row + 7, 119, row + 10, rgba('9a6736', 95));
    if (stage === 0) continue;
    for (const x of [21, 49, 78, 106]) {
      if (stage === 1) {
        diamond(pixels, x, row, 2, 2, rgba('c5a475'));
        continue;
      }
      const growth = stage === 7 ? 13 : 3 + stage * 1.4;
      const leaf = stage < 4 ? rgba('739148') : rgba('577c39');
      diamond(pixels, x - growth * 0.38, row - 2, growth * 0.57, growth * 0.35, leaf);
      diamond(pixels, x + growth * 0.38, row - 2, growth * 0.57, growth * 0.35, rgba('83a052'));
      rect(pixels, x - 1, row - 3, x + 1, row + 5, rgba('365c2d'));
      if (stage >= 5) diamond(pixels, x, row + 4, stage === 7 ? 5 : 3, stage === 7 ? 7 : 4, rgba('cf7b32'));
    }
  }
  if (stage === 0) {
    for (const x of [9, 119]) for (const y of [8, 120]) rect(pixels, x - 2, y - 2, x + 2, y + 2, rgba('b68a4f'));
    rect(pixels, 15, 14, 113, 17, rgba('ae824a', 170));
    rect(pixels, 15, 111, 113, 114, rgba('ae824a', 170));
  }
  return pixels;
}
function shoreTop() {
  const pixels = blank();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const grain = (hash(Math.floor(x / 13), Math.floor(y / 11), 41) - 0.5) * 17
      + (hash(x, y, 42) - 0.5) * 5;
    const at = (y * SIZE + x) * 4;
    const base = [139, 134, 83];
    for (let channel = 0; channel < 3; channel++) pixels[at + channel] = Math.round(base[channel] + grain);
    pixels[at + 3] = 255;
  }
  return pixels;
}
function shoreFace() {
  const pixels = blank();
  const bands = [rgba('bd9b65'), rgba('866443'), rgba('aa8150'), rgba('694b32')];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const bandY = y + (hash(Math.floor(x / 19), 0, 51) - 0.5) * 9;
    const layer = Math.max(0, Math.min(3, Math.floor(bandY / 32)));
    const grain = Math.round((hash(Math.floor(x / 6), Math.floor(y / 5), 52) - 0.5) * 13);
    const at = (y * SIZE + x) * 4;
    const seam = bandY % 32 < 4 && y > 4 ? -24 : 0;
    for (let channel = 0; channel < 3; channel++) pixels[at + channel] = bands[layer][channel] + grain + seam;
    pixels[at + 3] = 255;
  }
  return pixels;
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function png(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(pixels.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
for (const [category, generator] of [['grass', grass], ['garden', garden]]) {
  for (let index = 0; index < 8; index++) {
    const pixels = generator(index);
    images.push(pixels);
    await writeFile(new URL(`${category}-${index}.png`, OUT), png(SIZE, SIZE, pixels));
  }
}
const top = shoreTop(), face = shoreFace();
await writeFile(new URL('shore-top.png', OUT), png(SIZE, SIZE, top));
await writeFile(new URL('shore-face.png', OUT), png(SIZE, SIZE, face));
const atlas = new Uint8Array(SIZE * 8 * SIZE * 4 * 4);
atlas.fill(255); // Fourth row starts with neutral white for water and stone.
images[25] = top;
images[26] = face;
for (const [index, tile] of images.entries()) {
  if (!tile) continue;
  const tileX = index % 8, tileY = Math.floor(index / 8);
  for (let y = 0; y < SIZE; y++) {
    atlas.set(tile.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), ((tileY * SIZE + y) * SIZE * 8 + tileX * SIZE) * 4);
  }
}
await writeFile(new URL('atlas.png', OUT), png(SIZE * 8, SIZE * 4, atlas));
process.stdout.write('Generated 18 source tiles and one runtime atlas.\n');
