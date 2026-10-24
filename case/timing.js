// Timing measured from 60fps CS2 Dreams & Nightmares openings.
// The reel starts at full speed and stops with no overshoot.
// cubic-bezier(0.25, 0.6, 0.54, 1) matches
// p = 1 - (1 - x)^1.68 * (1 - 0.73 * x).

export const SPIN_MS = 5900;
export const UNLOCK_MS = 1300;
export const REEL_LEN = 48;
export const WINNER_AT = 37;
export const START_AT = 0;
export const DIM_MS = 100;
export const REVEAL_FADE_MS = 300;

export function ease(x) {
  const t = Math.min(1, Math.max(0, x));
  return 1 - (1 - t) ** 1.68 * (1 - 0.73 * t);
}
