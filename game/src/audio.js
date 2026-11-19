// Procedural audio: a running engine oscillator, one-shot tones and noise bursts, and a
// three-station radio built from short chord notes. No audio assets are loaded.

const ENGINE_BASE_FREQUENCY = 48;
const ENGINE_FREQUENCY_PER_SPEED = 5;
const ENGINE_MAX_GAIN = 0.12;
const ENGINE_GAIN_PER_SPEED = 0.003;
const SIREN_BASE_FREQUENCY = 580;
const SIREN_SWEEP_AMOUNT = 220;
const SIREN_SWEEP_RATE = 8;
const SIREN_GAIN = 0.025;
const RADIO_NOTE_INTERVAL = 0.24;
const RADIO_STATIONS = ['COAST FM', 'NIGHT DRIVE', 'SUNSET SOUL'];
const TONE_FLOOR_GAIN = 0.001;

export function createAudio() {
  let context = null, master = null, engineOsc = null, engineGain = null, radioTimer = 0, station = 0;
  const volumes = { master: 0.65, music: 0.3, effects: 0.7 };

  function boot() {
    if (context) return;
    context = new (window.AudioContext || window.webkitAudioContext)();
    master = context.createGain();
    master.gain.value = volumes.master;
    master.connect(context.destination);
    engineOsc = context.createOscillator();
    engineOsc.type = 'sawtooth';
    engineGain = context.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineGain).connect(master);
    engineOsc.start();
  }

  function tone(freq, duration = 0.12, wave = 'sine', gain = 0.15) {
    if (!context) return;
    let oscillator = context.createOscillator(), gainNode = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = freq;
    gainNode.gain.setValueAtTime(gain * volumes.effects, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(TONE_FLOOR_GAIN, context.currentTime + duration);
    oscillator.connect(gainNode).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  function noise(duration = 0.16, amount = 0.16) {
    if (!context) return;
    const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let sample = 0; sample < data.length; sample++) data[sample] = (Math.random() * 2 - 1) * (1 - sample / data.length);
    const source = context.createBufferSource(), gainNode = context.createGain();
    source.buffer = buffer;
    gainNode.gain.value = amount * volumes.effects;
    source.connect(gainNode).connect(master);
    source.start();
  }

  const chords = [[196, 247, 294, 370], [220, 262, 330, 392], [174, 220, 261, 349]];

  return {
    boot,
    volumes,
    setVolume(name, value) {
      volumes[name] = value;
      if (name === 'master' && master) master.gain.value = value;
    },
    shot(type = 1) {
      tone(type === 3 ? 85 : type === 2 ? 145 : 220, 0.11, 'sawtooth', 0.24);
      noise(type === 3 ? 0.28 : 0.12, 0.2);
    },
    horn() {
      tone(220, 0.42, 'square', 0.12);
      tone(277, 0.42, 'square', 0.1);
    },
    siren(time) {
      if (context) {
        engineOsc.frequency.setTargetAtTime(SIREN_BASE_FREQUENCY + Math.sin(time * SIREN_SWEEP_RATE) * SIREN_SWEEP_AMOUNT, context.currentTime, 0.05);
        engineGain.gain.setTargetAtTime(SIREN_GAIN, context.currentTime, 0.08);
      }
    },
    engine(speed) {
      if (context) {
        engineOsc.frequency.setTargetAtTime(ENGINE_BASE_FREQUENCY + Math.abs(speed) * ENGINE_FREQUENCY_PER_SPEED, context.currentTime, 0.08);
        engineGain.gain.setTargetAtTime(Math.min(ENGINE_MAX_GAIN, Math.abs(speed) * ENGINE_GAIN_PER_SPEED), context.currentTime, 0.1);
      }
    },
    step() {
      noise(0.045, 0.04);
    },
    click() {
      tone(720, 0.05, 'sine', 0.08);
    },
    radio(delta) {
      radioTimer -= delta;
      if (radioTimer <= 0 && context) {
        radioTimer = RADIO_NOTE_INTERVAL;
        const notes = chords[station];
        tone(notes[Math.floor(Math.random() * notes.length)], 0.18, 'triangle', volumes.music * 0.25);
      }
    },
    station(index) {
      station = (index + 3) % 3;
      radioTimer = 0;
      return RADIO_STATIONS[station];
    },
    get station() {
      return station;
    },
  };
}
