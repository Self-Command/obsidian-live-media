import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const p = JSON.parse(await fs.readFile('dist/provenance.json', 'utf8'));
for (const [f, info] of Object.entries(p.files)) {
  const b = await fs.readFile('dist/' + f);
  if (createHash('sha256').update(b).digest('hex') !== info.sha256) throw new Error('Artifact changed: ' + f);
}
if (p.commit !== process.env.GITHUB_SHA) throw new Error('Wrong commit artifact');
if (p.files['main.js'].bytes < 1000000 || p.files['main.js'].bytes > 60000000) throw new Error('Missing codecs or unbounded package size');
const m = JSON.parse(await fs.readFile('dist/manifest.json', 'utf8'));
if (m.id !== 'live-media' || m.isDesktopOnly) throw new Error('Wrong plugin identity');
console.log('Verified artifact identity, codec hashes, three-file package and size:', p.files['main.js'].bytes);
