import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`)
  : require('playwright');
const server = spawn(process.env.JUKEBOX_PYTHON || 'python', ['tests/continuation_server.py'],
  {cwd:new URL('..',import.meta.url),stdio:'inherit'});
let browser;
try {
  let ready = false;
  for (let n=0;n<60;n++) {
    try { if ((await fetch('http://127.0.0.1:8769/health')).ok) { ready=true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.equal(ready,true,'disposable fixture server started');
  browser = await chromium.launch({headless:true, executablePath:process.env.JUKEBOX_CHROMIUM || undefined,
    args:['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.goto('http://127.0.0.1:8769/guest?code=test-only-join');
  await page.locator('#discoverStatus').filter({hasText:'Český funk'}).waitFor();
  assert.match(await page.locator('#continuationNote').innerText(), /Navazuje Český funk/);
  const firstOffer = await page.locator('#discoverResults .song-title').allTextContents();
  assert.equal(firstOffer.length, 12);
  await page.locator('#moreDiscovery').click();
  await page.locator('#moreDiscovery:not([disabled])').waitFor();
  const nextOffer = await page.locator('#discoverResults .song-title').allTextContents();
  assert.equal(nextOffer.length, 12);
  assert.equal(nextOffer.some(title => firstOffer.includes(title)), false, 'next offer has no repeats');
  await page.locator('#discoverResults button').first().click();
  await page.locator('#discoverResults button').first().filter({hasText:'Ve frontě'}).waitFor();
  let queue = await (await context.request.get('http://127.0.0.1:8769/api/queue')).json();
  assert.equal(queue[1].source_playlist, 'cz_funk', 'source survives UI → API → queue');
  await context.request.post('http://127.0.0.1:8769/api/admin/login', {data:{pin:'test-only-pin'}});
  let prepared = await (await context.request.post('http://127.0.0.1:8769/api/player/autodj/prepare')).json();
  assert.equal(prepared.song.source_playlist, 'cz_funk');
  // Switch via a real discovery result, while an old AutoDJ buffer already exists.
  await page.locator('[data-discovery="cz_oldies"]').click();
  await page.locator('#discoverResults .song-title').first().filter({hasText:'cz_oldies'}).waitFor();
  await page.locator('#discoverResults button').first().click();
  await page.locator('#discoverResults button').first().filter({hasText:'Ve frontě'}).waitFor();
  await context.request.post('http://127.0.0.1:8769/api/player/ended');
  await context.request.post('http://127.0.0.1:8769/api/player/ended');
  prepared = await (await context.request.post('http://127.0.0.1:8769/api/player/autodj/prepare')).json();
  assert.equal(prepared.song.source_playlist, 'cz_oldies', 'AutoDJ keeps the last played playlist');
  await page.locator('[data-discovery="continue"]').click();
  await page.locator('#discoverStatus').filter({hasText:'České oldies'}).waitFor();
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('.discovery-panel').screenshot({path:'/tmp/jukebox-continuation-ui.png'});
  assert.deepEqual(errors, []);
  console.log('Chromium: next offers, source persistence, host ordering, automatic playlist continuation, 320/390/768/1440px and no JS errors passed.');
} finally { await browser?.close(); server.kill('SIGTERM'); }
