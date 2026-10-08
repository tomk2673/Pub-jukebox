import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/tv.js", import.meta.url), "utf8")
  .replace(/boot\(\);\s*$/, "");

function fixture() {
  let now = 100000;
  const timers = new Map();
  const elements = new Map();
  const states = [1, 5];
  const calls = [];
  const videos = ["track000001", "track000002"];
  const players = states.map((_, index) => ({
    getPlayerState: () => states[index],
    getDuration: () => 200,
    getCurrentTime: () => 30,
    playVideo: () => calls.push(["play", index]),
    pauseVideo: () => calls.push(["pause", index]),
    stopVideo: () => calls.push(["stop", index]),
    cueVideoById: id => { videos[index] = id; calls.push(["cue", index, id]); },
    loadVideoById: id => { videos[index] = id; calls.push(["load", index, id]); },
    setVolume: value => calls.push(["volume", index, value]),
  }));
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent:"", style:{}, addEventListener(){}, classList:{
      hidden:true, add(name) { if (name === "hidden") this.hidden=true; },
      remove(name) { if (name === "hidden") this.hidden=false; },
      toggle(name, value) { if (name === "hidden") this.hidden=value; },
    }});
    return elements.get(id);
  };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({window:{location:{origin:"http://fixture.test"}}, document:{getElementById:element,
    body:{dataset:{},classList:{toggle(){}}}}, navigator:{userAgent:"Desktop"},
    YT:{PlayerState:{ENDED:0,PLAYING:1,PAUSED:2,BUFFERING:3,CUED:5}},
    Date:Clock, AbortController, console,
    setTimeout(fn,ms) { const id=timers.size+1; timers.set(id,{fn,ms}); return id; },
    clearTimeout(id) { timers.delete(id); }, playersFixture:players,
  });
  vm.runInContext(source,context);
  vm.runInContext(`authenticated=true; playbackEnabled=true; deckReady=[true,true];
    players=playersFixture; currentVideo='track000001'; deckVideos=['track000001','track000002'];
    currentSong={id:1,video_id:'track000001',title:'Playing'};`, context);
  return {context, states, calls, element, timers, clock:ms => { now+=ms; }};
}

// A lost end event must still advance, while buffering never skips a guest.
{
  const {context,states} = fixture();
  context.finishes=0;
  vm.runInContext("finishCurrentSong=async()=>{finishes++};",context);
  states[0]=0;
  await context.monitorDjOutro();
  assert.equal(context.finishes,1,"ended video recovered without onStateChange");
  states[0]=3;
  await context.monitorDjOutro();
  assert.equal(context.finishes,1,"buffering must not advance or delete a song");
  vm.runInContext("playbackPaused=true;",context);
  states[0]=0;
  await context.monitorDjOutro();
  assert.equal(context.finishes,1,"manual pause wins over recovery");
}

// Retry the same stopped video, with backoff; never consume another queue item.
{
  const {context,states,calls,clock} = fixture();
  states[0]=5;
  await context.monitorDjOutro();
  await context.monitorDjOutro();
  assert.deepEqual(calls,[["play",0]]);
  clock(5000);
  await context.monitorDjOutro();
  assert.deepEqual(calls,[["play",0],["play",0]]);
}

// Existing guests/buffers start before catalog lookup, including with AutoDJ disabled.
for (const enabled of [true,false]) {
  const {context} = fixture();
  context.requests=[];
  context.enabled=enabled;
  vm.runInContext(`autoDjEnabled=enabled; currentSong=null; currentVideo=null;
    api=async(path)=>{requests.push(path); if(path==='/api/player/start') return {song:{id:2}};
      throw new Error('Catalog must not block a queued guest');};`,context);
  await context.ensureAutoDjBuffer({now_playing:null});
  assert.deepEqual(context.requests,["/api/player/start"]);
}

// Network/catalog failure retries after five seconds and releases the pending request.
{
  const {context,clock,element} = fixture();
  context.requests=[];
  vm.runInContext(`api=async(path)=>{requests.push(path);
    if(path==='/api/player/start') return {song:null};
    throw new Error('Temporary catalog failure');};`,context);
  await context.ensureAutoDjBuffer({now_playing:null});
  assert.match(element("playbackStatus").textContent,/Temporary catalog failure/);
  await context.ensureAutoDjBuffer({now_playing:null});
  assert.equal(context.requests.length,2,"no polling storm");
  clock(5000);
  await context.ensureAutoDjBuffer({now_playing:null});
  assert.equal(context.requests.length,4,"a failed request is retried after five seconds");
}

// Prefetch, transition and idle recovery share one in-flight preparation.
{
  const {context} = fixture();
  let complete;
  context.pending = new Promise(resolve => { complete=resolve; });
  context.requests=[];
  vm.runInContext(`api=async(path)=>{requests.push(path);
    if(path==='/api/queue') return [];
    if(path==='/api/player/autodj/prepare') return pending;
    return {song:null};};`,context);
  const buffer=context.ensureAutoDjBuffer({now_playing:{id:1}});
  const next=context.makeSureNextSongExists();
  const idle=context.ensureAutoDjBuffer({now_playing:null});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.requests.filter(path=>path.endsWith("/prepare")).length,1);
  complete({enabled:true,prepared:false,reason:"no_fresh_track"});
  await Promise.all([buffer,next,idle]);
  assert.equal(vm.runInContext("autoDjPending",context),null);
}

// Failed queue reads must not be treated as permission to insert AutoDJ.
{
  const {context} = fixture();
  context.requests=[];
  vm.runInContext(`api=async(path)=>{requests.push(path); throw new Error('DB unavailable');};`,context);
  await assert.rejects(context.makeSureNextSongExists(),/DB unavailable/);
  assert.deepEqual(context.requests,["/api/queue"]);
}

// Consuming/removing a valid buffer cannot leave the player waiting for the success cooldown.
{
  const {context} = fixture();
  context.requests=[];
  vm.runInContext(`api=async(path)=>{requests.push(path);
    if(path==='/api/queue') return [];
    return {enabled:true,prepared:true,song:{id:2}};};`,context);
  await context.prepareAutoDj();
  await context.makeSureNextSongExists();
  assert.equal(context.requests.filter(path=>path.endsWith('/prepare')).length,2,
    "a confirmed empty queue refills after consuming a successful buffer");
}

// Preserve pause across an unrelated volume update, then resume explicitly.
{
  const {context,calls,states} = fixture();
  vm.runInContext("preloadNextSong=async()=>null;",context);
  const song={id:1,video_id:"track000001",title:"Playing"};
  await context.applyState({now_playing:song,volume:80,revision:1,action:"pause"});
  await context.applyState({now_playing:song,volume:70,revision:2,action:"volume"});
  states[0]=2;
  await context.monitorDjOutro();
  assert.equal(calls.filter(call=>call[0]==="play").length,0);
  await context.applyState({now_playing:song,volume:70,revision:3,action:"resume"});
  assert.equal(calls.filter(call=>call[0]==="play").length,1);
}

// User activation reaches the blocked incoming deck, not just the outgoing deck.
{
  const {context,calls,element} = fixture();
  let handlers;
  context.YT.Player = function(_id,options) { handlers=options.events; };
  context.makeDeck(1,"playerB");
  handlers.onAutoplayBlocked();
  assert.equal(element("tapToPlay").classList.hidden,false);
  context.onDeckStateChange(0,{data:1});
  assert.equal(element("tapToPlay").classList.hidden,false,"outgoing playback does not hide incoming block");
  vm.runInContext("sync=async()=>{};",context);
  context.resumeBlockedPlayback();
  assert.ok(calls.some(call=>call[0]==="play" && call[1]===1));
  assert.ok(calls.some(call=>call[0]==="volume" && call[1]===1 && call[2]===0));
  context.onDeckStateChange(1,{data:1});
  assert.equal(element("tapToPlay").classList.hidden,true);
}

// A cached YouTube API that became ready before the TV script still creates both decks.
{
  const {context} = fixture();
  context.window.YT={Player:function(){}};
  context.created=[];
  vm.runInContext(`players=[null,null]; apiReady=false;
    makeDeck=(index)=>{created.push(index); return {};};`,context);
  context.createPlayers();
  assert.deepEqual(context.created,[0,1]);
}

// A transient config failure at startup must not prevent the polling/recovery loop.
{
  const {context} = fixture();
  context.intervals=[];
  context.setInterval=(_fn,ms)=>context.intervals.push(ms);
  vm.runInContext(`api=async(path)=>{
    if(path==='/api/me') return {admin:true};
    throw new Error('Startup config unavailable');};`,context);
  await context.boot();
  assert.deepEqual(context.intervals,[1500,400,5000]);
  assert.equal(vm.runInContext('authenticated',context),true,
    "an authenticated session may recover on the next successful sync");
}

// Mobile observers never prepare, start or recover playback.
{
  const {context,states,calls} = fixture();
  context.requests=[];
  vm.runInContext(`playbackEnabled=false; api=async(path)=>requests.push(path);`,context);
  states[0]=0;
  await context.ensureAutoDjBuffer({now_playing:null});
  await context.monitorDjOutro();
  context.resumeBlockedPlayback();
  assert.deepEqual(context.requests,[]);
  assert.deepEqual(calls,[]);
}

// A hung HTTP request is bounded, so the next sync/preparation can run again.
{
  const {context,timers} = fixture();
  context.fetch=(_path,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener("abort",()=>reject(new Error("aborted")));
  });
  const request=context.api("/api/player/state");
  const check=assert.rejects(request,error=>error.status===503);
  const timeout=[...timers.values()].find(timer=>timer.ms===15000);
  assert.ok(timeout);
  timeout.fn();
  await check;
  assert.equal(timers.size,0);
  context.fetch=async()=>({ok:true,json:async()=>({now_playing:null})});
  assert.equal((await context.api("/api/player/state")).now_playing,null);
}

console.log("TV AutoDJ recovery: lost end event, idle queue priority, retry, single preparation, safe reads, consumed buffer, pause, incoming activation, cached API, startup failure, observer and HTTP timeout passed.");
