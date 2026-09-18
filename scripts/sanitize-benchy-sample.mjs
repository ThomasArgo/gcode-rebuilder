/**
 * Creates the browser-only 3DBenchy demonstration asset from a downloaded
 * Creality slice of Creative Tools' official single-part model. The result is
 * intentionally not printer-ready: it retains reconstruction-relevant moves
 * only and removes startup/shutdown commands and brim deposition.
 */
import { readFile, writeFile } from 'node:fs/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/sanitize-benchy-sample.mjs <input> <output>');
const lines = (await readFile(input, 'utf8')).replace(/\r/g, '').split('\n');
const firstMotionMode = lines.findIndex(line => line.trim() === 'G90');
if (firstMotionMode < 0) throw new Error('Could not find G90 in source G-code.');

let omitBrim = false;
const outputLines = [
  '; 3DBenchy sample for GCode Rebuilder',
  '; Source model: Creative Tools official single-part 3DBenchy (CC0/public domain, 2025)',
  '; Pre-sliced demonstration: 0.4 mm nozzle, 0.2 mm layers, single material, standard orientation',
  '; Sanitized for browser reconstruction only — never send this file directly to a printer.',
  ';LAYER_HEIGHT:0.20',
  ';NOZZLE_DIAMETER:0.40'
];

for (const raw of lines.slice(firstMotionMode)) {
  const command = raw.split(';')[0].trim();
  const comment = raw.includes(';') ? raw.slice(raw.indexOf(';') + 1).trim() : '';
  if (/^TYPE\s*:/i.test(comment)) {
    omitBrim = /^TYPE\s*:\s*(?:BRIM|SKIRT)/i.test(comment);
    if (!omitBrim) outputLines.push(`;${comment}`);
    continue;
  }
  if (/^LAYER\s*:/i.test(comment) || /^LAYER_CHANGE$/i.test(comment) || /^Z\s*:/i.test(comment) || /^HEIGHT\s*:/i.test(comment) || /^WIDTH\s*:/i.test(comment)) {
    outputLines.push(`;${comment}`);
    continue;
  }
  if (!command || !/^(?:G0?1|G0?2|G0?3|G90|G91|M82|M83|G92|T\d+)\b/i.test(command)) continue;
  if (omitBrim && /^G0?1\b/i.test(command) && /\bE[-+]?(?:\d|\.\d)/i.test(command)) {
    const travel = command.split(/\s+/).filter(token => !/^E[-+]?(?:\d|\.\d)/i.test(token)).join(' ');
    if (travel !== 'G1' && travel !== 'G01') outputLines.push(travel);
    continue;
  }
  outputLines.push(command);
}

await writeFile(output, `${outputLines.join('\n')}\n`);
