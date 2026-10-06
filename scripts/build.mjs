// Run only in GitHub Actions.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
if (!process.env.GITHUB_ACTIONS) throw new Error('Builds must run in GitHub Actions');
await fs.mkdir('dist', {recursive: true});
await fs.mkdir('build', {recursive: true});
await build({entryPoints: ['src/engine/worker.ts'], bundle: true, format: 'iife', outfile: 'build/worker.js', target: 'es2022', minify: true});
const inputs = {
  worker: 'build/worker.js', core: 'node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js',
  wasm: 'node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm',
  hdr: 'codecs/generated/live_hdr.js', hdrWasm: 'codecs/generated/live_hdr.wasm'
};
const assets = {};
const sourceHashes = {};
for (const [key, path] of Object.entries(inputs)) {
  const bytes = await fs.readFile(path);
  assets[key] = gzipSync(bytes, {level: 9}).toString('base64');
  sourceHashes[key] = {path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length};
}
const assetPlugin = {
  name: 'embedded-offline-codecs', setup(b) {
    b.onResolve({filter: /^virtual:codec-assets$/}, () => ({path: 'assets', namespace: 'embedded'}));
    b.onLoad({filter: /.*/, namespace: 'embedded'}, () => ({contents: 'export const assets = ' + JSON.stringify(assets), loader: 'js'}));
  }
};
await build({entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian', '@codemirror/state', '@codemirror/view', 'node:*', 'electron'], plugins: [assetPlugin], format: 'cjs', platform: 'browser', outfile: 'dist/main.js', target: 'es2022', minify: true});
// Browser harness uses exactly the embedded engine produced by this build.
await build({entryPoints: ['tests/browser/harness.ts'], bundle: true, plugins: [assetPlugin], format: 'iife', outfile: 'dist/harness.js', target: 'es2022'});
for (const f of ['manifest.json', 'styles.css']) await fs.copyFile(f, 'dist/' + f);
const hashes = {};
for (const f of ['main.js', 'manifest.json', 'styles.css', 'harness.js']) {
  const b = await fs.readFile('dist/' + f);
  hashes[f] = {sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length};
}
await fs.writeFile('dist/provenance.json', JSON.stringify({commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, sourceHashes, files: hashes}, null, 2));
