// gen-petal-png.js
// 程序化生成桃花花瓣 PNG（128x128 RGBA），编码为 base64 内嵌进 qixi-heart-particles.html
// 用法：node gen-petal-png.js  （会输出 petal.png 并回写 HTML 中的 __PETAL_BASE64__ 占位符）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const CX = 64, BASE_Y = 106, TIP_Y = 18;
const HH = BASE_Y - TIP_Y;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// 花瓣配色：浅粉白边 -> 粉 -> 基部深粉，纹理亮粉
const C_EDGE = [255, 217, 230];
const C_INNER = [255, 154, 184];
const C_BASE = [247, 110, 156];
const C_VEIN = [255, 228, 238];

// 半宽轮廓（基部窄、中段饱满、顶端收圆）
function halfW(t) {
  return 3 + 23 * Math.pow(Math.sin(Math.PI * clamp(t, 0, 0.999)), 0.62);
}
// 4 条从基部向上的弯曲纹理
function veinX(i, t) {
  return CX + i * 0.34 * halfW(t) * (0.55 + 0.45 * Math.sin(t * 2.6 + i * 2.1));
}

/* ---------- 逐像素绘制 ---------- */
const raw = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = y * SIZE * 4 + x * 4;
    const t = clamp((BASE_Y - y) / HH, 0, 1);
    if (t <= 0 || t >= 1) { raw[idx + 3] = 0; continue; }
    const hw = halfW(t);
    const dx = Math.abs(x - CX);
    const d = hw - dx;
    if (d < 0) { raw[idx + 3] = 0; continue; }
    const u = dx / (hw + 0.001);
    let r = lerp(C_EDGE[0], C_INNER[0], clamp(u * 1.25, 0, 1));
    let g = lerp(C_EDGE[1], C_INNER[1], clamp(u * 1.25, 0, 1));
    let b = lerp(C_EDGE[2], C_INNER[2], clamp(u * 1.25, 0, 1));
    const baseMix = Math.pow(clamp(1 - t, 0, 1), 2.4) * 0.5;
    r = lerp(r, C_BASE[0], baseMix);
    g = lerp(g, C_BASE[1], baseMix);
    b = lerp(b, C_BASE[2], baseMix);
    let vein = 0;
    for (let k = 0; k < 4; k++) {
      const vd = Math.abs(x - veinX(-1.5 + k, t));
      vein = Math.max(vein, 1 - vd / 1.7);
    }
    if (vein > 0) {
      const vm = vein * 0.5;
      r = lerp(r, C_VEIN[0], vm);
      g = lerp(g, C_VEIN[1], vm);
      b = lerp(b, C_VEIN[2], vm);
    }
    const sdx = x - (CX - 10), sdy = y - 34;   // 左上方柔光
    const sheen = Math.max(0, 1 - (sdx * sdx + sdy * sdy) / (26 * 26));
    if (sheen > 0) {
      const sm = sheen * 0.18;
      r = lerp(r, 255, sm); g = lerp(g, 255, sm); b = lerp(b, 255, sm);
    }
    const alpha = clamp(d / 2.4, 0, 1) * 0.97; // 边缘 2.4px 柔和过渡
    raw[idx] = Math.round(clamp(r, 0, 255));
    raw[idx + 1] = Math.round(clamp(g, 0, 255));
    raw[idx + 2] = Math.round(clamp(b, 0, 255));
    raw[idx + 3] = Math.round(alpha * 255);
  }
}

/* ---------- PNG 编码（zlib + CRC32，无第三方依赖） ---------- */
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;      // 8bit RGBA
  const stride = w * 4;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(stride + 1);
    rgba.copy(row, 1, y * stride, (y + 1) * stride);
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });
  return {
    png: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0))
    ]),
    idat
  };
}

const { png, idat } = encodePNG(raw, SIZE, SIZE);
fs.writeFileSync(path.join(__dirname, 'petal.png'), png);
const b64 = png.toString('base64');

/* ---------- 回写 HTML 占位符 ---------- */
const htmlPath = path.join(__dirname, 'qixi-heart-particles.html');
let html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('__PETAL_BASE64__')) {
  console.error('ERROR: placeholder __PETAL_BASE64__ not found');
  process.exit(1);
}
html = html.replace('__PETAL_BASE64__', 'data:image/png;base64,' + b64);
fs.writeFileSync(htmlPath, html);

/* ---------- 自检：解压回读比对 ---------- */
const back = zlib.inflateSync(idat);
const stride = SIZE * 4;
let ok = back.length === SIZE * (stride + 1);
for (let y = 0; ok && y < SIZE; y++) {
  if (back[y * (stride + 1)] !== 0) ok = false;
  else if (!back.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)).equals(raw.subarray(y * stride, (y + 1) * stride))) ok = false;
}
console.log('PNG bytes:', png.length, '| base64 chars:', b64.length, '| roundtrip:', ok ? 'OK' : 'FAIL');
