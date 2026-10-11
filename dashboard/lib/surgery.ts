import { kindOf, type Kind } from './instruments';
import type { Step } from './procedures';

// Turns the taps recorded during a surgery into instrument cycles and metrics.
// Each instrument's taps alternate: the 1st tap means it was taken from the
// tray, the 2nd that it was put back, the 3rd taken again, and so on.

export type SurgeryScan = { scanId?: number; time: string; rfidUid: string; name: string; manual?: boolean };
// A surgery keeps a snapshot of the plan it was started with.
export type Surgery = {
  id: number;
  procedureId: string;
  procedureName: string;
  surgeon: string;
  startedAt: string;
  endedAt: string | null;
  plan: Step[];
  estMinutes: number;
  alertMinutes: number;
};

export type Cycle = {
  uid: string;
  name: string;
  kind: Kind;
  takenAt: number;
  returnedAt: number | null; // null = still out
  corrected: boolean; // the take or return was entered by hand, not tapped
  stepIndex: number | null; // plan step this use was matched to, if any
  inOrder: boolean; // its step came after the previous matched use's step
};

export type ToolStats = { uid: string; name: string; kind: Kind; cycles: number; outMs: number; out: boolean; outSince: number | null };

export type Analysis = {
  startMs: number;
  endMs: number;
  durationMs: number;
  cycles: Cycle[];
  tools: ToolStats[];
  stepCycle: (number | null)[]; // for each plan step, the index of the cycle that fulfilled it
  nextStep: number | null; // earliest plan step not yet done
  stepsDone: number;
  inOrder: number; // matched cycles that followed the plan order
  unplanned: Cycle[];
  stillOut: Cycle[];
  busyMs: number; // time with at least one instrument out
  idleMs: number; // time with no instrument out
  longestIdleMs: number;
  firstToolMs: number | null; // from start until the first instrument was taken
  corrections: number; // taps entered by hand
};

export function analyze(scans: SurgeryScan[], steps: Step[], startMs: number, endMs: number): Analysis {
  const sorted = scans
    .map((s) => ({ ...s, t: new Date(s.time).getTime() }))
    .filter((s) => s.t >= startMs && s.t <= endMs)
    .sort((a, b) => a.t - b.t);

  // Pair each instrument's taps into take/return cycles.
  const byUid = new Map<string, typeof sorted>();
  for (const s of sorted) byUid.set(s.rfidUid, [...(byUid.get(s.rfidUid) ?? []), s]);
  const cycles: Cycle[] = [];
  for (const taps of byUid.values()) {
    for (let i = 0; i < taps.length; i += 2) {
      cycles.push({
        uid: taps[i].rfidUid,
        name: taps[i].name,
        kind: kindOf(taps[i].name),
        takenAt: taps[i].t,
        returnedAt: taps[i + 1]?.t ?? null,
        corrected: !!taps[i].manual || !!taps[i + 1]?.manual,
        stepIndex: null,
        inOrder: false,
      });
    }
  }
  cycles.sort((a, b) => a.takenAt - b.takenAt);

  // Match each use, in the order instruments were taken, to the earliest
  // pending plan step for that instrument type. A use is "in order" when its
  // step comes after the previous matched use's step - so skipping a step
  // doesn't make everything after it count as out of order.
  const stepCycle: (number | null)[] = steps.map(() => null);
  let lastStep = -1;
  cycles.forEach((c, ci) => {
    const k = steps.findIndex((s, i) => stepCycle[i] === null && s.tool === c.kind);
    if (k < 0) return;
    c.inOrder = k > lastStep;
    lastStep = Math.max(lastStep, k);
    c.stepIndex = k;
    stepCycle[k] = ci;
  });

  // Busy/idle time from the union of "instrument out" intervals.
  const ivs = cycles.map((c) => [c.takenAt, c.returnedAt ?? endMs] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const iv of ivs) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }
  const busyMs = merged.reduce((a, [s, e]) => a + (e - s), 0);
  let longestIdleMs = 0;
  let cursor = startMs;
  for (const [s, e] of merged) { longestIdleMs = Math.max(longestIdleMs, s - cursor); cursor = Math.max(cursor, e); }
  longestIdleMs = Math.max(longestIdleMs, endMs - cursor);

  const tools = new Map<string, ToolStats>();
  for (const c of cycles) {
    const t = tools.get(c.uid) ?? { uid: c.uid, name: c.name, kind: c.kind, cycles: 0, outMs: 0, out: false, outSince: null };
    t.cycles += 1;
    t.outMs += (c.returnedAt ?? endMs) - c.takenAt;
    if (c.returnedAt === null) { t.out = true; t.outSince = c.takenAt; }
    tools.set(c.uid, t);
  }

  const durationMs = endMs - startMs;
  const next = stepCycle.indexOf(null);
  return {
    startMs,
    endMs,
    durationMs,
    cycles,
    tools: [...tools.values()],
    stepCycle,
    nextStep: next < 0 ? null : next,
    stepsDone: stepCycle.filter((x) => x !== null).length,
    inOrder: cycles.filter((c) => c.stepIndex !== null && c.inOrder).length,
    unplanned: cycles.filter((c) => c.stepIndex === null),
    stillOut: cycles.filter((c) => c.returnedAt === null),
    busyMs,
    idleMs: Math.max(0, durationMs - busyMs),
    longestIdleMs,
    firstToolMs: cycles.length ? cycles[0].takenAt - startMs : null,
    corrections: sorted.filter((s) => s.manual).length,
  };
}

export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};
