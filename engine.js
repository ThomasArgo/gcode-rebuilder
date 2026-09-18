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
  const settings = { width: .45, height: .2, arcResolution: 24, includeInfill: true, ignoreSkirt: true, ignoreBrim: true, ignoreSupports: true, ignoreStartupPurge: true, ...options };
  let absolute = true, absoluteExtrusion = true, tool = 0, feature = 'UNKNOWN', modelStarted = false, modelMarkerSeen = false, resetEpoch = 0;
  const pos = { x: 0, y: 0, z: 0 }, extrusion = new Map([[0, 0]]), layers = new Map(), pendingStartup = [];
  const warnings = [], stats = { commands: 0, extrusionDistance: 0, travelDistance: 0, retractions: 0, toolChanges: 0, filamentMm: 0, startupPurgeSegments: 0, startupPurgeExcluded: 0, startupPurge: { detected: false, excluded: false, segments: [], firstModelExtrusionLine: null }, min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity }, slicer: 'Unknown', flavor: 'Unknown', nozzle: null, layerHeight: null, printTime: null, speedMin: Infinity, speedMax: 0 };
  const updateBounds = point => ['x','y','z'].forEach(axis => { stats.min[axis] = Math.min(stats.min[axis], point[axis]); stats.max[axis] = Math.max(stats.max[axis], point[axis]); });
  const shouldSkip = () => (settings.ignoreSkirt && /SKIRT/i.test(feature)) || (settings.ignoreBrim && /BRIM/i.test(feature)) || (settings.ignoreSupports && /SUPPORT/i.test(feature)) || (!settings.includeInfill && /INFILL/i.test(feature));
  const appendRecord = (record, classification = record.feature, reason = null) => {
    record.classification = classification;
    if (classification === 'startup-purge') {
      stats.startupPurgeSegments++;
      stats.startupPurge.detected = true;
      stats.startupPurge.excluded = settings.ignoreStartupPurge;
      stats.startupPurge.segments.push({ line: record.line, command: record.command, start: record.start, end: record.next, extrusionDelta: record.eDelta, layer: record.layer, feature: record.feature, positioningMode: record.positioningMode, extrusionMode: record.extrusionMode, tool: record.tool, startup: record.startup, classification, reason });
      if (settings.ignoreStartupPurge) { stats.startupPurgeExcluded++; return; }
    } else if (stats.startupPurge.firstModelExtrusionLine === null) stats.startupPurge.firstModelExtrusionLine = record.line;
    const layerZ = Number(record.next.z.toFixed(4)); if (!layers.has(layerZ)) layers.set(layerZ, []);
    let previous = record.start;
    for (const point of record.points) { layers.get(layerZ).push({ a: previous, b: point, tool: record.tool, feature: classification, feed: record.feed || 0, source: record }); previous = point; }
    stats.extrusionDistance += record.distance; stats.filamentMm += record.eDelta; updateBounds(record.start); updateBounds(record.next);
  };
  const flushStartup = explicit => {
    if (!pendingStartup.length) return;
    let fallbackIndex = -1;
    if (!explicit && pendingStartup.length >= 4) {
      const first = pendingStartup[0], remainder = pendingStartup.slice(1), bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const record of remainder) for (const point of [record.start, record.next]) { bounds.minX = Math.min(bounds.minX, point.x); bounds.minY = Math.min(bounds.minY, point.y); bounds.maxX = Math.max(bounds.maxX, point.x); bounds.maxY = Math.max(bounds.maxY, point.y); }
      const dx = Math.abs(first.next.x - first.start.x), dy = Math.abs(first.next.y - first.start.y), straight = Math.min(dx, dy) <= Math.max(dx, dy) * .08;
      const gap = Math.max(settings.width * 4, 2), outside = Math.max(first.start.x, first.next.x) < bounds.minX - gap || Math.min(first.start.x, first.next.x) > bounds.maxX + gap || Math.max(first.start.y, first.next.y) < bounds.minY - gap || Math.min(first.start.y, first.next.y) > bounds.maxY + gap;
      if (first.resetEpoch > 0 && first.distance >= 40 && straight && outside) fallbackIndex = 0;
      else if (first.resetEpoch > 0 && first.distance >= 40 && straight) warnings.push('Startup purge detection was inconclusive; preserved early extrusion.');
    }
    pendingStartup.forEach((record, index) => {
      const classified = explicit || index === fallbackIndex;
      appendRecord(record, classified ? 'startup-purge' : record.feature, classified ? (explicit ? 'startup extrusion before first layer/object marker' : 'detached, long, straight extrusion before model geometry') : null);
    });
    pendingStartup.length = 0;
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex], comment = raw.includes(';') ? raw.slice(raw.indexOf(';') + 1).trim() : '';
    const commandPart = raw.split(';')[0].trim().toUpperCase();
    if (comment) {
      const match = comment.match(/(?:TYPE|FEATURE)\s*:\s*(.+)/i); if (match) feature = match[1].trim();
      /* A feature label is not a model boundary: Creality Print emits ;TYPE:Custom before its startup purge lines. */
      /* Match actual comment markers only. Flash Studio's settings header contains `layer_change_gcode`, which is not a print boundary. */
      const normalizedComment = comment.toUpperCase();
      const modelBoundary = normalizedComment === 'LAYER_CHANGE' || /^LAYER\s*:\s*0\s*$/.test(comment) || /^MESH\s*:\s*\S/.test(comment) || /^OBJECT_ID\s*:\s*\S/.test(comment) || /^PRINTING\s+OBJECT\b/.test(comment);
      if (modelBoundary && !modelStarted) { modelStarted = true; modelMarkerSeen = true; flushStartup(true); }
      const slicer = comment.match(/(?:GENERATED\s+BY|GENERATED WITH|SLICER)\s*[:=]?\s*(.+)/i); if (slicer) stats.slicer = slicer[1].trim();
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
    if (command === 'G92') { for (const axis of ['X','Y','Z']) { const value = number(tokens, axis); if (value !== undefined) pos[axis.toLowerCase()] = value; } const e = number(tokens, 'E'); if (e !== undefined) { extrusion.set(tool, e); resetEpoch++; } continue; }
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
      const points = /^G[23]/.test(command) ? arcPoints(start, next, number(tokens,'I'), number(tokens,'J'), /^G2/.test(command), settings.arcResolution) : [next];
      const record = { line: lineIndex + 1, source: raw, start, next, points, tool, feature, feed, distance, eDelta, resetEpoch, command, layer: Number(next.z.toFixed(4)), positioningMode: absolute ? 'absolute' : 'relative', extrusionMode: absoluteExtrusion ? 'absolute' : 'relative', startup: !modelStarted };
      if (modelStarted) appendRecord(record); else pendingStartup.push(record);
    } else stats.travelDistance += distance;
    Object.assign(pos, next);
    if (lineIndex % 8000 === 0) progress(Math.round(lineIndex / lines.length * 70));
  }
  flushStartup(modelMarkerSeen);
  const meshLayers = [...layers.entries()].sort((a,b) => a[0] - b[0]).map(([z, paths], index) => {
    const vertices = []; for (const path of paths) addBead(vertices, path.a, path.b, settings.width, settings.height); progress(70 + Math.round((index + 1) / Math.max(1, layers.size) * 30));
    return { z, paths, vertices: new Float32Array(vertices) };
  });
  if (!Number.isFinite(stats.min.x)) stats.min = stats.max = { x: 0, y: 0, z: 0 };
  stats.layers = meshLayers.length; stats.warnings = warnings.slice(0, 100); stats.speedMin = Number.isFinite(stats.speedMin) ? stats.speedMin : 0;
  return { meshLayers, stats };
}

export function sampleGcode() { return `; GCode Rebuilder sample\n; generated with GCode Rebuilder\n; LAYER_HEIGHT:0.20\n; NOZZLE_DIAMETER:0.40\nG90\nM82\nG92 E0\n;LAYER:0\nG1 Z0.20 F1200\n;TYPE:WALL-OUTER\nG1 X10 Y10 F1800\nG1 X40 Y10 E1.2\nG1 X40 Y40 E2.4\nG1 X10 Y40 E3.6\nG1 X10 Y10 E4.8\n;LAYER:1\nG1 Z0.40 F1200\nG1 X12 Y12 F1800\nG1 X38 Y12 E5.9\nG1 X38 Y38 E7.0\nG1 X12 Y38 E8.1\nG1 X12 Y12 E9.2\n`; }
