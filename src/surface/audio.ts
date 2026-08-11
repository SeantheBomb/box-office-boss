// BossOS audio engine: SFX (WebAudio, cached buffers), looping ambience + music beds
// crossfaded per scene, and Animal-Crossing-style mumbles pitch-varied per person.
// All assets baked by tools/bake-audio.mjs into public/audio (manifest.json).

import type { Person } from "../kernel/types";

type Manifest = {
  sfx: Record<string, string>;
  ambience: Record<string, string>;
  music: Record<string, string>;
  mumbles: Record<string, Record<string, string[]>>;
};

const VOL_KEY = "bob.audio";

class Loop {
  el: HTMLAudioElement;
  target = 0;
  constructor(public kind: "music" | "ambience") {
    this.el = new Audio();
    this.el.loop = true;
    this.el.volume = 0;
  }
  fadeTo(src: string | undefined, target: number) {
    this.target = src ? target : 0;
    if (src && !this.el.src.endsWith(src)) {
      this.el.src = src;
      this.el.currentTime = 0;
      this.el.play().catch(() => {});
    } else if (src && this.el.paused) {
      this.el.play().catch(() => {});
    }
  }
  tick(master: number, kindVol: number) {
    const goal = this.target * master * kindVol;
    const v = this.el.volume;
    const next = v + (goal - v) * 0.12;
    this.el.volume = Math.max(0, Math.min(1, next));
    if (this.el.volume < 0.005 && goal === 0 && !this.el.paused) this.el.pause();
  }
}

class AudioEngine {
  private ctx?: AudioContext;
  private manifest?: Manifest;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private music = new Loop("music");
  private ambience = new Loop("ambience");
  private scene = "";
  private unlocked = false;
  private lastMumble = 0;
  vol = { master: 0.8, sfx: 0.9, music: 0.35, ambience: 0.5, voice: 0.8, muted: false };

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(VOL_KEY) ?? "null");
      if (saved) this.vol = { ...this.vol, ...saved };
    } catch {}
    fetch("/audio/manifest.json")
      .then((r) => (r.ok ? r.json() : undefined))
      .then((m) => {
        this.manifest = m;
        if (this.scene) this.applyScene();
      })
      .catch(() => {});
    setInterval(() => {
      const m = this.vol.muted ? 0 : this.vol.master;
      this.music.tick(m, this.vol.music);
      this.ambience.tick(m, this.vol.ambience);
    }, 100);
  }

  saveVol() {
    localStorage.setItem(VOL_KEY, JSON.stringify(this.vol));
  }

  /** Browsers gate audio behind a user gesture — call from any first interaction. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ctx = new AudioContext();
    this.applyScene();
  }

  private async buffer(url: string): Promise<AudioBuffer | undefined> {
    if (!this.ctx) return undefined;
    if (!this.buffers.has(url)) {
      this.buffers.set(
        url,
        fetch(url)
          .then((r) => r.arrayBuffer())
          .then((ab) => this.ctx!.decodeAudioData(ab))
      );
    }
    try {
      return await this.buffers.get(url)!;
    } catch {
      return undefined;
    }
  }

  async sfx(name: string, volume = 1, rate = 1) {
    if (!this.unlocked || !this.manifest || this.vol.muted) return;
    const url = this.manifest.sfx[name];
    if (!url || !this.ctx) return;
    const buf = await this.buffer(url);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = this.vol.master * this.vol.sfx * volume;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }

  /** Scene keys: office / meetingRoom / stage / conStage / dinner */
  setScene(scene: string) {
    if (scene === this.scene) return;
    this.scene = scene;
    this.applyScene();
  }

  private applyScene() {
    if (!this.manifest || !this.unlocked) return;
    const key = this.scene || "office";
    this.music.fadeTo(this.manifest.music[key] ?? this.manifest.music.office, 1);
    this.ambience.fadeTo(this.manifest.ambience[key] ?? this.manifest.ambience.office, 1);
  }

  /** A couple of gibberish syllables in the speaker's voice — pitch is theirs alone. */
  async mumble(person: Person, sentiment: "happy" | "neutral" | "grumpy") {
    if (!this.unlocked || !this.manifest || this.vol.muted) return;
    const now = performance.now();
    if (now - this.lastMumble < 350) return; // don't stack voices
    this.lastMumble = now;
    const seed = person.portraitSeed;
    const classes = person.gender === "F" ? ["f1", "f2", "f3"] : person.gender === "M" ? ["m1", "m2", "m3"] : ["f2", "m1", "f3", "m3"];
    const vk = classes[seed % classes.length];
    const bank = this.manifest.mumbles[vk]?.[sentiment];
    if (!bank?.length || !this.ctx) return;
    const url = bank[Math.floor(Math.random() * bank.length)]; // cosmetic only — not sim randomness
    const buf = await this.buffer(url);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // each person's voice sits at their own pitch, forever
    src.playbackRate.value = 0.85 + ((seed % 97) / 97) * 0.5;
    const gain = this.ctx.createGain();
    gain.gain.value = this.vol.master * this.vol.voice * 0.9;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }
}

export const audio = new AudioEngine();

export function guessSentiment(text: string): "happy" | "neutral" | "grumpy" {
  if (/walk|refus|hmph|mmph|cold|displeas|regret|missed|blink|shut|checking their watch|gone before/i.test(text)) return "grumpy";
  if (/accept|delight|smile|erupt|applause|wonderful|handled|stands|screams|congrat|adore|finally|money/i.test(text)) return "happy";
  return "neutral";
}
