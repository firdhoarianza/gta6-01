// The screenshot scenes behind ?shot=start|play|end. Each one plays the real rules forward from a
// fresh world for a fixed number of steps, steered by a simple autopilot (look ahead each way the
// paddle could move, keep clear of blocks, chase the lowest coin when that is safe), so the frame
// is what a short game really looks like and the same seed always gives the same frame.
import { FIELD, PLAYER, STEP } from './config.js';
import { EVENT_OVER, KIND_BLOCK } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 26;
const END_LIMIT_SECONDS = 600;
/**
 * How far ahead, in seconds, the autopilot checks each way it could move: the play scene's pilot
 * looks well ahead and keeps all its lives; the end scene's looks only a moment ahead, so it is
 * caught out once the blocks speed up, as a hurried player is.
 */
const HORIZON_PLAY = 0.7;
const HORIZON_END = 0.25;
const SAMPLE = 1 / 30;
const DIRECTIONS = [0, -1, 1];
/** Extra room, each side, it keeps between the paddle and a block. */
const MARGIN = 10;
/** How far off-centre the target must be before the autopilot bothers moving. */
const TARGET_DEAD_ZONE = 8;

/** Seconds until moving in `direction` (-1, 0, 1) runs the paddle into a block; Infinity when it never does. */
function timeToHit(state, direction, horizon) {
  const player = state.player;
  for (let sampleTime = SAMPLE; sampleTime <= horizon; sampleTime += SAMPLE) {
    const projectedX = Math.min(FIELD.width - player.width, Math.max(0, player.x + direction * PLAYER.speed * sampleTime));
    for (let index = 0; index < state.items.length; index += 1) {
      const item = state.items[index];
      if (!item.active || item.kind !== KIND_BLOCK) continue;
      const projectedY = item.y + item.speed * sampleTime;
      if (projectedY + item.height > player.y && projectedY < player.y + player.height && item.x < projectedX + player.width + MARGIN && item.x + item.width > projectedX - MARGIN) return sampleTime;
    }
  }
  return Infinity;
}

/** Of the safe ways to move, the one toward the lowest coin (or the centre); else the one that is hit last. */
function autopilot(state, horizon) {
  const player = state.player;
  let coin = null;
  for (let index = 0; index < state.items.length; index += 1) {
    const item = state.items[index];
    if (item.active && item.kind !== KIND_BLOCK && (coin === null || item.y > coin.y)) coin = item;
  }
  const target = coin === null ? FIELD.width / 2 : coin.x + coin.width / 2;
  const centre = player.x + player.width / 2;
  const desiredDirection = target > centre + TARGET_DEAD_ZONE ? 1 : target < centre - TARGET_DEAD_ZONE ? -1 : 0;
  let bestDirection = desiredDirection;
  let bestTime = timeToHit(state, desiredDirection, horizon);
  for (let index = 0; index < DIRECTIONS.length && bestTime !== Infinity; index += 1) {
    const time = timeToHit(state, DIRECTIONS[index], horizon);
    if (time > bestTime) {
      bestTime = time;
      bestDirection = DIRECTIONS[index];
    }
  }
  return bestDirection;
}

/**
 * Set `world` to the named scene (start, play or end; any other name is start) and return the
 * screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) world.step(STEP, 0, true);
    return { screen: SCREEN_TITLE, best: 0 };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  const horizon = name === 'end' ? HORIZON_END : HORIZON_PLAY;
  for (let index = 0; index < limit / STEP; index += 1) {
    if (world.step(STEP, autopilot(world.state, horizon), false) & EVENT_OVER) break;
  }
  const over = world.state.lives === 0;
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
}
