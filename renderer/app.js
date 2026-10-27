import { VoiceReview } from './voice.js';
import { drawShapes } from './shapes.js';
import { STATUSES, fmtTime, shortTime, orderedNotes, composeAnnotated, buildDocuments, noteLabel } from './report.js';

const api = window.revue;
const $ = (id) => document.getElementById(id);
const appEl = $('app'); const video = $('video'); const overlay = $('overlay'); const stage = $('stage');
const input = $('input'); const octx = overlay.getContext('2d'); const peek = $('peekVideo');
const MARK = '#f0284a';
const SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75];

const S = {
  review: null, fps: null, appVersion: '', settings: {},
  mediaTime: 0, frameValid: false, lastMd: null, fpsSamples: [],
  draft: null, selectedId: null, drawing: null,
  voice: null, pendingVoice: null, clipAnchor: null, resumeTimer: null, saveTimer: null, pa: null,
  lastExport: null, playingClip: null,
};
const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowIso = () => new Date().toISOString();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round4 = (x) => Math.round(x * 10000) / 10000;
const dataUrl = (rel, v) => 'revue://app/data/' + S.review.video.sha256 + '/' + rel + (v ? '?v=' + v : '');
const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);

/* ---------- Messages ---------- */
let toastTimer = null;
function toast(msg, actionLabel, action, isError = false) {
  $('toastText').textContent = msg;
  const b = $('toastAction');
  b.hidden = !actionLabel; b.textContent = actionLabel || '';
  b.onclick = () => { $('toast').hidden = true; action && action(); };
  $('toast').classList.toggle('error', isError);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, isError ? 12000 : actionLabel ? 6000 : 2800);
}
const showError = (msg) => toast(msg, 'Fermer', null, true);
function pill(text, { rec = false, action = null, actionLabel = '' } = {}) {
  if (text == null) { $('floatPill').hidden = true; return; }
  $('floatText').textContent = text; $('recDot').hidden = !rec;
  const b = $('floatAction'); b.hidden = !action; b.textContent = actionLabel; b.onclick = action;
  $('floatPill').hidden = false;
}

/* ---------- Temps et images ---------- */
function maxFrame() { const v = S.review.video; return v.frameCount ? v.frameCount - 1 : Math.max(0, Math.floor(video.duration * S.fps) - 1); }
function currentFrame() {
  if (!S.fps) return null;
  return S.frameValid ? Math.round(S.mediaTime * S.fps) : Math.floor(video.currentTime * S.fps + 1e-4);
}
function currentTime() { const f = currentFrame(); return f == null ? video.currentTime : f / S.fps; }
function seekFrame(f) { f = clamp(f, 0, maxFrame()); S.frameValid = false; video.currentTime = Math.min((f + 0.5) / S.fps, video.duration - 0.0005); }
function seekTime(t) { if (S.fps) seekFrame(Math.floor(t * S.fps + 1e-4)); else { S.frameValid = false; video.currentTime = clamp(t, 0, video.duration); } }
function step(n) { if (!video.paused) pauseVideo(); if (S.fps) seekFrame(currentFrame() + n); else seekTime(video.currentTime + n / 30); }
function stepSeconds(sec) { if (!video.paused) pauseVideo(); if (S.fps) seekFrame(currentFrame() + Math.round(sec * S.fps)); else seekTime(video.currentTime + sec); }
function pauseVideo() { video.pause(); if (S.fps) seekFrame(currentFrame()); }
async function play() {
  cancelResume();
  if (S.draft) await commitDraft();
  if (S.draft) return;
  try { await video.play(); } catch (e) { showError('La lecture n\'a pas pu démarrer : ' + e.message); }
}
function togglePlay() { if (!S.review) return; if (video.paused) play(); else pauseVideo(); }
function frameReady() {
  return new Promise((resolve) => {
    const wait = () => { video.requestVideoFrameCallback(() => resolve()); setTimeout(resolve, 300); };
    if (video.seeking) video.addEventListener('seeked', wait, { once: true }); else resolve();
  });
}
async function grabFrame(now = false) {
  if (!now) await frameReady();
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Impossible de capturer l\'image de la vidéo.');
  return blob.arrayBuffer();
}
function trackFrames() {
  video.requestVideoFrameCallback((_now, md) => {
    if (S.lastMd && !video.paused && md.presentedFrames === S.lastMd.presentedFrames + 1) {
      const d = md.mediaTime - S.lastMd.mediaTime;
      if (d > 0.002 && d < 0.2) S.fpsSamples.push(d);
      if (!S.fps && S.review && S.fpsSamples.length >= 40) setMeasuredFps();
    }
    S.lastMd = md; S.mediaTime = md.mediaTime; S.frameValid = !video.seeking;
    onFrame();
    trackFrames();
  });
}
function setMeasuredFps() {
  const sorted = [...S.fpsSamples].sort((a, b) => a - b);
  const raw = 1 / sorted[Math.floor(sorted.length / 2)];
  const common = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  S.fps = common.reduce((best, c) => (Math.abs(c - raw) < Math.abs(best - raw) ? c : best), common[0]);
  if (Math.abs(S.fps - raw) > 0.5) S.fps = Math.round(raw * 100) / 100;
  const v = S.review.video;
  v.fps = S.fps; v.fpsSource = 'mesure'; v.frameCount = Math.round(video.duration * S.fps);
  S.review.notes.forEach((n) => { if (n.frame == null) n.frame = Math.round(n.time * S.fps); });
  scheduleSave();
}

/* ---------- Enregistrement automatique ---------- */
function serialize() {
  const r = { ...S.review, updatedAt: nowIso() };
  if (S.draft) { const { snapshot, snapshotPromise, snapToken, ...d } = S.draft; r.draft = { ...d, text: input.value }; } else delete r.draft;
  return r;
}
function scheduleSave(now) { if (!S.review) return; clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flushSave, now ? 0 : 350); }
async function flushSave() {
  clearTimeout(S.saveTimer);
  if (!S.review) return;
  try { await api.saveReview(S.review.video.sha256, serialize()); } catch (e) { showError('La revue n\'a pas pu être enregistrée : ' + e.message); }
}

/* ---------- Ouverture d'une vidéo ---------- */
api.on('video:hash-progress', (p) => pill('Ouverture de la vidéo… ' + Math.round(p * 100) + ' %'));
async function openWith(factory) {
  try {
    if (S.draft) await commitDraft();
    await flushSave();
    const info = await factory();
    if (info) await loadVideo(info);
  } catch (e) { showError(e.message || String(e)); } finally { if (!S.draft) pill(null); }
}
function mediaErrorMessage(codec) {
  const err = video.error; const what = codec ? ' (codec ' + codec + ')' : '';
  if (err && err.code === 4) return 'Ce format vidéo ne peut pas être lu' + what + '. Demandez un export MP4 en H.264 avec un son AAC, puis rouvrez-le.';
  if (err && err.code === 3) return 'La vidéo est endommagée ou mal encodée' + what + '. Demandez un nouvel export.';
  return 'La vidéo n\'a pas pu être ouverte' + what + (err && err.message ? ' : ' + err.message : '.');
}
async function loadVideo(info) {
  const c = info.container || {};
  stopVoice();
  S.fps = c.fps || null; S.fpsSamples = []; S.lastMd = null; S.draft = null; S.selectedId = null;
  video.src = info.url; peek.src = info.url;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => { video.onerror = null; resolve(); };
    video.onerror = () => reject(new Error(mediaErrorMessage(c.codec)));
  });
  video.onerror = () => showError(mediaErrorMessage(c.codec));
  if (!video.videoWidth) throw new Error('Ce fichier ne contient pas d\'image vidéo : ' + info.fileName);
  const existing = await api.loadReview(info.sha256);
  S.review = existing || { schema: 'revue-video/1', id: uid('r'), createdAt: nowIso(), reviewer: S.settings.reviewer || '', notes: [], exports: [] };
  const prev = (existing && existing.video) || {};
  S.review.video = {
    fileName: info.fileName, path: info.path, sha256: info.sha256, size: info.size, modifiedAt: info.modifiedAt,
    duration: video.duration, width: video.videoWidth, height: video.videoHeight, codec: c.codec || null,
    fps: S.fps || (prev.fpsSource === 'mesure' ? prev.fps : null), fpsSource: S.fps ? 'fichier' : prev.fpsSource || null,
    frameCount: c.frameCount || null,
  };
  if (!S.fps && S.review.video.fps) S.fps = S.review.video.fps;
  if (S.fps && !S.review.video.frameCount) S.review.video.frameCount = Math.round(video.duration * S.fps);
  appEl.classList.replace('no-video', 'has-video');
  $('sendBtn').disabled = false; input.disabled = false; $('micBtn').disabled = false;
  $('fileName').textContent = info.fileName;
  document.title = 'Retake · ' + info.fileName;
  video.playbackRate = S.settings.speed || 1;
  if (S.fps) seekFrame(0); else seekTime(0);
  const restored = S.review.draft; delete S.review.draft;
  if (restored) { S.draft = { ...restored, snapshot: null }; input.value = restored.text || ''; seekTime(restored.time); if (!restored.editingId) captureSnapshot(); }
  renderAll(); resizeOverlay();
  pill(null);
  toast(existing && existing.notes.length ? 'Revue reprise là où vous l\'aviez laissée.' : 'Lancez la lecture. Dès que quelque chose ne va pas, dites-le ou écrivez-le.');
  scheduleSave(true);
}

/* ---------- Commentaire en cours ---------- */
function ensureDraft(source = 'texte') {
  if (S.draft) return S.draft;
  cancelResume();
  let pausedBy = null;
  if (!video.paused) { pauseVideo(); pausedBy = source; }
  const f = currentFrame();
  S.draft = { id: uid('n'), time: f != null ? f / S.fps : video.currentTime, frame: f, end: null, text: '', shapes: [], clips: [], source, status: 'nouvelle', createdAt: nowIso(), locked: false, pausedBy, snapshot: null };
  captureSnapshot();
  renderComposer(); renderDots();
  return S.draft;
}
function captureSnapshot() {
  const d = S.draft; if (!d) return null;
  const token = {}; d.snapToken = token;
  d.snapshotPromise = grabFrame().then((buf) => { if (d.snapToken === token) d.snapshot = buf; })
    .catch((e) => showError('L\'image du commentaire n\'a pas pu être capturée : ' + e.message));
  return d.snapshotPromise;
}
let followTimer = null;
function followPlayhead() {
  const d = S.draft;
  if (!d || !video.paused || d.locked || d.editingId || d.shapes.length) return;
  const f = currentFrame(); const t = f != null ? f / S.fps : video.currentTime;
  if (Math.abs(t - d.time) < 1e-6) return;
  d.time = t; d.frame = f;
  renderComposer(); renderDots();
  clearTimeout(followTimer); followTimer = setTimeout(captureSnapshot, 120);
}
async function commitDraft() {
  const d = S.draft; if (!d) return;
  clearTimeout(followTimer); cancelResume();
  d.text = input.value.trim();
  if (!d.text && !d.clips.length && !d.shapes.length) { dropDraft(); return; }
  if (!d.editingId) { if (!d.snapshot) await captureSnapshot(); await d.snapshotPromise; }
  const sha = S.review.video.sha256;
  const existing = d.editingId ? S.review.notes.find((n) => n.id === d.editingId) : null;
  const note = {
    ...(existing || {}), id: d.editingId || d.id, time: d.time, frame: d.frame, end: d.end || null, text: d.text,
    shapes: d.shapes, clips: d.clips, source: d.source, status: d.status || 'nouvelle', origin: d.origin || null,
    previousImage: d.previousImage || null, createdAt: (existing && existing.createdAt) || d.createdAt, updatedAt: nowIso(),
  };
  if (d.snapshot) { note.frameFile = 'frames/' + note.id + '.jpg'; await api.writeAsset(sha, note.frameFile, d.snapshot); note.frameVersion = Date.now(); }
  if (!note.frameFile && !note.origin) { showError('Ce commentaire n\'a pas d\'image de référence. Mettez la vidéo sur pause puis réessayez.'); return; }
  if (existing) Object.assign(existing, note); else S.review.notes.push(note);
  S.draft = null; S.selectedId = note.id; input.value = ''; autoGrow(); input.blur(); pill(null);
  renderAll(); scheduleSave(true);
  const el = document.querySelector('.item[data-id="' + note.id + '"]'); if (el) el.scrollIntoView({ block: 'nearest' });
}
function dropDraft() { S.draft = null; input.value = ''; autoGrow(); pill(null); renderComposer(); renderDots(); redraw(); scheduleSave(); }
function cancelDraft() {
  const d = S.draft; if (!d) return;
  d.text = input.value;
  dropDraft(); cancelResume();
  if (d.text.trim() || d.clips.length || d.shapes.length) toast('Commentaire annulé.', 'Rétablir', () => { S.draft = d; input.value = d.text; autoGrow(); renderAll(); });
}
function editNote(id) {
  const n = S.review.notes.find((x) => x.id === id); if (!n) return;
  if (S.draft) cancelDraft();
  if (!video.paused) video.pause();
  seekTime(n.time);
  S.draft = { ...JSON.parse(JSON.stringify(n)), editingId: n.id, locked: true, snapshot: null, pausedBy: null };
  input.value = n.text; autoGrow(); S.selectedId = id;
  renderAll(); input.focus();
}
function deleteNote(id) {
  const i = S.review.notes.findIndex((x) => x.id === id); if (i < 0) return;
  const [n] = S.review.notes.splice(i, 1);
  if (S.selectedId === id) S.selectedId = null;
  renderAll(); scheduleSave(true);
  toast('Commentaire supprimé.', 'Rétablir', () => { S.review.notes.splice(i, 0, n); renderAll(); scheduleSave(true); });
}
function setStatus(id, status) {
  const n = S.review.notes.find((x) => x.id === id); if (!n) return;
  n.status = n.status === status ? 'a_verifier' : status; n.updatedAt = nowIso();
  renderAll(); scheduleSave(true);
}

/* ---------- Dessin sur l'image ---------- */
function resizeOverlay() {
  const r = stage.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(r.width * dpr); overlay.height = Math.round(r.height * dpr);
  redraw();
}
new ResizeObserver(resizeOverlay).observe(stage);
function contentRect() {
  const W = stage.clientWidth; const H = stage.clientHeight;
  const vw = video.videoWidth || 16; const vh = video.videoHeight || 9;
  const s = Math.min(W / vw, H / vh);
  return { x: (W - vw * s) / 2, y: (H - vh * s) / 2, w: vw * s, h: vh * s };
}
function visibleAt(n, f, t) {
  if (f != null && n.frame != null) return f >= n.frame && f <= (n.end && n.end.frame != null ? n.end.frame : n.frame);
  return t >= n.time - 0.02 && t <= (n.end ? n.end.time : n.time) + 0.02;
}
function redraw() {
  const dpr = window.devicePixelRatio || 1;
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!S.review) return;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rect = contentRect(); const f = currentFrame(); const t = currentTime(); const scale = rect.w / 1280;
  if (video.paused) {
    for (const n of S.review.notes) {
      if (S.draft && S.draft.editingId === n.id) continue;
      if (n.shapes.length && visibleAt(n, f, t)) drawShapes(octx, n.shapes, rect, { labels: n.shapes.length > 1, scale, alpha: n.id === S.selectedId ? 1 : 0.75 });
    }
  }
  if (S.draft && visibleAt(S.draft, f, t)) drawShapes(octx, S.draft.shapes, rect, { labels: S.draft.shapes.length > 1, scale });
  if (S.drawing && S.drawing.shape) drawShapes(octx, [S.drawing.shape], rect, { scale });
}
function toNorm(e) {
  const r = overlay.getBoundingClientRect(); const c = contentRect();
  return { x: clamp((e.clientX - r.left - c.x) / c.w, 0, 1), y: clamp((e.clientY - r.top - c.y) / c.h, 0, 1) };
}
overlay.addEventListener('pointerdown', (e) => {
  if (!S.review || e.button !== 0) return;
  cancelResume();
  overlay.setPointerCapture(e.pointerId);
  const wasPlaying = !video.paused;
  if (wasPlaying) pauseVideo();
  if (S.draft && !visibleAt(S.draft, currentFrame(), currentTime())) {
    toast('Terminez d\'abord le commentaire en cours (Entrée pour l\'ajouter, Échap pour l\'annuler).');
    return;
  }
  S.drawing = { p0: toNorm(e), x0: e.clientX, y0: e.clientY, wasPlaying, moved: false, shape: null };
});
overlay.addEventListener('pointermove', (e) => {
  const d = S.drawing; if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
  d.moved = true;
  const p = toNorm(e);
  d.shape = { type: 'rect', x: Math.min(d.p0.x, p.x), y: Math.min(d.p0.y, p.y), w: Math.abs(p.x - d.p0.x), h: Math.abs(p.y - d.p0.y), color: MARK };
  redraw();
});
overlay.addEventListener('pointerup', () => {
  const d = S.drawing; if (!d) return;
  S.drawing = null;
  let added = false;
  if (!d.moved && !d.wasPlaying) {
    ensureDraft('dessin').shapes.push({ type: 'pin', x: round4(d.p0.x), y: round4(d.p0.y), color: MARK }); added = true;
  } else if (d.moved && d.shape && d.shape.w > 0.004 && d.shape.h > 0.004) {
    const s = d.shape; ['x', 'y', 'w', 'h'].forEach((k) => { s[k] = round4(s[k]); });
    ensureDraft('dessin').shapes.push(s); added = true;
  }
  if (added) { S.draft.locked = true; renderComposer(); input.focus(); scheduleSave(); }
  redraw();
});
overlay.addEventListener('pointercancel', () => { S.drawing = null; redraw(); });
function undoShape() { if (S.draft && S.draft.shapes.length) { S.draft.shapes.pop(); renderComposer(); redraw(); scheduleSave(); } }

/* ---------- Commentaires vocaux ---------- */
function ensurePlaybackAnalyser() {
  if (S.pa) return;
  const ctx = new AudioContext();
  const src = ctx.createMediaElementSource(video);
  const an = ctx.createAnalyser(); an.fftSize = 1024;
  src.connect(an); an.connect(ctx.destination);
  S.pa = { ctx, an, buf: new Float32Array(1024) };
}
function playbackLevel() {
  if (!S.pa || video.paused || video.muted) return 0;
  S.pa.an.getFloatTimeDomainData(S.pa.buf);
  let s = 0; for (const x of S.pa.buf) s += x * x;
  return Math.sqrt(s / S.pa.buf.length);
}
function stopVoice() { if (S.voice) { S.voice.stop(); S.voice = null; } renderVoice(); }
async function toggleVoice() {
  if (!S.review) return;
  if (S.voice && S.voice.active) { stopVoice(); return; }
  try {
    ensurePlaybackAnalyser();
    await S.pa.ctx.resume();
    S.voice = new VoiceReview({ onStart: onSpeechStart, onClip: onSpeechClip, onLevel: onVoiceLevel, playbackLevel });
    S.voice.mode = 'auto';
    await S.voice.start();
    renderVoice();
    if (!S.settings.voiceTipShown) { toast('Je vous écoute. Avec des haut-parleurs, un casque évite que le son de la vidéo soit pris pour votre voix.'); saveSetting({ voiceTipShown: true }); }
  } catch (e) { S.voice = null; renderVoice(); showError(e.message); }
}
function onVoiceLevel(level, speaking) {
  $('micBtn').style.setProperty('--lvl', level.toFixed(2));
  $('micBtn').classList.toggle('speaking', speaking);
}
function onSpeechStart() {
  cancelResume();
  if (!S.draft && !video.paused && S.settings.pauseOnSpeech === false) {
    S.pendingVoice = { id: uid('n'), time: currentTime(), frame: currentFrame(), snapshot: grabFrame(true) };
    S.clipAnchor = { time: S.pendingVoice.time, frame: S.pendingVoice.frame };
  } else {
    const d = ensureDraft('voix');
    S.clipAnchor = { time: d.time, frame: d.frame };
  }
  pill('Enregistrement de votre commentaire…', { rec: true });
}
async function onSpeechClip(clip) {
  const sha = S.review.video.sha256;
  const pending = S.pendingVoice; S.pendingVoice = null;
  if (!clip) {
    pill(null);
    const d = S.draft;
    if (d && d.source === 'voix' && !d.clips.length && !d.shapes.length && !input.value.trim()) { const resume = d.pausedBy === 'voix'; dropDraft(); if (resume) play(); }
    return;
  }
  const id = uid('a'); const file = 'audio/' + id + '.wav';
  try { await api.writeAsset(sha, file, clip.wav); } catch (e) { pill(null); showError('Le commentaire vocal n\'a pas pu être enregistré : ' + e.message); return; }
  const anchor = S.clipAnchor || { time: currentTime(), frame: currentFrame() };
  const entry = { id, file, duration: clip.duration, videoTime: anchor.time, frame: anchor.frame, recordedAt: nowIso() };
  if (pending) {
    const note = { id: pending.id, time: pending.time, frame: pending.frame, end: null, text: '', shapes: [], clips: [entry], source: 'voix', status: 'nouvelle', origin: null, previousImage: null, createdAt: nowIso(), updatedAt: nowIso(), frameFile: 'frames/' + pending.id + '.jpg', frameVersion: Date.now() };
    await api.writeAsset(sha, note.frameFile, await pending.snapshot);
    S.review.notes.push(note); renderAll(); scheduleSave(true); pill(null);
    return;
  }
  const d = S.draft || ensureDraft('voix');
  d.clips.push(entry);
  renderComposer(); scheduleSave(true);
  startResume(d.pausedBy === 'voix');
}
function startResume(thenPlay) {
  cancelResume();
  let left = 2;
  const label = () => 'Commentaire vocal ajouté' + (thenPlay ? ' · reprise dans ' + left + ' s' : '');
  pill(label(), { action: () => { cancelResume(); if (S.draft) S.draft.pausedBy = null; pill('Entourez une zone ou ajoutez un mot, puis Entrée'); }, actionLabel: 'Rester ici' });
  S.resumeTimer = setInterval(async () => {
    left -= 1;
    if (left > 0) { pill(label(), { action: $('floatAction').onclick, actionLabel: 'Rester ici' }); return; }
    cancelResume(); pill(null);
    if (thenPlay) play(); else commitDraft();
  }, 1000);
}
function cancelResume() { if (S.resumeTimer) { clearInterval(S.resumeTimer); S.resumeTimer = null; pill(null); } }

/* ---------- Vérifier une nouvelle version ---------- */
async function importPrevious(reportPath) {
  if (!S.review) { toast('Ouvrez d\'abord la nouvelle version de la vidéo, puis importez la revue précédente.'); return; }
  let r;
  try { r = reportPath ? await api.importReviewPath(reportPath) : await api.importReview(); } catch (e) { showError(e.message); return; }
  if (!r) return;
  const { report, images } = r;
  if (report.video.sha256 === S.review.video.sha256) { showError('Cette revue porte sur la vidéo ouverte. Ouvrez la nouvelle version corrigée, puis importez la revue pour vérifier les corrections.'); return; }
  const sha = S.review.video.sha256; let added = 0;
  for (const rn of report.notes) {
    if (S.review.notes.some((n) => n.origin && n.origin.noteId === rn.id && n.origin.exportedAt === report.exportedAt)) continue;
    const id = uid('n'); let previousImage = null;
    if (images[rn.id]) { previousImage = 'frames/' + id + '-precedente.jpg'; await api.writeAsset(sha, previousImage, images[rn.id]); }
    const t = Math.min(rn.time, video.duration);
    S.review.notes.push({
      id, time: S.fps ? Math.round(t * S.fps) / S.fps : t, frame: S.fps ? Math.round(t * S.fps) : null, end: null, text: '',
      shapes: rn.shapes.map((s) => s.normalized), clips: [], source: 'import', status: 'a_verifier', previousImage, frameFile: null,
      origin: { number: rn.number, noteId: rn.id, exportedAt: report.exportedAt, reviewer: report.reviewer, fileName: report.video.fileName, sha256: report.video.sha256, text: rn.text || (rn.clips.length ? 'Commentaire vocal' : 'Voir la zone entourée') },
      createdAt: nowIso(), updatedAt: nowIso(),
    });
    added += 1;
  }
  renderAll(); scheduleSave(true);
  toast(plural(added, 'point', 'points') + ' à vérifier. Pour chacun, indiquez Corrigé ou Pas corrigé.');
  if (Math.abs(report.video.duration - video.duration) > 0.5) setTimeout(() => showError('Cette version dure ' + shortTime(video.duration) + ' au lieu de ' + shortTime(report.video.duration) + ' : certains points peuvent tomber un peu avant ou après le bon moment.'), 3000);
}

/* ---------- Envoi ---------- */
async function openSend() {
  if (!S.review) return;
  cancelResume();
  if (S.draft) await commitDraft();
  if (S.draft) return;
  if (!video.paused) pauseVideo();
  const n = S.review.notes.length;
  $('sendCount').textContent = n ? plural(n, 'commentaire', 'commentaires') + ' sur « ' + S.review.video.fileName + ' ».' : 'Aucun commentaire : la revue indiquera que la vidéo est validée telle quelle.';
  $('nameInput').value = S.review.reviewer || S.settings.reviewer || '';
  $('sendAsk').hidden = false; $('sendDone').hidden = true; $('sendModal').hidden = false;
  setTimeout(() => ($('nameInput').value ? $('sendGo') : $('nameInput')).focus(), 30);
}
async function exportReport() {
  const reviewer = $('nameInput').value.trim() || S.review.reviewer || S.settings.reviewer || '';
  if (!reviewer) { $('nameInput').focus(); toast('Indiquez votre prénom : il figure dans la revue.'); return null; }
  S.review.reviewer = reviewer; saveSetting({ reviewer });
  const back = currentTime(); const sha = S.review.video.sha256;
  $('sendGo').disabled = true;
  try {
    const notes = orderedNotes(S.review);
    for (const n of notes) {
      if (n.frameFile) continue;
      $('sendGo').textContent = 'Préparation des images…';
      seekTime(n.time); await frameReady();
      n.frameFile = 'frames/' + n.id + '.jpg'; n.frameVersion = Date.now();
      await api.writeAsset(sha, n.frameFile, await grabFrame());
    }
    const files = []; const copyAssets = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]; const label = noteLabel(i + 1);
      $('sendGo').textContent = 'Image ' + (i + 1) + ' sur ' + notes.length + '…';
      files.push({ rel: 'images/' + label + '-annotee.jpg', data: await composeAnnotated(dataUrl(n.frameFile, n.frameVersion), n.shapes) });
      copyAssets.push({ from: n.frameFile, to: 'images/' + label + '-brute.jpg' });
      if (n.previousImage) copyAssets.push({ from: n.previousImage, to: 'images/' + label + '-version-precedente.jpg' });
      n.clips.forEach((c, k) => copyAssets.push({ from: c.file, to: 'audio/' + label + '-' + String.fromCharCode(97 + k) + '.wav' }));
    }
    const exportedAt = nowIso(); const d = new Date(exportedAt);
    const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0');
    const baseName = 'Retake ' + S.review.video.fileName.replace(/\.[^.]+$/, '') + ' - ' + reviewer + ' - ' + stamp;
    const docs = buildDocuments({ review: S.review, appVersion: S.appVersion, exportedAt, notes, zipName: baseName + '.zip' });
    const res = await api.exportReport({ sha256: sha, baseName, markdown: docs.markdown, json: docs.json, html: docs.html, files, copyAssets });
    S.review.exports = [...(S.review.exports || []), { at: exportedAt, zipPath: res.zipPath, notes: notes.length }];
    S.lastExport = { ...res, message: docs.message };
    scheduleSave(true);
    $('sendPath').textContent = res.zipPath;
    $('sendAsk').hidden = true; $('sendDone').hidden = false;
    return res;
  } catch (e) {
    showError('La revue n\'a pas pu être créée : ' + (e.message || e)); return null;
  } finally {
    $('sendGo').disabled = false; $('sendGo').textContent = 'Créer le fichier';
    seekTime(back);
  }
}

/* ---------- Affichage ---------- */
function renderAll() { renderList(); renderDots(); renderComposer(); renderVoice(); updateTime(); redraw(); }
function renderList() {
  const box = $('list'); box.innerHTML = '';
  if (!S.review) { $('count').textContent = ''; box.innerHTML = '<div class="empty"><b>Aucune vidéo ouverte</b>Vos commentaires apparaîtront ici.</div>'; return; }
  const notes = orderedNotes(S.review);
  $('count').textContent = notes.length || '';
  if (!notes.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.innerHTML = '<b>Pas encore de commentaire</b>Écrivez ci-dessous, cliquez sur le micro pour parler, ou entourez une zone sur la vidéo.<br><br>';
    const b = document.createElement('button'); b.className = 'lnk'; b.textContent = 'Vérifier les corrections d\'une revue précédente';
    b.onclick = () => importPrevious(); e.append(b); box.append(e); return;
  }
  for (const n of notes) {
    const el = document.createElement('div');
    el.className = 'item' + (n.id === S.selectedId ? ' sel' : ''); el.dataset.id = n.id;
    const t = document.createElement('div'); t.className = 't'; t.textContent = shortTime(n.time);
    const body = document.createElement('div');
    if (n.origin) { const p = document.createElement('div'); p.className = 'prev'; p.textContent = 'Point ' + n.origin.number + ' de la revue du ' + new Date(n.origin.exportedAt).toLocaleDateString('fr-FR'); body.append(p); }
    const txt = document.createElement('div'); txt.className = 'txt';
    const main = n.origin ? n.origin.text + (n.text ? '\n' + n.text : '') : n.text;
    if (main) txt.textContent = main; else { txt.textContent = n.clips.length ? 'Commentaire vocal' : 'Zone à revoir'; txt.classList.add('voice-only'); }
    body.append(txt);
    const meta = document.createElement('div'); meta.className = 'meta';
    n.clips.forEach((c) => meta.append(clipButton(c)));
    if (n.shapes.length && !n.origin) { const s = document.createElement('span'); s.textContent = plural(n.shapes.length, 'zone', 'zones'); meta.append(s); }
    const tools = document.createElement('div'); tools.className = 'tools';
    const mk = (label, fn) => { const b = document.createElement('button'); b.className = 'lnk'; b.textContent = label; b.onclick = (e) => { e.stopPropagation(); fn(); }; tools.append(b); };
    mk('Modifier', () => editNote(n.id)); mk('Supprimer', () => deleteNote(n.id));
    meta.append(tools); body.append(meta);
    if (n.origin) {
      const v = document.createElement('div'); v.className = 'verdict';
      [['corrige', 'Corrigé', 'ok'], ['pas_corrige', 'Pas corrigé', 'ko']].forEach(([st, label, cls]) => {
        const b = document.createElement('button'); b.className = cls + (n.status === st ? ' on' : ''); b.textContent = label;
        b.onclick = (e) => { e.stopPropagation(); setStatus(n.id, st); }; v.append(b);
      });
      body.append(v);
    }
    el.append(t, body);
    el.onclick = () => selectNote(n.id);
    box.append(el);
  }
}
function clipButton(c) {
  const b = document.createElement('button'); b.className = 'play-clip';
  b.innerHTML = '<i></i>';
  b.append(document.createTextNode(shortTime(c.duration)));
  b.onclick = (e) => {
    e.stopPropagation();
    if (S.playingClip && S.playingClip.src.endsWith(c.file)) { S.playingClip.pause(); S.playingClip = null; b.classList.remove('on'); return; }
    if (S.playingClip) S.playingClip.pause();
    document.querySelectorAll('.play-clip.on').forEach((x) => x.classList.remove('on'));
    if (!video.paused) pauseVideo();
    const a = new Audio(dataUrl(c.file)); S.playingClip = a; b.classList.add('on');
    a.onended = () => { b.classList.remove('on'); S.playingClip = null; };
    a.play().catch((err) => showError('Lecture du commentaire vocal impossible : ' + err.message));
  };
  return b;
}
function selectNote(id) {
  const n = S.review.notes.find((x) => x.id === id); if (!n) return;
  if (S.draft && S.draft.editingId !== id) commitDraft();
  S.selectedId = id;
  if (!video.paused) video.pause();
  seekTime(n.time);
  renderList(); renderDots(); redraw();
}
function renderDots() {
  const box = $('dots'); box.innerHTML = '';
  if (!S.review || !video.duration) return;
  const D = video.duration;
  const items = [...S.review.notes, ...(S.draft && !S.draft.editingId ? [{ ...S.draft, pending: true }] : [])];
  for (const n of items) {
    const d = document.createElement('div');
    d.className = 'dot' + (n.pending ? ' pending' : '') + (n.id === S.selectedId ? ' sel' : '') + (n.status === 'corrige' ? ' ok' : n.status === 'pas_corrige' ? ' ko' : '');
    d.style.left = (n.time / D * 100) + '%';
    d.title = shortTime(n.time) + (n.text ? ' · ' + n.text.slice(0, 80) : n.origin ? ' · ' + n.origin.text.slice(0, 80) : '');
    if (!n.pending) d.onpointerdown = (e) => { e.stopPropagation(); selectNote(n.id); };
    box.append(d);
  }
}
function renderComposer() {
  const d = S.draft;
  const a = $('anchor'); a.innerHTML = '';
  if (d) {
    a.append(d.editingId ? 'Modifier le commentaire à ' : 'Commentaire à ');
    const b = document.createElement('b'); b.textContent = shortTime(d.time); a.append(b);
    const extra = [];
    if (d.shapes.length) extra.push(plural(d.shapes.length, 'zone', 'zones'));
    if (d.clips.length) extra.push(d.clips.length > 1 ? d.clips.length + ' vocaux' : 'vocal');
    if (extra.length) a.append(' · ' + extra.join(' · '));
    const c = document.createElement('button'); c.className = 'lnk'; c.textContent = 'Annuler'; c.onclick = cancelDraft; a.append(c);
    if (d.shapes.length && !S.resumeTimer) pill(plural(d.shapes.length, 'zone entourée', 'zones entourées') + ' · ajoutez un mot puis Entrée', { action: undoShape, actionLabel: 'Effacer la dernière' });
    else if (!d.shapes.length && !S.resumeTimer && !(S.voice && S.voice.speaking)) pill(null);
  }
  if (S.review) input.placeholder = d ? 'Ce qui ne va pas, ce que vous voudriez à la place' : 'Commenter à ' + shortTime(currentTime()) + '…';
}
function renderVoice() {
  const on = !!(S.voice && S.voice.active);
  $('micBtn').classList.toggle('on', on);
  $('box').classList.toggle('listening', on);
  $('micBtn').title = on ? 'Arrêter l\'écoute' : 'Commenter à voix haute';
  $('help').textContent = on ? 'Je vous écoute : parlez dès que quelque chose ne va pas, la vidéo se met en pause.' : 'Entrée pour ajouter · dessinez sur la vidéo pour montrer une zone';
}
let lastPlaceholder = 0;
function updateTime() {
  if (!S.review) return;
  const D = video.duration || 1; const t = video.paused ? currentTime() : video.currentTime;
  $('timeNow').textContent = shortTime(t); $('timeTotal').textContent = ' / ' + shortTime(D);
  const pct = clamp(t / D, 0, 1) * 100;
  $('played').style.width = pct + '%'; $('head').style.left = pct + '%';
  const now = performance.now();
  if (!S.draft && now - lastPlaceholder > 250) { lastPlaceholder = now; input.placeholder = 'Commenter à ' + shortTime(t) + '…'; }
}
function onFrame() { updateTime(); followPlayhead(); redraw(); }
video.addEventListener('seeking', () => { S.frameValid = false; });
video.addEventListener('seeked', () => { updateTime(); redraw(); });
video.addEventListener('play', () => { appEl.classList.add('playing'); redraw(); });
video.addEventListener('pause', () => { appEl.classList.remove('playing'); redraw(); });
video.addEventListener('timeupdate', updateTime);
video.addEventListener('ended', () => appEl.classList.remove('playing'));

/* ---------- Timeline ---------- */
const tl = $('timeline'); let scrubbing = false;
const timeAt = (e) => { const r = tl.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * (video.duration || 0); };
tl.addEventListener('pointerdown', (e) => { if (!S.review) return; cancelResume(); scrubbing = true; tl.setPointerCapture(e.pointerId); if (!video.paused) video.pause(); seekTime(timeAt(e)); });
tl.addEventListener('pointermove', (e) => {
  if (!S.review) return;
  const t = timeAt(e);
  if (scrubbing && !video.seeking) seekTime(t);
  const r = tl.getBoundingClientRect();
  $('peek').hidden = false; $('peek').style.left = clamp(e.clientX - r.left, 90, r.width - 90) + 'px';
  $('peekTime').textContent = shortTime(t);
  if (!peek.seeking) peek.currentTime = t;
});
tl.addEventListener('pointerup', (e) => { if (scrubbing) { scrubbing = false; seekTime(timeAt(e)); } });
tl.addEventListener('pointerleave', () => { $('peek').hidden = true; });
peek.addEventListener('seeked', () => { const c = $('peekCanvas'); c.getContext('2d').drawImage(peek, 0, 0, c.width, c.height); });

/* ---------- Saisie ---------- */
function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; }
input.addEventListener('input', () => {
  autoGrow(); cancelResume();
  if (!S.review) return;
  if (input.value.trim() && !S.draft) ensureDraft('texte');
  if (S.draft) { S.draft.text = input.value; if (input.value.trim()) S.draft.locked = true; scheduleSave(); }
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (S.draft) commitDraft(); else if (!input.value.trim()) input.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); if (S.draft) cancelDraft(); input.blur(); }
});
input.addEventListener('focus', cancelResume);

/* ---------- Commandes ---------- */
$('openBtn').onclick = () => openWith(() => api.pickVideo());
$('openBtn2').onclick = () => openWith(() => api.pickVideo());
$('playBtn').onclick = togglePlay;
$('prevBtn').onclick = () => step(-1);
$('nextBtn').onclick = () => step(1);
$('speedBtn').onclick = () => {
  const i = (SPEEDS.indexOf(video.playbackRate) + 1) % SPEEDS.length;
  video.playbackRate = SPEEDS[i]; saveSetting({ speed: SPEEDS[i] }); renderSpeed();
};
function renderSpeed() { $('speedBtn').textContent = String(video.playbackRate).replace('.', ',') + '×'; }
$('muteBtn').onclick = () => { video.muted = !video.muted; appEl.classList.toggle('muted-on', video.muted); };
$('micBtn').onclick = toggleVoice;
$('sendBtn').onclick = openSend;
$('sendCancel').onclick = () => { $('sendModal').hidden = true; };
$('sendGo').onclick = exportReport;
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') exportReport(); });
$('sendClose').onclick = () => { $('sendModal').hidden = true; };
$('revealBtn').onclick = () => S.lastExport && api.reveal(S.lastExport.zipPath);
$('copyBtn').onclick = async () => { if (S.lastExport) { await api.copy(S.lastExport.message); toast('Message copié. Collez-le avec le fichier en pièce jointe.'); } };
let settingsTimer = null;
function saveSetting(patch) { Object.assign(S.settings, patch); clearTimeout(settingsTimer); settingsTimer = setTimeout(() => api.setSettings(S.settings), 300); }

window.addEventListener('keydown', (e) => {
  if (!$('sendModal').hidden) { if (e.key === 'Escape') $('sendModal').hidden = true; return; }
  if (e.target.matches('textarea, input')) return;
  if (!S.review) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoShape(); return; }
  if (mod || e.altKey) return;
  if (S.resumeTimer && !['Shift'].includes(e.key)) cancelResume();
  const k = e.key; const lower = k.toLowerCase();
  if (k === ' ') { e.preventDefault(); if (!e.repeat) togglePlay(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) stepSeconds(-1); else step(-1); }
  else if (k === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) stepSeconds(1); else step(1); }
  else if (lower === 'j') stepSeconds(-5);
  else if (lower === 'l') stepSeconds(5);
  else if (lower === 'm') { if (!e.repeat) toggleVoice(); }
  else if (k === 'Enter') { e.preventDefault(); if (S.draft) commitDraft(); else { if (!video.paused) pauseVideo(); input.focus(); } }
  else if (k === 'Escape') { if (S.draft) cancelDraft(); else { S.selectedId = null; renderList(); renderDots(); redraw(); } }
}, true);
document.addEventListener('pointerdown', (e) => { if (e.target.closest('#stage, .composer')) cancelResume(); }, true);
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });

/* ---------- Glisser-déposer et menu ---------- */
window.addEventListener('dragover', (e) => { e.preventDefault(); $('welcome').classList.add('over'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('welcome').classList.remove('over'); });
window.addEventListener('drop', (e) => {
  e.preventDefault(); $('welcome').classList.remove('over');
  const file = e.dataTransfer.files[0]; if (!file) return;
  const p = api.pathForFile(file);
  if (/\.json$/i.test(p)) { importPrevious(p); return; }
  openWith(() => api.openVideo(p));
});
api.on('open-path', (p) => openWith(() => api.openVideo(p)));
api.on('menu', (cmd) => {
  if (cmd === 'open') openWith(() => api.pickVideo());
  else if (cmd === 'import') importPrevious();
  else if (cmd === 'export') openSend();
  else if (cmd === 'export-dir') api.chooseExportDir().then((d) => d && toast('Les revues seront enregistrées dans ' + d + '.'));
  else if (cmd === 'help') toast('Espace : lecture et pause · flèches : image par image · Entrée : commenter · M : micro · Échap : annuler');
});
window.addEventListener('beforeunload', () => { if (S.review) api.saveReview(S.review.video.sha256, serialize()); });

/* ---------- Démarrage ---------- */
(async () => {
  const info = await api.info();
  S.appVersion = info.version;
  document.body.classList.toggle('mac', info.platform === 'darwin');
  S.settings = { ...(await api.getSettings()) };
  if (S.settings.speed) video.playbackRate = S.settings.speed;
  renderSpeed(); renderList();
  trackFrames();
  const pending = await api.pendingOpen();
  if (pending) openWith(() => api.openVideo(pending));
})();

// Accès utilisé par les tests de bout en bout.
window.__revue = {
  S, video, commitDraft, ensureDraft, exportReport, openSend, toggleVoice, seekFrame, currentFrame, importPrevious, setStatus,
  openPath: (p) => openWith(() => api.openVideo(p)),
};
