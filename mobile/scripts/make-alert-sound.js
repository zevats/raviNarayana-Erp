// Generates the delivery alert tone (android/app/src/main/res/raw/delivery_alert.wav):
// a bright rising three-note chime (E6, G#6, B6) played twice — short, clear, not harsh.
const fs = require("fs");
const path = require("path");
const RATE = 44100;
const notes = [1318.51, 1661.22, 1975.53];
const NOTE = 0.16, GAP = 0.02, PAUSE = 0.22, TAIL = 0.45;
const one = notes.length * (NOTE + GAP) + TAIL;
const total = one * 2 + PAUSE;
const samples = new Float32Array(Math.ceil(total * RATE));
function strike(t0, f) {
  const start = Math.floor(t0 * RATE);
  const len = Math.floor((NOTE + TAIL) * RATE);
  for (let i = 0; i < len && start + i < samples.length; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.006);
    const env = attack * Math.exp(-t * 7.5);
    // fundamental + soft octave + a little fifth for a bell-like body
    const v = Math.sin(2 * Math.PI * f * t) * 0.62 + Math.sin(2 * Math.PI * f * 2 * t) * 0.18 * Math.exp(-t * 12) + Math.sin(2 * Math.PI * f * 1.5 * t) * 0.08;
    samples[start + i] += v * env;
  }
}
for (let r = 0; r < 2; r++) {
  const base = r * (one + PAUSE);
  notes.forEach((f, k) => strike(base + k * (NOTE + GAP), f));
}
let peak = 0;
for (const s of samples) peak = Math.max(peak, Math.abs(s));
const gain = 0.82 / peak;
const data = Buffer.alloc(samples.length * 2);
samples.forEach((s, i) => data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * gain * 32767))), i * 2));
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(data.length, 40);
const out = path.join(__dirname, "..", "android", "app", "src", "main", "res", "raw", "delivery_alert.wav");
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log(`delivery_alert.wav ${(total).toFixed(2)} s, ${Math.round((44 + data.length) / 1024)} KB`);
