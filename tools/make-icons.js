'use strict';
// Génère extension/icons/icon-{16,32,48,128}.png : deux cartes décalées + pastille « ×2 ».
// Node seul (zlib, fs, path), sortie déterministe. Lancer : npm run icons
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 32, 48, 128];
const SS = 8; // sur-échantillonnage : SS x SS échantillons par pixel

const BG = [0x14, 0x14, 0x16];
const BACK = [0x7f, 0xbf, 0xa3];
const FRONT = [0xcd, 0xee, 0xe0];
const EDGE = [0x1b, 0x3a, 0x30];
const BADGE = [0xf4, 0xf4, 0xf5];
const INK = [0x14, 0x14, 0x16];

// distance signée à un rectangle arrondi (négative dedans)
function sdRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function distSeg(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// géométrie en unités de S (0..1)
const FRONT_BOX = [0.14, 0.30, 0.55, 0.88]; // ~5:7
const BACK_BOX = [0.30, 0.12, 0.71, 0.70];
// 16/32 px : cartes un peu plus décalées pour que la carte arrière reste lisible
const FRONT_SMALL = [0.10, 0.34, 0.50, 0.90];
const BACK_SMALL = [0.30, 0.10, 0.72, 0.66];
const CARD_R = 0.08;

function colorAt(u, v, size) {
  const small = size < 48;
  if (sdRoundRect(u, v, 0, 0, 1, 1, 0.22) > 0) return null; // hors du carré arrondi : transparent
  let c = BG;
  const edge = small ? 0.05 : 0.035; // bordure fine (~0,8 px à 16 px)
  const card = (box, fill) => {
    const d = sdRoundRect(u, v, box[0], box[1], box[2], box[3], CARD_R);
    if (d <= 0) c = d > -edge ? EDGE : fill;
  };
  card(small ? BACK_SMALL : BACK_BOX, BACK);
  card(small ? FRONT_SMALL : FRONT_BOX, FRONT);

  const bx = 0.72, by = 0.74;
  if (small) {
    // à 16/32 px : un point plein, trop petit pour un « ×2 » lisible
    const r = 0.17;
    const d = Math.hypot(u - bx, v - by);
    if (d <= r + 0.035) c = d <= r ? BADGE : EDGE;
    return c;
  }
  const r = 0.2;
  const d = Math.hypot(u - bx, v - by);
  if (d <= r + 0.03) c = d <= r ? BADGE : BG;
  if (d <= r) {
    const hw = 0.0185; // demi-épaisseur du trait
    let ink = false;
    // croix (×) centrée à gauche
    const cx = bx - 0.07, cy = by, k = 0.04;
    ink = ink || distSeg(u, v, cx - k, cy - k, cx + k, cy + k) <= hw;
    ink = ink || distSeg(u, v, cx - k, cy + k, cx + k, cy - k) <= hw;
    // « 2 » en segments
    const x0 = bx + 0.03, x1 = bx + 0.11, y0 = by - 0.068, ym = by, y1 = by + 0.068;
    const pts = [[x0, y0], [x1, y0], [x1, ym], [x0, ym], [x0, y1], [x1, y1]];
    for (let i = 0; i < pts.length - 1; i++) {
      ink = ink || distSeg(u, v, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= hw;
    }
    if (ink) c = INK;
  }
  return c;
}

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filtre None
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a) {
        raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a);
        raw[o + 2] = Math.round(b / a); raw[o + 3] = Math.round((255 * a) / (SS * SS));
      }
    }
  }
  return raw;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const s of SIZES) fs.writeFileSync(path.join(outDir, `icon-${s}.png`), png(s));
