// Drawing only: the world's state and the current screen in, pixels out. The 1280x720 playfield
// is scaled to fit the window and centred, the margin filled with the backdrop colour. Flat
// rectangles and circles, canvas text for the HUD and the panels. Text that holds a number is
// rebuilt only when the number changes, so a frame allocates nothing.
import { FIELD, FONT, LIVES, PALETTE } from './config.js';
import { KIND_COIN } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

/** The panel's width; its height grows with its lines: room for the title, the lines and the prompt. */
const PANEL = { width: 600, top: 134, line: 34, bottom: 70 };
const LIFE_SIZE = 20;
const LIFE_GAP = 8;
const HUD_MARGIN_X = 24;
const HUD_TOP = 20;
const HUD_FONT_SIZE = 28;
const HUD_LIVES_LABEL_GAP = 12;
const LIFE_TOP = 24;
const PANEL_TITLE_OFFSET = 78;
const PANEL_TITLE_SIZE = 48;
const PANEL_LINE_SIZE = 22;
const PANEL_PROMPT_OFFSET = 40;
const PANEL_PROMPT_SIZE = 24;
/** Blink rate while invulnerable: hidden on every other tenth of a second. */
const BLINKS_PER_SECOND = 10;

function cachedLabel(prefix) {
  let value = -1;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const scoreLabel = cachedLabel('Score ');
  const levelLabel = cachedLabel('Level ');
  const finalLabel = cachedLabel('Score ');
  const bestLabel = cachedLabel('Best ');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, positionX, positionY, fontSize, color, align) {
    if (!fonts.has(fontSize)) fonts.set(fontSize, `${fontSize}px ${FONT}`);
    context.font = fonts.get(fontSize);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, positionX, positionY);
  }

  function drawField(state) {
    context.fillStyle = PALETTE.sky;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    context.fillStyle = PALETTE.ground;
    context.fillRect(0, FIELD.groundY, FIELD.width, FIELD.height - FIELD.groundY);

    const items = state.items;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.active) continue;
      if (item.kind === KIND_COIN) {
        context.fillStyle = PALETTE.coin;
        context.beginPath();
        context.arc(item.x + item.width / 2, item.y + item.height / 2, item.width / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillStyle = PALETTE.block;
        context.fillRect(item.x, item.y, item.width, item.height);
      }
    }

    const player = state.player;
    // Blink while invulnerable after a hit: hidden on every other tenth of a second.
    if (player.invulnerable === 0 || Math.floor(player.invulnerable * BLINKS_PER_SECOND) % 2 === 1) {
      context.fillStyle = PALETTE.player;
      context.fillRect(player.x, player.y, player.width, player.height);
    }
  }

  function drawHud(state) {
    context.textBaseline = 'top';
    text(scoreLabel(state.score), HUD_MARGIN_X, HUD_TOP, HUD_FONT_SIZE, PALETTE.text, 'left');
    text(levelLabel(state.level), FIELD.width / 2, HUD_TOP, HUD_FONT_SIZE, PALETTE.text, 'center');
    const firstLife = FIELD.width - HUD_MARGIN_X - LIVES * (LIFE_SIZE + LIFE_GAP) + LIFE_GAP;
    text('Lives', firstLife - HUD_LIVES_LABEL_GAP, HUD_TOP, HUD_FONT_SIZE, PALETTE.text, 'right');
    for (let life = 0; life < LIVES; life += 1) {
      context.fillStyle = life < state.lives ? PALETTE.player : PALETTE.ground;
      context.fillRect(firstLife + life * (LIFE_SIZE + LIFE_GAP), LIFE_TOP, LIFE_SIZE, LIFE_SIZE);
    }
  }

  function drawPanel(title, lines, prompt) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const panelX = (FIELD.width - PANEL.width) / 2;
    const panelY = (FIELD.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    context.fillRect(panelX, panelY, PANEL.width, height);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, panelY + PANEL_TITLE_OFFSET, PANEL_TITLE_SIZE, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, panelY + PANEL.top + index * PANEL.line, PANEL_LINE_SIZE, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, panelY + height - PANEL_PROMPT_OFFSET, PANEL_PROMPT_SIZE, PALETTE.coin, 'center');
  }

  const TITLE_LINES = ['Dodge the red blocks. Catch the gold coins.', 'Move with ← → or A D.  Pause with P.', ''];
  const PAUSED_LINES = ['The blocks will wait for you.'];
  const OVER_LINES = ['', ''];

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawField(state);
    if (screen === SCREEN_TITLE) {
      TITLE_LINES[2] = bestLabel(best);
      drawPanel('Block Dodger', TITLE_LINES, 'Press Space or click to start');
      return;
    }
    drawHud(state);
    if (screen === SCREEN_PAUSED) drawPanel('Paused', PAUSED_LINES, 'Press P to resume');
    else if (screen === SCREEN_OVER) {
      OVER_LINES[0] = finalLabel(state.score);
      OVER_LINES[1] = bestLabel(best);
      drawPanel('Game over', OVER_LINES, 'Press Space or click to play again');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
