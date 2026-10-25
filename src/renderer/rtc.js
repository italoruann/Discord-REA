'use strict';
// Motor de voz/video: malha P2P WebRTC (ideal para poucas pessoas; sem servidor de midia no meio).
// Cada par tem uma RTCPeerConnection com "perfect negotiation" e streams separados p/ mic, camera e tela.

// padrao sem TURN; o servidor manda a lista completa (com credencial TURN temporaria) no 'ready'
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

// Quando o P2P falha (CGNAT) o video passa pelo TURN da VPS. Ai o teto e baixo para nao derrubar o servidor.
const RELAY_CAP = { bitrate: 2_500_000, height: 720, fps: 30 };

// Predefinicoes do "Go Live". Bitrates generosos: o limite real e a sua banda de upload.
const STREAM_PRESETS = {
  '720':    { width: 1280, height: 720,  bitrate: 6_000_000 },
  '1080':   { width: 1920, height: 1080, bitrate: 12_000_000 },
  '1440':   { width: 2560, height: 1440, bitrate: 20_000_000 },
  '2160':   { width: 3840, height: 2160, bitrate: 35_000_000 },
  'source': { width: 0,    height: 0,    bitrate: 25_000_000 },
};

function mungeSdp(sdp, { videoMaxKbps }) {
  const lines = sdp.split('\r\n');
  const opus = [];
  const video = [];
  for (const l of lines) {
    let m = l.match(/^a=rtpmap:(\d+) opus\/48000/i);
    if (m) opus.push(m[1]);
    m = l.match(/^a=rtpmap:(\d+) (H264|VP8|VP9|AV1|H265)\/90000/i);
    if (m) video.push(m[1]);
  }
  return lines.map((l) => {
    const m = l.match(/^a=fmtp:(\d+) (.*)$/);
    if (!m) return l;
    if (opus.includes(m[1]) && !/stereo=1/.test(l)) return `${l};stereo=1;sprop-stereo=1;maxaveragebitrate=128000`;
    // Sem isso o Chromium comeca a ~300kbps e demora para subir a qualidade
    if (video.includes(m[1]) && !/x-google-start-bitrate/.test(l)) {
      return `${l};x-google-start-bitrate=${Math.min(8000, videoMaxKbps)};x-google-min-bitrate=1000;x-google-max-bitrate=${videoMaxKbps}`;
    }
    return l;
  }).join('\r\n');
}

function preferCodec(transceiver, codecName) {
  if (!transceiver || !transceiver.setCodecPreferences || !RTCRtpReceiver.getCapabilities) return;
  const caps = RTCRtpReceiver.getCapabilities('video');
  if (!caps) return;
  const want = 'video/' + codecName.toLowerCase();
  const preferred = caps.codecs.filter((c) => c.mimeType.toLowerCase() === want);
  if (!preferred.length) return;
  const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== want);
  try { transceiver.setCodecPreferences([...preferred, ...rest]); } catch (e) { console.warn('codec pref', e); }
}

class Peer {
  constructor(session, userId) {
    this.session = session;
    this.userId = userId;
    this.polite = session.selfId > userId; // desempate determinístico
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.meta = {};           // streamId -> 'mic' | 'camera' | 'screen'
    this.remoteStreams = {};  // kind -> MediaStream
    this.senders = {};        // 'mic' | 'camera' | 'screen' | 'screenAudio' -> RTCRtpSender
    this.viewing = false;     // o outro lado clicou em "Assistir" na minha transmissao
    this.relayed = false;     // conexao passando pelo TURN (servidor) em vez de P2P direto
    this.pc = new RTCPeerConnection({ iceServers: session.iceServers || ICE_SERVERS, bundlePolicy: 'max-bundle' });
    this.relayTimer = setInterval(() => this.checkRelay().catch(() => {}), 3000);
    this.pending = new Map(); // streamId -> MediaStream aguardando meta

    this.pc.onicecandidate = ({ candidate }) => { if (candidate) this.signal({ candidate }); };
    this.pc.onnegotiationneeded = () => this.negotiate();
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed') this.pc.restartIce();
      this.session.emit('peer-state', { userId, state: this.pc.iceConnectionState });
    };
    // reaplica bitrate/fps depois de cada negociacao (antes disso o encoder pode ignorar)
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState !== 'stable') return;
      for (const sn of Object.values(this.senders)) {
        if (sn._opts) this.tuneVideoSender(sn, sn._opts);
        else if (sn.track && sn.track.kind === 'audio') this.tuneAudioSender(sn);
      }
    };
    this.pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      const kind = this.meta[stream.id];
      if (kind) this.attach(kind, stream);
      else this.pending.set(stream.id, stream);
      track.onunmute = () => this.session.emit('remote-streams', { userId });
    };
  }

  signal(data) { this.session.gateway.send('signal', { to: this.userId, data }); }

  async negotiate() {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
      if (this.pc.signalingState !== 'stable') return;
      await this.pc.setLocalDescription({ type: 'offer', sdp: mungeSdp(offer.sdp, this.session.sdpOpts()) });
      this.signal({ description: this.pc.localDescription, meta: this.session.localMeta() });
    } catch (e) {
      console.error('negotiate', e);
    } finally {
      this.makingOffer = false;
    }
  }

  async onSignal({ description, candidate, meta, watch }) {
    if (meta) this.applyMeta(meta);
    if (watch !== undefined) this.session.setViewer(this, !!watch);
    try {
      if (description) {
        const collision = description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription({ type: 'answer', sdp: mungeSdp(answer.sdp, this.session.sdpOpts()) });
          this.signal({ description: this.pc.localDescription, meta: this.session.localMeta() });
        }
      } else if (candidate) {
        try { await this.pc.addIceCandidate(candidate); } catch (e) { if (!this.ignoreOffer) throw e; }
      }
    } catch (e) {
      console.error('signal', e);
    }
  }

  applyMeta(meta) {
    this.meta = { ...meta };
    for (const [sid, stream] of this.pending) {
      if (this.meta[sid]) { this.attach(this.meta[sid], stream); this.pending.delete(sid); }
    }
    // remove streams que o outro lado parou de enviar
    const activeKinds = new Set(Object.values(this.meta));
    for (const kind of Object.keys(this.remoteStreams)) {
      if (!activeKinds.has(kind)) { delete this.remoteStreams[kind]; this.session.emit('remote-streams', { userId: this.userId }); }
    }
  }

  attach(kind, stream) {
    this.remoteStreams[kind] = stream;
    stream.onremovetrack = () => { if (!stream.getTracks().length) { delete this.remoteStreams[kind]; this.session.emit('remote-streams', { userId: this.userId }); } };
    if (kind === 'mic' || kind === 'screen') this.session.audio.attach(this.userId, kind, stream);
    this.session.emit('remote-streams', { userId: this.userId });
  }

  setTrack(slot, track, stream, opts = {}) {
    const existing = this.senders[slot];
    if (existing) {
      if (track) { existing.replaceTrack(track); if (track.kind === 'video') { existing._opts = opts; this.tuneVideoSender(existing, opts); } return existing; }
      try { this.pc.removeTrack(existing); } catch {}
      delete this.senders[slot];
      return null;
    }
    if (!track) return null;
    const sender = this.pc.addTrack(track, stream);
    this.senders[slot] = sender;
    if (track.kind === 'audio') this.tuneAudioSender(sender);
    if (track.kind === 'video') {
      const tr = this.pc.getTransceivers().find((t) => t.sender === sender);
      preferCodec(tr, opts.codec || 'H264');
      sender._opts = opts;
      this.tuneVideoSender(sender, opts);
    }
    return sender;
  }

  // descobre se o par de candidatos escolhido passa pelo TURN e reajusta o video
  async checkRelay() {
    const report = await this.pc.getStats();
    let pair = null;
    report.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = report.get(r.selectedCandidatePairId); });
    if (!pair) return;
    const relayed = [pair.localCandidateId, pair.remoteCandidateId].some((cid) => report.get(cid)?.candidateType === 'relay');
    if (relayed === this.relayed) return;
    this.relayed = relayed;
    for (const sn of Object.values(this.senders)) if (sn._opts) this.tuneVideoSender(sn, sn._opts);
    this.session.emit('relay', { userId: this.userId, relayed });
  }

  async tuneVideoSender(sender, { bitrate, fps, degradation }) {
    const cap = this.relayed ? RELAY_CAP : null;
    // parametros so podem ser setados depois que existem encodings (apos negociacao)
    for (let i = 0; i < 20; i++) {
      const p = sender.getParameters();
      if (p.encodings && p.encodings.length) {
        const height = (sender.track && sender.track.getSettings().height) || 0;
        p.encodings[0].maxBitrate = cap ? Math.min(bitrate, cap.bitrate) : bitrate;
        if (fps || cap) p.encodings[0].maxFramerate = cap ? Math.min(fps || cap.fps, cap.fps) : fps;
        p.encodings[0].scaleResolutionDownBy = cap && height > cap.height ? height / cap.height : 1;
        p.encodings[0].priority = 'high';
        p.encodings[0].networkPriority = 'high';
        if (degradation) p.degradationPreference = degradation;
        try { await sender.setParameters(p); } catch (e) { console.warn('setParameters', e); }
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // "Qualidade de servico com prioridade alta de pacotes" (marca DSCP) + Opus a 128 kbps
  async tuneAudioSender(sender) {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) return;
    const prio = this.session.settings.qos ? 'high' : 'low';
    p.encodings[0].maxBitrate = 128000;
    p.encodings[0].priority = prio;
    p.encodings[0].networkPriority = prio;
    try { await sender.setParameters(p); } catch (e) { console.warn('audio setParameters', e); }
  }

  close() {
    clearInterval(this.relayTimer);
    this.pc.close();
    this.session.audio.detachUser(this.userId);
  }
}

// Mixagem de audio remoto com volume por usuario (ate 200%) e detecção de fala.
class AudioMixer {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.nodes = new Map(); // `${userId}:${kind}` -> { src, gain, analyser, el }
    this.volumes = JSON.parse(localStorage.getItem('rea.volumes') || '{}');
    this.localMutes = new Set(JSON.parse(localStorage.getItem('rea.localMutes') || '[]'));
    this.deafened = false;
    this.outputVolume = 1;
  }
  key(u, k) { return `${u}:${k}`; }
  attach(userId, kind, stream) {
    this.detach(userId, kind);
    if (!stream.getAudioTracks().length) return;
    // Chromium so libera audio WebRTC remoto para o WebAudio se houver um elemento <audio> consumindo
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    src.connect(gain);
    gain.connect(this.master);
    gain.gain.value = this.effectiveVolume(userId, kind);
    this.nodes.set(this.key(userId, kind), { src, gain, analyser, el, buf: new Uint8Array(analyser.fftSize) });
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  detach(userId, kind) {
    const n = this.nodes.get(this.key(userId, kind));
    if (!n) return;
    n.src.disconnect(); n.gain.disconnect(); n.el.srcObject = null;
    this.nodes.delete(this.key(userId, kind));
  }
  detachUser(userId) { for (const k of ['mic', 'screen']) this.detach(userId, k); }
  volumeFor(userId, kind) { return this.volumes[this.key(userId, kind)] ?? 1; }
  effectiveVolume(userId, kind) { return this.localMutes.has(userId) ? 0 : this.volumeFor(userId, kind); }
  isLocalMuted(userId) { return this.localMutes.has(userId); }
  setLocalMute(userId, m) {
    m ? this.localMutes.add(userId) : this.localMutes.delete(userId);
    localStorage.setItem('rea.localMutes', JSON.stringify([...this.localMutes]));
    for (const k of ['mic', 'screen']) { const n = this.nodes.get(this.key(userId, k)); if (n) n.gain.gain.value = this.effectiveVolume(userId, k); }
  }
  setOutputVolume(v) { this.outputVolume = v; if (!this.deafened) this.master.gain.value = v; }
  setVolume(userId, kind, v) {
    this.volumes[this.key(userId, kind)] = v;
    localStorage.setItem('rea.volumes', JSON.stringify(this.volumes));
    const n = this.nodes.get(this.key(userId, kind));
    if (n) n.gain.gain.value = this.effectiveVolume(userId, kind);
  }
  setDeafened(d) { this.deafened = d; this.master.gain.value = d ? 0 : this.outputVolume; }
  async setOutputDevice(deviceId) { if (this.ctx.setSinkId) { try { await this.ctx.setSinkId(deviceId || ''); } catch (e) { console.warn(e); } } }
  level(userId, kind = 'mic') {
    const n = this.nodes.get(this.key(userId, kind));
    if (!n) return 0;
    n.analyser.getByteTimeDomainData(n.buf);
    let sum = 0;
    for (let i = 0; i < n.buf.length; i++) { const x = (n.buf[i] - 128) / 128; sum += x * x; }
    return Math.sqrt(sum / n.buf.length);
  }
}

class VoiceSession {
  constructor(gateway, selfId, settings, iceServers) {
    this.gateway = gateway;
    this.iceServers = iceServers;
    this.watching = new Set(); // userIds cuja transmissao eu assisto (so eles me mandam a tela)
    this.selfId = selfId;
    this.settings = settings;
    this.channelId = null;
    this.peers = new Map();
    this.listeners = {};
    this.audio = new AudioMixer();
    this.mic = null;          // MediaStream processado (saida do MicProcessor)
    this.proc = null;         // MicProcessor
    this.camera = null;
    this.screen = null;
    this.screenOpts = null;
    this.muted = false;
    this.deafened = false;
    this.speaking = new Set();
    this.speakTimer = null;
    // containers com id fixo: o outro lado identifica mic/camera/tela pelo id do stream
    this.out = { mic: new MediaStream(), camera: new MediaStream(), screen: new MediaStream() };
  }

  on(ev, cb) { (this.listeners[ev] ||= []).push(cb); }
  emit(ev, d) { for (const cb of this.listeners[ev] || []) cb(d); }

  sdpOpts() { return { videoMaxKbps: Math.round(((this.screenOpts && this.screenOpts.bitrate) || 12_000_000) / 1000) }; }

  localMeta() {
    const meta = {};
    if (this.mic) meta[this.out.mic.id] = 'mic';
    if (this.camera) meta[this.out.camera.id] = 'camera';
    if (this.screen) meta[this.out.screen.id] = 'screen';
    return meta;
  }
  broadcastMeta() { for (const p of this.peers.values()) p.signal({ meta: this.localMeta() }); }

  async join(channelId, peers) {
    this.channelId = channelId;
    this.audio.setOutputVolume(this.settings.outputVolume);
    this.proc = new window.REA_AUDIO.MicProcessor(this.audio.ctx, this.settings);
    this.proc.setMuted(this.muted);
    this.proc.on('speaking-while-muted', () => this.emit('speaking-while-muted'));
    this.proc.on('no-input', () => this.emit('no-input'));
    try {
      await this.proc.start();
      this.mic = this.proc.dest.stream;
    } catch (e) {
      console.warn('sem microfone', e);
      this.emit('mic-error', e);
      this.mic = null;
    }
    if (this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
    if (this.settings.outputDevice) this.audio.setOutputDevice(this.settings.outputDevice);
    for (const uid of peers) this.addPeer(uid);
    this.startSpeakingLoop();
  }

  addPeer(userId) {
    if (this.peers.has(userId) || userId === this.selfId) return this.peers.get(userId);
    const p = new Peer(this, userId);
    this.peers.set(userId, p);
    if (this.mic) p.setTrack('mic', this.mic.getAudioTracks()[0], this.out.mic);
    if (this.camera) p.setTrack('camera', this.camera.getVideoTracks()[0], this.out.camera, this.cameraOpts());
    if (this.watching.has(userId)) p.signal({ watch: true });
    return p;
  }

  // eu assisto (ou paro de assistir) a transmissao de userId: so assim ele me envia a tela
  setWatching(userId, on) {
    if (on === this.watching.has(userId)) return;
    on ? this.watching.add(userId) : this.watching.delete(userId);
    const p = this.peers.get(userId);
    if (p) p.signal({ watch: on });
  }

  // outro participante abriu/fechou minha transmissao: quem nao assiste nao gasta meu upload
  setViewer(p, on) {
    p.viewing = on;
    if (!this.screen) return;
    if (on) this.addScreenTracks(p);
    else { p.setTrack('screen', null); p.setTrack('screenAudio', null); }
  }

  removePeer(userId) {
    const p = this.peers.get(userId);
    if (!p) return;
    p.close();
    this.peers.delete(userId);
    this.speaking.delete(userId);
    this.emit('remote-streams', { userId });
  }

  onSignal(from, data) {
    const p = this.peers.get(from) || this.addPeer(from);
    if (p) p.onSignal(data);
  }

  startSpeakingLoop() {
    clearInterval(this.speakTimer);
    // o audio remoto ja chega "cortado" pelo gate de quem fala, entao um limiar fixo baixo basta
    this.speakTimer = setInterval(() => {
      const next = new Set();
      if (this.proc && this.proc.speaking) next.add(this.selfId);
      for (const uid of this.peers.keys()) if (this.audio.level(uid) > 0.008) next.add(uid);
      const changed = next.size !== this.speaking.size || [...next].some((u) => !this.speaking.has(u));
      this.speaking = next;
      if (changed) this.emit('speaking', next);
    }, 100);
  }

  setMuted(m) {
    this.muted = m;
    if (this.proc) this.proc.setMuted(m);
  }

  setDeafened(d) {
    this.deafened = d;
    this.audio.setDeafened(d);
  }

  // reaplica dispositivo/filtros; a track enviada continua a mesma (sem renegociar)
  async restartMic() {
    if (!this.proc) return;
    await this.proc.acquire();
    if (!this.mic) {
      this.mic = this.proc.dest.stream;
      for (const p of this.peers.values()) p.setTrack('mic', this.mic.getAudioTracks()[0], this.out.mic);
      this.broadcastMeta();
    }
  }

  setPTT(active) { if (this.proc) this.proc.setPTT(active); }

  retuneAudio() { for (const p of this.peers.values()) if (p.senders.mic) p.tuneAudioSender(p.senders.mic); }

  cameraOpts() { return { bitrate: 4_000_000, fps: 30, codec: this.settings.codec, degradation: 'balanced' }; }

  async startCamera() {
    this.camera = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: this.settings.videoDevice ? { exact: this.settings.videoDevice } : undefined,
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
      },
    });
    this.broadcastMeta();
    for (const p of this.peers.values()) p.setTrack('camera', this.camera.getVideoTracks()[0], this.out.camera, this.cameraOpts());
    this.camera.getVideoTracks()[0].onended = () => this.stopCamera();
    this.emit('local-streams');
  }

  stopCamera() {
    if (!this.camera) return;
    this.camera.getTracks().forEach((t) => t.stop());
    this.camera = null;
    for (const p of this.peers.values()) p.setTrack('camera', null);
    this.broadcastMeta();
    this.emit('local-streams');
  }

  // opts: { sourceId, resolution: '720'|'1080'|'1440'|'2160'|'source', fps: 15|30|60, audio: bool, codec, contentHint }
  async startScreen(opts) {
    const preset = STREAM_PRESETS[opts.resolution] || STREAM_PRESETS['1080'];
    const bitrate = opts.bitrate || preset.bitrate;
    await window.native.capture.select(opts.sourceId, !!opts.audio);
    const video = { frameRate: { ideal: opts.fps, max: opts.fps } };
    if (preset.width) { video.width = { ideal: preset.width, max: preset.width }; video.height = { ideal: preset.height, max: preset.height }; }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video,
      // restrictOwnAudio: tenta excluir o audio do proprio app (vozes da call) da captura, onde o Chromium suportar
      audio: opts.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000, restrictOwnAudio: true } : false,
    });
    const vt = stream.getVideoTracks()[0];
    // 'motion' = prioriza fluidez (jogos/filmes) | 'detail' = prioriza nitidez (texto/codigo)
    vt.contentHint = opts.contentHint || (opts.fps >= 60 ? 'motion' : 'detail');
    if (this.screen) this.stopScreen(true);
    this.screen = stream;
    // Padrao: trava a resolucao (Full HD nunca cai para 720p). So o modo "Fluidez" deixa reduzir resolucao para manter FPS.
    this.screenOpts = { ...opts, bitrate, degradation: opts.contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution' };
    vt.onended = () => this.stopScreen();
    this.broadcastMeta();
    for (const p of this.peers.values()) if (p.viewing) this.addScreenTracks(p);
    this.emit('local-streams');
    return stream;
  }

  addScreenTracks(p) {
    const vt = this.screen.getVideoTracks()[0];
    const at = this.screen.getAudioTracks()[0];
    p.setTrack('screen', vt, this.out.screen, { bitrate: this.screenOpts.bitrate, fps: this.screenOpts.fps, codec: this.screenOpts.codec || this.settings.codec, degradation: this.screenOpts.degradation });
    p.setTrack('screenAudio', at || null, this.out.screen);
  }

  stopScreen(replacing = false) {
    if (!this.screen) return;
    this.screen.getTracks().forEach((t) => t.stop());
    this.screen = null;
    if (!replacing) {
      for (const p of this.peers.values()) { p.setTrack('screen', null); p.setTrack('screenAudio', null); }
      this.screenOpts = null;
      this.broadcastMeta();
      this.emit('local-streams');
    }
  }

  async stats(userId, kind = 'screen') {
    const p = this.peers.get(userId);
    const stream = p && p.remoteStreams[kind];
    if (!stream) return null;
    const track = stream.getVideoTracks()[0];
    if (!track) return null;
    const report = await p.pc.getStats(track);
    let out = null;
    report.forEach((r) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        const now = r.timestamp;
        const prev = p._prevStats && p._prevStats[kind];
        const kbps = prev ? Math.round(((r.bytesReceived - prev.bytes) * 8) / (now - prev.t)) : 0;
        p._prevStats = { ...(p._prevStats || {}), [kind]: { bytes: r.bytesReceived, t: now } };
        const codec = r.codecId && report.get(r.codecId);
        out = { width: r.frameWidth, height: r.frameHeight, fps: Math.round(r.framesPerSecond || 0), kbps, codec: codec ? codec.mimeType.split('/')[1] : '?', lost: r.packetsLost, decoder: r.decoderImplementation };
      }
    });
    return out;
  }

  async leave() {
    clearInterval(this.speakTimer);
    for (const uid of [...this.peers.keys()]) this.removePeer(uid);
    for (const s of [this.mic, this.camera, this.screen]) if (s) s.getTracks().forEach((t) => t.stop());
    if (this.proc) this.proc.stop();
    this.proc = null;
    this.mic = this.camera = this.screen = null;
    this.screenOpts = null;
    this.watching.clear();
    this.channelId = null;
    this.speaking = new Set();
    this.audio.ctx.close().catch(() => {});
    this.emit('speaking', this.speaking);
    this.emit('local-streams');
  }
}

window.REA_RTC = { VoiceSession, STREAM_PRESETS };
