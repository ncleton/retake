'use strict';
// Lecture minimale des métadonnées d'un fichier MP4/MOV : cadence exacte, nombre d'images,
// dimensions et codec de la piste vidéo, lus dans la table stts du conteneur.
const fs = require('fs');

function children(buf, start, end) {
  const out = [];
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); header = 16; } else if (size === 0) size = end - off;
    if (size < header || off + size > end) break;
    out.push({ type, start: off + header, end: off + size });
    off += size;
  }
  return out;
}
const find = (buf, box, type) => (box ? children(buf, box.start, box.end).find((b) => b.type === type) : undefined);

async function findMoov(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    let off = 0;
    const head = Buffer.alloc(16);
    while (off + 8 <= size) {
      await fh.read(head, 0, 16, off);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (boxSize === 1) boxSize = Number(head.readBigUInt64BE(8)); else if (boxSize === 0) boxSize = size - off;
      if (boxSize < 8) return null;
      if (type === 'moov') {
        if (boxSize > 512 * 1024 * 1024) return null;
        const buf = Buffer.alloc(boxSize);
        await fh.read(buf, 0, boxSize, off);
        return buf;
      }
      off += boxSize;
    }
    return null;
  } finally { await fh.close(); }
}

function snapFps(fps) {
  const common = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120];
  for (const c of common) if (Math.abs(fps - c) < 0.01) return c;
  return Math.round(fps * 1000) / 1000;
}

async function readMp4Info(filePath) {
  const moov = await findMoov(filePath);
  if (!moov) return null;
  for (const trak of children(moov, 8, moov.length).filter((b) => b.type === 'trak')) {
    const mdia = find(moov, trak, 'mdia');
    const hdlr = find(moov, mdia, 'hdlr');
    if (!hdlr || moov.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue;
    const mdhd = find(moov, mdia, 'mdhd');
    const version = moov.readUInt8(mdhd.start);
    const timescale = version === 1 ? moov.readUInt32BE(mdhd.start + 20) : moov.readUInt32BE(mdhd.start + 12);
    const mediaDuration = version === 1 ? Number(moov.readBigUInt64BE(mdhd.start + 24)) : moov.readUInt32BE(mdhd.start + 16);
    const stbl = find(moov, find(moov, mdia, 'minf'), 'stbl');
    const stts = find(moov, stbl, 'stts');
    if (!stts) return null;
    let frames = 0; const deltas = new Map();
    const n = moov.readUInt32BE(stts.start + 4);
    for (let i = 0; i < n; i++) {
      const count = moov.readUInt32BE(stts.start + 8 + i * 8);
      const delta = moov.readUInt32BE(stts.start + 12 + i * 8);
      frames += count; deltas.set(delta, (deltas.get(delta) || 0) + count);
    }
    const [mainDelta, mainCount] = [...deltas.entries()].sort((a, b) => b[1] - a[1])[0] || [0, 0];
    const stsd = find(moov, stbl, 'stsd');
    const codec = stsd ? moov.toString('latin1', stsd.start + 12, stsd.start + 16) : '';
    const tkhd = find(moov, trak, 'tkhd');
    return {
      fps: mainDelta ? snapFps(timescale / mainDelta) : null,
      constantFrameRate: frames > 0 && mainCount >= frames - 1,
      frameCount: frames,
      duration: timescale ? mediaDuration / timescale : null,
      codec,
      width: tkhd ? moov.readUInt32BE(tkhd.end - 8) / 65536 : 0,
      height: tkhd ? moov.readUInt32BE(tkhd.end - 4) / 65536 : 0,
    };
  }
  return null;
}

module.exports = { readMp4Info };
