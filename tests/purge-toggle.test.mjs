/** Integration test for the existing startup-purge checkbox and worker reconstruction path. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = normalize(join(fileURLToPath(new URL('..', import.meta.url))));
const fixture = fileURLToPath(new URL('./fixtures/creality-startup-purge.gcode', import.meta.url));
const flashFixture = fileURLToPath(new URL('./fixtures/flash-studio-startup-purge.gcode', import.meta.url));
const types = { '.css':'text/css', '.js':'text/javascript', '.html':'text/html', '.png':'image/png' };
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(root)) return response.writeHead(403).end();
  try { response.writeHead(200, { 'content-type':types[extname(file)] || 'application/octet-stream' }); response.end(await readFile(file)); } catch { response.writeHead(404).end(); }
});
const modulePath = process.env.PLAYWRIGHT_MODULE, executablePath = process.env.BROWSER_EXECUTABLE;
if (!modulePath || !executablePath) { console.log('purge toggle browser test skipped: set PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE to run it.'); process.exit(0); }
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ executablePath, headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil:'networkidle' });
  await page.locator('#file').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('#viewer-state')?.textContent === 'Startup purge line detected: 2 segments excluded.');
  const excludedBounds = await page.locator('#stats').textContent();
  assert.match(excludedBounds, /118\.4, 28\.3, 0\.2/);
  await page.locator('input[name="ignoreStartupPurge"]').uncheck();
  await page.waitForFunction(() => document.querySelector('#viewer-state')?.textContent === 'Startup purge line detected and included.');
  const includedBounds = await page.locator('#stats').textContent();
  assert.match(includedBounds, /-2\.4, 20\.0, 0\.2/);
  assert.notEqual(excludedBounds, includedBounds);
  await page.locator('input[name="ignoreStartupPurge"]').check();
  await page.locator('#file').setInputFiles(flashFixture);
  await page.waitForFunction(() => document.querySelector('#viewer-state')?.textContent === 'Startup purge line detected: 3 segments excluded.');
  const flashExcludedBounds = await page.locator('#stats').textContent();
  assert.match(flashExcludedBounds, /76\.0, 80\.0, 0\.3/);
  await page.locator('input[name="ignoreStartupPurge"]').uncheck();
  await page.waitForFunction(() => document.querySelector('#viewer-state')?.textContent === 'Startup purge line detected and included.');
  const flashIncludedBounds = await page.locator('#stats').textContent();
  assert.match(flashIncludedBounds, /50\.0, -1\.4, 0\.3/);
  await page.locator('#sample').click();
  await page.waitForFunction(() => document.querySelector('#viewer-state')?.textContent?.startsWith('Benchy sample rebuilt ('), null, { timeout:30000 });
  assert.match(await page.locator('#file-note').textContent(), /3DBenchy-sample\.gcode/);
  assert.match(await page.locator('#stats').textContent(), /59\.5 × 30\.6 × 47\.8 mm/);
  for (const selector of ['#layer','#layer-mode','#export-binary','#export-ascii','#export-json']) assert.equal(await page.locator(selector).isDisabled(), false);
  await page.locator('input[name="ignoreStartupPurge"]').check();
  await page.locator('#file').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('#viewer-state')?.textContent === 'Startup purge line detected: 2 segments excluded.');
  console.log('purge toggle browser test passed');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
