import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/tv.js", import.meta.url), "utf8").replace(/boot\(\);\s*$/, "");
const sandbox = {
  Float32Array,
  Math,
  Number,
  Promise,
  setTimeout,
  setInterval: () => 0,
  window: {},
};
vm.runInNewContext(source, sandbox);

let seed = 123456789;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const variants = sandbox.getTransitionVariants();
assert.equal(variants.length, 5, "Živý DJ mix musí nabídnout pět variant");
const metrics = [];
for (const variant of variants) {
  const samples = sandbox.synthesizeTransitionSamples(48000, variant, random);
  assert.equal(samples.length, Math.ceil(48000 * variant.duration), `${variant.id} musí dodržet svoji délku`);
  let peak = 0;
  let power = 0;
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample), "Vzorky přechodu musí být konečné");
    peak = Math.max(peak, Math.abs(sample));
    power += sample * sample;
  }
  const rms = Math.sqrt(power / samples.length);
  assert.ok(peak > 0.2 && peak < 0.95, `${variant.id} musí být slyšitelný, ale nesmí digitálně přebudit`);
  assert.ok(rms > 0.035 && rms < 0.4, `${variant.id} musí mít kontrolovanou průměrnou energii`);
  assert.ok(Math.abs(samples[0]) < 0.001, `${variant.id} musí začínat bez lupnutí`);
  metrics.push({ id: variant.id, duration_ms: Math.round(variant.duration * 1000), peak: Number(peak.toFixed(3)), rms: Number(rms.toFixed(3)) });
}

const rotation = Array.from({ length: 15 }, () => sandbox.chooseTransitionVariant(random).id);
assert.equal(new Set(rotation).size, variants.length, "Rotace musí použít všechny varianty");
for (let index = 1; index < rotation.length; index += 1) {
  assert.notEqual(rotation[index], rotation[index - 1], "Stejný přechod nesmí zaznít dvakrát za sebou");
}

console.log(JSON.stringify({ variants: metrics, rotation }));
