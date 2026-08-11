// Bump BUILD_VERSION every deploy; players get a studio-memo popup with the changelog.
// SAVE_VERSION lives in kernel/save.ts — when it bumps, the popup explains the save reset.

export const BUILD_VERSION = "0.6.0";

export const CHANGELOG: string[] = [
  "BOOM OR BUST: movies are now a GENRE × GENRE × TOPIC fusion (Horror × Comedy · ZOMBIES). Topics trend on their own — spikier and meaner than genres — and when all three line up hot, the multiplier goes EXPONENTIAL. When they don't… well. The Audience app has a new Topic Tracker board.",
  "THE DOSSIER: one searchable app for every file in the game. Search anyone or anything — people, pictures, genres, topics — and every 📁 link in every email and meeting now opens straight to the file, with a back button to retrace the trail.",
  "CROSS-REFERENCE EVERYTHING: producer stat sheets right in the assignment email, rival releases linked from the pick-a-date email, and a Referenced: row of one-click files on the mail that matters.",
  "STANDUP WITH TEETH: idle producers can now be handed a shelved project, sent out to SCOUT a pitch for next week (they come back with dinner — and the meeting starts warm), or fired on the spot (severance applies; the room notices).",
  "SET VISITS THAT MATTER: production reviews now read the ACTUAL state of the shoot — real friction, real overruns, real scope creep. And when nothing's on fire, a healthy set is leverage: praise the room, push the pace, or commission a showpiece scene.",
  "NO MORE DOPPELGÄNGERS: duplicate movie titles and twin VFX studios have been escorted off the lot.",
];
