#!/usr/bin/env node
/** Build the static frontend and leave provenance next to the served files. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const result = spawnSync('next', ['build'], { stdio: 'inherit', env: process.env });
if (result.status !== 0) process.exit(result.status ?? 1);

let sourceRevision = 'unknown';
let sourceDirty = false;
try {
  sourceRevision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  sourceDirty = Boolean(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim());
} catch {
  // Packaged environments may not contain the git metadata; the build remains valid.
}

const outputDir = process.env.DOCKER_BUILD === 'true' || process.env.TAURI_BUILD === 'true' || process.env.IFRAME_PREVIEW_BASE_PATH
  ? path.join(root, 'out')
  : path.resolve(root, '../static');
if (!existsSync(outputDir)) throw new Error(`Next export directory not found: ${outputDir}`);

writeFileSync(path.join(outputDir, 'build-manifest.json'), `${JSON.stringify({
  source_revision: sourceRevision,
  source_dirty: sourceDirty,
  playground_ratio_contract: 'v1',
  built_at: new Date().toISOString(),
}, null, 2)}\n`);
