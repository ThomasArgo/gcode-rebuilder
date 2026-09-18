/** Browser-level responsive smoke test; see README for local runner variables. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = normalize(join(fileURLToPath(new URL('..', import.meta.url))));
const types = { '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.html':'text/html' };
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(root)) return response.writeHead(403).end();
  try { response.writeHead(200, { 'content-type':types[extname(file)] || 'application/octet-stream' }); response.end(await readFile(file)); } catch { response.writeHead(404).end('Not found'); }
});
const externalUrl = process.env.BASE_URL;
if (!externalUrl) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = externalUrl || `http://127.0.0.1:${server.address().port}/`, modulePath = process.env.PLAYWRIGHT_MODULE, executablePath = process.env.BROWSER_EXECUTABLE;
if (!modulePath || !executablePath) { console.log('layout browser test skipped: set PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE to run it.'); if (server.listening) server.close(); process.exit(0); }
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ executablePath, headless:true });
const sizes = [[1920,1080],[1600,900],[1440,900],[1366,768],[1280,720],[1024,768],[820,1180],[768,1024],[430,932],[390,844],[375,667],[320,568]];
try {
  const page = await browser.newPage();
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height }); await page.goto(baseUrl, { waitUntil:'networkidle' });
    const check = await page.evaluate(() => { const viewer = document.querySelector('#viewer'), canvas = viewer.querySelector('canvas'), box = viewer.getBoundingClientRect(), canvasBox = canvas.getBoundingClientRect(); return { pageFits:document.documentElement.scrollWidth <= document.documentElement.clientWidth, canvasFits:canvasBox.width <= box.width + 1 && canvasBox.height <= box.height + 1, status:document.querySelector('.status-message')?.textContent.trim(), sourceLink:[...document.links].some(link => /github\.com\/ThomasArgo\/gcode-rebuilder/.test(link.href)), width:box.width, height:box.height }; });
    if (!check.pageFits || !check.canvasFits || !check.width || !check.height || check.status !== 'Load a G-code file to begin.' || check.sourceLink) throw new Error(`${width}x${height}: ${JSON.stringify(check)}`);
  }
  await page.setViewportSize({ width:1440, height:900 }); await page.goto(baseUrl, { waitUntil:'networkidle' }); await page.setViewportSize({ width:320, height:568 }); await page.setViewportSize({ width:1440, height:900 });
  const resized = await page.evaluate(() => { const viewer = document.querySelector('#viewer'), canvas = viewer.querySelector('canvas'); return document.documentElement.scrollWidth <= document.documentElement.clientWidth && canvas.getBoundingClientRect().width <= viewer.getBoundingClientRect().width + 1; });
  if (!resized) throw new Error('wide → narrow → wide resize check failed');
  console.log(`layout browser test passed (${sizes.length} viewports + resize cycle)`);
} finally { await browser.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
