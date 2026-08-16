import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import axe from 'axe-core';

const root = path.resolve(process.cwd());
const siteRoot = path.join(root, '.reports', 'site-dist');
const reportRoot = path.join(root, '.reports', 'site');
await fs.mkdir(reportRoot, { recursive: true });

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  const requested = request.url === '/' ? 'index.html' : request.url.slice(1).split('?')[0];
  const file = path.resolve(siteRoot, requested);
  if (!file.startsWith(`${siteRoot}${path.sep}`)) { response.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport });
    const externalRequests = [];
    page.on('request', (request) => { if (!request.url().startsWith(`http://127.0.0.1:${port}`)) externalRequests.push(request.url()); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    if (externalRequests.length) throw new Error(`External requests detected: ${externalRequests.join(', ')}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`${viewport.name} has ${overflow}px horizontal overflow.`);
    await page.locator('#catalog-search').fill('voice');
    await page.getByRole('link', { name: /ElevenLabs/i }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.keyboard.press('Tab');
    if (!(await page.locator('.skip-link').evaluate((element) => element === document.activeElement))) throw new Error('Skip link is not the first keyboard target.');
    await page.keyboard.press('Enter');
    if (!(await page.locator('#main').evaluate((element) => element === document.activeElement))) throw new Error('Skip link did not move focus to main.');
    await page.addScriptTag({ content: axe.source });
    const audit = await page.evaluate(async () => globalThis.axe.run(document, { resultTypes: ['violations'] }));
    if (audit.violations.length) {
      const details = audit.violations.flatMap((item) => item.nodes.map((node) => `${item.id}: ${node.target.join(' ')}`));
      throw new Error(`Accessibility violations: ${details.join('; ')}`);
    }
    await page.screenshot({ path: path.join(reportRoot, `${viewport.name}.png`), fullPage: true });
    await page.close();
  }
  console.log('Documentation site browser, keyboard, responsive, and axe checks passed.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
