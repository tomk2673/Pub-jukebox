import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let ProcessorClass = null;
const messages = [];
class AudioWorkletProcessorStub {
  constructor() {
    this.port = { onmessage: null, postMessage: (message) => messages.push(message) };
  }
}

const sandbox = {
  AudioWorkletProcessor: AudioWorkletProcessorStub,
  Float32Array,
  Float64Array,
  Math,
  Number,
  sampleRate: 48000,
  registerProcessor: (_name, processor) => { ProcessorClass = processor; },
};
const source = fs.readFileSync(new URL("../windows-bass-guard/bass-guard-processor.js", import.meta.url), "utf8");
vm.runInNewContext(source, sandbox);
assert.ok(ProcessorClass, "AudioWorklet se musí zaregistrovat");

const processor = new ProcessorClass({
  processorOptions: {
    config: {
      audio_mode: "bass_guard",
      target_lufs: -16,
      limiter_ceiling_db: -1,
      bass_guard_strength: 80,
    },
  },
});

let phase = 0;
let outputPeak = 0;
for (let block = 0; block < 3000; block += 1) {
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  for (let index = 0; index < 128; index += 1) {
    const time = phase / 48000;
    const sample = 0.72 * Math.sin(2 * Math.PI * 50 * time) + 0.08 * Math.sin(2 * Math.PI * 1000 * time);
    left[index] = sample;
    right[index] = sample;
    phase += 1;
  }
  const output = [new Float32Array(128), new Float32Array(128)];
  processor.process([[left, right]], [output]);
  if (block > 100) {
    for (const channel of output) for (const sample of channel) outputPeak = Math.max(outputPeak, Math.abs(sample));
  }
}

const latest = messages.filter((message) => message.type === "metrics").at(-1)?.metrics;
assert.ok(latest, "Procesor musí posílat živé metriky");
assert.ok(Number.isFinite(latest.measured_lufs), "Měření hlasitosti musí být číselné");
assert.ok(latest.bass_reduction_db > 1, "Basově přetížený signál musí být dynamicky stažen");
assert.ok(outputPeak <= 10 ** (-1 / 20) + 0.01, "Výstup nesmí překročit nastavený limiter");

const transientProcessor = new ProcessorClass({
  processorOptions: {
    config: {
      audio_mode: "bass_guard",
      target_lufs: -8,
      limiter_ceiling_db: -6,
      bass_guard_strength: 0,
    },
  },
});
let transientPeak = 0;
for (let block = 0; block < 8; block += 1) {
  const signal = new Float32Array(128);
  if (block === 0) signal[0] = 1;
  const output = [new Float32Array(128), new Float32Array(128)];
  transientProcessor.process([[signal, signal]], [output]);
  for (const channel of output) for (const sample of channel) transientPeak = Math.max(transientPeak, Math.abs(sample));
}
assert.ok(transientProcessor.limiterGain < 0.8, "Limiter musí na plnou špičku skutečně reagovat");
assert.ok(transientPeak <= 10 ** (-6 / 20) + 0.015, "Look-ahead limiter musí zachytit plnou špičku");

console.log(JSON.stringify({ outputPeak, transientPeak, latest }));
