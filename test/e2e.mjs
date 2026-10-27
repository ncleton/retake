// Test de bout en bout de l'application réelle : relecture, commentaires écrits, zones, voix simulée
// par un faux micro, envoi de la revue, puis vérification d'une nouvelle version.
import { _electron as electron } from 'playwright';
import { unzipSync } from 'fflate';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const VIDEO = path.resolve(process.env.REVUE_TEST_VIDEO || '');
const VIDEO2 = path.resolve(process.env.REVUE_TEST_VIDEO2 || '');
const VOICE = process.env.REVUE_TEST_VOICE && path.resolve(process.env.REVUE_TEST_VOICE);
if (!process.env.REVUE_TEST_VIDEO || !process.env.REVUE_TEST_VIDEO2 || !VOICE) throw new Error('Définir REVUE_TEST_VIDEO, REVUE_TEST_VIDEO2 et REVUE_TEST_VOICE (WAV de parole).');
const out = path.join(here, 'out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'rapports'), { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revue-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ exportDir: path.join(out, 'rapports'), reviewer: 'Tony', voiceTipShown: true }));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'ÉCHEC ') + name + (detail !== undefined ? ' : ' + JSON.stringify(detail) : '')); };
const shot = (win, name) => win.screenshot({ path: path.join(out, name + '.png') });

const exe = process.env.REVUE_APP_EXECUTABLE;
const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: [appDir] }), env: { ...process.env, REVUE_USER_DATA: userData, REVUE_FAKE_AUDIO: VOICE } });
const win = await app.firstWindow();
win.on('pageerror', (e) => console.log('pageerror:', e.message));
win.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
await win.waitForTimeout(1200);
await shot(win, '01-accueil');

await win.waitForFunction(() => window.__revue);
await win.evaluate((p) => window.__revue.openPath(p), VIDEO);
await win.waitForSelector('#app.has-video', { timeout: 60000 });
await win.waitForTimeout(1200);
await shot(win, '02-video-ouverte');
const meta = await win.evaluate(() => ({ ...window.__revue.S.review.video }));
check('métadonnées lues dans le fichier', meta.fps && meta.frameCount && meta.width, { fps: meta.fps, images: meta.frameCount, taille: meta.width + 'x' + meta.height });

const R = () => window.__revue;
const stageBox = async () => {
  const box = await win.locator('#overlay').boundingBox();
  const vr = await win.evaluate(() => { const v = window.__revue.video; const st = document.getElementById('stage'); const s = Math.min(st.clientWidth / v.videoWidth, st.clientHeight / v.videoHeight); return { x: (st.clientWidth - v.videoWidth * s) / 2, y: (st.clientHeight - v.videoHeight * s) / 2, w: v.videoWidth * s, h: v.videoHeight * s }; });
  return (fx, fy) => [box.x + vr.x + fx * vr.w, box.y + vr.y + fy * vr.h];
};
const notes = () => win.evaluate(() => window.__revue.S.review.notes.map((n) => ({ ...n })));

// 1. Zone entourée sur une image précise, puis un mot et Entrée
const F1 = Number(process.env.REVUE_TEST_FRAME || 11544);
await win.evaluate((f) => window.__revue.seekFrame(f), F1);
await win.waitForTimeout(700);
let P = await stageBox();
await win.mouse.move(...P(0.55, 0.08)); await win.mouse.down(); await win.mouse.move(...P(0.8, 0.2), { steps: 8 }); await win.mouse.move(...P(0.96, 0.3), { steps: 8 }); await win.mouse.up();
await win.keyboard.type('Le titre est coupé à droite, il faut le passer sur deux lignes.');
await shot(win, '03-zone-et-texte');
await win.keyboard.press('Enter');
await win.waitForTimeout(600);
let all = await notes();
check('commentaire 1 calé sur l\'image demandée', all[0] && all[0].frame === F1, { image: all[0] && all[0].frame, attendu: F1 });
check('commentaire 1 : la zone entourée est jointe', all[0] && all[0].shapes.length === 1 && all[0].shapes[0].type === 'rect');

// 2. Écrire pendant la lecture met en pause et cale le commentaire sur l'image affichée
await win.evaluate((f) => window.__revue.seekFrame(f), F1 + 1800);
await win.waitForTimeout(400);
await win.keyboard.press(' ');
await win.waitForTimeout(1500);
await win.locator('#input').click();
await win.keyboard.type('Cette partie va trop vite pour lire le tableau.');
const st2 = await win.evaluate(() => ({ paused: window.__revue.video.paused, frame: window.__revue.S.draft && window.__revue.S.draft.frame }));
await win.keyboard.press('Enter');
await win.waitForTimeout(500);
all = await notes();
const n2 = all.find((n) => n.text.startsWith('Cette partie'));
check('écrire pendant la lecture met la vidéo en pause', st2.paused && n2 && n2.frame === st2.frame && n2.frame > F1 + 1800, { image: n2 && n2.frame });

// 3. Commentaire parlé (faux micro qui dit une phrase en boucle)
await win.evaluate((f) => window.__revue.seekFrame(f), F1 + 6000);
await win.waitForTimeout(400);
await win.locator('#micBtn').click();
await win.waitForTimeout(300);
await win.keyboard.press(' ');
const t0 = Date.now();
await win.waitForFunction(() => window.__revue.S.voice && window.__revue.S.voice.speaking, null, { timeout: 30000 });
await win.waitForTimeout(1500);
await shot(win, '04-parole-en-cours');
const duringSpeech = await win.evaluate(() => window.__revue.video.paused);
await win.waitForFunction(() => window.__revue.S.draft && window.__revue.S.draft.clips.length, null, { timeout: 20000 });
await shot(win, '05-vocal-ajoute');
await win.waitForFunction(() => window.__revue.S.review.notes.some((n) => n.clips.length) && !window.__revue.video.paused, null, { timeout: 8000 });
check('parler met la vidéo en pause, puis la lecture reprend seule', duringSpeech, { secondes: (Date.now() - t0) / 1000 });
await win.locator('#micBtn').click();
await win.evaluate(async () => { const r = window.__revue; if (r.S.draft) await r.commitDraft(); r.video.pause(); });
await win.waitForTimeout(400);
all = await notes();
const n3 = all.find((n) => n.clips.length);
const wav = n3 && path.join(userData, 'reviews', meta.sha256, n3.clips[0].file);
check('commentaire vocal enregistré en WAV', wav && fs.existsSync(wav) && fs.statSync(wav).size > 16000, n3 && { duree: n3.clips[0].duration, image: n3.frame });

// 4. Un clic sur l'image en pause pose un point
const F4 = Number(process.env.REVUE_TEST_FRAME_POINT || 600);
await win.evaluate((f) => window.__revue.seekFrame(f), F4);
await win.waitForTimeout(500);
P = await stageBox();
await win.mouse.click(...P(0.5, 0.5));
await win.keyboard.type('Logo un peu flou ici.');
await win.keyboard.press('Enter');
await win.waitForTimeout(500);
all = await notes();
check('clic sur l\'image en pause : point posé', all.some((n) => n.frame === F4 && n.shapes[0] && n.shapes[0].type === 'pin'));
await win.locator('.item').first().hover();
await shot(win, '06-liste');

// 5. Envoi de la revue
await win.locator('#sendBtn').click();
await win.waitForSelector('#sendModal:not([hidden])');
await shot(win, '07-envoi');
await win.locator('#sendGo').click();
await win.waitForSelector('#sendDone:not([hidden])', { timeout: 120000 });
await shot(win, '08-envoi-pret');
const exp = await win.evaluate(() => window.__revue.S.lastExport);
check('archive .zip créée', exp && fs.existsSync(exp.zipPath), exp && path.basename(exp.zipPath));
const report = JSON.parse(fs.readFileSync(path.join(exp.outDir, 'rapport.json'), 'utf8'));
check('rapport : 4 commentaires triés par instant', report.notes.length === 4 && report.notes.every((n, i, a) => !i || a[i - 1].time <= n.time), report.notes.map((n) => n.timecode));
const listing = Object.keys(unzipSync(fs.readFileSync(exp.zipPath))).join('\n');
const missing = report.notes.flatMap((n) => [n.images.annotated, n.images.raw, ...n.clips.map((c) => c.file)]).filter((f) => !listing.includes(f));
check('archive : images et commentaires vocaux présents', missing.length === 0, { manquants: missing });
const md = fs.readFileSync(path.join(exp.outDir, 'rapport.md'), 'utf8');
check('rapport.md : empreinte SHA-256 et consignes pour l\'agent', md.includes(meta.sha256) && md.includes('Consignes pour l\'agent'));
fs.writeFileSync(path.join(out, 'export.json'), JSON.stringify({ outDir: exp.outDir, zipPath: exp.zipPath, video: VIDEO }, null, 2));
await win.locator('#sendClose').click();

// 6. Nouvelle version : importer la revue et vérifier chaque point
await win.evaluate((p) => window.__revue.openPath(p), VIDEO2);
await win.waitForFunction((name) => window.__revue.S.review && window.__revue.S.review.video.fileName === name, path.basename(VIDEO2), { timeout: 60000 });
await win.waitForTimeout(800);
await win.evaluate((p) => window.__revue.importPrevious(p), path.join(exp.outDir, 'rapport.json'));
await win.waitForTimeout(800);
await win.locator('.verdict .ok').first().click();
await win.locator('.verdict .ko').nth(1).click();
await win.waitForTimeout(300);
await shot(win, '09-verification');
const imported = await win.evaluate(() => window.__revue.S.review.notes.filter((n) => n.origin).map((n) => n.status));
check('revue précédente importée, verdicts enregistrés', imported.length === 4 && imported.includes('corrige') && imported.includes('pas_corrige'), imported);
await win.locator('#sendBtn').click();
await win.locator('#sendGo').click();
await win.waitForSelector('#sendDone:not([hidden])', { timeout: 120000 });
const exp2 = await win.evaluate(() => window.__revue.S.lastExport);
const rep2 = JSON.parse(fs.readFileSync(path.join(exp2.outDir, 'rapport.json'), 'utf8'));
check('revue 2 : statuts exportés', rep2.summary.fixed === 1 && rep2.summary.notFixed === 1, rep2.summary);

await app.close();
fs.writeFileSync(path.join(out, 'resultats.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? failed.length + ' contrôle(s) en échec' : 'Tous les contrôles passent (' + results.length + ').');
process.exit(failed.length ? 1 : 0);
