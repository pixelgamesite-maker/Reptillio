/**
 * Duo voice chat — browser-to-browser WebRTC (audio only), signaled through
 * the Rush room's WebSocket. Uses the "perfect negotiation" pattern so either
 * player can join voice first, leave, or rejoin. When a direct connection
 * isn't possible (strict mobile networks), Cloudflare's TURN relay carries it.
 */
type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; bye?: boolean };

export class Voice {
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement;
  private makingOffer = false;
  private ignoreOffer = false;
  private meter: { ctx: AudioContext; local?: AnalyserNode; remote?: AnalyserNode } | null = null;
  micOn = false;
  muted = false;
  needsTap = false;

  constructor(
    public polite: boolean,
    private iceServers: () => Promise<RTCIceServer[]>,
    private sendSignal: (d: Signal) => void,
    private onChange: () => void
  ) {
    this.audio = new Audio();
    this.audio.autoplay = true;
  }

  /** Ask for the mic and start talking. */
  async join() {
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.micOn = true;
    this.muted = false;
    const pc = await this.ensurePc();
    for (const t of this.mic.getTracks()) pc.addTrack(t, this.mic);
    this.attachMeter("local", this.mic);
    this.onChange();
  }

  leave() {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.micOn = false;
    this.sendSignal({ bye: true });
    this.reset();
    this.onChange();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !m));
    this.onChange();
  }

  /** Partner left or reconnected — drop the call; it renegotiates when they're back. */
  reset() {
    try { this.pc?.close(); } catch { /* no-op */ }
    this.pc = null;
    this.makingOffer = false;
    this.ignoreOffer = false;
    if (this.mic) {
      // keep our mic; rebuild a fresh connection so we're ready to talk again
      void this.ensurePc().then((pc) => this.mic!.getTracks().forEach((t) => pc.addTrack(t, this.mic!)));
    }
  }

  async resumeAudio() {
    try {
      await this.audio.play();
      await this.meter?.ctx.resume();
      this.needsTap = false;
    } catch {
      this.needsTap = true;
    }
    this.onChange();
  }

  level(which: "local" | "remote") {
    const a = this.meter?.[which];
    if (!a) return 0;
    const buf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    return Math.sqrt(sum / buf.length);
  }

  async onSignal(d: Signal) {
    if (d.bye) {
      this.reset();
      return;
    }
    const pc = await this.ensurePc();
    try {
      if (d.description) {
        const collision = d.description.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(d.description);
        if (d.description.type === "offer") {
          await pc.setLocalDescription();
          this.sendSignal({ description: pc.localDescription! });
        }
      } else if (d.candidate) {
        try {
          await pc.addIceCandidate(d.candidate);
        } catch (e) {
          if (!this.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn("voice signal error", e);
    }
  }

  close() {
    this.mic?.getTracks().forEach((t) => t.stop());
    try { this.pc?.close(); } catch { /* no-op */ }
    void this.meter?.ctx.close();
    this.audio.srcObject = null;
  }

  private async ensurePc() {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: await this.iceServers() });
    this.pc = pc;
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal({ description: pc.localDescription! });
      } catch (e) {
        console.warn("voice offer failed", e);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => candidate && this.sendSignal({ candidate: candidate.toJSON() });
    pc.ontrack = ({ streams }) => {
      if (!streams[0]) return;
      this.audio.srcObject = streams[0];
      this.attachMeter("remote", streams[0]);
      void this.resumeAudio();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") pc.restartIce();
      this.onChange();
    };
    return pc;
  }

  private attachMeter(which: "local" | "remote", stream: MediaStream) {
    try {
      if (!this.meter) this.meter = { ctx: new AudioContext() };
      const src = this.meter.ctx.createMediaStreamSource(stream);
      const an = this.meter.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      this.meter[which] = an;
    } catch {
      /* meters are cosmetic */
    }
  }
}
