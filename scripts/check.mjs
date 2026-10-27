// Vérification rapide : syntaxe de tous les fichiers JavaScript de l'application.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const cjs = ['main.js', 'preload.js', 'lib/mp4info.js'];
const esm = fs.readdirSync('renderer').filter((f) => f.endsWith('.js')).map((f) => 'renderer/' + f)
  .concat(fs.readdirSync('test').filter((f) => f.endsWith('.mjs')).map((f) => 'test/' + f));
let failed = 0;
for (const f of cjs) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed += 1; console.error(f + '\n' + r.stderr); }
}
for (const f of esm) {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(f, 'utf8'), encoding: 'utf8' });
  if (r.status !== 0) { failed += 1; console.error(f + '\n' + r.stderr); }
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes('## ' + pkg.version)) { failed += 1; console.error('CHANGELOG.md ne contient pas de section ' + pkg.version); }
console.log(failed ? failed + ' erreur(s)' : 'Syntaxe et version vérifiées (' + (cjs.length + esm.length) + ' fichiers).');
process.exit(failed ? 1 : 0);
