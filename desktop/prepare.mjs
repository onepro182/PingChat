// Copie l'interface PingChat et le pont WhatsApp dans desktop/src/ avant le build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(here, 'src');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'ui'), { recursive: true });
for (const f of ['index.html', 'dashboard.html']) fs.copyFileSync(path.join(root, f), path.join(out, 'ui', f));
for (const d of ['css', 'js', 'assets']) fs.cpSync(path.join(root, d), path.join(out, 'ui', d), { recursive: true });
fs.copyFileSync(path.join(root, 'bridge', 'server.mjs'), path.join(out, 'server.mjs'));
console.log('src/ pret');
