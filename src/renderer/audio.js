'use strict';
// Processamento do microfone, equivalente as opcoes de voz do Discord:
//   supressao de ruido (IA/RNNoise | padrao | nenhuma), cancelamento de eco, ganho automatico,
//   volume de entrada, deteccao de voz com sensibilidade automatica ou manual, deteccao avancada (VAD por IA),
//   pressionar para falar com atraso ao soltar, teste de microfone (loopback),
//   aviso "voce esta silenciado" e aviso de microfone sem som.
//
// Grafo: mic -> [RNNoise] -> volume de entrada -> analisador
//                                          \-> atraso 30ms (lookahead) -> gate -> destino (track enviada)

const dbOf = (rms) => (rms > 0 ? 20 * Math.log10(rms) : -100);

class MicProcessor {
  constructor(ctx, settings) {
    this.ctx = ctx;
    this.settings = settings;
    this.listeners = {};
    this.dest = ctx.createMediaStreamDestination();
    this.inputGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.rawAnalyser = ctx.createAnalyser(); // sinal cru (antes da IA) para detectar microfone mudo
    this.rawAnalyser.fftSize = 1024;
    this.delay = ctx.createDelay(0.1);
    this.delay.delayTime.value = 0.03; // o gate abre "antes" da primeira silaba
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.inputGain.connect(this.analyser);
    this.inputGain.connect(this.delay).connect(this.gate).connect(this.dest);

    this.raw = null;
    this.src = null;
    this.worklet = null;
    this.rnnError = null;
    this.muted = false;
    this.ptt = false;
    this.pttTimer = null;
    this.vad = 0;
    this.lastVadVoice = 0;
    this.lastVoice = 0;
    this.noiseFloor = -60;
    this.lastDb = -100;
    this.transmitting = false;
    this.speaking = false;
    this.silentSince = 0;
    this.noInputWarned = false;
    this.lastMutedWarn = 0;
    this.loopback = false;
  }

  get track() { return this.dest.stream.getAudioTracks()[0]; }
  on(ev, cb) { (this.listeners[ev] ||= []).push(cb); }
  emit(ev, d) { for (const cb of this.listeners[ev] || []) cb(d); }

  static async loadWorklet(ctx) {
    if (!ctx.__rnnoiseLoaded) {
      ctx.__rnnoiseLoaded = ctx.audioWorklet.addModule('worklets/rnnoise-worklet.js');
    }
    return ctx.__rnnoiseLoaded;
  }

  async start() {
    await this.acquire();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 20);
  }

  // (re)abre o microfone com as configuracoes atuais. A track de saida continua a mesma,
  // entao trocar dispositivo/filtros nao exige renegociar a chamada.
  async acquire() {
    const s = this.settings;
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: s.inputDevice ? { exact: s.inputDevice } : undefined,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression === 'standard',
        autoGainControl: s.autoGainControl,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
    this.releaseInput();
    this.raw = raw;
    this.src = this.ctx.createMediaStreamSource(raw);
    this.src.connect(this.rawAnalyser);
    this.rnnError = null;
    const needRnn = s.noiseSuppression === 'krisp' || s.advancedVad;
    if (needRnn) {
      try {
        await MicProcessor.loadWorklet(this.ctx);
        this.worklet = new AudioWorkletNode(this.ctx, 'rnnoise', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { suppress: s.noiseSuppression === 'krisp' },
        });
        this.worklet.port.onmessage = (e) => { this.vad = e.data; };
        this.src.connect(this.worklet).connect(this.inputGain);
      } catch (e) {
        console.warn('RNNoise indisponivel', e);
        this.rnnError = e.message || String(e);
        this.worklet = null;
        this.src.connect(this.inputGain);
      }
    } else {
      this.src.connect(this.inputGain);
    }
    this.inputGain.gain.value = s.inputVolume;
    this.noInputWarned = false;
    this.silentSince = 0;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  releaseInput() {
    if (this.src) this.src.disconnect();
    if (this.worklet) { this.worklet.port.postMessage({ destroy: true }); this.worklet.disconnect(); }
    if (this.raw) this.raw.getTracks().forEach((t) => t.stop());
    this.src = this.worklet = this.raw = null;
    this.vad = 0;
  }

  setInputVolume(v) { this.inputGain.gain.value = v; }
  setMuted(m) { this.muted = m; }

  setPTT(active) {
    clearTimeout(this.pttTimer);
    if (active) this.ptt = true;
    else this.pttTimer = setTimeout(() => { this.ptt = false; }, this.settings.pttReleaseDelay);
  }

  // teste de microfone: toca de volta exatamente o que seria enviado
  setLoopback(on) {
    if (on === this.loopback) return;
    this.loopback = on;
    if (on) this.gate.connect(this.ctx.destination); else this.gate.disconnect(this.ctx.destination);
  }

  threshold() {
    const s = this.settings;
    if (!s.autoSensitivity) return s.vadThresholdDb;
    return Math.max(-70, Math.min(-25, this.noiseFloor + 12));
  }

  tick() {
    const s = this.settings;
    const now = performance.now();
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const db = dbOf(Math.sqrt(sum / this.buf.length));
    this.lastDb = db;

    // estimativa do ruido de fundo (cai rapido, sobe devagar) para a sensibilidade automatica
    if (db < this.noiseFloor) this.noiseFloor = this.noiseFloor * 0.8 + db * 0.2;
    else this.noiseFloor = Math.min(this.noiseFloor + 0.03, db);

    const thr = this.threshold();
    let voice = db > thr;
    if (s.advancedVad && this.worklet) {
      if (this.vad > 0.6) this.lastVadVoice = now;
      voice = voice && now - this.lastVadVoice < 200; // ignora teclado, ventilador, etc.
    }
    if (voice) this.lastVoice = now;

    const wants = s.inputMode === 'ptt' ? this.ptt : now - this.lastVoice < 350;
    const transmitting = wants && !this.muted;
    if (transmitting !== this.transmitting) {
      this.transmitting = transmitting;
      this.gate.gain.setTargetAtTime(transmitting ? 1 : 0, this.ctx.currentTime, transmitting ? 0.004 : 0.04);
    }
    const speaking = transmitting && (s.inputMode === 'ptt' ? db > thr : true);
    if (speaking !== this.speaking) { this.speaking = speaking; this.emit('speaking', speaking); }

    if (this.muted && voice && now - this.lastMutedWarn > 6000) { this.lastMutedWarn = now; this.emit('speaking-while-muted'); }

    // microfone mudo de verdade (cabo, privacidade do Windows, dispositivo errado)
    this.rawAnalyser.getFloatTimeDomainData(this.buf);
    let rawPeak = 0;
    for (let i = 0; i < this.buf.length; i++) { const a = Math.abs(this.buf[i]); if (a > rawPeak) rawPeak = a; }
    if (this.raw && rawPeak === 0) { // zeros digitais = nenhum sinal chegando
      if (!this.silentSince) this.silentSince = now;
      if (!this.noInputWarned && now - this.silentSince > 6000) { this.noInputWarned = true; this.emit('no-input'); }
    } else this.silentSince = 0;
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.pttTimer);
    this.setLoopback(false);
    this.releaseInput();
    this.gate.disconnect();
  }
}

window.REA_AUDIO = { MicProcessor };
