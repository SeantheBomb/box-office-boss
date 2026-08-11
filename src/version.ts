// Bump BUILD_VERSION every deploy; players get a studio-memo popup with the changelog.
// SAVE_VERSION lives in kernel/save.ts — when it bumps, the popup explains the save reset.

export const BUILD_VERSION = "0.3.1";

export const CHANGELOG: string[] = [
  "FIX: dossiers opened from inside a meeting (the \"full dossier ▸\" / movie links) now actually appear as a floating window on top of the meeting, instead of hiding behind it until the meeting ended.",
  "THE TOWN PLAYS BACK: rivals start mid-flight — releases every week or two, announced release dates, and they'll blink if you crowd their weekend.",
  "PACKAGING SESSIONS: you now assemble each picture — pick the director and leads from real candidates. Agents call. Agents always call.",
  "PREMIERE NIGHT: your releases end with a red carpet, a crowd, and a toast.",
  "BROKEN-MOVIE TRIAGE: bad screening? Reshoot, recut, dump it in January, or sell it to a rival.",
  "BOARD NOTES: mandates with deadlines. Winning quarters get a winner's script.",
  "NEW: weekly box-office chart, incident logs, test screenings, press tours, lunches, the Sundown Festival, diva demands, and an annual 'ones that got away' recap.",
  "FIXES: prepro burn shows real $/day, pitch subjects match the pitch, calendar keeps its past (crossed out), skip-to-next-event stops on outcomes too.",
];
