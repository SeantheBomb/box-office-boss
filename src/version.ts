// Bump BUILD_VERSION every deploy; players get a studio-memo popup with the changelog.
// SAVE_VERSION lives in kernel/save.ts — when it bumps, the popup explains the save reset.

export const BUILD_VERSION = "0.4.0";

export const CHANGELOG: string[] = [
  "BossOS FACELIFT: full knockoff-Mac desktop — menu bar with live studio clock, magnifying dock with bounce-on-mail, traffic-light windows, translucent everything. Only the finest, for an exec.",
  "MAKE IT YOURS: new games start with your name, your studio's name, and your pick of desktop wallpaper — the whole town addresses you accordingly.",
  "SOUND: a full audio pass — soft lounge beds and room-tone ambience that shift between office, set, con floor, and gala; chimes, stamps, stingers, applause, paparazzi.",
  "VOICES: characters now mumble their feelings in meetings, Animal Crossing style — every person at their own pitch.",
  "FACES: portraits rebuilt as stylized caricatures — shaded, expressive, with stat-mapped wardrobe and accessories (agents wear earpieces; famous stars wear shades indoors).",
  "JUICE: new mail slides in as notifications, the calendar reminds you about tomorrow's meetings, and the dock bounces when something needs you.",
  "CHARTS: hover the standings for exact weekly numbers, click release markers to open dossiers, sparklines in the table, conversion rates on the funnel.",
];
