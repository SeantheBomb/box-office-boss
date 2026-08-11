// Procedural SVG portraits: every person gets a face minted from their portraitSeed.

import { makeRng } from "../kernel/rng";

const SKINS = ["#f2c9a0", "#e0ac69", "#c68642", "#8d5524", "#f8d9c0", "#a3705a"];
const HAIRС = ["#2c1b10", "#4a3220", "#c9a227", "#8a8a8a", "#b5651d", "#151515", "#7a2c1a", "#d8d8d8"];
const BGS = ["#2e5266", "#6d3a5d", "#3f6d3a", "#8a5a2c", "#4a4a6d", "#6d4a2c"];

// Per-role visual language so you can read who you're talking to at a glance:
// cast = gold star frame + glamour glow · director = viewfinder + beret + slate corner
// writer = notebook edge + pencil behind ear · producer = pinstripe corner + cigar? no — clipboard
// vfx = wireframe corner · critic = monocle chain + quill corner
const ROLE_FRAME: Record<string, string> = {
  cast: "#e8c14a",
  director: "#4a90d9",
  writer: "#7ac74f",
  producer: "#c9a227",
  critic: "#b06ad9",
  vfx: "#5ad9c9",
};

export function Portrait({ seed, size = 72, mood = 0, role }: { seed: number; size?: number; mood?: number; role?: string }) {
  const rng = makeRng(seed);
  const bg = rng.pick(BGS);
  const skin = rng.pick(SKINS);
  const hair = rng.pick(HAIRС);
  const hairStyle = rng.int(0, 4); // 0 bald, 1 flat, 2 pouf, 3 long, 4 mohawk-ish
  const eyeY = 40 + rng.int(-2, 2);
  const eyeDx = 10 + rng.int(-1, 2);
  const browTilt = rng.int(-3, 3) + (mood < 0 ? 4 : 0);
  const glasses = rng.chance(0.25);
  const facial = rng.chance(0.3);
  const earrings = rng.chance(0.2);
  const mouthCurve = mood > 0 ? 6 : mood < 0 ? -5 : rng.int(-2, 4);
  const faceW = 30 + rng.int(-3, 4);
  const frame = role ? ROLE_FRAME[role] : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ borderRadius: 8, boxShadow: "0 3px 10px rgba(0,0,0,0.5)", border: frame ? `2px solid ${frame}` : undefined }}>
      <rect width="100" height="100" fill={bg} />
      {/* shoulders */}
      <ellipse cx="50" cy="102" rx="34" ry="22" fill={rng.pick(["#2c2c30", "#57402a", "#6d1f1f", "#1d3a5a"])} />
      {/* head */}
      <ellipse cx="50" cy="48" rx={faceW} ry="30" fill={skin} />
      {/* hair */}
      {hairStyle === 1 && <path d={`M${50 - faceW},48 Q50,8 ${50 + faceW},48 L${50 + faceW},38 Q50,14 ${50 - faceW},38 Z`} fill={hair} />}
      {hairStyle === 1 && <ellipse cx="50" cy="26" rx={faceW - 2} ry="10" fill={hair} />}
      {hairStyle === 2 && <ellipse cx="50" cy="24" rx={faceW} ry="14" fill={hair} />}
      {hairStyle === 3 && <path d={`M${50 - faceW - 4},70 Q${44 - faceW},20 50,18 Q${56 + faceW},20 ${50 + faceW + 4},70 L${50 + faceW - 6},70 Q${50 + faceW - 4},34 50,30 Q${54 - faceW},34 ${56 - faceW},70 Z`} fill={hair} />}
      {hairStyle === 4 && <rect x="42" y="12" width="16" height="16" rx="5" fill={hair} />}
      {/* brows */}
      <line x1={50 - eyeDx - 6} y1={eyeY - 8 + browTilt} x2={50 - eyeDx + 5} y2={eyeY - 8} stroke={hair} stroke-width="2.5" />
      <line x1={50 + eyeDx - 5} y1={eyeY - 8} x2={50 + eyeDx + 6} y2={eyeY - 8 + browTilt} stroke={hair} stroke-width="2.5" />
      {/* eyes */}
      <circle cx={50 - eyeDx} cy={eyeY} r="3" fill="#1c1a17" />
      <circle cx={50 + eyeDx} cy={eyeY} r="3" fill="#1c1a17" />
      {glasses && (
        <g stroke="#1c1a17" stroke-width="1.5" fill="none">
          <circle cx={50 - eyeDx} cy={eyeY} r="7" />
          <circle cx={50 + eyeDx} cy={eyeY} r="7" />
          <line x1={50 - eyeDx + 7} y1={eyeY} x2={50 + eyeDx - 7} y2={eyeY} />
        </g>
      )}
      {/* nose + mouth */}
      <line x1="50" y1={eyeY + 4} x2="48" y2={eyeY + 12} stroke="#00000030" stroke-width="2" />
      <path d={`M42,${64} Q50,${64 + mouthCurve} 58,${64}`} stroke="#7a3a30" stroke-width="2.5" fill="none" />
      {facial && <path d={`M40,66 Q50,${76 + mouthCurve / 2} 60,66 L60,72 Q50,80 40,72 Z`} fill={hair} opacity="0.85" />}
      {earrings && <circle cx={50 - faceW} cy="58" r="2.5" fill="#e8c14a" />}
      {/* role signifiers */}
      {role === "cast" && (
        <g>
          <path d="M8,10 l2.4,4.9 5.4,.8 -3.9,3.8 .9,5.4 -4.8,-2.5 -4.8,2.5 .9,-5.4 -3.9,-3.8 5.4,-.8 Z" fill="#e8c14a" />
          <ellipse cx="50" cy="48" rx={faceW + 4} ry="34" fill="none" stroke="#e8c14a55" stroke-width="3" />
        </g>
      )}
      {role === "director" && (
        <g>
          <path d={`M${50 - faceW + 2},22 Q50,6 ${50 + faceW - 2},20 L${50 + faceW - 6},28 Q50,16 ${50 - faceW + 6},30 Z`} fill="#2c2c30" />
          <circle cx={50 + faceW - 4} cy="18" r="4" fill="#2c2c30" />
          <rect x="4" y="78" width="26" height="16" rx="2" fill="#1c1a17" stroke="#fff" stroke-width="1" />
          <path d="M4,84 l26,0 M9,78 l5,6 M17,78 l5,6 M25,78 l5,6" stroke="#fff" stroke-width="1" />
        </g>
      )}
      {role === "writer" && (
        <g>
          <rect x={50 + eyeDx + 8} y={eyeY - 14} width="4" height="14" rx="1.5" fill="#c9a227" transform={`rotate(20 ${50 + eyeDx + 10} ${eyeY - 7})`} />
          <rect x="70" y="80" width="26" height="16" fill="#f4eee2" stroke="#8a6a10" />
          <path d="M73,84 h20 M73,88 h20 M73,92 h14" stroke="#8a6a10" stroke-width="1" />
        </g>
      )}
      {role === "producer" && (
        <g>
          <rect x="4" y="76" width="24" height="20" rx="2" fill="#8a5a2c" />
          <rect x="7" y="72" width="18" height="7" rx="2" fill="#c9a227" />
          <path d="M8,82 h16 M8,86 h16 M8,90 h10" stroke="#f4eee2" stroke-width="1.5" />
        </g>
      )}
      {role === "critic" && (
        <g>
          <circle cx={50 + eyeDx} cy={eyeY} r="8" fill="none" stroke="#b06ad9" stroke-width="2" />
          <path d={`M${50 + eyeDx + 6},${eyeY + 6} q6,10 2,20`} fill="none" stroke="#b06ad9" stroke-width="1.5" />
          <path d="M78,94 q10,-16 16,-18 q-4,8 -10,20 Z" fill="#f4eee2" stroke="#b06ad9" stroke-width="1" />
        </g>
      )}
    </svg>
  );
}

/** Non-person portraits for board/crowd/exec placeholders. */
export function GroupPortrait({ kind, size = 72 }: { kind: string; size?: number }) {
  const seedMap: Record<string, number> = { board: 901, crowd: 902, exec: 903, producers: 904 };
  if (kind === "crowd") {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ borderRadius: 8 }}>
        <rect width="100" height="100" fill="#241c33" />
        {[15, 33, 51, 69, 87].map((x, i) => (
          <g key={i}>
            <circle cx={x} cy={62 + (i % 2) * 8} r="9" fill={SKINS[i % SKINS.length]} />
            <ellipse cx={x} cy={80 + (i % 2) * 8} rx="11" ry="10" fill="#1c1725" />
          </g>
        ))}
        <text x="50" y="30" text-anchor="middle" fill="#e8c14a" font-size="26">★</text>
      </svg>
    );
  }
  if (kind === "board" || kind === "producers") {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ borderRadius: 8 }}>
        <rect width="100" height="100" fill={kind === "board" ? "#1d2733" : "#2c3326"} />
        {[28, 50, 72].map((x, i) => (
          <g key={i}>
            <circle cx={x} cy="45" r="10" fill={SKINS[(i + 1) % SKINS.length]} />
            <rect x={x - 12} y="56" width="24" height="30" rx="4" fill="#14161a" />
            <rect x={x - 2} y="56" width="4" height="16" fill={kind === "board" ? "#a33327" : "#c9a227"} />
          </g>
        ))}
      </svg>
    );
  }
  return <Portrait seed={seedMap[kind] ?? 900} size={size} />;
}
