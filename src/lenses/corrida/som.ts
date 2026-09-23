/**
 * Os avisos sonoros: votos entrando e uma virada.
 *
 * Desligados por padrão, e o navegador só libera áudio depois de um clique — por isso o botão. A
 * ideia é poder deixar a tela de lado e ouvir quando algo acontece, que é como se acompanha uma
 * apuração de verdade: de esguelha.
 */
/** Soft sounds for new votes and a lead change. Off by default; browsers only allow audio after a click. */
export class Chime {
  private ctx: AudioContext | null = null;
  enabled = false;
  toggle() { this.enabled = !this.enabled; if (this.enabled && !this.ctx) this.ctx = new AudioContext(); if (this.ctx?.state === 'suspended') void this.ctx.resume(); return this.enabled; }
  private tone(freq: number, at: number, dur: number, gain: number) {
    const ctx = this.ctx!; const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime + at); g.gain.linearRampToValueAtTime(gain, ctx.currentTime + at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + dur + 0.05);
  }
  votes() { if (this.enabled && this.ctx) { this.tone(880, 0, 0.18, 0.06); this.tone(1320, 0.07, 0.22, 0.04); } }
  overtake() { if (this.enabled && this.ctx) { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.09, 0.5, 0.07)); } }
}
