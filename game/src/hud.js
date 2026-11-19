// Solara Bay — the heads-up display.
//
// Everything is built at runtime (index.html is never touched): a cartographic minimap generated
// from the same 34-unit road grid as city.js, segmented vitals, a wanted strip, a mission card,
// a toast queue, a radio readout and two overlays (pause/help + the full city atlas).
import { CITY } from './config.js';

const TAU = Math.PI * 2;
const MAP_UNITS = 470;
const MAP_PX = 940;          // world raster: 2 px per world unit
const MAP_SCALE = MAP_PX / MAP_UNITS;
const MINI_VIEW = 200;       // world units across the round minimap
const MINI_PX = 220;         // minimap canvas size in pixels
const MINI_CENTER = MINI_PX / 2;
const MINI_CLIP_RADIUS = 109;
const MINI_BLIP_RADIUS = 102;
const MINI_MARKER_CLAMP = 96;
const MINI_WANTED_RADIUS = 105;
const ATLAS_PX = 594;        // full atlas canvas size in pixels
const DISTRICT_EDGE = 105;   // district boundaries along x/z
const DOWNTOWN_HALF = 65;
const DOWNTOWN_CORE = 60;
const BLOCK_HALF = 17;       // half of CITY.block: cell centre offset
const ROAD_LIMIT = 6;        // road lines run from -6..6
const RASTER_EDGE = 238;     // district cells past this are sea
const SEA_Z = -230;
const BEACH_Z = -222;
const SEGMENT_COUNT = 14;
const LOW_HEALTH = 30;
const KMH_PER_UNIT = 3.6;
const MAX_STARS = 5;
const STORY_TOTAL = 6;
const SIDE_MISSION_START = 6;
const TOAST_DEDUPE_MS = 1200;
const TOAST_LIFETIME_MS = 6300;
const MAX_TOASTS = 3;
const SLOW_LANE_MS = 100;    // 10 Hz for the map, clock, distance
const MINIMAP_MS = 95;
const BIGMAP_MS = 260;
const MAX_HUD_DELTA = 0.06;
const DEFAULT_HUD_DELTA = 0.016;
const MINUTES_PER_DAY = 1440;
const FALLBACK_CLOCK_MINUTES = 21 * 60 + 4;
const FALLBACK_CLOCK_TICK_MS = 4000;
const KM_THRESHOLD = 999;
const METERS_PER_KM = 1000;
const LOW_TIME_SECONDS = 10;
const BLIP_FLASH_MS = 220;
const ATLAS_FLASH_MS = 260;
const ATLAS_LABEL_FLIP_MARGIN = 100;
const PATCH_MAX_TRIES = 40;
const PATCH_RETRY_MS = 250;

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
const fmt = (value) => Math.round(value).toLocaleString('en-US');

const DISTRICTS = [
  { name: 'DOWNTOWN', color: '#3d5752' },
  { name: 'THE DOCKS', color: '#4b4434' },
  { name: 'SUBURBS', color: '#434a3b' },
  { name: 'INDUSTRIAL', color: '#43464a' },
  { name: 'BEACH PARK', color: '#4d4533' },
  { name: 'LITTLE HAVANA', color: '#46382e' }
];
const ROAD_COLOR = '#9b9583';
const BUILDING_COLORS = ['#2a322e', '#2e3732', '#28302c'];

const WEAPONS = ['PISTOL', 'SMG', 'SHOTGUN'];
const STATIONS = ['COAST FM', 'NIGHT DRIVE', 'SUNSET SOUL'];

export function districtAt(position) {
  const positionX = position.x, positionZ = position.z;
  if (positionX < -DISTRICT_EDGE) return 'THE DOCKS';
  if (positionZ > DISTRICT_EDGE) return 'SUBURBS';
  if (positionX > DISTRICT_EDGE) return 'INDUSTRIAL';
  if (positionZ < -DISTRICT_EDGE) return 'BEACH PARK';
  if (Math.abs(positionX) < DOWNTOWN_HALF && Math.abs(positionZ) < DOWNTOWN_HALF) return 'DOWNTOWN';
  return 'LITTLE HAVANA';
}

function districtIndex(positionX, positionZ) {
  if (positionX < -DISTRICT_EDGE) return 1;
  if (positionZ > DISTRICT_EDGE) return 2;
  if (positionX > DISTRICT_EDGE) return 3;
  if (positionZ < -DISTRICT_EDGE) return 4;
  if (Math.abs(positionX) < DOWNTOWN_CORE) return 0;
  return 5;
}

const CSS = `
#hud,#radar{background:none;border:0;padding:0;min-width:0;box-shadow:none;text-shadow:none}
#toast{display:none!important}
#ui{font-family:"Inter","Segoe UI",system-ui,-apple-system,sans-serif;color:#fff4e2;text-shadow:0 2px 10px rgba(4,12,15,.75);--amber:#f5bb62;--teal:#7ce7d3;--red:#ff6a54;--cream:#fff2da;--panel:rgba(8,18,22,.88);--line:rgba(255,226,178,.16)}
#ui::before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(4,11,14,.32) 0%,rgba(4,11,14,0) 18%,rgba(4,11,14,0) 64%,rgba(4,11,14,.42) 100%)}
.sb-num{font-variant-numeric:tabular-nums}
.sb-panel{background:var(--panel);border:1px solid var(--line);box-shadow:0 12px 34px rgba(0,0,0,.38);position:relative;text-shadow:none}
.sb-panel::before{content:"";position:absolute;left:0;top:0;width:26px;height:2px;background:var(--amber);opacity:.9}

/* ---------- left: vitals ---------- */
#hud{position:fixed;left:26px;bottom:24px;width:296px;z-index:4}
.sb-vitals{padding:13px 14px 11px;border-radius:3px}
.sb-lab{font-size:9px;letter-spacing:2.4px;color:rgba(255,238,208,.64);font-weight:700}
.sb-vrow{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px}
.sb-vrow b{font-size:15px;font-weight:800;letter-spacing:.4px;color:var(--cream);font-variant-numeric:tabular-nums}
.sb-seg{display:flex;gap:2px;height:7px;margin-bottom:9px}
.sb-seg i{flex:1;background:rgba(255,244,220,.10);border-radius:1px;transition:background .14s}
.sb-seg i.on{background:#ff8064;box-shadow:0 0 6px rgba(255,110,80,.35)}
.sb-seg i.on.low{background:#ff4a3d}
.sb-seg.arm i.on{background:#7ce3ef;box-shadow:0 0 6px rgba(124,227,239,.3)}
.sb-stam{display:flex;align-items:center;gap:8px;margin:2px 0 10px}
.sb-stam .sb-lab{flex:none;font-size:7.5px;letter-spacing:2px}
.sb-thin{flex:1;height:4px;background:rgba(255,244,220,.16);overflow:hidden;border-radius:2px}
.sb-thin i{display:block;height:100%;background:rgba(124,231,211,.75);transition:width .15s}
.sb-wrow{display:flex;align-items:center;gap:10px;border-top:1px solid rgba(255,226,178,.13);padding-top:9px}
.sb-wicon{width:40px;height:26px;border:1px solid rgba(255,226,178,.22);background:rgba(255,244,220,.05);display:grid;place-items:center;flex:none}
.sb-wicon svg{width:28px;height:18px;display:block}
.sb-wname{flex:1;min-width:0;line-height:1.1}
.sb-wname small{display:block;font-size:8px;letter-spacing:2px;color:rgba(255,238,208,.58);margin-bottom:3px}
.sb-wname b{font-size:12px;letter-spacing:1.6px;font-weight:800;color:var(--cream)}
.sb-ammo{text-align:right;line-height:1;font-variant-numeric:tabular-nums}
.sb-ammo b{font-size:23px;font-weight:800;color:var(--cream);letter-spacing:-.5px}
.sb-ammo em{font-style:normal;font-size:10px;color:rgba(255,238,208,.68);margin-left:3px}
.sb-car{margin-top:8px;font-size:9px;letter-spacing:2px;color:rgba(124,231,211,.85);font-weight:700;display:flex;justify-content:space-between}
.sb-car span{color:rgba(255,238,208,.64)}

/* ---------- brand / place line ---------- */
#sbplace{position:fixed;left:29px;top:52px;display:flex;align-items:center;gap:10px;font-size:9.5px;letter-spacing:3px;color:rgba(255,238,208,.82);font-weight:700;z-index:4}
#sbplace b{color:var(--amber)}
#sbplace i{width:3px;height:3px;background:rgba(255,226,178,.45);display:block;border-radius:50%}
#sbplace span{color:rgba(255,244,226,.9);font-variant-numeric:tabular-nums}

/* ---------- wanted ---------- */
#sbstars{position:fixed;top:18px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:12px;padding:7px 15px 7px 13px;background:rgba(8,18,22,.82);border:1px solid rgba(255,120,96,.28);border-radius:2px;box-shadow:0 8px 26px rgba(0,0,0,.35);z-index:5}
#sbstars.on{display:flex}
.sb-wlab{font-size:8px;letter-spacing:3px;color:rgba(255,160,140,.8);font-weight:800}
.sb-star-row{display:flex;gap:3px}
.sb-star{font-size:21px;line-height:1;color:rgba(255,244,220,.14);transition:color .18s,text-shadow .18s}
.sb-star.lit{color:#ffcf72;text-shadow:0 0 9px rgba(255,184,74,.85)}
#sbstars.hot .sb-star.lit{animation:sb-hot 1s ease-in-out infinite}
@keyframes sb-hot{0%,100%{opacity:1}50%{opacity:.55}}
.sb-wsub{font-size:8px;letter-spacing:2.4px;color:rgba(255,190,170,.75);font-weight:700;min-width:64px}
.sb-arrest{position:absolute;left:12px;right:12px;bottom:3px;height:2px;background:rgba(255,120,96,.14);opacity:0;transition:opacity .15s}
.sb-arrest.on{opacity:1}
.sb-arrest i{display:block;height:100%;width:0;background:#ff5a45}

/* ---------- top right: money + radio ---------- */
#sbtop{position:fixed;right:27px;top:20px;text-align:right;z-index:4}
.sb-money small{display:block;font-size:8px;letter-spacing:3px;color:rgba(255,238,208,.5);font-weight:700;margin-bottom:3px}
.sb-money b{font-size:29px;font-weight:800;letter-spacing:.2px;color:var(--cream);font-variant-numeric:tabular-nums;line-height:1}
.sb-money em{font-style:normal;font-size:11px;font-weight:800;letter-spacing:2px;color:var(--amber);margin-left:5px}
.sb-radio{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:11px;padding-top:9px;border-top:1px solid rgba(255,226,178,.15)}
.sb-radio small{display:block;font-size:8px;letter-spacing:2.2px;color:rgba(255,238,208,.58);font-weight:700;text-align:right;margin-bottom:2px}
.sb-radio b{font-size:11px;letter-spacing:1.6px;font-weight:800;color:rgba(255,244,226,.92)}
.sb-eq{display:flex;align-items:flex-end;gap:2px;height:14px}
.sb-eq i{width:2px;background:var(--teal);opacity:.75;animation:sb-eq 1.1s ease-in-out infinite}
.sb-eq i:nth-child(1){height:5px;animation-delay:-.2s}
.sb-eq i:nth-child(2){height:11px;animation-delay:-.6s}
.sb-eq i:nth-child(3){height:7px;animation-delay:-.35s}
.sb-eq i:nth-child(4){height:13px;animation-delay:-.8s}
@keyframes sb-eq{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}

/* ---------- mission card ---------- */
#sbmission{position:fixed;right:26px;bottom:252px;width:286px;padding:11px 13px 10px;border-radius:3px;z-index:4}
.sb-mtag{display:flex;justify-content:space-between;align-items:center;font-size:8.5px;letter-spacing:2px;color:rgba(124,231,211,.85);font-weight:800;margin-bottom:6px}
.sb-mtag span:last-child{color:var(--amber);font-variant-numeric:tabular-nums;letter-spacing:1.4px}
.sb-mtitle{font-size:15px;font-weight:800;letter-spacing:.6px;line-height:1.1;color:var(--cream);margin-bottom:7px}
.sb-mobj{display:flex;gap:8px;align-items:flex-start;font-size:10.5px;line-height:1.45;letter-spacing:.7px;color:rgba(226,240,232,.9);font-weight:600;min-height:30px}
.sb-mobj i{flex:none;width:5px;height:5px;margin-top:5px;background:var(--amber);transform:rotate(45deg);box-shadow:0 0 7px rgba(245,187,98,.7)}
.sb-mfoot{display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,226,178,.13)}
.sb-pips{display:flex;gap:4px}
.sb-pips i{width:16px;height:3px;background:rgba(255,244,220,.14);display:block}
.sb-pips i.done{background:rgba(124,231,211,.8)}
.sb-pips i.cur{background:var(--amber);box-shadow:0 0 7px rgba(245,187,98,.6)}
.sb-mmeta{font-size:9px;letter-spacing:1.4px;color:rgba(255,238,208,.7);font-weight:700;font-variant-numeric:tabular-nums}
.sb-mtbar{height:3px;background:rgba(255,244,220,.14);margin-top:7px;display:none}
.sb-mtbar.on{display:block}
.sb-mtbar i{display:block;height:100%;width:100%;background:var(--amber);transition:width .2s linear}
.sb-mtbar.low i{background:#ff5a45}

/* ---------- radar ---------- */
#radar{position:fixed;right:26px;bottom:24px;width:214px;z-index:4}
.sb-mm{position:relative;width:190px;height:190px;margin-left:auto;border-radius:50%;background:#0b1d21;border:1px solid rgba(255,226,178,.42);box-shadow:0 0 0 5px rgba(8,18,22,.72),0 0 0 6px rgba(255,226,178,.14),0 16px 38px rgba(0,0,0,.45)}
#mmc{position:absolute;inset:0;width:190px;height:190px;border-radius:50%}
.sb-mm-shade{position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 26px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,244,220,.08);pointer-events:none}
.sb-mm-n{position:absolute;top:3px;left:50%;transform:translateX(-50%);font-size:8px;font-weight:800;letter-spacing:1px;color:rgba(255,238,208,.85);background:rgba(8,18,22,.9);padding:1px 4px;border-radius:1px}
.sb-mm-live{position:absolute;left:14px;bottom:12px;font-size:7.5px;letter-spacing:2px;color:rgba(124,231,211,.9);font-weight:800;display:flex;align-items:center;gap:4px}
.sb-mm-live i{width:4px;height:4px;border-radius:50%;background:#7ce7d3;box-shadow:0 0 6px #7ce7d3}
.sb-mm-foot{width:190px;margin-left:auto;margin-top:8px;display:flex;justify-content:space-between;align-items:baseline;padding:0 2px}
.sb-mm-foot b{font-size:9.5px;letter-spacing:2px;color:rgba(255,244,226,.92);font-weight:800}
.sb-mm-foot span{font-size:9px;letter-spacing:1.4px;color:rgba(255,238,208,.66);font-weight:700;font-variant-numeric:tabular-nums}

/* ---------- toasts ---------- */
#sbtoasts{position:fixed;left:50%;bottom:54px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px;width:520px;z-index:6;pointer-events:none}
.sb-toast{display:flex;align-items:center;gap:9px;background:rgba(6,16,19,.9);border-left:2px solid var(--amber);padding:6px 13px 6px 10px;font-size:10px;font-weight:700;letter-spacing:1.8px;color:rgba(255,246,228,.95);box-shadow:0 8px 24px rgba(0,0,0,.35);animation:sb-toast 6s ease forwards;white-space:nowrap}
.sb-toast.hot{border-left-color:#ff6a54}
.sb-toast.cool{border-left-color:var(--teal)}
.sb-toast span{opacity:.55;font-size:8px;letter-spacing:1.4px}
@keyframes sb-toast{0%{opacity:0;transform:translateY(7px)}8%{opacity:1;transform:translateY(0)}82%{opacity:1}100%{opacity:0;transform:translateY(-4px)}}
#sbhint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);font-size:9px;letter-spacing:2.4px;color:rgba(255,238,208,.66);font-weight:700;z-index:4;white-space:nowrap;padding:5px 13px;border-radius:2px;background:rgba(6,16,19,.58);border:1px solid rgba(255,226,178,.12)}

/* ---------- overlays ---------- */
.sb-overlay{position:fixed;inset:0;display:none;place-items:center;background:rgba(3,10,12,.84);z-index:30;pointer-events:auto;text-shadow:none}
.sb-overlay.on{display:grid}
.sb-mapcard{background:#07171b;border:1px solid rgba(255,226,178,.22);box-shadow:0 30px 80px rgba(0,0,0,.6);padding:16px 16px 12px;width:626px}
.sb-maphead{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px}
.sb-maphead small{display:block;font-size:8px;letter-spacing:4px;color:var(--amber);font-weight:800;margin-bottom:3px}
.sb-maphead b{font-size:21px;letter-spacing:5px;font-weight:800;color:var(--cream)}
.sb-maphead>span{font-size:8px;letter-spacing:2.4px;color:rgba(255,238,208,.45);font-weight:700;padding-bottom:3px}
#sbbigmap{display:block;width:594px;height:594px;background:#0b1c21;border:1px solid rgba(255,226,178,.14)}
.sb-legend{display:flex;gap:18px;align-items:center;margin-top:9px;font-size:8px;letter-spacing:1.8px;color:rgba(255,238,208,.6);font-weight:700}
.sb-legend span{display:flex;align-items:center;gap:6px}
.sb-legend i{width:7px;height:7px;display:block;transform:rotate(45deg)}
.sb-legend .you{background:#7ce7d3}
.sb-legend .cop{background:#ff5a45;border-radius:50%;transform:none}
.sb-legend .job{background:#f5bb62}
.sb-legend .water{background:#0f3038;border:1px solid rgba(255,255,255,.25)}
.sb-card{background:#081a1f;border:1px solid rgba(255,226,178,.22);box-shadow:0 30px 80px rgba(0,0,0,.6);padding:26px 30px 22px;width:700px}
.sb-ptitle{font-size:38px;font-weight:800;letter-spacing:12px;color:var(--cream);line-height:1}
.sb-psub{font-size:8px;letter-spacing:5px;color:var(--amber);font-weight:800;margin:8px 0 20px}
.sb-keys{display:grid;grid-template-columns:1fr 1fr;gap:5px 30px;border-top:1px solid rgba(255,226,178,.14);border-bottom:1px solid rgba(255,226,178,.14);padding:14px 0}
.sb-key{display:flex;justify-content:space-between;gap:12px;font-size:9px;letter-spacing:1.4px;color:rgba(255,238,208,.62);font-weight:600;padding:2px 0}
.sb-key b{color:var(--cream);font-weight:800;letter-spacing:1.6px}
.sb-logwrap{margin-top:14px}
.sb-logwrap small{font-size:8px;letter-spacing:3px;color:rgba(255,238,208,.42);font-weight:800}
#sbjoblog{margin-top:7px;display:flex;flex-direction:column;gap:4px}
.sb-logrow{display:flex;justify-content:space-between;gap:10px;font-size:9px;letter-spacing:1.2px;color:rgba(255,238,208,.72);font-weight:600}
.sb-logrow b{color:var(--cream);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-logrow em{font-style:normal;font-size:8px;letter-spacing:1.6px;color:rgba(255,238,208,.4);flex:none}
.sb-logrow em.done{color:var(--teal)}
.sb-logrow em.fail{color:#ff6a54}
.sb-phint{margin-top:18px;font-size:8px;letter-spacing:2.6px;color:rgba(255,238,208,.4);font-weight:700}

/* ---------- busted ---------- */
#sbbusted{position:fixed;inset:0;display:none;place-items:center;background:rgba(20,6,4,.55);z-index:25;pointer-events:none}
#sbbusted.on{display:grid;animation:sb-bust 2.8s ease forwards}
#sbbusted b{font-size:76px;letter-spacing:22px;color:#ffd9a1;font-weight:800;text-shadow:0 0 40px rgba(255,90,60,.6)}
#sbbusted span{display:block;text-align:center;font-size:9px;letter-spacing:5px;color:rgba(255,226,190,.75);margin-top:10px;font-weight:700}
@keyframes sb-bust{0%{opacity:0}12%{opacity:1}80%{opacity:1}100%{opacity:0}}
`;

let ui = null;
let world = null;
let miniCtx = null;
let bigCtx = null;
const els = {};
const cache = { text: {}, segs: {}, toasts: '', pauses: null };
const segmentBanks = { hp: [], ap: [] };
const toasts = [];
let toastSeq = 0;
let lastToast = '';
let lastFrame = 0;
let lastSlow = 0;
let lastMini = 0;
let lastBig = 0;
let mapOpen = false;
let mainPaused = false;
let bigDirty = true;
let last = { player: null, police: null, mission: null };

// ---------------------------------------------------------------- world raster
function buildWorld() {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_PX;
  canvas.height = MAP_PX;
  const ctx = canvas.getContext('2d');
  const toRasterX = (worldX) => (worldX + MAP_UNITS / 2) * MAP_SCALE;
  const toRasterY = (worldZ) => (worldZ + MAP_UNITS / 2) * MAP_SCALE;

  ctx.fillStyle = '#313833';
  ctx.fillRect(0, 0, MAP_PX, MAP_PX);

  // District-tinted blocks. Cell centres are the same 34-unit grid city.js builds on.
  for (let gridX = -7; gridX <= 7; gridX++) {
    for (let gridZ = -7; gridZ <= 7; gridZ++) {
      const cellX = gridX * CITY.block + BLOCK_HALF;
      const cellZ = gridZ * CITY.block + BLOCK_HALF;
      if (Math.abs(cellX) > RASTER_EDGE || Math.abs(cellZ) > RASTER_EDGE) continue;
      const districtIdx = districtIndex(cellX, cellZ);
      ctx.fillStyle = DISTRICTS[districtIdx].color;
      ctx.fillRect(toRasterX(cellX - BLOCK_HALF), toRasterY(cellZ - BLOCK_HALF), CITY.block * MAP_SCALE, CITY.block * MAP_SCALE);
    }
  }

  // Carriageways.
  ctx.fillStyle = ROAD_COLOR;
  for (let roadIndex = -ROAD_LIMIT; roadIndex <= ROAD_LIMIT; roadIndex++) {
    const roadCoord = roadIndex * CITY.block;
    ctx.fillRect(toRasterX(roadCoord) - (CITY.road * MAP_SCALE) / 2, 0, CITY.road * MAP_SCALE, MAP_PX);
    ctx.fillRect(0, toRasterY(roadCoord) - (CITY.road * MAP_SCALE) / 2, MAP_PX, CITY.road * MAP_SCALE);
  }
  // Soft kerbs.
  ctx.strokeStyle = 'rgba(16,22,20,.35)';
  ctx.lineWidth = 1;
  for (let roadIndex = -ROAD_LIMIT; roadIndex <= ROAD_LIMIT; roadIndex++) {
    const roadCoord = roadIndex * CITY.block;
    ctx.beginPath();
    ctx.moveTo(toRasterX(roadCoord) - (CITY.road * MAP_SCALE) / 2, 0);
    ctx.lineTo(toRasterX(roadCoord) - (CITY.road * MAP_SCALE) / 2, MAP_PX);
    ctx.moveTo(toRasterX(roadCoord) + (CITY.road * MAP_SCALE) / 2, 0);
    ctx.lineTo(toRasterX(roadCoord) + (CITY.road * MAP_SCALE) / 2, MAP_PX);
    ctx.moveTo(0, toRasterY(roadCoord) - (CITY.road * MAP_SCALE) / 2);
    ctx.lineTo(MAP_PX, toRasterY(roadCoord) - (CITY.road * MAP_SCALE) / 2);
    ctx.moveTo(0, toRasterY(roadCoord) + (CITY.road * MAP_SCALE) / 2);
    ctx.lineTo(MAP_PX, toRasterY(roadCoord) + (CITY.road * MAP_SCALE) / 2);
    ctx.stroke();
  }
  // Centre dashes.
  ctx.strokeStyle = 'rgba(244,232,203,.36)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 9]);
  for (let roadIndex = -ROAD_LIMIT; roadIndex <= ROAD_LIMIT; roadIndex++) {
    const roadCoord = roadIndex * CITY.block;
    ctx.beginPath();
    ctx.moveTo(toRasterX(roadCoord), 0);
    ctx.lineTo(toRasterX(roadCoord), MAP_PX);
    ctx.moveTo(0, toRasterY(roadCoord));
    ctx.lineTo(MAP_PX, toRasterY(roadCoord));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Sea and beach at z < -230.
  const seaY = toRasterY(SEA_Z);
  ctx.fillStyle = '#0e2e37';
  ctx.fillRect(0, 0, MAP_PX, seaY);
  ctx.fillStyle = '#6c6045';
  ctx.fillRect(0, seaY, MAP_PX, toRasterY(BEACH_Z) - seaY);
  ctx.strokeStyle = 'rgba(240,230,200,.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, seaY);
  ctx.lineTo(MAP_PX, seaY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160,216,222,.12)';
  ctx.lineWidth = 1;
  for (let waveIndex = 0; waveIndex < 6; waveIndex++) {
    const waveY = 2 + waveIndex * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, waveY);
    ctx.lineTo(MAP_PX, waveY);
    ctx.stroke();
  }

  // Buildings — same footprints city.js generates.
  for (let gridX = -ROAD_LIMIT; gridX <= ROAD_LIMIT; gridX++) {
    for (let gridZ = -ROAD_LIMIT; gridZ <= ROAD_LIMIT; gridZ++) {
      const buildingX = gridX * CITY.block + BLOCK_HALF;
      const buildingZ = gridZ * CITY.block + BLOCK_HALF;
      if (Math.abs(buildingX) > 220 || buildingZ > 210 || buildingZ < -210) continue;
      if (Math.abs(gridX) < 1 && Math.abs(gridZ) < 1) continue;
      const seed = Math.abs(gridX * 71 + gridZ * 113 + 991);
      const width = 12 + (seed % 8);
      const depth = 12 + ((seed * 7) % 9);
      const districtIdx = districtIndex(buildingX, buildingZ);
      ctx.fillStyle = BUILDING_COLORS[seed % BUILDING_COLORS.length];
      ctx.fillRect(toRasterX(buildingX) - (width * MAP_SCALE) / 2, toRasterY(buildingZ) - (depth * MAP_SCALE) / 2, width * MAP_SCALE, depth * MAP_SCALE);
      ctx.strokeStyle = 'rgba(236,240,222,.13)';
      ctx.lineWidth = 1;
      ctx.strokeRect(toRasterX(buildingX) - (width * MAP_SCALE) / 2, toRasterY(buildingZ) - (depth * MAP_SCALE) / 2, width * MAP_SCALE, depth * MAP_SCALE);
      if (districtIdx === 2 || districtIdx === 4) {
        ctx.fillStyle = 'rgba(64,104,78,.85)';
        for (let treeIndex = 0; treeIndex < 3; treeIndex++) {
          ctx.beginPath();
          ctx.arc(toRasterX(buildingX + width / 2 + 1) + Math.cos(treeIndex * 2.1) * 3, toRasterY(buildingZ + width / 3) + Math.sin(treeIndex * 2.1) * 3, 2.1, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  // Causeway over the water — a landmark and a route off the beach.
  ctx.fillStyle = ROAD_COLOR;
  ctx.fillRect(toRasterX(-34) - (CITY.road * MAP_SCALE) / 2, 0, CITY.road * MAP_SCALE, toRasterY(-204) + 4);
  ctx.strokeStyle = 'rgba(20,26,24,.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(toRasterX(-34) - (CITY.road * MAP_SCALE) / 2, 0);
  ctx.lineTo(toRasterX(-34) - (CITY.road * MAP_SCALE) / 2, toRasterY(-204));
  ctx.moveTo(toRasterX(-34) + (CITY.road * MAP_SCALE) / 2, 0);
  ctx.lineTo(toRasterX(-34) + (CITY.road * MAP_SCALE) / 2, toRasterY(-204));
  ctx.stroke();

  // Coastline re-stroke to sit above the bridge.
  ctx.strokeStyle = 'rgba(240,230,200,.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, seaY);
  ctx.lineTo(MAP_PX, seaY);
  ctx.stroke();

  return canvas;
}

// ---------------------------------------------------------------- DOM
function seg(count, bank) {
  for (let segIndex = 0; segIndex < count; segIndex++) {
    const segment = document.createElement('i');
    bank.push(segment);
  }
  return bank.map((element) => element.outerHTML).join('') || '';
}

function build() {
  if (ui) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  ui = document.querySelector('#ui') || document.body;
  const hud = document.querySelector('#hud');
  const radar = document.querySelector('#radar');

  if (hud) {
    hud.innerHTML = `
      <div class="sb-panel sb-vitals">
        <div class="sb-vrow"><span class="sb-lab">HEALTH</span><b id="sbhp">100</b></div>
        <div class="sb-seg" id="sbhseg"></div>
        <div class="sb-vrow"><span class="sb-lab">ARMOUR</span><b id="sbap">35</b></div>
        <div class="sb-seg arm" id="sbaseg"></div>
        <div class="sb-stam"><span class="sb-lab">STAMINA</span><div class="sb-thin"><i id="sbsta"></i></div></div>
        <div class="sb-wrow">
          <div class="sb-wicon"><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M3 8h25v5h-5.5l-1.8 5.5h-4.9l1.6-5.5H10v5.5H5v-5.5H3z" fill="#ffe9c4"/><path d="M11 10h9v2h-9z" fill="#8b7a5d"/></svg></div>
          <div class="sb-wname"><small>EQUIPPED</small><b id="sbwname">PISTOL</b></div>
          <div class="sb-ammo"><b id="sbclip">12</b><em id="sbammo">/ 72</em></div>
        </div>
        <div class="sb-car" id="sbride">ON FOOT<span>SHIFT TO SPRINT</span></div>
      </div>`;
    const healthSegs = hud.querySelector('#sbhseg');
    const armorSegs = hud.querySelector('#sbaseg');
    for (let segIndex = 0; segIndex < SEGMENT_COUNT; segIndex++) {
      const healthSeg = document.createElement('i');
      const armorSeg = document.createElement('i');
      healthSegs.appendChild(healthSeg);
      armorSegs.appendChild(armorSeg);
      segmentBanks.hp.push(healthSeg);
      segmentBanks.ap.push(armorSeg);
    }
  }

  if (radar) {
    radar.innerHTML = `
      <div class="sb-mm">
        <canvas id="mmc" width="220" height="220"></canvas>
        <div class="sb-mm-shade"></div>
        <div class="sb-mm-n">N</div>
        <div class="sb-mm-live"><i></i>LIVE</div>
      </div>
      <div class="sb-mm-foot"><b id="sbmmdist">DOWNTOWN</b><span id="sbmmtime">21:04</span></div>`;
  }

  const extra = document.createElement('div');
  extra.innerHTML = `
    <div id="sbplace"><b id="sbdistrict">DOWNTOWN</b><i></i><span id="sbclock">21:04</span></div>
    <div id="sbstars">
      <div class="sb-wlab">WANTED</div>
      <div class="sb-star-row" id="sbstarrow"></div>
      <div class="sb-wsub" id="sbwsub">SEARCHING</div>
      <div class="sb-arrest" id="sbarrest"><i></i></div>
    </div>
    <div id="sbtop">
      <div class="sb-money"><small>CASH ON HAND</small><div><b id="sbcash">850</b><em>CR</em></div></div>
      <div class="sb-radio"><div class="sb-eq"><i></i><i></i><i></i><i></i></div><div><small>RADIO</small><b id="sbradio">COAST FM</b></div></div>
    </div>
    <div id="sbmission" class="sb-panel">
      <div class="sb-mtag"><span id="sbmtag">STORY JOB · 01 / 06</span><span id="sbmtimer"></span></div>
      <div class="sb-mtitle" id="sbmtitle">FIRST LIGHT</div>
      <div class="sb-mobj"><i></i><span id="sbmobj">MEET NICO AT THE PELICAN MOTEL</span></div>
      <div class="sb-mfoot"><div class="sb-pips" id="sbmpips"></div><span class="sb-mmeta" id="sbmmeta">+450 CR</span></div>
      <div class="sb-mtbar" id="sbmtbar"><i></i></div>
    </div>
    <div id="sbtoasts"></div>
    <div id="sbhint">TAB CITY MAP · P PAUSE · E INTERACT</div>
    <div id="sbbusted"><div><b>BUSTED</b><span>WANTED LEVEL CLEARED</span></div></div>
    <div class="sb-overlay" id="sbmap">
      <div class="sb-mapcard">
        <div class="sb-maphead">
          <div><small>SOLARA BAY</small><b>STREET ATLAS</b></div>
          <span>TAB / P TO CLOSE</span>
        </div>
        <canvas id="sbbigmap" width="594" height="594"></canvas>
        <div class="sb-legend">
          <span><i class="you"></i>YOU</span>
          <span><i class="job"></i>OBJECTIVE</span>
          <span><i class="cop"></i>POLICE</span>
          <span><i class="water"></i>SALT REACH</span>
          <span style="margin-left:auto">SIX DISTRICTS · 470 UNITS</span>
        </div>
      </div>
    </div>
    <div class="sb-overlay" id="sbpause">
      <div class="sb-card">
        <div class="sb-ptitle">PAUSED</div>
        <div class="sb-psub">SOLARA BAY · LOW TIDE</div>
        <div class="sb-keys">
          <div class="sb-key"><span>Move / drive</span><b>W A S D</b></div>
          <div class="sb-key"><span>Look</span><b>MOUSE</b></div>
          <div class="sb-key"><span>Sprint</span><b>SHIFT</b></div>
          <div class="sb-key"><span>Jump / handbrake</span><b>SPACE</b></div>
          <div class="sb-key"><span>Enter / exit · interact</span><b>E</b></div>
          <div class="sb-key"><span>Fire weapon</span><b>MOUSE 1</b></div>
          <div class="sb-key"><span>Pistol / SMG / shotgun</span><b>1 · 2 · 3</b></div>
          <div class="sb-key"><span>Reload</span><b>R</b></div>
          <div class="sb-key"><span>Crouch</span><b>F</b></div>
          <div class="sb-key"><span>Horn</span><b>H</b></div>
          <div class="sb-key"><span>Radio station</span><b>N</b></div>
          <div class="sb-key"><span>City map</span><b>TAB</b></div>
        </div>
        <div class="sb-logwrap"><small>JOB LOG</small><div id="sbjoblog"></div></div>
        <div class="sb-phint">P TO RESUME · ESC ALSO UNPAUSES</div>
      </div>
    </div>`;
  while (extra.firstChild) ui.appendChild(extra.firstChild);

  els.hp = document.querySelector('#sbhp');
  els.ap = document.querySelector('#sbap');
  els.sta = document.querySelector('#sbsta');
  els.wname = document.querySelector('#sbwname');
  els.clip = document.querySelector('#sbclip');
  els.ammo = document.querySelector('#sbammo');
  els.ride = document.querySelector('#sbride');
  els.district = document.querySelector('#sbdistrict');
  els.clock = document.querySelector('#sbclock');
  els.stars = document.querySelector('#sbstars');
  els.starRow = document.querySelector('#sbstarrow');
  els.wsub = document.querySelector('#sbwsub');
  els.arrest = document.querySelector('#sbarrest');
  els.arrestFill = document.querySelector('#sbarrest i');
  els.cash = document.querySelector('#sbcash');
  els.radio = document.querySelector('#sbradio');
  els.mtag = document.querySelector('#sbmtag');
  els.mtitle = document.querySelector('#sbmtitle');
  els.mobj = document.querySelector('#sbmobj');
  els.mmeta = document.querySelector('#sbmmeta');
  els.mpips = document.querySelector('#sbmpips');
  els.mtimer = document.querySelector('#sbmtimer');
  els.mtbar = document.querySelector('#sbmtbar');
  els.mtbarFill = document.querySelector('#sbmtbar i');
  els.toasts = document.querySelector('#sbtoasts');
  els.busted = document.querySelector('#sbbusted');
  els.map = document.querySelector('#sbmap');
  els.pause = document.querySelector('#sbpause');
  els.big = document.querySelector('#sbbigmap');
  els.mm = document.querySelector('#mmc');
  els.mmDistrict = document.querySelector('#sbmmdist');
  els.mmTime = document.querySelector('#sbmmtime');
  els.joblog = document.querySelector('#sbjoblog');

  for (let starIndex = 0; starIndex < MAX_STARS; starIndex++) {
    const star = document.createElement('span');
    star.className = 'sb-star';
    star.textContent = '★';
    els.starRow.appendChild(star);
  }

  if (els.mm) miniCtx = els.mm.getContext('2d');
  if (els.big) bigCtx = els.big.getContext('2d');
  world = buildWorld();
  installKeys();
  patchSolara();
}

function txt(element, value) {
  if (!element) return;
  if (element.__cachedText !== value) {
    element.__cachedText = value;
    element.textContent = value;
  }
}

// ---------------------------------------------------------------- notifications
function notify(text, kind) {
  if (!text) return;
  const now = performance.now();
  const lastOne = toasts[toasts.length - 1];
  if (lastOne && lastOne.text === text && now - lastOne.at < TOAST_DEDUPE_MS) return;
  const hot = kind === 'hot' || /WANTED|BUSTED|FAILED|ROADBLOCK|AIR SUPPORT|WRECK|DIED|EXPIRED/i.test(text);
  const cool = kind === 'cool' || /COMPLETE|RETRY|JOB|HEAT LOST/i.test(text);
  toasts.push({ id: ++toastSeq, text, at: now, hot, cool });
  while (toasts.length > MAX_TOASTS) toasts.shift();
}

function renderToasts() {
  if (!els.toasts) return;
  const now = performance.now();
  while (toasts.length && now - toasts[0].at > TOAST_LIFETIME_MS) toasts.shift();
  const key = toasts.map((toast) => toast.id).join(',');
  if (cache.toasts === key) return;
  cache.toasts = key;
  els.toasts.innerHTML = toasts.map((toast) => {
    const kind = toast.hot ? 'hot' : toast.cool ? 'cool' : '';
    const stamp = toast.hot ? 'ALERT' : toast.cool ? 'LOG' : 'CITY';
    return `<div class="sb-toast ${kind}"><span>${stamp}</span>${toast.text}</div>`;
  }).join('');
}

// ---------------------------------------------------------------- key handling
function installKeys() {
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const menu = document.querySelector('#menu');
    if (!menu || menu.style.display !== 'none') return;
    if (event.code === 'Tab') {
      event.preventDefault();
      toggleMap();
    } else if (event.code === 'KeyP') {
      // main.js owns the real pause; this only mirrors it so the help card matches.
      mainPaused = !mainPaused;
      if (mapOpen) setMap(false);
      syncOverlays();
    } else if (event.code === 'Escape') {
      mainPaused = !mainPaused;
      if (mapOpen) setMap(false);
      syncOverlays();
      refreshJobLog();
    }
  }, true);
}

function syncOverlays() {
  if (!els.pause) return;
  els.pause.classList.toggle('on', mainPaused && !mapOpen);
  if (mainPaused && !mapOpen) refreshJobLog();
}

function refreshJobLog() {
  if (!els.joblog) return;
  const mission = last.mission;
  if (!mission || typeof mission.missionLog !== 'function') {
    els.joblog.innerHTML = '<div class="sb-logrow"><b>NO JOBS ON FILE</b><em>—</em></div>';
    return;
  }
  const rows = mission.missionLog().slice(0, 4);
  if (!rows.length) {
    els.joblog.innerHTML = '<div class="sb-logrow"><b>NO JOBS ON FILE</b><em>—</em></div>';
    return;
  }
  els.joblog.innerHTML = rows.map((row) => {
    const statusClass = row.status === 'COMPLETE' ? 'done' : row.status === 'FAILED' ? 'fail' : '';
    const rewardLabel = row.status === 'COMPLETE' ? `+${row.reward} CR` : row.status;
    return `<div class="sb-logrow"><b>${row.title}</b><em class="${statusClass}">${rewardLabel}</em></div>`;
  }).join('');
}

function setMap(show) {
  mapOpen = !!show;
  if (els.map) els.map.classList.toggle('on', mapOpen);
  if (mapOpen) {
    bigDirty = true;
    drawBigMap();
  }
  syncOverlays();
}

export function toggleMap(show) {
  if (!ui) build();
  setMap(typeof show === 'boolean' ? show : !mapOpen);
  return mapOpen;
}

function patchSolara() {
  try {
    let value = window.SOLARA || null;
    Object.defineProperty(window, 'SOLARA', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(api) {
        value = api;
        if (api && typeof api === 'object') api.toggleMap = toggleMap;
      }
    });
    if (value) value.toggleMap = toggleMap;
  } catch (error) {
    let attempts = 0;
    const timer = setInterval(() => {
      const solara = window.SOLARA;
      if (solara && typeof solara === 'object') {
        solara.toggleMap = toggleMap;
        clearInterval(timer);
      }
      if (++attempts > PATCH_MAX_TRIES) clearInterval(timer);
    }, PATCH_RETRY_MS);
  }
}

// ---------------------------------------------------------------- minimap
function drawMinimap(player, police, mission) {
  const ctx = miniCtx;
  if (!ctx || !world) return;
  const MINI_SCALE = MINI_PX / MINI_VIEW;
  const playerX = player.group.position.x;
  const playerZ = player.group.position.z;
  const heading = player.car ? player.car.root.rotation.y : player.group.rotation.y;

  ctx.save();
  ctx.clearRect(0, 0, MINI_PX, MINI_PX);
  ctx.beginPath();
  ctx.arc(MINI_CENTER, MINI_CENTER, MINI_CLIP_RADIUS, 0, TAU);
  ctx.fillStyle = '#0b1d21';
  ctx.fill();
  ctx.clip();

  // Blit the world raster centred on the player.
  let sourceX = (playerX + MAP_UNITS / 2) * MAP_SCALE - (MINI_VIEW / 2) * MAP_SCALE;
  let sourceY = (playerZ + MAP_UNITS / 2) * MAP_SCALE - (MINI_VIEW / 2) * MAP_SCALE;
  let sourceWidth = MINI_VIEW * MAP_SCALE;
  let sourceHeight = MINI_VIEW * MAP_SCALE;
  const DEST_PER_SOURCE = MINI_PX / (MINI_VIEW * MAP_SCALE);          // dest px per source px
  let destX = 0, destY = 0, destWidth = MINI_PX, destHeight = MINI_PX;
  if (sourceX < 0) { const cut = -sourceX; destX = cut * DEST_PER_SOURCE; destWidth -= destX; sourceWidth -= cut; sourceX = 0; }
  if (sourceY < 0) { const cut = -sourceY; destY = cut * DEST_PER_SOURCE; destHeight -= destY; sourceHeight -= cut; sourceY = 0; }
  if (sourceX + sourceWidth > MAP_PX) { const cut = sourceX + sourceWidth - MAP_PX; sourceWidth -= cut; destWidth -= cut * DEST_PER_SOURCE; }
  if (sourceY + sourceHeight > MAP_PX) { const cut = sourceY + sourceHeight - MAP_PX; sourceHeight -= cut; destHeight -= cut * DEST_PER_SOURCE; }
  if (sourceWidth > 0 && sourceHeight > 0) ctx.drawImage(world, sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight);

  // Wanted arc around the bezel.
  if (police && police.stars > 0) {
    ctx.strokeStyle = 'rgba(255,90,70,.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(MINI_CENTER, MINI_CENTER, MINI_WANTED_RADIUS, -Math.PI / 2, -Math.PI / 2 + TAU * (police.stars / MAX_STARS));
    ctx.stroke();
  }

  const toMap = (worldX, worldZ) => [MINI_CENTER + (worldX - playerX) * MINI_SCALE, MINI_CENTER + (worldZ - playerZ) * MINI_SCALE];
  const inside = (mapX, mapY, radius = 100) => Math.hypot(mapX - MINI_CENTER, mapY - MINI_CENTER) < radius;

  // Police blips.
  if (police) {
    const flash = Math.floor(performance.now() / BLIP_FLASH_MS) % 2 === 0;
    const units = police.units || [];
    for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
      const unit = units[unitIndex];
      if (!unit || !unit.root) continue;
      const [mapX, mapY] = toMap(unit.root.position.x, unit.root.position.z);
      if (!inside(mapX, mapY, MINI_BLIP_RADIUS)) continue;
      ctx.fillStyle = flash ? '#ff4d3f' : '#4f8bff';
      ctx.beginPath();
      ctx.arc(mapX, mapY, 3.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const cop of police.foot || []) {
      if (!cop || !cop.mesh) continue;
      const [mapX, mapY] = toMap(cop.mesh.position.x, cop.mesh.position.z);
      if (!inside(mapX, mapY, MINI_BLIP_RADIUS)) continue;
      ctx.fillStyle = '#9cc4ff';
      ctx.beginPath();
      ctx.arc(mapX, mapY, 2.2, 0, TAU);
      ctx.fill();
    }
    if (police.heli && police.heli.group) {
      const [mapX, mapY] = toMap(police.heli.group.position.x, police.heli.group.position.z);
      if (inside(mapX, mapY, MINI_BLIP_RADIUS)) {
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mapX, mapY, 5, 0, TAU);
        ctx.stroke();
      }
    }
    for (const block of police.roadblock || []) {
      if (!block || !block.root) continue;
      const [mapX, mapY] = toMap(block.root.position.x, block.root.position.z);
      if (inside(mapX, mapY, MINI_BLIP_RADIUS)) {
        ctx.fillStyle = '#ff6a54';
        ctx.fillRect(mapX - 2, mapY - 2, 4, 4);
      }
    }
  }

  // Mission marker, clamped to the bezel with a small pointer.
  if (mission && mission.marker && mission.marker.visible) {
    let markerOffsetX = (mission.marker.position.x - playerX) * MINI_SCALE;
    let markerOffsetY = (mission.marker.position.z - playerZ) * MINI_SCALE;
    const markerDistance = Math.hypot(markerOffsetX, markerOffsetY);
    let atEdge = false;
    if (markerDistance > MINI_MARKER_CLAMP) {
      markerOffsetX = (markerOffsetX / markerDistance) * MINI_MARKER_CLAMP;
      markerOffsetY = (markerOffsetY / markerDistance) * MINI_MARKER_CLAMP;
      atEdge = true;
    }
    const markerX = MINI_CENTER + markerOffsetX, markerY = MINI_CENTER + markerOffsetY;
    ctx.save();
    ctx.translate(markerX, markerY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#f5bb62';
    ctx.strokeStyle = 'rgba(7,18,21,.9)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-4.3, -4.3, 8.6, 8.6);
    ctx.strokeRect(-4.3, -4.3, 8.6, 8.6);
    ctx.restore();
    if (atEdge) {
      ctx.fillStyle = 'rgba(245,187,98,.9)';
      ctx.beginPath();
      ctx.arc(markerX, markerY, 1.6, 0, TAU);
      ctx.fill();
    }
  }

  // Player arrow (north-up map, arrow rotates with heading).
  ctx.save();
  ctx.translate(MINI_CENTER, MINI_CENTER);
  ctx.rotate(Math.PI - heading);
  ctx.fillStyle = '#f4fffb';
  ctx.strokeStyle = 'rgba(6,16,18,.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5.4, 6.4);
  ctx.lineTo(0, 3.2);
  ctx.lineTo(-5.4, 6.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Soft inner vignette.
  const vignette = ctx.createRadialGradient(MINI_CENTER, MINI_CENTER, 66, MINI_CENTER, MINI_CENTER, MINI_CENTER);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,10,12,.55)');
  ctx.fillStyle = vignette;
  ctx.beginPath();
  ctx.arc(MINI_CENTER, MINI_CENTER, MINI_CENTER, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- atlas
const POIS = [
  { x: -42, z: -42, name: 'PELICAN MOTEL' },
  { x: 68, z: -204, name: 'MARINA' },
  { x: 170, z: -34, name: 'PORT' },
  { x: -34, z: -204, name: 'CAUSEWAY' },
  { x: 17, z: 17, name: 'DOWNTOWN' }
];

function drawBigMap() {
  const ctx = bigCtx;
  if (!ctx || !world) return;
  const toAtlas = (worldCoord) => ((worldCoord + MAP_UNITS / 2) / MAP_UNITS) * ATLAS_PX;
  ctx.clearRect(0, 0, ATLAS_PX, ATLAS_PX);
  ctx.fillStyle = '#0b1c21';
  ctx.fillRect(0, 0, ATLAS_PX, ATLAS_PX);
  ctx.drawImage(world, 0, 0, MAP_PX, MAP_PX, 0, 0, ATLAS_PX, ATLAS_PX);

  // District names.
  const areas = [
    { name: 'DOWNTOWN', x: 12, z: 12 },
    { name: 'THE DOCKS', x: -160, z: -46 },
    { name: 'SUBURBS', x: 66, z: 172 },
    { name: 'INDUSTRIAL', x: 172, z: 76 },
    { name: 'BEACH PARK', x: -66, z: -166 },
    { name: 'LITTLE HAVANA', x: -66, z: 86 }
  ];
  ctx.textAlign = 'center';
  for (const area of areas) {
    ctx.font = '700 12px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,244,226,.72)';
    ctx.fillText(area.name, toAtlas(area.x), toAtlas(area.z));
    ctx.font = '600 8px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,244,226,.3)';
    ctx.fillText('SOLARA BAY', toAtlas(area.x), toAtlas(area.z) + 12);
  }

  // Sea label.
  ctx.font = 'italic 600 13px Georgia, serif';
  ctx.fillStyle = 'rgba(160,216,222,.55)';
  ctx.fillText('SALT  REACH', toAtlas(120), toAtlas(-232) + 7);

  // Point of interest pins.
  for (const poi of POIS) {
    const pinX = toAtlas(poi.x), pinY = toAtlas(poi.z);
    ctx.fillStyle = '#f5bb62';
    ctx.beginPath();
    ctx.arc(pinX, pinY, 2.4, 0, TAU);
    ctx.fill();
    ctx.font = '700 8px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,244,226,.62)';
    ctx.textAlign = 'left';
    const flipLabel = pinX > ATLAS_PX - ATLAS_LABEL_FLIP_MARGIN;
    ctx.textAlign = flipLabel ? 'right' : 'left';
    ctx.fillText(poi.name, pinX + (flipLabel ? -6 : 6), pinY + 3);
  }
  ctx.textAlign = 'center';

  const player = last.player;
  const police = last.police;
  const mission = last.mission;

  if (mission && mission.marker && mission.marker.visible) {
    const markerX = toAtlas(mission.marker.position.x), markerY = toAtlas(mission.marker.position.z);
    ctx.save();
    ctx.translate(markerX, markerY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#f5bb62';
    ctx.strokeStyle = 'rgba(7,18,21,.9)';
    ctx.lineWidth = 2;
    ctx.fillRect(-6, -6, 12, 12);
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.restore();
    ctx.font = '700 8px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(245,187,98,.8)';
    ctx.fillText('OBJECTIVE', markerX, markerY - 12);
  }

  if (police) {
    const flash = Math.floor(performance.now() / ATLAS_FLASH_MS) % 2 === 0;
    for (const unit of police.units || []) {
      if (!unit || !unit.root) continue;
      ctx.fillStyle = flash ? '#ff4d3f' : '#4f8bff';
      ctx.beginPath();
      ctx.arc(toAtlas(unit.root.position.x), toAtlas(unit.root.position.z), 4, 0, TAU);
      ctx.fill();
    }
    for (const block of police.roadblock || []) {
      if (!block || !block.root) continue;
      ctx.fillStyle = '#ff6a54';
      ctx.fillRect(toAtlas(block.root.position.x) - 3, toAtlas(block.root.position.z) - 3, 6, 6);
    }
    if (police.heli && police.heli.group) {
      ctx.strokeStyle = '#ffd27a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toAtlas(police.heli.group.position.x), toAtlas(police.heli.group.position.z), 8, 0, TAU);
      ctx.stroke();
    }
  }

  if (player) {
    const playerX = toAtlas(player.group.position.x), playerY = toAtlas(player.group.position.z);
    const heading = player.car ? player.car.root.rotation.y : player.group.rotation.y;
    ctx.save();
    ctx.translate(playerX, playerY);
    ctx.rotate(Math.PI - heading);
    ctx.fillStyle = '#7ce7d3';
    ctx.strokeStyle = 'rgba(4,14,16,.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Compass rose.
  ctx.save();
  ctx.translate(ATLAS_PX - 30, 30);
  ctx.fillStyle = 'rgba(255,244,226,.7)';
  ctx.font = '800 11px "Inter", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -10);
  ctx.strokeStyle = 'rgba(255,244,226,.45)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(0, 10);
  ctx.moveTo(0, -6); ctx.lineTo(-4, 0);
  ctx.moveTo(0, -6); ctx.lineTo(4, 0);
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = 'center';
}

// ---------------------------------------------------------------- main update
export function updateHud(player, police, mission, toast) {
  if (!player || !player.group) return;
  build();
  const now = performance.now();
  const delta = lastFrame ? Math.min(MAX_HUD_DELTA, (now - lastFrame) / 1000) : DEFAULT_HUD_DELTA;
  lastFrame = now;
  last = { player, police, mission };

  if (mission && typeof mission.update === 'function') {
    try { mission.update(delta, player, police); } catch (error) { /* keep the HUD alive */ }
  }

  if (police && typeof police.drainEvents === 'function') {
    for (const text of police.drainEvents()) notify(text, 'hot');
  }
  if (mission && typeof mission.drainEvents === 'function') {
    for (const text of mission.drainEvents()) notify(text, /COMPLETE|JOB|RETRY/.test(text) ? 'cool' : undefined);
  }

  if (toast && toast !== lastToast) notify(toast);
  lastToast = toast || '';

  // Vitals.
  const health = clamp(Number(player.health) || 0, 0, 100);
  const armor = clamp(Number(player.armor) || 0, 0, 100);
  txt(els.hp, String(Math.ceil(health)));
  txt(els.ap, String(Math.ceil(armor)));
  setSegs(segmentBanks.hp, (health / 100) * SEGMENT_COUNT, health < LOW_HEALTH);
  setSegs(segmentBanks.ap, (armor / 100) * SEGMENT_COUNT, false);
  if (els.sta) els.sta.style.width = `${clamp(Number(player.stamina) || 0, 0, 100)}%`;

  const weapon = WEAPONS[clamp((Number(player.weapon) || 1) - 1, 0, WEAPONS.length - 1)];
  txt(els.wname, weapon);
  txt(els.clip, String(Number(player.clip) || 0));
  txt(els.ammo, `/ ${Number(player.ammo) || 0}`);

  const rideKey = player.car
    ? `${String(player.car.type || 'SEDAN').toUpperCase()}|${Math.round(Math.abs(Number(player.car.speed) || 0) * KMH_PER_UNIT)}`
    : 'FOOT';
  if (cache.ride !== rideKey) {
    cache.ride = rideKey;
    if (els.ride) {
      els.ride.innerHTML = player.car
        ? `${String(player.car.type || 'SEDAN').toUpperCase()} <span>${Math.round(Math.abs(Number(player.car.speed) || 0) * KMH_PER_UNIT)} KM/H</span>`
        : 'ON FOOT <span>SHIFT TO SPRINT</span>';
    }
  }

  // Money.
  txt(els.cash, fmt(Number(player.money) || 0));

  // Wanted.
  const stars = clamp(Math.round(Number(police && police.stars) || 0), 0, MAX_STARS);
  if (els.stars) {
    els.stars.classList.add('on');
    els.stars.classList.toggle('hot', stars >= 4);
  }
  if (els.starRow.__stars !== stars) {
    els.starRow.__stars = stars;
    const starElements = els.starRow.children;
    for (let starIndex = 0; starIndex < starElements.length; starIndex++) starElements[starIndex].classList.toggle('lit', starIndex < stars);
  }
  const arrest = police && Number(police.arrest) ? police.arrest : 0;
  if (els.arrest) els.arrest.classList.toggle('on', arrest > 0.02);
  if (els.arrestFill) els.arrestFill.style.width = `${clamp(arrest, 0, 1) * 100}%`;
  let wantedSubtitle = 'SEARCHING';
  if (police && police.arresting) wantedSubtitle = 'BEING ARRESTED';
  else if (police && police.evading) wantedSubtitle = 'EVADING';
  else if (stars >= 4) wantedSubtitle = 'AIR SUPPORT';
  else if (stars === 0) wantedSubtitle = '';
  txt(els.wsub, wantedSubtitle);

  if (els.busted) els.busted.classList.toggle('on', !!(police && police.busted));

  // Mission card.
  updateMissionCard(player, mission);

  // Radio.
  let station = 0;
  try {
    const audio = window.SOLARA && window.SOLARA.audio;
    if (audio && Number.isFinite(Number(audio.station))) station = Number(audio.station);
  } catch (error) { station = 0; }
  txt(els.radio, STATIONS[clamp(station, 0, 2)]);

  renderToasts();

  // Slow lane: 10 Hz for the map, clock, distance.
  if (now - lastSlow > SLOW_LANE_MS) {
    lastSlow = now;
    const pos = player.group.position;
    const area = districtAt(pos);
    txt(els.district, area);
    txt(els.mmDistrict, area.toUpperCase());
    const timeOfDayRaw = (window.SOLARA && typeof window.SOLARA.timeOfDay === 'number') ? window.SOLARA.timeOfDay : (FALLBACK_CLOCK_MINUTES + Math.floor(now / FALLBACK_CLOCK_TICK_MS)) / MINUTES_PER_DAY;
    const totalMinutes = Math.floor((((timeOfDayRaw % 1) + 1) % 1) * MINUTES_PER_DAY);
    const hours = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
    const minutes = String(totalMinutes % 60).padStart(2, '0');
    txt(els.clock, `${hours}:${minutes}`);
    txt(els.mmTime, `${hours}:${minutes}`);

    if (mission && mission.marker && mission.marker.visible) {
      const distance = Math.hypot(mission.marker.position.x - pos.x, mission.marker.position.z - pos.z);
      const label = distance > KM_THRESHOLD ? `${(distance / METERS_PER_KM).toFixed(1)} KM` : `${Math.round(distance)} M`;
      if (els.mmeta) {
        const reward = Number(mission.reward) || 0;
        txt(els.mmeta, `${reward ? `+${fmt(reward)} CR · ` : ''}${label}`);
      }
    } else if (els.mmeta) {
      txt(els.mmeta, mission && mission.reward ? `+${fmt(mission.reward)} CR · NO FIXED POINT` : 'NO FIXED POINT');
    }

    if (now - lastMini > MINIMAP_MS) {
      lastMini = now;
      drawMinimap(player, police, mission);
    }
  }

  if (mapOpen && now - lastBig > BIGMAP_MS) {
    lastBig = now;
    drawBigMap();
  }
}

function setSegs(bank, count, low) {
  const litCount = clamp(Math.round(count), 0, bank.length);
  if (bank.__litCount === litCount && bank.__lowFlag === low) return;
  bank.__litCount = litCount;
  bank.__lowFlag = low;
  for (let segIndex = 0; segIndex < bank.length; segIndex++) {
    const isOn = segIndex < litCount;
    bank[segIndex].classList.toggle('on', isOn);
    bank[segIndex].classList.toggle('low', low);
  }
}

function updateMissionCard(player, mission) {
  if (!mission) return;
  const current = typeof mission.current === 'function' ? mission.current() : null;
  const title = current ? String(current[0] || '') : '';
  const missionIndex = Number(mission.index) || 0;
  const side = missionIndex >= SIDE_MISSION_START;
  txt(els.mtag, side ? 'SIDE JOB · SOLARA' : `STORY JOB · ${String(missionIndex + 1).padStart(2, '0')} / ${String(STORY_TOTAL).padStart(2, '0')}`);

  const cleanTitle = title.replace(/^\d+\s*·\s*/, '').replace(/^SIDE\s*·\s*/, '');
  txt(els.mtitle, cleanTitle || 'SOLARA BAY');

  const objective = typeof mission.objectiveText === 'function' ? mission.objectiveText() : (current ? current[1] : '');
  txt(els.mobj, objective || (mission.done ? 'SOLARA BAY IS YOURS' : ''));

  const stepCount = Math.max(1, Number(mission.stepCount) || 1);
  const stepIndex = clamp(Number(mission.stepIndex) || 0, 0, stepCount - 1);
  const pipKey = `${missionIndex}:${stepCount}:${mission.done ? 1 : 0}`;
  if (cache.pips !== pipKey) {
    cache.pips = pipKey;
    els.mpips.innerHTML = '';
    for (let pipIndex = 0; pipIndex < stepCount; pipIndex++) els.mpips.appendChild(document.createElement('i'));
  }
  const pips = els.mpips.children;
  for (let pipIndex = 0; pipIndex < pips.length; pipIndex++) {
    pips[pipIndex].classList.toggle('done', pipIndex < stepIndex || (mission.done && pipIndex <= stepIndex));
    pips[pipIndex].classList.toggle('cur', pipIndex === stepIndex && !mission.done);
  }

  // Timer.
  let secondsLeft = null;
  let totalSeconds = 0;
  if (typeof mission.timeLeft === 'function') secondsLeft = mission.timeLeft();
  if (typeof mission.timeTotal === 'function') totalSeconds = Number(mission.timeTotal()) || 0;
  const hasTimer = secondsLeft !== null && secondsLeft !== undefined;
  if (els.mtimer) {
    const label = hasTimer ? `${Math.floor(Math.max(0, secondsLeft) / 60)}:${String(Math.max(0, Math.ceil(secondsLeft)) % 60).padStart(2, '0')}` : '';
    txt(els.mtimer, label);
  }
  if (els.mtbar) {
    els.mtbar.classList.toggle('on', hasTimer);
    els.mtbar.classList.toggle('low', hasTimer && secondsLeft < LOW_TIME_SECONDS);
    if (hasTimer) {
      const ratio = totalSeconds > 0 ? clamp(secondsLeft / totalSeconds, 0, 1) : 1;
      els.mtbarFill.style.width = `${ratio * 100}%`;
    }
  }

  // Until the slow lane measures distance, keep the meta line useful.
  if (!els.mmeta.__cachedText && mission.reward) txt(els.mmeta, `+${fmt(Number(mission.reward) || 0)} CR`);
}

// Keep the HUD legible if a future main.js calls updateHud before the player exists.
export function mountHud() {
  build();
  return { toggleMap };
}
