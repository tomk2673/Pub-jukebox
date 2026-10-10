import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require=createRequire(import.meta.url);
const {chromium}=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`)
  : require("playwright");
const server=spawn(process.env.JUKEBOX_PYTHON || "python",["tests/continuation_server.py"],
  {cwd:new URL("..",import.meta.url),stdio:"inherit"});
let browser;
const origin="http://127.0.0.1:8769";
try {
  let ready=false;
  for (let n=0;n<60;n++) {
    try {if ((await fetch(`${origin}/health`)).ok) {ready=true;break;}} catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(ready,true);
  browser=await chromium.launch({headless:true,executablePath:process.env.JUKEBOX_CHROMIUM || undefined,
    args:["--no-sandbox"]});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await context.request.post(`${origin}/api/admin/login`,{data:{pin:"test-only-pin"}});
  // Local transport test: no production queue and no real YouTube audio/video requests.
  // Deliberately initialize before tv.js and omit the iframe API readiness callback.
  await page.route("https://www.youtube.com/iframe_api",route=>route.fulfill({
    contentType:"application/javascript",body:`
      window.fixturePlayers=[];
      window.YT={PlayerState:{ENDED:0,PLAYING:1,PAUSED:2,BUFFERING:3,CUED:5},
        Player:function(id,options){
          const deck={state:-1,video:null,blockOnce:false,volume:0,
            getIframe:()=>document.getElementById(id), getPlayerState(){return this.state;},
            getDuration:()=>180, getCurrentTime:()=>20,
            setVolume(value){this.volume=value;},
            cueVideoById(video){this.video=video;this.state=5;},
            loadVideoById(video){this.video=video;this.playVideo();},
            playVideo(){if(this.blockOnce){this.blockOnce=false;options.events.onAutoplayBlocked();return;}
              this.state=1;queueMicrotask(()=>options.events.onStateChange({data:1}));},
            pauseVideo(){this.state=2;},stopVideo(){this.state=-1;}
          };window.fixturePlayers.push(deck);setTimeout(()=>options.events.onReady(),0);return deck;
        }};`,
  }));
  await page.route("https://i.ytimg.com/**",route=>route.abort());
  await page.goto(`${origin}/tv`);
  await page.locator("#nowTitle").filter({hasText:"Test Funk"}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixturePlayers.length),2,"cached iframe API creates both decks");
  const firstGuest=(await (await context.request.post(`${origin}/api/queue`,{data:{
    video_id:"track999991",title:"First guest takes priority",source_playlist:"funk",
  }})).json());
  await page.evaluate(()=>{window.fixturePlayers[activeDeck].state=0;});
  await page.locator("#nowTitle").filter({hasText:firstGuest.title}).waitFor({timeout:12000});
  let queue=await (await context.request.get(`${origin}/api/queue`)).json();
  assert.equal(queue.find(song=>song.status==="playing").id,firstGuest.id,
    "lost ENDED event advances through real API with guest priority");

  await context.request.post(`${origin}/api/player/control`,{data:{action:"pause"}});
  await page.waitForFunction(()=>playbackPaused && window.fixturePlayers[activeDeck].state===2);
  await context.request.post(`${origin}/api/player/control`,{data:{action:"volume",value:70}});
  await page.waitForFunction(()=>effectiveVolume===70 && playbackPaused);
  await page.evaluate(()=>{window.fixturePlayers[activeDeck].state=0;});
  await page.waitForTimeout(1000);
  queue=await (await context.request.get(`${origin}/api/queue`)).json();
  assert.equal(queue.find(song=>song.status==="playing").id,firstGuest.id,"manual pause preserves song");
  await context.request.post(`${origin}/api/player/control`,{data:{action:"resume"}});
  await page.waitForFunction(()=>!playbackPaused && window.fixturePlayers[activeDeck].state===1);

  const secondGuest=await (await context.request.post(`${origin}/api/queue`,{data:{
    video_id:"track999992",title:"Second guest after browser activation",source_playlist:"funk",
  }})).json();
  await page.evaluate(()=>{window.fixturePlayers[1-activeDeck].blockOnce=true;
    window.fixturePlayers[activeDeck].state=0;});
  await page.locator("#tapToPlay").waitFor({state:"visible",timeout:10000});
  queue=await (await context.request.get(`${origin}/api/queue`)).json();
  assert.equal(queue.find(song=>song.id===secondGuest.id).status,"queued","blocked playback does not delete guest");
  await page.locator("#tapToPlay").click();
  await page.locator("#nowTitle").filter({hasText:secondGuest.title}).waitFor({timeout:12000});
  await page.locator("#tapToPlay").waitFor({state:"hidden"});
  queue=await (await context.request.get(`${origin}/api/queue`)).json();
  assert.equal(queue.find(song=>song.status==="playing").id,secondGuest.id);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  assert.deepEqual(errors,[]);
  console.log("Chromium TV: cached API startup, lost ENDED event, real queue/transition and guest priority, manual pause across volume change, incoming autoplay activation and 320/390/768/1440px passed. YouTube player is a local fixture.");
} finally {await browser?.close();server.kill("SIGTERM");}
