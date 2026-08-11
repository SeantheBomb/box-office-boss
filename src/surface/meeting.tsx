// The dialogue-encounter scene. Remounted per meeting via key (back-to-back queue safe).
// Counterpart dossier is one click away — you always know who you're talking to.

import { useEffect, useMemo, useState } from "preact/hooks";
import type { Sim } from "../kernel/sim";
import type { SimEvent } from "../kernel/types";
import { MeetingSession, type Beat } from "../kernel/meetings";
import { GroupPortrait } from "./portraits";
import { Portrait2 } from "./portraits2";
import type { OpenDossier } from "./dossiers";
import { money } from "../kernel/text";
import { audio, guessSentiment } from "./audio";

const SCENE_CLASS: Record<string, string> = {
  meetingRoom: "meetingRoom",
  stage: "stage",
  conStage: "conStage",
  dinner: "dinner",
  office: "office-scene",
};

export function MeetingScene({ sim, event, onDone, openDossier }: { sim: Sim; event: SimEvent; onDone: () => void; openDossier: OpenDossier }) {
  const session = useMemo(() => new MeetingSession(sim, event), [event.id]);
  const [beat, setBeat] = useState<Beat>(() => session.start());
  const meetingDef = sim.content.meetings[event.type] ?? {};
  const sceneClass = SCENE_CLASS[meetingDef.scene] ?? "meetingRoom";
  const person = beat.portraitId ? sim.person(beat.portraitId) : undefined;
  const movie = sim.movie(event.data.movieId);
  // meeting sting on entry; premiere gets the paparazzi treatment
  useEffect(() => {
    audio.sfx("meeting", 0.8);
    if (event.type === "premiere") setTimeout(() => audio.sfx("camera"), 600);
    if (event.type === "awards") setTimeout(() => audio.sfx("applause", 0.5), 800);
  }, [event.id]);
  // every beat, the counterpart mumbles their feelings — Animal Crossing rules
  useEffect(() => {
    const sentiment = guessSentiment(beat.text);
    if (person) audio.mumble(person, sentiment);
    if (/applause|erupt|room stands|screams/i.test(beat.text)) audio.sfx("applause", 0.7);
    if (/flashbulb|paparazzi|camera/i.test(beat.text)) audio.sfx("camera", 0.6);
  }, [beat]);
  // number keys pick lines; Enter continues — no mouse required, no ambiguity about what's clickable
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (beat.done && (e.code === "Enter" || e.code === "Space")) {
        e.preventDefault();
        onDone();
        return;
      }
      const n = parseInt(e.key, 10);
      if (!beat.done && n >= 1 && n <= (beat.choices?.length ?? 0)) {
        setBeat(session.choose(beat.choices![n - 1].id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beat]);
  return (
    <div class={`meeting ${sceneClass}`}>
      <div class="counterpart">
        {person ? (
          <Portrait2 person={person} size={132} mood={Math.sign(person.relationship)} />
        ) : (
          <GroupPortrait kind={beat.portraitId ?? "board"} size={110} />
        )}
        <div class="name">{beat.speaker}</div>
        {person && (
          <div class="counterpart-stats">
            {person.role === "cast" && `${money(person.dailyRate ?? 0)}/day · coop ${person.cooperation} · improv ${person.improv} · fame ${person.fame}`}
            {person.role === "writer" && `craft ${person.avgRating} · ${person.capableGenres?.join("/")}`}
            {person.role === "director" && `craft ${person.avgRating} · ~${person.avgVfxShots} VFX · ${person.avgReshoots} reshoots`}
            {person.role === "producer" && `×${(person.avgProdCost ?? 1).toFixed(2)} cost · ×${(person.avgProdLength ?? 1).toFixed(2)} time`}
            <div>
              <a class="doss-link" onClick={() => openDossier("person", person.id)}>full dossier ▸</a>
              {movie && (
                <>
                  {" · "}
                  <a class="doss-link" onClick={() => openDossier("movie", movie.id)}>📁 {movie.title}</a>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div class="table" />
      <div class="dialogue">
        <div class="speaker">{meetingDef.title ?? event.type}</div>
        <div class="text">{beat.text}</div>
        {beat.done ? (
          <button class="continue" onClick={onDone}>Continue ▸ <span class="key-hint">(Enter)</span></button>
        ) : (
          <div class="choices">
            <div class="choose-label">— choose your line —</div>
            {(beat.choices ?? []).map((c, i) => (
              <button key={c.id} onClick={() => { audio.sfx("click", 0.5); setBeat(session.choose(c.id)); }}>
                <span class="choice-num">{i + 1}</span> “{c.line}”
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
