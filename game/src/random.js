// A small seeded random number generator (mulberry32): the same seed gives the same game,
// which is what makes the screenshot scenes repeatable.

const MULBERRY_INCREMENT = 0x6d2b79f5;
const FIRST_MIX_SHIFT = 15;
const SECOND_MIX_SHIFT = 7;
const SECOND_MIX_MULTIPLIER = 61;
const FINAL_MIX_SHIFT = 14;
const UINT32_DIVISOR = 4294967296;

export function createRandom(seed) {
  let state = seed | 0;
  return function random() {
    state = (state + MULBERRY_INCREMENT) | 0;
    let mixed = Math.imul(state ^ (state >>> FIRST_MIX_SHIFT), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> SECOND_MIX_SHIFT), SECOND_MIX_MULTIPLIER | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> FINAL_MIX_SHIFT)) >>> 0) / UINT32_DIVISOR;
  };
}
