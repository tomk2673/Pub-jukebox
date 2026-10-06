import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';

const external = process.env.TEST_BASE_URL;
const temp = await mkdtemp(path.join(tmpdir(), 'jukebox-browser-'));
let server;
let browser;
let serverLog = '';
try {
  let base = external;
  if (!base) {
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.env.PYTHON_BIN || 'python', [new URL('server.py', import.meta.url).pathname, String(port)], {
      env: {...process.env, SUPABASE_URL: '', YOUTUBE_API_KEY: '', ADMIN_PIN: 'browser-only',
        JOIN_CODE: 'browser-only', SECRET_KEY: 'browser-fixture-only', JUKEBOX_DB: path.join(temp, 'test.db')},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', data => { serverLog += data; });
    server.stderr.on('data', data => { serverLog += data; });
  }
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(serverLog);
    if (attempt === 79) throw new Error(`Fixture failed to start: ${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  const errors = [];
  async function context(viewport) {
    const ctx = await browser.newContext({viewport, serviceWorkers: 'block'});
    await ctx.route('**/*', route => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      if (route.request().resourceType() === 'image') return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"/>'});
      return route.abort();
    });
    ctx.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    });
    return ctx;
  }
  for (const width of [320, 390, 768, 1440]) {
    const ctx = await context({width, height: 844});
    const page = await ctx.newPage();
    await page.goto(`${base}/guest?code=browser-only`);
    await page.locator('#connection').filter({hasText: 'online'}).waitFor();
    const bounds = await page.locator('#searchInput').boundingBox();
    assert.ok(bounds.y > 0 && bounds.y + bounds.height < 844, `search visible before scrolling at ${width}px`);
    assert.equal(await page.locator('main > section').first().getAttribute('class'), 'panel search-panel');
    assert.ok(await page.locator('.guest-tip').isVisible());
    assert.match(await page.locator('.guest-tip').innerText(), /Přeskočit moji skladbu/);
    assert.equal(await page.locator('#ownSongActions').isVisible(), false, 'AutoDJ is not skippable by guests');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no horizontal overflow at ${width}px`);
    if (process.env.SCREENSHOT_DIR && width === 390) await page.screenshot({path: path.join(process.env.SCREENSHOT_DIR, 'guest-search-skip-tip.png')});
    await page.locator('#searchInput').fill('Funk');
    await page.locator('#searchButton').click();
    await page.locator('#results .song-card').first().waitFor();
    assert.equal(await page.locator('#results .song-card').count(), 2);
    await ctx.close();
  }
  const owner = await context({width: 390, height: 844});
  const page = await owner.newPage();
  await page.goto(`${base}/guest?code=browser-only`);
  await page.locator('#searchInput').fill('Funk');
  await page.locator('#searchButton').click();
  await page.locator('#results .song-card').first().getByRole('button', {name: '+ Do fronty'}).click();
  await page.locator('#nowTitle').filter({hasText: 'Guest funk'}).waitFor();
  assert.equal(await page.locator('#skipOwnSong').isVisible(), true, 'first guest takes over AutoDJ and can skip');
  const first = (await (await owner.request.get(`${base}/api/queue`)).json()).find(song => song.status === 'playing');
  const stranger = await context({width: 390, height: 844});
  const other = await stranger.newPage();
  await other.goto(`${base}/guest?code=browser-only`);
  await other.locator('#connection').filter({hasText: 'online'}).waitFor();
  assert.equal(await other.locator('#ownSongActions').isVisible(), false);
  assert.equal((await stranger.request.post(`${base}/api/queue/${first.id}/skip`)).status(), 404);
  await other.locator('#searchInput').fill('Funk');
  await other.locator('#searchButton').click();
  await other.locator('#results .song-card').nth(1).getByRole('button', {name: '+ Do fronty'}).click();
  assert.equal((await (await stranger.request.get(`${base}/api/queue`)).json())[0].id, first.id, 'second guest cannot interrupt the first guest');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#skipOwnSong').click();
  await page.locator('#nowTitle').filter({hasText: 'Next guest'}).waitFor();
  assert.equal(await page.locator('#ownSongActions').isVisible(), false);
  assert.deepEqual(await (await owner.request.post(`${base}/api/queue/${first.id}/skip`)).json(), {ok: true, idempotent: true});
  assert.equal((await (await owner.request.get(`${base}/api/queue`)).json())[0].video_id, 'B1234567890');
  assert.deepEqual(errors, []);
  console.log('Chromium: search first, skip announcement, 320/390/768/1440px, search, AutoDJ takeover, owner/stranger skip and stale retry passed.');
} finally {
  await browser?.close();
  if (server) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(temp, {recursive: true, force: true});
}
