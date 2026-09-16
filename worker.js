import { reconstructGcode } from './engine.js';
self.onmessage = ({ data }) => {
  try {
    const result = reconstructGcode(data.text, data.settings, progress => self.postMessage({ type: 'progress', progress }));
    const transfers = result.meshLayers.map(layer => layer.vertices.buffer);
    self.postMessage({ type: 'complete', result }, transfers);
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
