// Précision à l'image près : commentaires posés pendant des transitions animées, puis comparaison à ffmpeg (check_frames.py).
import { _electron as electron } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.resolve(process.env.REVUE_TEST_VIDEO);
const FRAMES = (process.env.REVUE_TEST_FRAMES || '').split(',').map(Number).filter((x) => x >= 0);
const out = path.join(here, 'out'); fs.mkdirSync(path.join(out, 'precision'), { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'revue-prec-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ exportDir: path.join(out, 'precision'), reviewer: 'Test' }));
const app = await electron.launch({ args: [path.resolve(here, '..')], env: { ...process.env, REVUE_USER_DATA: ud } });
const win = await app.firstWindow();
await win.waitForFunction(() => window.__revue);
await win.evaluate((p) => window.__revue.openPath(p), VIDEO);
await win.waitForSelector('#app.has-video', { timeout: 60000 });
for (const f of FRAMES) {
  // On arrive sur l'image en lecture puis pause, comme le ferait le relecteur, ou image par image.
  await win.evaluate((x) => window.__revue.seekFrame(x - 40), f);
  await win.waitForTimeout(300);
  await win.evaluate((x) => window.__revue.seekFrame(x), f);
  await win.waitForTimeout(400);
  await win.locator('#input').click();
  await win.keyboard.type('Contrôle image ' + f);
  await win.keyboard.press('Enter');
  await win.waitForTimeout(300);
}
await win.locator('#sendBtn').click();
await win.locator('#sendGo').click();
await win.waitForSelector('#sendDone:not([hidden])', { timeout: 120000 });
const exp = await win.evaluate(() => window.__revue.S.lastExport);
fs.writeFileSync(path.join(out, 'export.json'), JSON.stringify({ outDir: exp.outDir, zipPath: exp.zipPath, video: VIDEO }, null, 2));
await app.close();
