// Rapport de revue : Markdown pour l'agent de montage, JSON structuré, page HTML lisible et images annotées.
import { drawShapes, shapeBounds, placeName, SHAPE_NAMES } from './shapes.js';

export const STATUSES = { nouvelle: 'Nouveau', a_verifier: 'À vérifier', corrige: 'Corrigé', pas_corrige: 'Pas corrigé' };

const pad = (n, w = 2) => String(n).padStart(w, '0');
const round3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
export function fmtTime(sec, withMs = true) {
  if (sec == null || !isFinite(sec)) return '--:--';
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000); const m = Math.floor(ms / 60000) % 60; const s = Math.floor(ms / 1000) % 60;
  const base = (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
  return withMs ? base + '.' + pad(ms % 1000, 3) : base;
}
export function shortTime(sec) {
  if (sec == null || !isFinite(sec)) return '0:00';
  const s = Math.floor(sec + 1e-6); const h = Math.floor(s / 3600);
  return (h ? h + ':' + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + pad(s % 60);
}
export function smpte(frame, fps) {
  if (frame == null || !fps) return null;
  const nominal = Math.round(fps); const total = Math.floor(frame / nominal);
  return pad(Math.floor(total / 3600)) + ':' + pad(Math.floor(total / 60) % 60) + ':' + pad(total % 60) + ':' + pad(frame % nominal);
}
const fr = (n) => (n == null ? '' : n.toLocaleString('fr-FR'));
const dec = (x) => x.toFixed(1).replace('.', ',');
const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);
export const noteLabel = (num) => 'n' + pad(num, 2);

export function orderedNotes(review) {
  return [...review.notes].sort((a, b) => a.time - b.time || a.createdAt.localeCompare(b.createdAt));
}

function shapeInPixels(s, W, H) {
  const b = shapeBounds(s);
  const px = { x: Math.round(b.x * W), y: Math.round(b.y * H), w: Math.round(b.w * W), h: Math.round(b.h * H) };
  const out = { type: s.type, place: placeName(b), boundsPx: px, normalized: { ...s } };
  if (s.type === 'arrow') {
    out.fromPx = [Math.round(s.x1 * W), Math.round(s.y1 * H)]; out.toPx = [Math.round(s.x2 * W), Math.round(s.y2 * H)];
    out.place = placeName({ x: s.x2, y: s.y2, w: 0, h: 0 });
  }
  if (s.type === 'pin') out.pointPx = [px.x, px.y];
  return out;
}
export function describeShape(sh, i) {
  const p = sh.boundsPx;
  if (sh.type === 'arrow') return 'Repère ' + (i + 1) + ', flèche pointant ' + sh.place + ' : de (' + sh.fromPx.join(', ') + ') vers (' + sh.toPx.join(', ') + ') px';
  if (sh.type === 'pin') return 'Repère ' + (i + 1) + ', point ' + sh.place + ' : (' + sh.pointPx.join(', ') + ') px';
  return 'Repère ' + (i + 1) + ', ' + SHAPE_NAMES[sh.type] + ' ' + sh.place + ' : x ' + p.x + ' à ' + (p.x + p.w) + ', y ' + p.y + ' à ' + (p.y + p.h) + ' px';
}

// Compose l'image brute et les repères à la résolution de la vidéo.
export async function composeAnnotated(rawUrl, shapes) {
  const img = new Image();
  img.src = rawUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  drawShapes(ctx, shapes, { x: 0, y: 0, w: c.width, h: c.height }, { scale: c.width / 1280, labels: true });
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return blob.arrayBuffer();
}

export function buildDocuments({ review, appVersion, exportedAt, notes, zipName }) {
  const v = review.video;
  const W = v.width; const H = v.height; const fps = v.fps;
  const clipCount = notes.reduce((a, n) => a + n.clips.length, 0);
  const checked = notes.filter((n) => n.origin);
  const fixedCount = checked.filter((n) => n.status === 'corrige').length;
  const notFixed = checked.filter((n) => n.status === 'pas_corrige').length;
  const date = new Date(exportedAt);
  const dateFr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const jsonNotes = notes.map((n, idx) => {
    const num = idx + 1; const label = noteLabel(num);
    return {
      number: num, id: n.id, status: n.status, origin: n.origin || null,
      time: round3(n.time), timecode: fmtTime(n.time), smpte: smpte(n.frame, fps), frame: n.frame,
      end: n.end ? { time: round3(n.end.time), timecode: fmtTime(n.end.time), frame: n.end.frame } : null,
      text: (n.text || '').trim(), source: n.source,
      lookback: n.source === 'voix' && !n.shapes.length ? { from: round3(Math.max(0, n.time - 3)), to: round3(n.time) } : null,
      clips: n.clips.map((c, k) => ({ file: 'audio/' + label + '-' + String.fromCharCode(97 + k) + '.wav', duration: round3(c.duration), videoTime: round3(c.videoTime), timecode: fmtTime(c.videoTime), transcript: null })),
      shapes: n.shapes.map((s) => shapeInPixels(s, W, H)),
      images: {
        annotated: 'images/' + label + '-annotee.jpg', raw: 'images/' + label + '-brute.jpg',
        previousVersion: n.origin && n.previousImage ? 'images/' + label + '-version-precedente.jpg' : null,
      },
      createdAt: n.createdAt, updatedAt: n.updatedAt,
    };
  });

  const json = {
    schema: 'revue-video/1', app: { name: 'Retake', version: appVersion }, exportedAt, reviewer: review.reviewer,
    video: { fileName: v.fileName, sha256: v.sha256, sizeBytes: v.size, duration: round3(v.duration), fps, frameCount: v.frameCount, width: W, height: H, codec: v.codec || null, fpsSource: v.fpsSource },
    summary: { notes: notes.length, voiceClips: clipCount, previousNotesChecked: checked.length, fixed: fixedCount, notFixed },
    coordinates: 'Pixels de la vidéo d\'origine, origine en haut à gauche ; "normalized" donne les mêmes valeurs entre 0 et 1.',
    notes: jsonNotes,
  };

  const md = [];
  md.push('# Retake : ' + v.fileName, '');
  let lead = 'Relu par ' + (review.reviewer || 'relecteur inconnu') + ' le ' + dateFr + '. ' + plural(notes.length, 'commentaire', 'commentaires') + '.';
  if (clipCount) lead += ' ' + plural(clipCount, 'commentaire vocal', 'commentaires vocaux') + ' à transcrire.';
  if (checked.length) lead += ' Vérification de la version précédente : ' + plural(fixedCount, 'point corrigé', 'points corrigés') + ', ' + plural(notFixed, 'point pas corrigé', 'points pas corrigés') + ', ' + (checked.length - fixedCount - notFixed) + ' non vérifié' + (checked.length - fixedCount - notFixed > 1 ? 's' : '') + '.';
  md.push(lead, '');
  md.push('## Vidéo relue', '', '| | |', '|---|---|');
  md.push('| Fichier | ' + v.fileName + ' |');
  md.push('| SHA-256 | ' + v.sha256 + ' |');
  md.push('| Durée | ' + fmtTime(v.duration) + (v.frameCount ? ' (' + fr(v.frameCount) + ' images)' : '') + ' |');
  md.push('| Cadence | ' + (fps ? fps + ' images/s' + (v.fpsSource === 'mesure' ? ' (mesurée pendant la lecture)' : ' (lue dans le fichier)') : 'inconnue') + ' |');
  md.push('| Résolution | ' + W + ' × ' + H + ' px |', '');
  md.push('## Consignes pour l\'agent de montage', '');
  md.push('1. Vérifie que l\'empreinte SHA-256 ci-dessus est celle de ton rendu. Si elle diffère, les instants ne correspondent pas : retrouve la bonne version avant de corriger.');
  md.push('2. Si tu es l\'agent Montage vidéo, lance `python3 plugins/agent-montage-video/skills/retake/scripts/ingest_review.py <ce .zip>` : il vérifie l\'empreinte, transcrit les commentaires vocaux, compare chaque image au rendu et relie chaque commentaire à la scène et à la réplique.');
  md.push('3. Les commentaires vocaux (`audio/*.wav`) contiennent souvent l\'essentiel : transcris-les avant de décider quoi changer.');
  md.push('4. Le relecteur parle après avoir vu le problème. Pour un commentaire vocal sans repère, cherche aussi dans les 3 secondes qui précèdent l\'instant indiqué.');
  md.push('5. « Image n » est le numéro d\'image compté depuis 0. Pour l\'extraire : `ffmpeg -i <rendu> -vf "select=eq(n\\,N)" -fps_mode passthrough -frames:v 1 image.png`.');
  md.push('6. Les repères sont en pixels de la vidéo, origine en haut à gauche. Ils sont numérotés sur les images `images/*-annotee.jpg`.');
  md.push('7. Réponds commentaire par commentaire (corrigé, ou non corrigé et pourquoi), puis rends une nouvelle version : le relecteur ouvrira la nouvelle version, importera ce rapport et vérifiera chaque point.', '');
  md.push('## Commentaires', '');
  if (!notes.length) md.push('Aucun commentaire : la vidéo est validée telle quelle.', '');
  jsonNotes.forEach((j) => {
    md.push('### ' + j.number + '. ' + j.timecode + (j.origin ? ' · ' + STATUSES[j.status] : ''), '');
    md.push('- Instant : ' + j.timecode + (j.frame != null ? ', image ' + fr(j.frame) : '') + (j.smpte ? ' (' + j.smpte + ')' : ''));
    if (j.end) md.push('- Concerne la séquence jusqu\'à ' + j.end.timecode + (j.end.frame != null ? ', image ' + fr(j.end.frame) : '') + ' (' + dec(j.end.time - j.time) + ' s)');
    if (j.origin) md.push('- Point n° ' + j.origin.number + ' de la revue du ' + new Date(j.origin.exportedAt).toLocaleDateString('fr-FR') + ' : **' + STATUSES[j.status] + '**');
    md.push('');
    if (j.origin && j.origin.text) md.push('Commentaire d\'origine : « ' + j.origin.text.replace(/\n/g, ' ') + ' »', '');
    if (j.text) md.push('> ' + j.text.split('\n').join('\n> '), '');
    else if (!j.clips.length && !j.origin) md.push('> (pas de texte : voir les repères sur l\'image)', '');
    if (j.clips.length) {
      md.push('Commentaires vocaux :');
      j.clips.forEach((c) => md.push('- `' + c.file + '` : ' + dec(c.duration) + ' s, dit à ' + c.timecode + ' (transcription à faire)'));
      md.push('');
    }
    if (j.lookback) md.push('Dit pendant la lecture : regarde aussi de ' + fmtTime(j.lookback.from) + ' à ' + fmtTime(j.lookback.to) + '.', '');
    if (j.shapes.length) { md.push('Repères sur l\'image :'); j.shapes.forEach((s, k) => md.push('- ' + describeShape(s, k))); md.push(''); }
    md.push('![Commentaire ' + j.number + '](' + j.images.annotated + ')', '');
    md.push('Image sans annotation : `' + j.images.raw + '`' + (j.images.previousVersion ? ' · version précédente : `' + j.images.previousVersion + '`' : ''), '');
  });
  md.push('---', 'Rapport produit par Retake ' + appVersion + '.' + (zipName ? ' Archive : ' + zipName + '.' : ''), '');

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = jsonNotes.map((j) => '<article><img src="' + j.images.annotated + '" alt=""><div><p class="t">' + j.number + ' · ' + esc(j.timecode) + (j.end ? ' → ' + esc(j.end.timecode) : '') +
    (j.origin ? ' · <b class="st ' + j.status + '">' + STATUSES[j.status] + '</b>' : '') + '</p>' +
    (j.origin && j.origin.text ? '<p class="m">Commentaire d\'origine : ' + esc(j.origin.text) + '</p>' : '') +
    (j.text ? '<p class="x">' + esc(j.text).replace(/\n/g, '<br>') + '</p>' : '') +
    j.clips.map((c) => '<audio controls src="' + c.file + '"></audio>').join('') +
    (j.shapes.length ? '<ul>' + j.shapes.map((s, k) => '<li>' + esc(describeShape(s, k)) + '</li>').join('') + '</ul>' : '') +
    '<p class="m">Image ' + fr(j.frame) + '</p></div></article>').join('\n');
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Retake : ' + esc(v.fileName) + '</title><style>' +
    'body{font:15px/1.5 Inter,-apple-system,"Segoe UI",sans-serif;background:#f7f7f8;color:#0c0a09;margin:0;padding:40px}main{max-width:1100px;margin:auto}' +
    'h1{font-size:30px;font-weight:400;letter-spacing:-.02em;margin:0}.lead{color:#8a8a92;font-size:18px;margin:4px 0 28px}article{display:grid;grid-template-columns:480px 1fr;gap:22px;background:#fff;border:1px solid #ebebef;border-radius:18px;padding:16px;margin:0 0 14px}' +
    'article img{width:100%;border-radius:10px;display:block}.t{color:#8a8a92;margin:0 0 6px;font-variant-numeric:tabular-nums}.x{margin:0 0 8px;font-size:16px}.m{color:#8a8a92;font-size:13px;margin:4px 0}audio{width:100%;height:34px;margin:4px 0}ul{padding-left:18px;color:#57534e;font-size:13px}' +
    '.st{font-weight:600}.st.corrige{color:#15a46b}.st.pas_corrige{color:#f0284a}@media(max-width:900px){article{grid-template-columns:1fr}}</style></head><body><main><h1>Retake : ' + esc(v.fileName) + '</h1><p class="lead">' +
    esc(review.reviewer || '') + ' · ' + esc(dateFr) + ' · ' + plural(notes.length, 'commentaire', 'commentaires') + '</p>' + cards + '</main></body></html>';

  const message = 'Voici ma revue de « ' + v.fileName + ' » : ' + plural(notes.length, 'commentaire', 'commentaires') + '. Le fichier ' + (zipName || 'joint') + ' contient tout (images et commentaires vocaux).';
  return { markdown: md.join('\n'), json: JSON.stringify(json, null, 2), html, message, jsonNotes };
}
