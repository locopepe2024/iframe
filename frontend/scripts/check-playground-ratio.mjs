#!/usr/bin/env node
/**
 * Regression contract for playground result media frames.
 *
 * A ratio helper alone is insufficient: a later merge can leave the helper in
 * place while binding ResultCard back to a literal 16:9 frame. Keep the source
 * binding and the supported parameter spellings checked together.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const resultCard = path.join(root, 'src/components/modules/playground/ResultCard.tsx');
const mediaDisplay = path.join(root, 'src/components/modules/playground/mediaDisplay.ts');
const failures = [];

if (!existsSync(resultCard)) failures.push('missing ResultCard.tsx');
if (!existsSync(mediaDisplay)) failures.push('missing mediaDisplay.ts');

if (existsSync(resultCard)) {
  const source = readFileSync(resultCard, 'utf8');
  if (!source.includes("import { getOutputAspectRatio } from './mediaDisplay';")) {
    failures.push('ResultCard must import getOutputAspectRatio');
  }
  const helperUses = (source.match(/getOutputAspectRatio\(generation\.parameters\)/g) || []).length;
  if (helperUses < 3) {
    failures.push(`ResultCard must bind completed, processing, and failed media to the helper (found ${helperUses})`);
  }
  if (/aspectRatio\s*:\s*['"]16\s*\/\s*9['"]/.test(source)) {
    failures.push('ResultCard contains a hard-coded 16:9 media frame');
  }
}

if (existsSync(mediaDisplay)) {
  const source = readFileSync(mediaDisplay, 'utf8');
  if (!source.includes('parameters?.aspect_ratio') || !source.includes('parameters?.ratio') || !source.includes('parameters?.aspectRatio')) {
    failures.push('ratio helper must read canonical and historical parameter spellings');
  }
}

if (failures.length) {
  console.error('✘ Playground ratio contract failed');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log('✓ Playground ResultCard ratio contract passed');
