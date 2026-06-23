// A short, pleasant two-note chime synthesised with the Web Audio API —
// no audio asset to ship, works offline. Played by the notification bell
// whenever the unread count rises (new order, approval, etc.).
//
// Browser autoplay policy: an AudioContext starts "suspended" until the
// user has interacted with the page. We resume lazily; the first chime
// after page load may be silent if no click has happened yet, which is
// fine — by the time work is flowing the user has clicked something.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

export function playChime() {
  const ac = getCtx();
  if (!ac) return;
  // Resume if the autoplay policy left it suspended (no-op if running).
  if (ac.state === "suspended") void ac.resume();

  const now = ac.currentTime;
  // C6 → G6: a gentle rising "ding-dong".
  const notes = [1046.5, 1568.0];
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = now + i * 0.15;
    const dur = 0.3;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  });
}
