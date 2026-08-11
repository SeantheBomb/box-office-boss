// Portraits v2 — stylized caricature busts, fully layered and stat-mapped.
// Every visual trait derives from the person: role sets wardrobe, stats set accessories,
// archetype sets attitude, mood bends brows and mouth. Deterministic from portraitSeed.
// (When the Gemini PNG bake lands, PortraitImg swaps in baked layers via the same mapping.)

import { makeRng } from "../kernel/rng";
import type { Person } from "../kernel/types";

const SKINS = [
  { base: "#f6cfa8", shade: "#e0ab7e", blush: "#f0a68a" },
  { base: "#eab88a", shade: "#cf9260", blush: "#e09a72" },
  { base: "#d29a66", shade: "#b07a44", blush: "#c67f56" },
  { base: "#a9744c", shade: "#8a5a34", blush: "#9c6644" },
  { base: "#7d5236", shade: "#613d26", blush: "#6f4630" },
  { base: "#f8dcc0", shade: "#dfb894", blush: "#efb49c" },
];
const HAIR_COLORS = ["#241a12", "#4a3220", "#7a5230", "#b5651d", "#c9a227", "#8a8a8a", "#d8d8d8", "#151515", "#7a2c1a", "#3b2c20"];
const ROLE_BG: Record<string, [string, string]> = {
  cast: ["#8a6a2c", "#3f3116"],
  director: ["#2c4a6a", "#16243a"],
  writer: ["#3f6d3a", "#1c3319"],
  producer: ["#6d5a2c", "#332a12"],
  agent: ["#5a2c6d", "#2a1233"],
  critic: ["#6d2c4a", "#331222"],
};

export function Portrait2({ person, size = 96, mood = 0 }: { person: Person; size?: number; mood?: number }) {
  const rng = makeRng(person.portraitSeed);
  const R = (a: number, b: number) => rng.int(a, b);
  const skin = SKINS[R(0, SKINS.length - 1)] ?? SKINS[0];
  let hairC = HAIR_COLORS[R(0, HAIR_COLORS.length - 1)];
  const grayTemples = person.archetype === "faded-legend" || (person.filmography?.length ?? 0) > 6;
  const [bg1, bg2] = ROLE_BG[person.role] ?? ["#4a4a5a", "#22222c"];

  // face geometry
  const faceW = 52 + R(-8, 10); // half-width
  const faceH = 62 + R(-6, 8);
  const jaw = R(0, 3); // 0 round 1 square 2 pointed 3 heavy
  const cx = 100, cy = 92;
  const eyeY = cy - 8 + R(-3, 3);
  const eyeDx = 22 + R(-3, 4);
  const eyeW = 9 + R(-2, 3);
  const noseL = 16 + R(-3, 6);
  const mouthY = cy + 30 + R(-2, 3);

  // attitude: cooperation bends resting brows, improv bends resting mouth
  const coop = person.cooperation ?? person.avgCastCooperation ?? 60;
  const improv = person.improv ?? 50;
  const browAngle = (coop < 35 ? 7 : coop > 75 ? -3 : 2) + (mood < 0 ? 6 : mood > 0 ? -3 : 0) + R(-2, 2);
  const browTh = 3 + R(0, 3) + (person.gender === "M" ? 1 : 0);
  const mouthCurve = (mood > 0 ? 10 : mood < 0 ? -8 : improv > 70 ? 6 : coop < 35 ? -4 : 2) + R(-2, 3);
  const smirk = person.archetype === "loose-cannon" || improv > 80;

  // hair style pool (gendered lean, seed decides)
  const stylesF = ["bob", "waves", "bun", "pony", "curls", "pixie", "long", "shag"];
  const stylesM = ["slick", "pomp", "part", "buzz", "curls", "shag", "bald", "wild"];
  const pool = person.gender === "F" ? stylesF : person.gender === "M" ? stylesM : [...stylesF, ...stylesM];
  let hair = pool[R(0, pool.length - 1)];
  if (person.archetype === "loose-cannon") hair = "wild";
  const facial = person.gender === "M" && rng.chance(0.45) ? R(0, 2) : -1; // 0 stache 1 goatee 2 beard

  // stat-mapped extras
  const fame = person.fame ?? 0;
  const rich = (person.netWorth ?? 0) > 6_000_000 || fame > 80;
  const sunglasses = person.role === "cast" && fame > 72 && rng.chance(0.7);
  const glasses = !sunglasses && (person.role === "writer" ? rng.chance(0.65) : person.role === "critic" ? false : rng.chance(0.2));
  const monocle = person.role === "critic" && rng.chance(0.7);
  const earpiece = person.role === "agent";
  const beret = person.role === "director" && (person.avgVfxShots ?? 0) < 250;
  const headphones = person.role === "director" && (person.avgVfxShots ?? 0) >= 250;
  const pencil = person.role === "writer" && rng.chance(0.7);
  const earringL = rich && rng.chance(0.8);
  const chain = rich && person.gender !== "F" && rng.chance(0.5);
  const lipstick = person.gender === "F" && rng.chance(0.7);
  const cheekbones = person.physique === "chiseled" || person.physique === "statuesque";

  // wardrobe by role
  const WARDROBES: Record<string, { c1: string; c2: string; lapel: string; type: string }> = {
    cast: { c1: "#1c1a24", c2: "#3a2a4a", lapel: "#c9a227", type: "glam" },
    director: { c1: "#1c1c1c", c2: "#2a2a2a", lapel: "#1c1c1c", type: "turtleneck" },
    writer: { c1: "#5a4a34", c2: "#6d5a40", lapel: "#3f3428", type: "cardigan" },
    producer: { c1: "#2a3140", c2: "#39445a", lapel: "#1e2430", type: "suit" },
    agent: { c1: "#16181c", c2: "#24262c", lapel: "#0e0f12", type: "suit" },
    critic: { c1: "#4a3a2a", c2: "#5c4936", lapel: "#3a2d20", type: "tweed" },
  };
  const wardrobe = WARDROBES[person.role] ?? { c1: "#333", c2: "#444", lapel: "#222", type: "suit" };
  const tieC = ["#a33327", "#2e5266", "#c9a227", "#3f6d3a", "#6d3a5d"][R(0, 4)];

  const jawPath =
    jaw === 1
      ? `M${cx - faceW},${cy} L${cx - faceW + 6},${cy + faceH - 14} Q${cx - faceW + 10},${cy + faceH} ${cx - 18},${cy + faceH + 2} L${cx + 18},${cy + faceH + 2} Q${cx + faceW - 10},${cy + faceH} ${cx + faceW - 6},${cy + faceH - 14} L${cx + faceW},${cy}`
      : jaw === 2
      ? `M${cx - faceW},${cy} Q${cx - faceW + 4},${cy + faceH - 8} ${cx},${cy + faceH + 8} Q${cx + faceW - 4},${cy + faceH - 8} ${cx + faceW},${cy}`
      : jaw === 3
      ? `M${cx - faceW},${cy} Q${cx - faceW},${cy + faceH + 2} ${cx - 12},${cy + faceH + 4} L${cx + 12},${cy + faceH + 4} Q${cx + faceW},${cy + faceH + 2} ${cx + faceW},${cy}`
      : `M${cx - faceW},${cy} Q${cx - faceW + 2},${cy + faceH} ${cx},${cy + faceH + 4} Q${cx + faceW - 2},${cy + faceH} ${cx + faceW},${cy}`;

  const uid = `p${person.portraitSeed & 0xffff}`;

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ borderRadius: "10%", boxShadow: "0 4px 14px rgba(0,0,0,0.45)" }}>
      <defs>
        <radialGradient id={`${uid}bg`} cx="50%" cy="30%" r="80%">
          <stop offset="0%" stop-color={bg1} />
          <stop offset="100%" stop-color={bg2} />
        </radialGradient>
        <linearGradient id={`${uid}sk`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stop-color={skin.base} />
          <stop offset="100%" stop-color={skin.shade} />
        </linearGradient>
        <linearGradient id={`${uid}cl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={wardrobe.c2} />
          <stop offset="100%" stop-color={wardrobe.c1} />
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill={`url(#${uid}bg)`} />
      {/* spotlight vignette */}
      <ellipse cx="100" cy="60" rx="90" ry="70" fill="#ffffff14" />

      {/* shoulders / wardrobe */}
      <path d={`M30,200 Q34,146 72,138 L100,132 L128,138 Q166,146 170,200 Z`} fill={`url(#${uid}cl)`} />
      {wardrobe.type === "turtleneck" && <path d="M76,142 Q100,152 124,142 L124,158 Q100,168 76,158 Z" fill="#111" />}
      {wardrobe.type === "suit" && (
        <g>
          <path d="M84,140 L100,168 L100,200 L70,200 Q66,160 84,140" fill={wardrobe.lapel} />
          <path d="M116,140 L100,168 L100,200 L130,200 Q134,160 116,140" fill={wardrobe.lapel} />
          <path d="M96,150 L104,150 L106,178 L100,192 L94,178 Z" fill={tieC} />
        </g>
      )}
      {wardrobe.type === "glam" && (
        <g>
          <path d="M82,140 Q100,158 118,140 L112,200 L88,200 Z" fill="#0e0c14" />
          <path d="M84,140 L98,158 L86,166 Z" fill={wardrobe.lapel} opacity="0.9" />
          <path d="M116,140 L102,158 L114,166 Z" fill={wardrobe.lapel} opacity="0.9" />
        </g>
      )}
      {wardrobe.type === "cardigan" && <path d="M78,144 L100,160 L122,144 L122,200 L78,200 Z" fill="#4a3d2c" />}
      {wardrobe.type === "tweed" && (
        <g>
          <path d="M96,148 Q100,144 104,148 Q108,156 100,160 Q92,156 96,148" fill="#a33327" />
          <circle cx="100" cy="154" r="2" fill="#7a1f18" />
        </g>
      )}
      {chain && <path d="M78,152 Q100,176 122,152" stroke="#e8c14a" stroke-width="4" fill="none" stroke-dasharray="1 5" stroke-linecap="round" />}

      {/* neck */}
      <path d={`M86,${cy + faceH - 12} L86,146 Q100,154 114,146 L114,${cy + faceH - 12} Z`} fill={skin.shade} />

      {/* head */}
      <path d={`${jawPath} Q${cx + faceW},${cy - faceH * 0.55} ${cx + faceW * 0.6},${cy - faceH * 0.82} Q${cx},${cy - faceH} ${cx - faceW * 0.6},${cy - faceH * 0.82} Q${cx - faceW},${cy - faceH * 0.55} ${cx - faceW},${cy} Z`} fill={`url(#${uid}sk)`} />
      {/* ears */}
      <ellipse cx={cx - faceW - 2} cy={eyeY + 10} rx="7" ry="11" fill={skin.shade} />
      <ellipse cx={cx + faceW + 2} cy={eyeY + 10} rx="7" ry="11" fill={skin.base} />
      {earringL && <circle cx={cx - faceW - 3} cy={eyeY + 22} r="3.5" fill="#e8c14a" stroke="#8a6a10" stroke-width="0.8" />}

      {/* cheeks + contour */}
      <ellipse cx={cx - faceW * 0.55} cy={cy + 14} rx="10" ry="6" fill={skin.blush} opacity="0.45" />
      <ellipse cx={cx + faceW * 0.55} cy={cy + 14} rx="10" ry="6" fill={skin.blush} opacity="0.35" />
      {cheekbones && (
        <g stroke={skin.shade} stroke-width="2" opacity="0.6" fill="none">
          <path d={`M${cx - faceW * 0.7},${cy + 8} Q${cx - faceW * 0.5},${cy + 18} ${cx - faceW * 0.3},${cy + 20}`} />
          <path d={`M${cx + faceW * 0.7},${cy + 8} Q${cx + faceW * 0.5},${cy + 18} ${cx + faceW * 0.3},${cy + 20}`} />
        </g>
      )}
      {grayTemples && (
        <g>
          <path d={`M${cx - faceW + 2},${cy - 18} q6,-14 14,-20`} stroke="#c8c8c8" stroke-width="5" fill="none" opacity="0.8" />
          <path d={`M${cx + faceW - 2},${cy - 18} q-6,-14 -14,-20`} stroke="#c8c8c8" stroke-width="5" fill="none" opacity="0.8" />
        </g>
      )}

      {/* eyes */}
      {!sunglasses && (
        <g>
          <ellipse cx={cx - eyeDx} cy={eyeY} rx={eyeW} ry={eyeW * 0.62} fill="#fff" />
          <ellipse cx={cx + eyeDx} cy={eyeY} rx={eyeW} ry={eyeW * 0.62} fill="#fff" />
          <circle cx={cx - eyeDx + 1.5} cy={eyeY + 0.5} r={eyeW * 0.42} fill="#2c1c10" />
          <circle cx={cx + eyeDx + 1.5} cy={eyeY + 0.5} r={eyeW * 0.42} fill="#2c1c10" />
          <circle cx={cx - eyeDx + 3} cy={eyeY - 1.5} r="1.4" fill="#fff" />
          <circle cx={cx + eyeDx + 3} cy={eyeY - 1.5} r="1.4" fill="#fff" />
          {/* lids for tired producers under load */}
          {(person.role === "producer" || coop < 30) && (
            <g>
              <path d={`M${cx - eyeDx - eyeW},${eyeY - 2} h${eyeW * 2}`} stroke={skin.shade} stroke-width="3" opacity="0.7" />
              <path d={`M${cx + eyeDx - eyeW},${eyeY - 2} h${eyeW * 2}`} stroke={skin.shade} stroke-width="3" opacity="0.7" />
            </g>
          )}
        </g>
      )}
      {/* brows — the caricature's whole attitude lives here */}
      <path d={`M${cx - eyeDx - eyeW - 2},${eyeY - 12 + browAngle} Q${cx - eyeDx},${eyeY - 16 - browAngle / 2} ${cx - eyeDx + eyeW + 2},${eyeY - 12 - browAngle}`} stroke={hairC} stroke-width={browTh} fill="none" stroke-linecap="round" />
      <path d={`M${cx + eyeDx - eyeW - 2},${eyeY - 12 - browAngle} Q${cx + eyeDx},${eyeY - 16 - browAngle / 2} ${cx + eyeDx + eyeW + 2},${eyeY - 12 + browAngle}`} stroke={hairC} stroke-width={browTh} fill="none" stroke-linecap="round" />

      {/* nose */}
      <path d={`M${cx},${eyeY + 6} Q${cx - 4},${eyeY + noseL} ${cx - 7},${eyeY + noseL + 4} Q${cx},${eyeY + noseL + 9} ${cx + 7},${eyeY + noseL + 4}`} stroke={skin.shade} stroke-width="3" fill="none" stroke-linecap="round" />

      {/* mouth */}
      {smirk ? (
        <path d={`M${cx - 16},${mouthY} Q${cx + 4},${mouthY + mouthCurve} ${cx + 18},${mouthY - 6}`} stroke={lipstick ? "#a3273a" : "#7a3a30"} stroke-width={lipstick ? 5 : 3.5} fill="none" stroke-linecap="round" />
      ) : (
        <path d={`M${cx - 16},${mouthY} Q${cx},${mouthY + mouthCurve} ${cx + 16},${mouthY}`} stroke={lipstick ? "#a3273a" : "#7a3a30"} stroke-width={lipstick ? 5 : 3.5} fill="none" stroke-linecap="round" />
      )}
      {mood > 0 && <path d={`M${cx - 12},${mouthY + 1} Q${cx},${mouthY + mouthCurve * 0.9 + 3} ${cx + 12},${mouthY + 1}`} fill="#fff" opacity="0.9" />}

      {/* facial hair */}
      {facial === 0 && <path d={`M${cx - 14},${mouthY - 6} Q${cx},${mouthY - 12} ${cx + 14},${mouthY - 6} Q${cx},${mouthY - 2} ${cx - 14},${mouthY - 6}`} fill={hairC} />}
      {facial === 1 && <path d={`M${cx - 8},${mouthY + 6} Q${cx},${mouthY + 22} ${cx + 8},${mouthY + 6} Q${cx},${mouthY + 12} ${cx - 8},${mouthY + 6}`} fill={hairC} />}
      {facial === 2 && <path d={`M${cx - faceW + 6},${cy + 8} Q${cx - 20},${cy + faceH + 10} ${cx},${cy + faceH + 12} Q${cx + 20},${cy + faceH + 10} ${cx + faceW - 6},${cy + 8} L${cx + faceW - 14},${cy + 4} Q${cx},${mouthY + 14} ${cx - faceW + 14},${cy + 4} Z`} fill={hairC} opacity="0.95" />}

      {/* hair */}
      <Hair style={hair} color={hairC} cx={cx} cy={cy} faceW={faceW} faceH={faceH} rng={R} />

      {/* accessories */}
      {glasses && (
        <g stroke="#2c2620" stroke-width="2.5" fill="#ffffff14">
          <rect x={cx - eyeDx - eyeW - 3} y={eyeY - 8} width={eyeW * 2 + 6} height={eyeW * 1.5 + 2} rx="4" />
          <rect x={cx + eyeDx - eyeW - 3} y={eyeY - 8} width={eyeW * 2 + 6} height={eyeW * 1.5 + 2} rx="4" />
          <line x1={cx - eyeDx + eyeW + 3} y1={eyeY} x2={cx + eyeDx - eyeW - 3} y2={eyeY} />
        </g>
      )}
      {sunglasses && (
        <g>
          <rect x={cx - eyeDx - eyeW - 3} y={eyeY - 8} width={eyeW * 2 + 6} height={eyeW * 1.6 + 2} rx="5" fill="#14161a" stroke="#c9a227" stroke-width="1.5" />
          <rect x={cx + eyeDx - eyeW - 3} y={eyeY - 8} width={eyeW * 2 + 6} height={eyeW * 1.6 + 2} rx="5" fill="#14161a" stroke="#c9a227" stroke-width="1.5" />
          <line x1={cx - eyeDx + eyeW + 3} y1={eyeY - 2} x2={cx + eyeDx - eyeW - 3} y2={eyeY - 2} stroke="#c9a227" stroke-width="2" />
          <path d={`M${cx - eyeDx - 4},${eyeY - 5} l6,3`} stroke="#ffffff66" stroke-width="2" />
        </g>
      )}
      {monocle && (
        <g>
          <circle cx={cx + eyeDx} cy={eyeY} r={eyeW + 3} fill="none" stroke="#b8934a" stroke-width="2.5" />
          <path d={`M${cx + eyeDx + eyeW + 2},${eyeY + 4} q8,14 4,26`} stroke="#b8934a" stroke-width="1.5" fill="none" />
        </g>
      )}
      {earpiece && (
        <g>
          <path d={`M${cx + faceW + 2},${eyeY + 4} q8,0 7,10 q-1,8 -8,7`} fill="#2c3540" stroke="#4a90d9" stroke-width="1" />
          <circle cx={cx + faceW + 5} cy={eyeY + 9} r="2" fill="#4ad9ff" />
        </g>
      )}
      {pencil && <rect x={cx + faceW - 10} y={eyeY - 16} width="5" height="26" rx="2" fill="#c9a227" transform={`rotate(24 ${cx + faceW - 8} ${eyeY - 3})`} />}
      {beret && (
        <g>
          <path d={`M${cx - faceW - 4},${cy - faceH * 0.6} Q${cx - 10},${cy - faceH - 22} ${cx + faceW * 0.9},${cy - faceH * 0.72} Q${cx + faceW * 0.4},${cy - faceH * 0.5} ${cx - faceW - 4},${cy - faceH * 0.6}`} fill="#1c1c24" />
          <circle cx={cx} cy={cy - faceH - 8} r="4" fill="#1c1c24" />
        </g>
      )}
      {headphones && (
        <g>
          <path d={`M${cx - faceW - 4},${eyeY + 2} Q${cx},${cy - faceH - 14} ${cx + faceW + 4},${eyeY + 2}`} stroke="#22262c" stroke-width="7" fill="none" />
          <rect x={cx - faceW - 10} y={eyeY} width="12" height="18" rx="5" fill="#22262c" />
          <rect x={cx + faceW - 2} y={eyeY} width="12" height="18" rx="5" fill="#22262c" />
        </g>
      )}

      {/* rim light */}
      <path d={`M${cx + faceW * 0.7},${cy - faceH * 0.7} Q${cx + faceW},${cy - faceH * 0.3} ${cx + faceW - 1},${cy + 8}`} stroke="#ffffff33" stroke-width="4" fill="none" stroke-linecap="round" />
    </svg>
  );
}

function Hair({ style, color, cx, cy, faceW, faceH, rng }: { style: string; color: string; cx: number; cy: number; faceW: number; faceH: number; rng: (a: number, b: number) => number }) {
  const top = cy - faceH;
  const hi = "#ffffff2e";
  switch (style) {
    case "slick":
      return (
        <g>
          <path d={`M${cx - faceW},${cy - 14} Q${cx - faceW - 2},${top - 4} ${cx},${top - 8} Q${cx + faceW + 2},${top - 4} ${cx + faceW},${cy - 14} Q${cx + faceW - 8},${top + 10} ${cx},${top + 12} Q${cx - faceW + 8},${top + 10} ${cx - faceW},${cy - 14}`} fill={color} />
          <path d={`M${cx - 30},${top + 2} Q${cx},${top - 4} ${cx + 30},${top + 2}`} stroke={hi} stroke-width="4" fill="none" />
        </g>
      );
    case "pomp":
      return (
        <g>
          <path d={`M${cx - faceW},${cy - 16} Q${cx - faceW - 6},${top - 18} ${cx - 10},${top - 22} Q${cx + 34},${top - 26} ${cx + faceW - 4},${top - 2} Q${cx + faceW},${cy - 20} ${cx + faceW - 10},${top + 12} Q${cx},${top + 6} ${cx - faceW + 6},${top + 14} Z`} fill={color} />
          <path d={`M${cx - 24},${top - 12} Q${cx + 8},${top - 18} ${cx + 30},${top - 6}`} stroke={hi} stroke-width="5" fill="none" />
        </g>
      );
    case "part":
      return (
        <g>
          <path d={`M${cx - faceW},${cy - 12} Q${cx - faceW},${top - 6} ${cx - 12},${top - 10} L${cx - 8},${top + 8} Q${cx - faceW + 10},${top + 12} ${cx - faceW},${cy - 12}`} fill={color} />
          <path d={`M${cx - 12},${top - 10} Q${cx + faceW},${top - 12} ${cx + faceW},${cy - 12} Q${cx + faceW - 10},${top + 10} ${cx - 4},${top + 6} Z`} fill={color} />
        </g>
      );
    case "buzz":
      return <path d={`M${cx - faceW + 2},${cy - 18} Q${cx - faceW},${top - 2} ${cx},${top - 4} Q${cx + faceW},${top - 2} ${cx + faceW - 2},${cy - 18} Q${cx},${top + 16} ${cx - faceW + 2},${cy - 18}`} fill={color} opacity="0.7" />;
    case "bald":
      return <ellipse cx={cx - 14} cy={top + 10} rx="16" ry="7" fill="#ffffff3d" />;
    case "wild":
      return (
        <g fill={color}>
          {Array.from({ length: 9 }, (_, i) => {
            const a = -160 + i * 20 + rng(-6, 6);
            const r = faceH + rng(4, 18);
            const x = cx + Math.cos((a * Math.PI) / 180) * (faceW * 0.9);
            const y = cy - 6 + Math.sin((a * Math.PI) / 180) * r * 0.7;
            return <ellipse key={i} cx={x} cy={y} rx={13 + rng(0, 6)} ry={11 + rng(0, 6)} />;
          })}
        </g>
      );
    case "curls":
      return (
        <g fill={color}>
          {Array.from({ length: 8 }, (_, i) => {
            const x = cx - faceW + 4 + i * ((faceW * 2 - 8) / 7);
            return <circle key={i} cx={x} cy={top + 2 + (i % 2 ? -6 : 2)} r={13 + rng(0, 4)} />;
          })}
          <circle cx={cx - faceW} cy={cy - 16} r="12" />
          <circle cx={cx + faceW} cy={cy - 16} r="12" />
        </g>
      );
    case "bob":
      return (
        <g>
          <path d={`M${cx - faceW - 8},${cy + 16} Q${cx - faceW - 10},${top - 10} ${cx},${top - 12} Q${cx + faceW + 10},${top - 10} ${cx + faceW + 8},${cy + 16} L${cx + faceW - 4},${cy + 18} Q${cx + faceW - 2},${cy - 24} ${cx + 20},${top + 6} Q${cx - 30},${top + 10} ${cx - faceW + 2},${cy - 10} L${cx - faceW + 4},${cy + 18} Z`} fill={color} />
          <path d={`M${cx - 34},${top - 2} Q${cx},${top - 8} ${cx + 34},${top - 2}`} stroke={hi} stroke-width="4" fill="none" />
        </g>
      );
    case "waves":
      return (
        <g>
          <path d={`M${cx - faceW - 12},${cy + 44} Q${cx - faceW - 16},${top - 8} ${cx},${top - 12} Q${cx + faceW + 16},${top - 8} ${cx + faceW + 12},${cy + 44} Q${cx + faceW + 2},${cy + 48} ${cx + faceW - 2},${cy + 40} Q${cx + faceW},${cy - 20} ${cx + 22},${top + 4} Q${cx - 30},${top + 8} ${cx - faceW},${cy - 14} Q${cx - faceW - 2},${cy + 44} ${cx - faceW - 6},${cy + 46} Z`} fill={color} />
          <path d={`M${cx + faceW + 4},${cy} q6,14 -2,30`} stroke={hi} stroke-width="3" fill="none" />
          <path d={`M${cx - faceW - 6},${cy} q-6,14 2,30`} stroke={hi} stroke-width="3" fill="none" />
        </g>
      );
    case "bun":
      return (
        <g>
          <path d={`M${cx - faceW},${cy - 12} Q${cx - faceW},${top - 6} ${cx},${top - 8} Q${cx + faceW},${top - 6} ${cx + faceW},${cy - 12} Q${cx},${top + 10} ${cx - faceW},${cy - 12}`} fill={color} />
          <circle cx={cx} cy={top - 12} r="13" fill={color} />
          <circle cx={cx - 4} cy={top - 15} r="4" fill={hi} />
        </g>
      );
    case "pony":
      return (
        <g>
          <path d={`M${cx - faceW},${cy - 12} Q${cx - faceW},${top - 8} ${cx},${top - 10} Q${cx + faceW},${top - 8} ${cx + faceW},${cy - 12} Q${cx},${top + 8} ${cx - faceW},${cy - 12}`} fill={color} />
          <path d={`M${cx + faceW - 4},${top + 6} Q${cx + faceW + 26},${cy} ${cx + faceW + 14},${cy + 44} Q${cx + faceW + 4},${cy + 30} ${cx + faceW + 2},${cy + 6} Z`} fill={color} />
        </g>
      );
    case "pixie":
      return (
        <g>
          <path d={`M${cx - faceW - 2},${cy - 10} Q${cx - faceW - 4},${top - 10} ${cx + 8},${top - 12} Q${cx + faceW + 4},${top - 6} ${cx + faceW - 2},${cy - 20} Q${cx + 20},${top - 2} ${cx + 6},${top + 10} Q${cx - 26},${top + 14} ${cx - faceW + 4},${cy - 4} Z`} fill={color} />
          <path d={`M${cx + 10},${top - 6} q14,2 22,10`} stroke={hi} stroke-width="3" fill="none" />
        </g>
      );
    case "long":
      return (
        <g>
          <path d={`M${cx - faceW - 10},${cy + 58} L${cx - faceW - 12},${cy - 20} Q${cx - faceW - 8},${top - 10} ${cx},${top - 12} Q${cx + faceW + 8},${top - 10} ${cx + faceW + 12},${cy - 20} L${cx + faceW + 10},${cy + 58} L${cx + faceW - 4},${cy + 56} Q${cx + faceW},${cy - 16} ${cx + 24},${top + 2} Q${cx - 28},${top + 6} ${cx - faceW + 2},${cy - 12} L${cx - faceW + 4},${cy + 56} Z`} fill={color} />
        </g>
      );
    case "shag":
    default:
      return (
        <g fill={color}>
          <path d={`M${cx - faceW - 4},${cy - 4} Q${cx - faceW - 6},${top - 8} ${cx},${top - 10} Q${cx + faceW + 6},${top - 8} ${cx + faceW + 4},${cy - 4} L${cx + faceW - 6},${cy - 12} L${cx + 26},${top + 4} L${cx + 8},${top + 10} L${cx - 12},${top + 4} L${cx - 30},${top + 12} L${cx - faceW + 6},${cy - 10} Z`} />
        </g>
      );
  }
}
