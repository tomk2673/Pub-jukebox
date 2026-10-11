// Real admin flows against a disposable SQLite fixture, never the live bar queue.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';

const require = createRequire(import.meta.url);
const {chromium} = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`)
  : require('playwright');
const server = spawn(process.env.JUKEBOX_PYTHON || 'python', ['tests/continuation_server.py'],
  {cwd:new URL('..',import.meta.url),stdio:'inherit'});
const base = 'http://127.0.0.1:8769';
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
let browser;
try {
  let ready = false;
  for (let n=0;n<60;n++) {
    try { if ((await fetch(`${base}/health`)).ok) { ready=true; break; } } catch {}
    await wait(100);
  }
  assert.equal(ready,true,'disposable fixture is ready');
  browser = await chromium.launch({headless:true,executablePath:process.env.JUKEBOX_CHROMIUM || undefined,
    args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote']});
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.goto(`${base}/admin`);
  await page.locator('#pin').fill('test-only-pin');
  await page.locator('#loginForm button[type="submit"]').click();
  const playable = () => page.locator('#playToggle:not([disabled])').waitFor();
  const savedAuto = () => page.locator('#autodjEnabled:not([disabled])').waitFor();
  const config = async () => (await context.request.get(`${base}/api/admin/config`)).json();
  const queue = async () => (await context.request.get(`${base}/api/queue`)).json();
  const slider = async (id,value) => page.locator(`#${id}`).evaluate((el,v) => {
    el.value=String(v); el.dispatchEvent(new Event('input',{bubbles:true}));
  },value);
  await playable();
  assert.equal(await page.locator('#settingsPanel').isVisible(),false);
  assert.equal(await page.locator('.playback-actions button').count(),2);
  assert.equal(await page.locator('#nowTitle').innerText(),'Test Funk');
  assert.equal(await page.locator('#playToggle').innerText(),'Ⅱ Pauza');
  assert.equal(await page.locator('#playToggle').evaluate(el=>el.getBoundingClientRect().bottom<innerHeight),true,'player is immediately reachable');
  assert.equal(await page.locator('#adminSearchInput').evaluate(el=>el.getBoundingClientRect().bottom<innerHeight),true,'search needs no page scroll');

  await page.locator('#playToggle').click();
  await playable();
  assert.match(await page.locator('#playToggle').innerText(),/Pokračovat/);
  await page.route('**/api/player/control', async route => {
    if (route.request().postDataJSON()?.action==='volume') await wait(180);
    await route.continue();
  });
  await slider('volume',25);
  await wait(230);
  await slider('volume',67);
  await page.waitForFunction(() => document.getElementById('volumeValue').textContent==='67 %'
    && !state.volumeSending && state.volumePending==null);
  await page.unroute('**/api/player/control');
  assert.equal((await (await context.request.get(`${base}/api/player/state`)).json()).volume,67);
  assert.equal(await page.locator('#nowTitle').innerText(),'Test Funk','volume preserves the current song');
  assert.match(await page.locator('#playToggle').innerText(),/Pokračovat/,'volume preserves a known pause');
  await page.locator('#nightButton').click();
  await playable();
  assert.equal(await page.locator('#nightButton').getAttribute('aria-pressed'),'true');
  await page.reload();
  await playable();
  assert.match(await page.locator('#playToggle').innerText(),/Pokračovat/,'known pause survives reload in this tab');
  await page.locator('#playToggle').click();
  await playable();
  assert.match(await page.locator('#playToggle').innerText(),/Pauza/);

  await page.locator('#adminSearchInput').fill('funk');
  await page.locator('#adminSearchButton').click();
  await page.locator('#adminSearchResults .song-card').first().waitFor();
  await page.locator('#adminSearchResults button').first().evaluate(el=>{el.click();el.click();});
  await page.locator('#adminSearchResults button').first().filter({hasText:'Ve frontě'}).waitFor();
  await page.locator('#queue .song-card').waitFor();
  assert.equal((await queue()).filter(song=>song.status==='queued').length,1,'a double tap adds one song');
  await page.locator('#queue button').first().focus();
  await page.evaluate(()=>{window.queueButton=document.activeElement;});
  await page.evaluate(()=>loadAll(true));
  assert.equal(await page.evaluate(()=>window.queueButton===document.activeElement && window.queueButton.isConnected),true,'unchanged polling retains focus and DOM');
  await page.locator('#adminSearchResults button').nth(1).click();
  await page.locator('#adminSearchResults button').nth(1).filter({hasText:'Ve frontě'}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('#queue .song-card').length===2);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'/tmp/jukebox-admin-queue.png',fullPage:true});
  await page.locator('#clearSearchButton').click();
  assert.equal(await page.locator('#adminSearchResults .song-card').count(),0);
  await page.locator('#queue button').first().click();
  await playable();
  assert.match(await page.locator('#nowTitle').innerText(),/Fixture funk 1/);
  // "Play now" keeps the interrupted track in the existing server queue.
  await page.locator('#queue [data-song-id="1"] .remove-song').click();
  await playable();
  assert.equal((await queue()).some(song=>song.id===1 && song.status==='queued'),false);
  await page.route('**/api/player/next', async route=>{await wait(200);await route.continue();});
  await page.locator('#nextButton').evaluate(el=>{el.click();el.click();});
  await playable();
  await page.unroute('**/api/player/next');
  assert.match(await page.locator('#nowTitle').innerText(),/Fixture funk 2/,'double next tap advances once');

  const original = await config();
  await page.locator('#settingsTab').click();
  await page.locator('#businessName').fill('Rozpracovaný bar');
  await page.locator('#menuText').fill('Drink | 125 Kč');
  await page.locator('input[name="tvMode"][value="menu"]').check();
  await page.locator('#soundSettings > summary').click();
  await page.locator('input[name="audioMode"][value="bass_guard"]').check();
  await slider('targetLufs',-18);
  await page.locator('#musicTab').click();
  await page.locator('input[name="autodjPlaylist"][value="soul_blues"]').check();
  await savedAuto();
  let stored = await config();
  assert.equal(stored.business_name,original.business_name,'quick save does not submit a business draft');
  assert.equal(stored.tv_mode,original.tv_mode);
  assert.equal(stored.audio_mode,original.audio_mode,'quick save does not submit an audio draft');
  assert.equal(stored.target_lufs,original.target_lufs);
  assert.equal(stored.autodj_playlists.includes('soul_blues'),true);
  await page.locator('#settingsTab').click();
  assert.equal(await page.locator('#businessName').inputValue(),'Rozpracovaný bar');
  assert.equal(await page.locator('#menuText').inputValue(),'Drink | 125 Kč');
  assert.equal(await page.locator('#targetLufs').inputValue(),'-18');
  assert.equal(await page.locator('#unsavedDot').isVisible(),true);
  await page.locator('#saveAudioButton').click();
  await page.locator('#saveAudioButton:not([disabled])').waitFor();
  stored = await config();
  assert.equal(stored.target_lufs,-18);
  assert.equal(stored.business_name,original.business_name,'audio-only save leaves the TV draft untouched');
  await page.locator('#saveSettingsButton').click();
  await page.locator('#displayStatus').filter({hasText:'Uloženo.'}).waitFor();
  assert.equal(await page.locator('#unsavedDot').isVisible(),false);
  stored=await config();
  assert.equal(stored.business_name,'Rozpracovaný bar');
  assert.equal(stored.tv_mode,'menu');
  assert.equal(stored.menu_text,'Drink | 125 Kč');
  await page.reload();
  await playable();
  assert.equal(await page.locator('#settingsPanel').isVisible(),false,'login/reload starts on music');
  await page.locator('#musicTab').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#settingsTab').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#musicTab').getAttribute('aria-selected'),'true');

  // Reject an empty enabled automatic selection, and roll back failed writes.
  for (const key of ['world_hits','funk','hiphop','house']) {
    await page.locator(`input[name="autodjPlaylist"][value="${key}"]`).uncheck();
    await savedAuto();
  }
  await page.locator('input[name="autodjPlaylist"][value="soul_blues"]').uncheck();
  await savedAuto();
  assert.equal(await page.locator('input[name="autodjPlaylist"][value="soul_blues"]').isChecked(),true);
  assert.match(await page.locator('#autodjStatus').innerText(),/alespoň jeden styl/);
  await page.route('**/api/admin/display',route=>route.fulfill({status:503,json:{detail:'Testovací výpadek'}}));
  await page.locator('#autodjEnabled').uncheck();
  await savedAuto();
  assert.equal(await page.locator('#autodjEnabled').isChecked(),true,'failed write rolls the switch back');
  assert.match(await page.locator('#autodjStatus').innerText(),/Neuloženo/);
  await page.unroute('**/api/admin/display');
  await page.locator('#autodjEnabled').uncheck();
  await savedAuto();
  assert.equal((await config()).autodj_enabled,false);
  assert.equal(await page.locator('input[name="autodjPlaylist"][value="funk"]').isDisabled(),true);
  await page.locator('#autodjEnabled').check();
  await savedAuto();
  await context.request.post(`${base}/api/player/next`);
  await page.evaluate(()=>loadAll(true));
  assert.match(await page.locator('#playToggle').innerText(),/Spustit/);
  await page.locator('#playToggle').click();
  await playable();
  assert.match(await page.locator('#nowTitle').innerText(),/Fixture soul_blues/,'start prepares AutoDJ when the queue is empty');

  await page.route('**/api/queue',route=>route.fulfill({status:503,json:{detail:'Testovací výpadek'}}));
  await page.evaluate(()=>loadAll(true));
  assert.equal(await page.locator('#connectionNotice').isVisible(),true);
  assert.equal(await page.locator('#playToggle').isDisabled(),true);
  await page.unroute('**/api/queue');
  await page.evaluate(()=>loadAll(true));
  await playable();
  assert.equal(await page.locator('#connectionNotice').isVisible(),false);

  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    for (const tab of ['music','settings']) {
      await page.locator(`#${tab}Tab`).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${tab}: no overflow at ${width}px`);
      if (width===390 && tab==='settings') await page.screenshot({path:'/tmp/jukebox-admin-settings-mobile.png',fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#musicTab').click();
  await page.screenshot({path:'/tmp/jukebox-admin-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'/tmp/jukebox-admin-desktop.png',fullPage:true});
  await page.locator('#settingsTab').click();
  await page.screenshot({path:'/tmp/jukebox-admin-settings.png',fullPage:true});

  await page.route('**/api/player/state',route=>route.fulfill({status:401,json:{detail:'Vypršelo'}}));
  await page.evaluate(()=>loadAll(true));
  assert.equal(await page.locator('#loginView').isVisible(),true);
  assert.equal(await page.locator('#adminView').isVisible(),false);
  await page.unroute('**/api/player/state');
  await page.locator('#pin').fill('test-only-pin');
  await page.locator('#loginForm button[type="submit"]').click();
  await playable();
  assert.equal(await page.locator('#settingsPanel').isVisible(),false);
  await page.locator('#settingsTab').click();
  await page.locator('#logoutButton').click();
  await page.locator('#loginView').waitFor();
  assert.equal((await (await context.request.get(`${base}/api/me`)).json()).admin,false);
  assert.deepEqual(errors,[]);
  console.log('Admin Chromium: login, unified player, volume/night/pause, search, queue, double taps, stable focus, immediate AutoDJ, draft isolation, audio save, rollback, network recovery, keyboard tabs, 320/390/768/1440px and session expiry passed.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
