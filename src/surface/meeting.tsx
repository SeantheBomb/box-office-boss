// The dialogue-encounter scene: renders MeetingSession beats, one meeting at a time.

import { useMemo, useState } from "preact/hooks";
import type { Sim } from "../kernel/sim";
import type { SimEvent } from "../kernel/types";
import { MeetingSession, type Beat } from "../kernel/meetings";
import { Portrait, GroupPortrait } from "./portraits";

const SCENE_CLASS: Record<string, string> = {
  meetingRoom: "meetingRoom",
  stage: "stage",
  conStage: "conStage",
  dinner: "dinner",
  office: "office-scene",
};

export function MeetingScene({ sim, event, onDone }: { sim: Sim; event: SimEvent; onDone: () => void }) {
  const session = useMemo(() => new MeetingSession(sim, event), [event.id]);
  const [beat, setBeat] = useState<Beat>(() => session.start());
  const meetingDef = sim.content.meetings[event.type] ?? {};
  const sceneClass = SCENE_CLASS[meetingDef.scene] ?? "meetingRoom";
  const person = beat.portraitId ? sim.person(beat.portraitId) : undefined;
  return (
    <div class={`meeting ${sceneClass}`}>
      <div class="counterpart">
        {person ? (
          <Portrait seed={person.portraitSeed} size={110} mood={Math.sign(person.relationship)} />
        ) : (
          <GroupPortrait kind={beat.portraitId ?? "board"} size={110} />
        )}
        <div class="name">{beat.speaker}</div>
      </div>
      <div class="table" />
      <div class="dialogue">
        <div class="speaker">{meetingDef.title ?? event.type}</div>
        <div class="text">{beat.text}</div>
        {beat.done ? (
          <button class="continue" onClick={onDone}>Continue ▸</button>
        ) : (
          <div class="choices">
            {(beat.choices ?? []).map((c) => (
              <button key={c.id} onClick={() => setBeat(session.choose(c.id))}>
                “{c.line}”
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
