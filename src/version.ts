// Bump BUILD_VERSION every deploy; players get a studio-memo popup with the changelog.
// SAVE_VERSION lives in kernel/save.ts — when it bumps, the popup explains the save reset.

export const BUILD_VERSION = "0.7.1";

export const CHANGELOG: string[] = [
  "Anonymous session recording: the studio now quietly logs which decisions you make (not who you are) so the dev can tell whether anyone's actually playing and debug real runs. No gameplay change.",
  "CAREERS: every release now moves everyone attached to it. Stars gain and lose fame, rates chase the fame curve, directors' and writers' craft drifts toward what they actually delivered, producers' track records become EARNED, and VFX houses reprice with demand.",
  "RISING STARS & FALLING ONES: break out onto the A-list and the ego arrives before the trophy — new riders, worse cooperation, a heavier rate card. Wreck a project or star in a bomb and they come back down to earth: cheap, early, and suspiciously polite. You'll feel it in the room.",
  "THE PRODUCER ECONOMY: producers draw real weekly salaries, carry morale, and renegotiate their rate every season. Rival studios run fully simulated producer benches — and unhappy people take calls in BOTH directions. Counter the poach or let them walk; make your own runs from any rival producer's file.",
  "THE TRADES KNOW EVERYTHING: breakouts, falls from grace, defections, failed raids, and repriced VFX shops all make the column — with one-click files on everyone named.",
  "THE DOSSIER, PROPERLY: a real dock icon, browse tabs for People / Pictures / Studios / VFX, full search across all of it (writers, directors, rival movies included), and brand-new files on every studio and every VFX house.",
];
