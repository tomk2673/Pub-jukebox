const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const dbToGain = (value) => 10 ** (value / 20);
const gainToDb = (value) => 20 * Math.log10(Math.max(1e-9, value));

class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.z1 = 0;
    this.z2 = 0;
  }

  assign(b0, b1, b2, a0, a1, a2) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  lowpass(frequency, q, rate) {
    const omega = 2 * Math.PI * frequency / rate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q);
    return this.assign(
      (1 - cosine) / 2,
      1 - cosine,
      (1 - cosine) / 2,
      1 + alpha,
      -2 * cosine,
      1 - alpha,
    );
  }

  highpass(frequency, q, rate) {
    const omega = 2 * Math.PI * frequency / rate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q);
    return this.assign(
      (1 + cosine) / 2,
      -(1 + cosine),
      (1 + cosine) / 2,
      1 + alpha,
      -2 * cosine,
      1 - alpha,
    );
  }

  highShelf(frequency, gainDb, rate) {
    const amplitude = 10 ** (gainDb / 40);
    const omega = 2 * Math.PI * frequency / rate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    const alpha = sine / 2 * Math.sqrt(2);
    const beta = 2 * Math.sqrt(amplitude) * alpha;
    return this.assign(
      amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + beta),
      -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine),
      amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - beta),
      (amplitude + 1) - (amplitude - 1) * cosine + beta,
      2 * ((amplitude - 1) - (amplitude + 1) * cosine),
      (amplitude + 1) - (amplitude - 1) * cosine - beta,
    );
  }

  process(sample) {
    const result = this.b0 * sample + this.z1;
    this.z1 = this.b1 * sample - this.a1 * result + this.z2;
    this.z2 = this.b2 * sample - this.a2 * result;
    return result;
  }
}

class NightBassGuardProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.config = this.normalizeConfig(options.processorOptions?.config || {});
    this.lowFilters = [];
    this.weightHighpass = [];
    this.weightShelf = [];
    this.delayBuffers = [];
    this.delaySize = Math.max(64, Math.ceil(sampleRate * 0.006));
    this.delayIndex = 0;
    this.inputValues = new Float64Array(8);
    this.lowValues = new Float64Array(8);
    this.processedValues = new Float64Array(8);
    this.loudnessPower = 1e-8;
    this.fullPower = 1e-8;
    this.bassPower = 1e-8;
    this.levelGain = 1;
    this.bassGain = 1;
    this.limiterEnvelope = 0;
    this.limiterGain = 1;
    this.meterFrames = 0;

    this.loudnessCoefficient = Math.exp(-1 / (sampleRate * 3));
    this.fullCoefficient = Math.exp(-1 / (sampleRate * 0.4));
    this.bassCoefficient = Math.exp(-1 / (sampleRate * 0.25));
    this.levelAttack = Math.exp(-1 / (sampleRate * 0.35));
    this.levelRelease = Math.exp(-1 / (sampleRate * 4));
    this.bassAttack = Math.exp(-1 / (sampleRate * 0.035));
    this.bassRelease = Math.exp(-1 / (sampleRate * 0.7));
    this.limiterRelease = Math.exp(-1 / (sampleRate * 0.12));

    this.port.onmessage = (event) => {
      if (event.data?.type === "config") this.config = this.normalizeConfig(event.data.config || {});
    };
  }

  normalizeConfig(config) {
    return {
      enabled: config.audio_mode === "bass_guard",
      targetLufs: clamp(Number(config.target_lufs ?? -16), -24, -8),
      ceilingDb: clamp(Number(config.limiter_ceiling_db ?? -1), -6, 0),
      bassStrength: clamp(Number(config.bass_guard_strength ?? 65), 0, 100),
    };
  }

  ensureChannels(channelCount) {
    while (this.lowFilters.length < channelCount) {
      this.lowFilters.push(new Biquad().lowpass(120, 0.707, sampleRate));
      this.weightHighpass.push(new Biquad().highpass(38, 0.5, sampleRate));
      this.weightShelf.push(new Biquad().highShelf(1682, 4, sampleRate));
      this.delayBuffers.push(new Float32Array(this.delaySize));
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.length || !output?.length) return true;
    const channelCount = Math.min(output.length, 8);
    const frameCount = output[0].length;
    this.ensureChannels(channelCount);

    for (let frame = 0; frame < frameCount; frame += 1) {
      let fullFramePower = 0;
      let bassFramePower = 0;
      let weightedFramePower = 0;

      for (let channel = 0; channel < channelCount; channel += 1) {
        const source = input[Math.min(channel, input.length - 1)];
        const sample = source?.[frame] || 0;
        const low = this.lowFilters[channel].process(sample);
        const weighted = this.weightShelf[channel].process(this.weightHighpass[channel].process(sample));
        this.inputValues[channel] = sample;
        this.lowValues[channel] = low;
        fullFramePower += sample * sample;
        bassFramePower += low * low;
        weightedFramePower += weighted * weighted;
      }

      fullFramePower /= channelCount;
      bassFramePower /= channelCount;
      weightedFramePower /= channelCount;
      this.fullPower = this.fullCoefficient * this.fullPower + (1 - this.fullCoefficient) * fullFramePower;
      this.bassPower = this.bassCoefficient * this.bassPower + (1 - this.bassCoefficient) * bassFramePower;
      this.loudnessPower = this.loudnessCoefficient * this.loudnessPower + (1 - this.loudnessCoefficient) * weightedFramePower;

      const measuredLufs = 10 * Math.log10(Math.max(1e-10, this.loudnessPower));
      let wantedGain = 1;
      if (this.config.enabled && measuredLufs > -55) {
        wantedGain = dbToGain(clamp(this.config.targetLufs - measuredLufs, -12, 9));
      }
      const levelCoefficient = wantedGain < this.levelGain ? this.levelAttack : this.levelRelease;
      this.levelGain = levelCoefficient * this.levelGain + (1 - levelCoefficient) * wantedGain;

      let bassReductionDb = 0;
      const fullDb = 10 * Math.log10(Math.max(1e-10, this.fullPower));
      if (this.config.enabled && this.config.bassStrength > 0 && fullDb > -48) {
        const bassShareDb = 10 * Math.log10(Math.max(1e-10, this.bassPower / this.fullPower));
        const threshold = -2 - 0.06 * this.config.bassStrength;
        const excess = Math.max(0, bassShareDb - threshold);
        const ratio = 0.35 + 0.006 * this.config.bassStrength;
        bassReductionDb = Math.min(this.config.bassStrength * 0.12, excess * ratio);
      }
      const wantedBassGain = dbToGain(-bassReductionDb);
      const bassCoefficient = wantedBassGain < this.bassGain ? this.bassAttack : this.bassRelease;
      this.bassGain = bassCoefficient * this.bassGain + (1 - bassCoefficient) * wantedBassGain;

      let peak = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        const processed = (this.inputValues[channel] + this.lowValues[channel] * (this.bassGain - 1)) * this.levelGain;
        this.processedValues[channel] = processed;
        peak = Math.max(peak, Math.abs(processed));
      }
      this.limiterEnvelope = Math.max(peak, this.limiterEnvelope * this.limiterRelease);
      const ceiling = dbToGain(this.config.ceilingDb);
      const wantedLimiterGain = this.config.enabled ? Math.min(1, ceiling / Math.max(1e-9, this.limiterEnvelope)) : 1;
      this.limiterGain = wantedLimiterGain < this.limiterGain
        ? wantedLimiterGain
        : this.limiterRelease * this.limiterGain + (1 - this.limiterRelease) * wantedLimiterGain;

      for (let channel = 0; channel < channelCount; channel += 1) {
        const delay = this.delayBuffers[channel];
        const delayed = delay[this.delayIndex];
        delay[this.delayIndex] = this.processedValues[channel];
        output[channel][frame] = this.config.enabled ? delayed * this.limiterGain : this.inputValues[channel];
      }
      this.delayIndex = (this.delayIndex + 1) % this.delaySize;
    }

    this.meterFrames += frameCount;
    if (this.meterFrames >= sampleRate / 2) {
      const measured = 10 * Math.log10(Math.max(1e-10, this.loudnessPower));
      this.port.postMessage({
        type: "metrics",
        metrics: {
          measured_lufs: Number.isFinite(measured) ? Math.round(measured * 10) / 10 : null,
          gain_db: Math.round(gainToDb(this.levelGain) * 100) / 100,
          bass_reduction_db: Math.round(-gainToDb(this.bassGain) * 100) / 100,
          limiter_reduction_db: Math.round(-gainToDb(this.limiterGain) * 100) / 100,
        },
      });
      this.meterFrames = 0;
    }
    return true;
  }
}

registerProcessor("night-bass-guard", NightBassGuardProcessor);
