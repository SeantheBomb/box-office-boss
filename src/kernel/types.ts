// State + content schemas. Everything tunable lives in content/ (the one rule).

// ---------- calendar ----------
export const DAYS_PER_WEEK = 7;
export const WEEKS_PER_SEASON = 12;
export const SEASONS = ["Winter", "Spring", "Summer", "Fall"] as const;
export const WEEKS_PER_YEAR = WEEKS_PER_SEASON * 4;
export const DAYS_PER_YEAR = WEEKS_PER_YEAR * DAYS_PER_WEEK;

export type Slot = "morning" | "afternoon" | "evening";

export interface CalDate {
  year: number; // 1-based
  season: number; // 0..3
  week: number; // 1..48 within year
  weekOfSeason: number; // 1..12
  dayOfWeek: number; // 0=Mon
  day: number; // absolute
}

export function calDate(day: number): CalDate {
  const year = Math.floor(day / DAYS_PER_YEAR) + 1;
  const dayOfYear = day % DAYS_PER_YEAR;
  const week = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;
  const season = Math.floor((week - 1) / WEEKS_PER_SEASON);
  return {
    year,
    season,
    week,
    weekOfSeason: ((week - 1) % WEEKS_PER_SEASON) + 1,
    dayOfWeek: dayOfYear % DAYS_PER_WEEK,
    day,
  };
}

export const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function fmtDate(day: number): string {
  const d = calDate(day);
  return `${DOW[d.dayOfWeek]} · WK ${d.week} · ${SEASONS[d.season].toUpperCase()} · YR ${d.year}`;
}

// ---------- people ----------
export type Role = "cast" | "director" | "writer" | "producer" | "vfx" | "critic" | "agent";

export interface Person {
  id: string;
  role: Role;
  name: string;
  gender: "M" | "F" | "NB";
  portraitSeed: number;
  archetype: string;
  alive: boolean;
  // shared
  filmography: FilmCredit[];
  relationship: number; // -100..100 with player
  // cast
  physique?: string;
  netWorth?: number;
  dailyRate?: number;
  cooperation?: number; // 0..100
  improv?: number; // 0..100
  rider?: string;
  fame?: number; // 0..100
  // director
  avgVfxShots?: number;
  avgCastSize?: number;
  avgLocations?: number;
  avgReshoots?: number;
  avgCastCooperation?: number; // how they run a set
  // writer
  capableGenres?: string[];
  // producer
  avgProdLength?: number; // multiplier
  avgProdCost?: number; // multiplier
  avgProdRevenue?: number; // multiplier
  // shared quality signal
  avgRating?: number; // 0..100 craft skill
  // critic
  outlet?: string;
  harshness?: number; // 0..1
  genreBias?: Record<string, number>;
  // scheduling
  busyUntil: number; // day; talent locked to a production until then
  signedByStudio?: number; // studio index currently employing
  agentId?: string; // cast & directors are repped
}

export interface Incident {
  day: number;
  kind: string;
  text: string; // the narrative as it was reported
  cost: number;
  delay: number;
  resolution?: string; // what you did about it
}

export interface Mandate {
  id: string;
  text: string;
  kind: "releaseSeason" | "beatRival" | "budgetCap" | "releaseCount";
  param: any;
  deadlineDay: number;
  done?: boolean;
  failed?: boolean;
}

export interface FilmCredit {
  movieId: string;
  title: string;
  role: Role;
  year: number;
  stars: number; // 0..5 critic avg
  profit: number;
}

export interface VfxStudio {
  id: string;
  name: string;
  dailyCost: number;
  maxDailyShots: number;
  avgRating: number;
}

// ---------- movies ----------
export type Phase =
  | "pitch"
  | "script"
  | "development" // script approved, waiting for a producer (no burn)
  | "prepro"
  | "production"
  | "post"
  | "release"
  | "distribute"
  | "done"
  | "cancelled";

export interface ShotBlock {
  location: number; // 1-based location index
  days: number;
  castIds: string[];
}

export interface Quality {
  script: number;
  direction: number;
  performance: number;
  vfx: number;
  polish: number;
}

export interface Movie {
  id: string;
  studio: number; // index into studios
  title: string;
  genre: string;
  subgenre: string;
  estRating: string; // G/PG/PG-13/R
  franchise?: string;
  sequelOf?: string;
  writerId: string;
  directorId?: string;
  castIds: string[];
  idealCastIds: string[];
  producerId?: string;
  vfxStudioId?: string;
  targetLength: number; // minutes
  minBudget: number;
  estVfx: number;
  actualVfx?: number;
  phase: Phase;
  phaseStart: number;
  phaseEnd: number; // planned day
  budget: number; // total committed
  spent: number;
  dailyCost: number;
  locations: number;
  quality: Quality;
  hype: number; // 0..100
  marketing: number; // $ spent
  releaseDay?: number;
  theaters?: number;
  weeklyGross: number[];
  revenue: number;
  homeRevenue: number;
  reviews: { criticId: string; stars: number; quote: string }[];
  fanScore?: number;
  setbackCount: number;
  awards: string[];
  screeningScore?: number;
  estRevenue?: number; // rough projection shown in pitch/dossier
  shotList?: ShotBlock[]; // built at pre-production wrap
  pitchLogline?: string;
  incidents: Incident[];
  announcedRelease?: number; // publicly dated (trades know) before the actual release event
  fromPassedPitch?: boolean; // you said no to this one — the trades remember
  acquired?: boolean; // festival pickup, not homegrown
  pressTours: number;
  testScreened?: boolean;
}

// ---------- studios ----------
export interface Studio {
  name: string;
  cash: number;
  isPlayer: boolean;
  persona?: string; // rival policy archetype
  riskAppetite?: number;
  genreBias?: Record<string, number>;
  history: { week: number; profit: number }[]; // weekly snapshots of REPORTED profit
  totalRevenue: number;
  totalSpent: number; // real spend (private)
  reportedSpend: number; // budgets posted as lump sums on release day (public)
  bankrupt?: boolean;
}

// ---------- audience ----------
export type Pref = "like" | "dislike" | "unknown";

export interface Segment {
  id: string;
  name: string;
  size: number; // millions of people
  channelTheater: number; // 0..1 preference for theaters vs home
  criticWeight: number; // 0..1
  genres: Record<string, Pref>;
  people: Record<string, Pref>; // personId -> pref (discovered)
  studios: Record<string, Pref>; // studio name -> pref
  franchises: Record<string, Pref>;
  hiddenGenres: Record<string, number>; // true affinity 0..1 (undiscovered)
}

export interface AudienceState {
  segments: Segment[];
  fads: Record<string, number>; // genre -> heat 0..2 (1 = neutral)
}

// ---------- calendar events ----------
export type MeetingType =
  | "pitch"
  | "casting"
  | "board"
  | "productionReview"
  | "convention"
  | "awards"
  | "execStandup"
  | "producersStandup";

export interface SimEvent {
  id: string;
  day: number;
  slot: Slot;
  kind: "meeting" | "outcome";
  type: string; // meeting: MeetingType; outcome: outcome type
  data: Record<string, any>;
}

// ---------- email ----------
export interface EmailAction {
  id: string;
  label: string;
}

export interface Email {
  id: string;
  day: number;
  from: string;
  fromRole: string;
  subject: string;
  body: string; // may contain {report:...} embeds
  read: boolean;
  actions: EmailAction[];
  actionTaken?: string;
  ctx: Record<string, any>;
  embed?: { kind: "standings" | "funnel"; movieId?: string };
}

// ---------- run state ----------
export interface DecisionRecord {
  day: number;
  kind: string;
  ref: string;
  choice: string;
}

export interface RunState {
  seed: number;
  day: number;
  timeOfDay: number; // 0..1 fraction of day elapsed (visual + slot gating)
  studios: Studio[];
  people: Person[];
  vfxStudios: VfxStudio[];
  movies: Movie[];
  audience: AudienceState;
  events: SimEvent[];
  inbox: Email[];
  patience: number; // 0..100 board patience (hidden)
  patienceTier: number; // 0 warm..3 hostile (derived, but stored for tone continuity)
  decisions: DecisionRecord[];
  nextId: number;
  gameOver?: { kind: "bankrupt" | "fired"; day: number; epitaph?: string };
  flags: Record<string, any>;
  eventLog: SimEvent[]; // processed events, for the calendar's past (capped)
  mandates: Mandate[];
  weekChart: { movieId: string; gross: number }[]; // this week's box office, ranked
}

export interface PendingMeeting {
  event: SimEvent;
  // runtime dialogue state handled by surface
}

// ---------- content ----------
export interface Content {
  game: any;
  people: any;
  pitches: any;
  setbacks: any;
  audience: any;
  economy: any;
  templates: Record<string, any>;
  meetings: any;
}
