import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'public', 'origin-helper');
const manifest = JSON.parse(await readFile(path.join(root, 'VERSION.json'), 'utf8'));
await writeFile(path.join(directory, 'LICENSE'), await readFile(path.join(root, 'LICENSE')));
await writeFile(path.join(directory, 'VERSION.json'), JSON.stringify({ product: 'Scientific Plot Studio Origin Helper', version: manifest.originHelperVersion }, null, 2) + '\n');
const files = {};
for (const name of await readdir(directory)) {
  if (name.endsWith('.zip')) continue;
  files[name] = new Uint8Array(await readFile(path.join(directory, name)));
}
await writeFile(path.join(directory, 'lsv-origin-helper.zip'), zipSync(files, { level: 6 }));
console.log(`Web helper bundle refreshed: ${manifest.originHelperVersion}`);
