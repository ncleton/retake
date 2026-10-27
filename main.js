'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { Readable } = require('stream');
const { zipSync } = require('fflate');
const { readMp4Info } = require('./lib/mp4info');

const SCHEME = 'revue';
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

if (process.env.REVUE_FAKE_AUDIO) {
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.REVUE_FAKE_AUDIO);
  app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox');
}
if (process.env.REVUE_USER_DATA) app.setPath('userData', process.env.REVUE_USER_DATA);

const RENDERER = path.join(__dirname, 'renderer');
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const mediaTokens = new Map();
let win = null;

const reviewDir = (sha) => {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Empreinte de vidéo invalide : ' + sha);
  return path.join(app.getPath('userData'), 'reviews', sha);
};
const safeRel = (rel) => {
  const norm = path.posix.normalize(String(rel).replace(/\\/g, '/'));
  if (norm === '..' || norm.startsWith('../') || path.posix.isAbsolute(norm)) throw new Error('Chemin refusé : ' + rel);
  return norm;
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.json': 'application/json',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.woff2': 'font/woff2',
};

async function serveFile(filePath, request) {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { return new Response('Fichier introuvable', { status: 404 }); }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = -1; let end = -1;
    if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, stat.size - Number(m[2])); end = stat.size - 1; }
    else if (m && m[1] !== '') { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1; }
    if (start < 0 || start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + stat.size } });
    }
    const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
    return new Response(stream, { status: 206, headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), { status: 200, headers: { ...base, 'Content-Length': String(stat.size) } });
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app') return new Response('Hôte inconnu', { status: 404 });
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'media') {
        const file = mediaTokens.get(parts[1]);
        if (!file) return new Response('Vidéo non autorisée', { status: 403 });
        return await serveFile(file, request);
      }
      if (parts[0] === 'data') return await serveFile(path.join(reviewDir(parts[1]), safeRel(parts.slice(2).join('/'))), request);
      return await serveFile(path.join(RENDERER, safeRel(parts.join('/') || 'index.html')), request);
    } catch (e) {
      return new Response(String(e.message || e), { status: 400 });
    }
  });
}

function hashFile(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, st) => {
      if (err) return reject(err);
      const hash = crypto.createHash('sha256');
      let done = 0; let last = 0;
      const s = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
      s.on('data', (c) => {
        hash.update(c); done += c.length;
        const now = Date.now();
        if (now - last > 120) { last = now; onProgress(done / st.size); }
      });
      s.on('error', reject);
      s.on('end', () => resolve({ sha256: hash.digest('hex'), size: st.size }));
    });
  });
}

async function openVideo(filePath) {
  filePath = path.resolve(filePath);
  const st = await fsp.stat(filePath).catch(() => null);
  if (!st || !st.isFile()) throw new Error('Fichier introuvable : ' + filePath);
  const { sha256, size } = await hashFile(filePath, (p) => win && win.webContents.send('video:hash-progress', p));
  let container = null;
  try { container = await readMp4Info(filePath); } catch { container = null; }
  const token = crypto.randomBytes(12).toString('hex');
  mediaTokens.set(token, filePath);
  await fsp.mkdir(reviewDir(sha256), { recursive: true });
  const settings = await readSettings();
  settings.recent = [filePath, ...(settings.recent || []).filter((p) => p !== filePath)].slice(0, 8);
  await writeSettings(settings);
  return {
    url: SCHEME + '://app/media/' + token + '/' + encodeURIComponent(path.basename(filePath)),
    path: filePath, fileName: path.basename(filePath), sha256, size, modifiedAt: st.mtime.toISOString(), container,
  };
}

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
async function readSettings() {
  try { return JSON.parse(await fsp.readFile(settingsPath(), 'utf8')); } catch { return {}; }
}
async function writeSettings(s) { await atomicWrite(settingsPath(), JSON.stringify(s, null, 2)); }
async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'revue';
}

async function exportReport(payload) {
  const { sha256, baseName, markdown, json, html, files, copyAssets } = payload;
  const dir = reviewDir(sha256);
  const settings = await readSettings();
  const parent = settings.exportDir || path.join(app.getPath('documents'), 'Retake');
  const folderName = safeName(baseName);
  const outDir = path.join(parent, folderName);
  await fsp.mkdir(outDir, { recursive: true });
  const zipEntries = {};
  const put = async (rel, buf, level) => {
    const r = safeRel(rel);
    const target = path.join(outDir, r);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buf);
    zipEntries[folderName + '/' + r] = [new Uint8Array(buf), { level }];
  };
  await put('rapport.md', Buffer.from(markdown, 'utf8'), 6);
  await put('rapport.json', Buffer.from(json, 'utf8'), 6);
  await put('rapport.html', Buffer.from(html, 'utf8'), 6);
  for (const f of files) await put(f.rel, Buffer.from(f.data), 0);
  for (const a of copyAssets) {
    let data;
    try { data = await fsp.readFile(path.join(dir, safeRel(a.from))); } catch {
      throw new Error('Fichier de la revue manquant : ' + a.from + '. Il a été supprimé du dossier de la revue ; le rapport n\'a pas été créé.');
    }
    await put(a.to, data, 0);
  }
  const zipPath = path.join(parent, folderName + '.zip');
  await atomicWrite(zipPath, Buffer.from(zipSync(zipEntries)));
  settings.exportDir = parent;
  await writeSettings(settings);
  return { outDir, zipPath };
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
  ipcMain.handle('app:pending-open', () => { const p = pendingOpen; pendingOpen = null; return p; });
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', async (_e, patch) => { const s = { ...(await readSettings()), ...patch }; await writeSettings(s); return s; });
  ipcMain.handle('video:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Ouvrir une vidéo à relire', properties: ['openFile'],
      filters: [{ name: 'Vidéos', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv'] }, { name: 'Tous les fichiers', extensions: ['*'] }],
    });
    return r.canceled ? null : openVideo(r.filePaths[0]);
  });
  ipcMain.handle('video:open', (_e, p) => openVideo(p));
  ipcMain.handle('review:load', async (_e, sha) => {
    try { return JSON.parse(await fsp.readFile(path.join(reviewDir(sha), 'review.json'), 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw new Error('La revue enregistrée pour cette vidéo est illisible (' + e.message + ').');
    }
  });
  ipcMain.handle('review:save', async (_e, sha, review) => {
    await atomicWrite(path.join(reviewDir(sha), 'review.json'), JSON.stringify(review, null, 2));
    return true;
  });
  ipcMain.handle('review:write-asset', async (_e, sha, rel, data) => {
    await atomicWrite(path.join(reviewDir(sha), safeRel(rel)), Buffer.from(data));
    return true;
  });
  ipcMain.handle('review:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choisir le rapport de la revue précédente (rapport.json)', properties: ['openFile'],
      filters: [{ name: 'Rapport de revue', extensions: ['json'] }],
    });
    if (r.canceled) return null;
    return importReport(r.filePaths[0]);
  });
  ipcMain.handle('review:import-path', (_e, file) => importReport(file));
  ipcMain.handle('report:export', (_e, payload) => exportReport(payload));
  ipcMain.handle('report:choose-dir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Dossier où enregistrer les rapports', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    await writeSettings({ ...(await readSettings()), exportDir: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('shell:reveal', (_e, p) => { shell.showItemInFolder(p); return true; });
  ipcMain.handle('clipboard:write', (_e, t) => { clipboard.writeText(String(t)); return true; });
}

async function importReport(file) {
  let data;
  try { data = JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) { throw new Error('Rapport illisible : ' + e.message); }
  if (data.schema !== 'revue-video/1') throw new Error('Ce fichier n\'est pas un rapport de Retake (schéma attendu : revue-video/1).');
  const folder = path.dirname(file);
  const images = {};
  for (const n of data.notes || []) {
    if (n.images && n.images.annotated) {
      try { images[n.id] = new Uint8Array(await fsp.readFile(path.join(folder, safeRel(n.images.annotated)))); } catch { /* l'image manque : la note est importée sans vignette */ }
    }
  }
  return { report: data, images };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1080, minHeight: 680, show: false,
    backgroundColor: '#f7f7f8', title: 'Retake',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());
  win.loadURL(SCHEME + '://app/index.html');
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (cmd) => () => win && win.webContents.send('menu', cmd);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'Fichier', submenu: [
      { label: 'Ouvrir une vidéo…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Importer la revue précédente…', click: send('import') },
      { type: 'separator' },
      { label: 'Exporter le rapport…', accelerator: 'CmdOrCtrl+E', click: send('export') },
      { label: 'Choisir le dossier des rapports…', click: send('export-dir') },
      { type: 'separator' },
      isMac ? { role: 'close', label: 'Fermer la fenêtre' } : { role: 'quit', label: 'Quitter' },
    ] },
    { label: 'Édition', submenu: [{ role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }] },
    { label: 'Présentation', submenu: [{ role: 'togglefullscreen', label: 'Plein écran' }, { role: 'resetZoom', label: 'Taille réelle' }, { role: 'zoomIn', label: 'Agrandir' }, { role: 'zoomOut', label: 'Réduire' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { label: 'Aide', submenu: [{ label: 'Raccourcis clavier', click: send('help') }] },
  ]));
}

let pendingOpen = process.argv.slice(1).find((a) => VIDEO_EXT.test(a)) || null;
if (!app.requestSingleInstanceLock()) app.quit();
app.on('open-file', (e, p) => { e.preventDefault(); if (win) win.webContents.send('open-path', p); else pendingOpen = p; });
app.on('second-instance', (_e, argv) => {
  const p = argv.find((a) => VIDEO_EXT.test(a));
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  if (p) win.webContents.send('open-path', p);
});

app.whenReady().then(() => {
  registerProtocol();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
