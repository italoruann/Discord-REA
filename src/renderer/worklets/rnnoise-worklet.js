// Supressao de ruido por IA (RNNoise) rodando na thread de audio em tempo real.
// Equivalente aberto do Krisp usado pelo Discord. Tambem devolve a probabilidade de voz (VAD),
// usada pela "Deteccao avancada de voz".
import createRNNWasmModuleSync from '../../../node_modules/@jitsi/rnnoise-wasm/dist/rnnoise-sync.js';

const FRAME = 480;          // RNNoise trabalha com quadros de 10 ms a 48 kHz
const FIFO = 4096;
const SCALE = 32768;        // RNNoise espera amostras na faixa de int16

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.suppress = options.processorOptions ? options.processorOptions.suppress !== false : true;
    this.mod = createRNNWasmModuleSync();
    this.st = this.mod._rnnoise_create();
    this.inPtr = this.mod._malloc(FRAME * 4);
    this.outPtr = this.mod._malloc(FRAME * 4);
    this.frame = new Float32Array(FRAME);
    this.frameLen = 0;
    this.fifo = new Float32Array(FIFO);
    this.rd = 0;
    this.wr = FRAME; // 10 ms de atraso inicial garante que sempre ha saida pronta
    this.vadMax = 0;
    this.frames = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      if ('suppress' in e.data) this.suppress = e.data.suppress;
      if (e.data.destroy) this.destroy();
    };
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.mod._rnnoise_destroy(this.st);
    this.mod._free(this.inPtr);
    this.mod._free(this.outPtr);
  }

  processFrame() {
    const heap = this.mod.HEAPF32; // pode mudar se a memoria do wasm crescer
    const inIdx = this.inPtr >> 2;
    const outIdx = this.outPtr >> 2;
    for (let i = 0; i < FRAME; i++) heap[inIdx + i] = this.frame[i] * SCALE;
    const vad = this.mod._rnnoise_process_frame(this.st, this.outPtr, this.inPtr);
    const src = this.suppress ? heap : null;
    for (let i = 0; i < FRAME; i++) {
      this.fifo[this.wr] = src ? src[outIdx + i] / SCALE : this.frame[i];
      this.wr = (this.wr + 1) % FIFO;
    }
    if (vad > this.vadMax) this.vadMax = vad;
    if (++this.frames === 2) { // envia a cada 20 ms
      this.port.postMessage(this.vadMax);
      this.vadMax = 0;
      this.frames = 0;
    }
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0][0];
    const n = output.length;
    for (let i = 0; i < n; i++) {
      this.frame[this.frameLen++] = input ? input[i] : 0;
      if (this.frameLen === FRAME) { this.processFrame(); this.frameLen = 0; }
    }
    for (let i = 0; i < n; i++) {
      output[i] = this.fifo[this.rd];
      this.rd = (this.rd + 1) % FIFO;
    }
    return true;
  }
}

registerProcessor('rnnoise', RnnoiseProcessor);
