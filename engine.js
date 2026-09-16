/** Browser-safe G-code parser and deposited-bead mesh generator. */
const number = (tokens, key) => {
  const token = tokens.find(item => item[0] === key);
  return token ? Number(token.slice(1)) : undefined;
};

const arcPoints = (from, to, i, j, clockwise, resolution) => {
  if (!Number.isFinite(i) || !Number.isFinite(j)) return [to];
  const cx = from.x + i, cy = from.y + j;
  const radius = Math.hypot(from.x - cx, from.y - cy);
  if (!radius) return [to];
  let start = Math.atan2(from.y - cy, from.x - cx);
  let end = Math.atan2(to.y - cy, to.x - cx);
  let sweep = end - start;
  if (clockwise && sweep >= 0) sweep -= Math.PI * 2;
  if (!clockwise && sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * resolution));
  return Array.from({ length: steps }, (_, index) => {
    const a = start + sweep * ((index + 1) / steps);
    return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, z: from.z + (to.z - from.z) * ((index + 1) / steps) };
  });
};

function addBead(target, a, b, width, height) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < .001) return;
  const nx = -dy / length * width / 2, ny = dx / length * width / 2;
  const z0 = a.z - height / 2, z1 = a.z + height / 2;
  const points = [
    [a.x + nx, a.y + ny, z0], [a.x - nx, a.y - ny, z0],
    [b.x + nx, b.y + ny, z0], [b.x - nx, b.y - ny, z0],
    [a.x + nx, a.y + ny, z1], [a.x - nx, a.y - ny, z1],
    [b.x + nx, b.y + ny, z1], [b.x - nx, b.y - ny, z1]
  ];
  const faces = [[0,2,1],[1,2,3],[4,5,6],[5,7,6],[0,4,2],[2,4,6],[1,3,5],[3,7,5],[0,1,4],[1,5,4],[2,6,3],[3,6,7]];
  for (const face of faces) for (const index of face) target.push(...points[index]);
}

export function reconstructGcode(source, options = {}, progress = () => {}) {
  const lines = source.replace(/\r/g, '').split('\n');
  const settings = { width: .45, height: .2, arcResolution: 24, includeInfill: true, ignoreSkirt: true, ignoreBrim: true, ignoreSupports: true, ...options };
  let absolute = true, absoluteExtrusion = true, tool = 0, feature = 'UNKNOWN';
  const pos = { x: 0, y: 0, z: 0 }, extrusion = new Map([[0, 0]]), layers = new Map();
  const warnings = [], stats = { commands: 0, extrusionDistance: 0, travelDistance: 0, retractions: 0, toolChanges: 0, filamentMm: 0, min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity }, slicer: 'Unknown', flavor: 'Unknown', nozzle: null, layerHeight: null, printTime: null, speedMin: Infinity, speedMax: 0 };
  const updateBounds = point => ['x','y','z'].forEach(axis => { stats.min[axis] = Math.min(stats.min[axis], point[axis]); stats.max[axis] = Math.max(stats.max[axis], point[axis]); });
  const shouldSkip = () => (settings.ignoreSkirt && /SKIRT/i.test(feature)) || (settings.ignoreBrim && /BRIM/i.test(feature)) || (settings.ignoreSupports && /SUPPORT/i.test(feature)) || (!settings.includeInfill && /INFILL/i.test(feature));
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex], comment = raw.includes(';') ? raw.slice(raw.indexOf(';') + 1).trim() : '';
    const commandPart = raw.split(';')[0].trim().toUpperCase();
    if (comment) {
      const match = comment.match(/(?:TYPE|FEATURE)\s*:\s*(.+)/i); if (match) feature = match[1].trim();
      const slicer = comment.match(/(?:GENERATED WITH|SLICER)\s*[:=]?\s*(.+)/i); if (slicer) stats.slicer = slicer[1].trim();
      const layerHeight = comment.match(/LAYER_HEIGHT\s*[:=]\s*([\d.]+)/i); if (layerHeight) stats.layerHeight = Number(layerHeight[1]);
      const nozzle = comment.match(/NOZZLE_DIAMETER\s*[:=]\s*([\d.]+)/i); if (nozzle) stats.nozzle = Number(nozzle[1]);
      const time = comment.match(/TIME\s*[:=]\s*(\d+)/i); if (time) stats.printTime = Number(time[1]);
    }
    if (!commandPart) continue;
    const tokens = commandPart.split(/\s+/), command = tokens[0]; stats.commands++;
    if (command === 'G90') { absolute = true; continue; }
    if (command === 'G91') { absolute = false; continue; }
    if (command === 'M82') { absoluteExtrusion = true; continue; }
    if (command === 'M83') { absoluteExtrusion = false; continue; }
    if (/^T\d+$/.test(command)) { tool = Number(command.slice(1)); if (!extrusion.has(tool)) extrusion.set(tool, 0); stats.toolChanges++; continue; }
    if (command === 'G92') { for (const axis of ['X','Y','Z']) { const value = number(tokens, axis); if (value !== undefined) pos[axis.toLowerCase()] = value; } const e = number(tokens, 'E'); if (e !== undefined) extrusion.set(tool, e); continue; }
    if (!['G0','G00','G1','G01','G2','G02','G3','G03'].includes(command)) { if (/^[A-Z]/.test(command) && !['M104','M109','M140','M190','M106','M107','M117'].includes(command)) warnings.push(`${command} on line ${lineIndex + 1}`); continue; }
    const start = { ...pos }, next = { ...pos };
    for (const axis of ['X','Y','Z']) { const value = number(tokens, axis); if (value !== undefined) next[axis.toLowerCase()] = absolute ? value : pos[axis.toLowerCase()] + value; }
    const feed = number(tokens, 'F'); if (feed !== undefined) { stats.speedMin = Math.min(stats.speedMin, feed / 60); stats.speedMax = Math.max(stats.speedMax, feed / 60); }
    const eValue = number(tokens, 'E'), beforeE = extrusion.get(tool) ?? 0;
    const eDelta = eValue === undefined ? 0 : (absoluteExtrusion ? eValue - beforeE : eValue);
    if (eValue !== undefined) extrusion.set(tool, absoluteExtrusion ? eValue : beforeE + eValue);
    const distance = Math.hypot(next.x - start.x, next.y - start.y, next.z - start.z);
    const isExtruding = eDelta > .00001 && distance > .001 && !shouldSkip();
    if (eDelta < -.00001) stats.retractions++;
    if (isExtruding) {
      const layerZ = Number(next.z.toFixed(4)); if (!layers.has(layerZ)) layers.set(layerZ, []);
      const points = /^G[23]/.test(command) ? arcPoints(start, next, number(tokens,'I'), number(tokens,'J'), /^G2/.test(command), settings.arcResolution) : [next];
      let previous = start;
      for (const point of points) { layers.get(layerZ).push({ a: previous, b: point, tool, feature, feed: feed || 0 }); previous = point; }
      stats.extrusionDistance += distance; stats.filamentMm += eDelta; updateBounds(start); updateBounds(next);
    } else stats.travelDistance += distance;
    Object.assign(pos, next);
    if (lineIndex % 8000 === 0) progress(Math.round(lineIndex / lines.length * 70));
  }
  const meshLayers = [...layers.entries()].sort((a,b) => a[0] - b[0]).map(([z, paths], index) => {
    const vertices = []; for (const path of paths) addBead(vertices, path.a, path.b, settings.width, settings.height); progress(70 + Math.round((index + 1) / Math.max(1, layers.size) * 30));
    return { z, paths, vertices: new Float32Array(vertices) };
  });
  if (!Number.isFinite(stats.min.x)) stats.min = stats.max = { x: 0, y: 0, z: 0 };
  stats.layers = meshLayers.length; stats.warnings = warnings.slice(0, 100); stats.speedMin = Number.isFinite(stats.speedMin) ? stats.speedMin : 0;
  return { meshLayers, stats };
}

export function sampleGcode() { return `; GCode Rebuilder sample\n; generated with GCode Rebuilder\n; LAYER_HEIGHT:0.20\n; NOZZLE_DIAMETER:0.40\nG90\nM82\nG92 E0\n;LAYER:0\nG1 Z0.20 F1200\n;TYPE:WALL-OUTER\nG1 X10 Y10 F1800\nG1 X40 Y10 E1.2\nG1 X40 Y40 E2.4\nG1 X10 Y40 E3.6\nG1 X10 Y10 E4.8\n;LAYER:1\nG1 Z0.40 F1200\nG1 X12 Y12 F1800\nG1 X38 Y12 E5.9\nG1 X38 Y38 E7.0\nG1 X12 Y38 E8.1\nG1 X12 Y12 E9.2\n`; }
