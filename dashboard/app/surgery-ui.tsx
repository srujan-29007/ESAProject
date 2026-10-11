"use client";

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { KIND_LABEL } from '@/lib/instruments';
import type { Procedure, Step } from '@/lib/procedures';
import { fmtClock, fmtDuration, type Analysis, type Cycle, type Surgery } from '@/lib/surgery';
import { InstrumentIcon, readPass, savePass } from './ui';
import { kindOf, type Kind } from '@/lib/instruments';

export type ToolRow = { uid: string; name: string; color: string };
export type SurgerySummary = Surgery & { procedureName: string; durationMs: number; cycles: number; stepsDone: number; stepsTotal: number; stillOut: number };

const fmtWall = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Sends a request with the stored admin passcode (or `pass`). Resolves to the
// JSON body, or throws 'PASSCODE' (missing/wrong) / an error message.
export async function adminSend<T>(method: 'POST' | 'PATCH', url: string, body: unknown, pass: string | null): Promise<T> {
  const passcode = pass ?? readPass();
  if (!passcode) throw new Error('PASSCODE');
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'x-admin-passcode': passcode }, body: JSON.stringify(body) });
  if (r.status === 401) { savePass(null); throw new Error('PASSCODE'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? 'Something went wrong');
  savePass(passcode);
  return data as T;
}
export const adminPost = <T,>(url: string, body: unknown, pass: string | null) => adminSend<T>('POST', url, body, pass);

export function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <div className={`card-in my-6 w-full ${wide ? 'max-w-3xl' : 'max-w-md'} rounded-lg border border-slate-200 bg-white shadow-md`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function PassField({ value, onChange, onEnter, autoFocus }: { value: string; onChange: (v: string) => void; onEnter: () => void; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-amber-800">Admin passcode</span>
      <input
        type="password" inputMode="numeric" value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
        className="mt-1.5 w-full rounded-lg bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-amber-300 focus:ring-2 focus:ring-amber-500"
      />
    </label>
  );
}

export function StartSurgeryDialog({ procedures, onClose, onStarted }: { procedures: Procedure[]; onClose: () => void; onStarted: (s: Surgery) => void }) {
  const [procId, setProcId] = useState(procedures[0]?.id ?? '');
  const [surgeon, setSurgeon] = useState('');
  const [needPass, setNeedPass] = useState(() => !readPass());
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const proc = procedures.find((p) => p.id === procId);

  const start = async () => {
    if (!proc) return setError('Choose a procedure');
    if (!surgeon.trim()) return setError("Enter the surgeon's name");
    if (needPass && !pass) return setError('Enter the admin passcode');
    setBusy(true); setError(null);
    try {
      onStarted(await adminPost<Surgery>('/api/surgeries', { procedureId: procId, surgeon }, needPass ? pass : null));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'PASSCODE') { setError(needPass ? 'Wrong passcode' : 'Enter the admin passcode'); setNeedPass(true); }
      else setError(msg);
    } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} wide>
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Start Surgery</h2>
        <p className="text-sm text-slate-600">Choose the procedure. A recommended instrument plan is shown during the surgery - the surgeon can use instruments in any order.</p>
      </div>
      <div className="grid gap-5 p-6 md:grid-cols-[1fr_1fr]">
        <div className="space-y-2.5">
          <div className="text-[11px] font-bold text-slate-500">Procedure</div>
          {procedures.length === 0 && <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 ring-1 ring-slate-200">No procedures yet - add one on the <Link href="/procedures" className="font-semibold text-blue-700">Procedures</Link> page.</div>}
          {procedures.map((p) => (
            <button key={p.id} onClick={() => setProcId(p.id)}
              className={`w-full rounded-md px-4 py-3 text-left ring-1 transition ${p.id === procId ? 'bg-blue-50 ring-blue-300' : 'bg-slate-50 ring-slate-200 hover:ring-slate-300'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{p.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-slate-500">~{p.estMinutes} min</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-600">{p.summary}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {proc && (
            <div className="rounded-md bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-700">Recommended plan · {proc.steps.length} steps</div>
              <ol className="mt-2.5 space-y-2">
                {proc.steps.map((st, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs text-slate-600">{i + 1}</span>
                    <span className="mt-0.5 text-blue-700"><InstrumentIcon kind={st.tool} size={15} /></span>
                    <span><span className="font-medium text-slate-900">{KIND_LABEL[st.tool]}</span> <span className="text-slate-600">- {st.purpose}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <label className="block">
            <span className="text-[11px] font-bold text-slate-500">Surgeon</span>
            <input value={surgeon} maxLength={60} placeholder="e.g. Dr. A. Kumar" autoFocus
              onChange={(e) => { setSurgeon(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
              className="mt-1.5 w-full rounded-lg bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500" />
          </label>
          {needPass && <PassField value={pass} onChange={(v) => { setPass(v); setError(null); }} onEnter={start} />}
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            Make sure every instrument is in the tray before starting. During the surgery, the 1st tap of an instrument means it was <b>taken</b> and the 2nd tap that it was <b>returned</b>.
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-200">Cancel</button>
        <button onClick={start} disabled={busy} className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {busy ? 'Starting…' : 'Start Surgery'}
        </button>
      </div>
    </Modal>
  );
}

export function EndSurgeryDialog({ surgery, stillOut, onClose, onEnded }: {
  surgery: Surgery; stillOut: Cycle[]; onClose: () => void; onEnded: (s: Surgery) => void;
}) {
  const [needPass, setNeedPass] = useState(() => !readPass());
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const end = async () => {
    if (needPass && !pass) return setError('Enter the admin passcode');
    setBusy(true); setError(null);
    try {
      onEnded(await adminPost<Surgery>(`/api/surgeries/${surgery.id}/end`, {}, needPass ? pass : null));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'PASSCODE') { setError(needPass ? 'Wrong passcode' : 'Enter the admin passcode'); setNeedPass(true); }
      else setError(msg);
    } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">End surgery?</h2>
        {stillOut.length > 0 ? (
          <div className="rounded-md bg-red-50 p-4 ring-1 ring-red-200">
            <div className="flex items-center gap-2 text-sm font-bold text-red-700">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              {stillOut.length} instrument{stillOut.length === 1 ? ' is' : 's are'} not back in the tray
            </div>
            <ul className="mt-2 space-y-1 text-sm text-red-800">
              {stillOut.map((c) => <li key={c.uid}>• {c.name} - out since {fmtWall(c.takenAt)}</li>)}
            </ul>
            <div className="mt-2 text-xs text-red-700">Tap them on the reader as they go back, or end anyway and they will be flagged in the report.</div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">All instruments are back in the tray. The surgery report will be saved.</p>
        )}
        {needPass && <PassField autoFocus value={pass} onChange={(v) => { setPass(v); setError(null); }} onEnter={end} />}
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-200">Keep going</button>
        <button onClick={end} disabled={busy} className="rounded-lg bg-red-700 px-5 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50">
          {busy ? 'Ending…' : stillOut.length ? 'End anyway' : 'End Surgery'}
        </button>
      </div>
    </Modal>
  );
}

// Gantt-style timeline: one row per instrument, a bar for every time it was out of the tray.
export function SurgeryTimeline({ analysis, rows, steps }: { analysis: Analysis; rows: ToolRow[]; steps: Step[] }) {
  const [hover, setHover] = useState<Cycle | null>(null);
  const { startMs, endMs } = analysis;
  const span = Math.max(endMs - startMs, 60_000);
  const pct = (t: number) => ((t - startMs) / span) * 100;
  const tick = [15, 30, 60, 120, 300, 600, 900, 1800, 3600].map((s) => s * 1000).find((s) => span / s <= 8) ?? 3600_000;
  const ticks = Array.from({ length: Math.floor(span / tick) + 1 }, (_, i) => i * tick);
  const all = [...rows, ...analysis.tools.filter((t) => !rows.some((r) => r.uid === t.uid)).map((t) => ({ uid: t.uid, name: t.name, color: '#5b6670' }))];

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="space-y-2">
        {all.map((r) => (
          <div key={r.uid} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-xs font-medium text-slate-700 sm:w-36">{r.name}</div>
            <div className="relative h-6 flex-1 rounded bg-slate-50">
              {ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: `${(t / span) * 100}%` }} />)}
              {analysis.cycles.filter((c) => c.uid === r.uid).map((c, i) => {
                const end = c.returnedAt ?? endMs;
                return (
                  <div key={i}
                    onMouseEnter={() => setHover(c)}
                    className={`absolute inset-y-1 cursor-default rounded-[4px] ${c.returnedAt === null ? 'tool-out' : ''} ${hover === c ? 'ring-2 ring-slate-900/60' : ''}`}
                    style={{ left: `${pct(c.takenAt)}%`, width: `max(${pct(end) - pct(c.takenAt)}%, 4px)`, background: r.color, opacity: hover && hover !== c ? 0.45 : 1 }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="relative ml-[124px] mt-1.5 h-4 sm:ml-[156px]">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 font-mono text-xs text-slate-500" style={{ left: `${(t / span) * 100}%` }}>{fmtClock(t)}</span>
        ))}
      </div>
      {hover && (
        <div className="pointer-events-none absolute right-0 top-0 z-10 w-64 rounded-md bg-white px-3.5 py-2.5 text-xs shadow-md ring-1 ring-slate-200">
          <div className="font-semibold text-slate-900">{hover.name}</div>
          <div className="mt-1 text-slate-700">Taken at T+{fmtClock(hover.takenAt - startMs)} ({fmtWall(hover.takenAt)})</div>
          <div className="text-slate-700">{hover.returnedAt ? `Returned at T+${fmtClock(hover.returnedAt - startMs)} · out ${fmtDuration(hover.returnedAt - hover.takenAt)}` : 'Not returned yet'}</div>
          <div className="mt-1 text-slate-600">{hover.stepIndex !== null ? `Step ${hover.stepIndex + 1}: ${steps[hover.stepIndex].purpose}` : 'Unplanned use'}</div>
        </div>
      )}
    </div>
  );
}

const MUTE_KEY = 'or-alerts-muted';

// Soft two-tone chime for new alerts (Web Audio, no sound files).
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.32);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.35);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

// The live view while a surgery is running. `onCorrect` records a manual
// take/return for an instrument whose tap was missed; it resolves to an error message or null.
export function LiveSurgeryPanel({ surgery, analysis, rows, now, onEnd, onCorrect }: {
  surgery: Surgery; analysis: Analysis; rows: ToolRow[]; now: number; onEnd: () => void; onCorrect: (uid: string) => Promise<string | null>;
}) {
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const played = useRef(new Set<string>());
  useEffect(() => { const t = setTimeout(() => { try { setMuted(localStorage.getItem(MUTE_KEY) === '1'); } catch {} }, 0); return () => clearTimeout(t); }, []);

  const steps = surgery.plan;
  const toolState = (uid: string) => analysis.tools.find((t) => t.uid === uid);
  const limitMs = surgery.alertMinutes * 60_000;
  const elapsed = now - analysis.startMs;
  const overtime = surgery.estMinutes > 0 && elapsed > surgery.estMinutes * 60_000;
  const alerts = [
    ...analysis.tools.filter((t) => t.out && t.outSince !== null && now - t.outSince > limitMs).map((t) => ({
      key: `${t.uid}-${t.outSince}`,
      text: <><b>{t.name}</b> has been out of the tray for <b className="font-mono">{fmtClock(now - t.outSince!)}</b> (alert after {surgery.alertMinutes} min).</>,
    })),
    ...(overtime ? [{ key: 'overtime', text: <>Surgery is running over its estimated <b>{surgery.estMinutes} min</b>.</> }] : []),
  ];
  const alertKeys = alerts.map((a) => a.key).join('|');
  useEffect(() => {
    const fresh = alertKeys.split('|').filter((k) => k && !played.current.has(k));
    if (!fresh.length) return;
    fresh.forEach((k) => played.current.add(k));
    if (!muted) chime();
  }, [alertKeys, muted]);

  const toggleMute = () => { const m = !muted; setMuted(m); try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch {} };
  const fix = async (uid: string) => {
    setBusy(uid); setFixError(null);
    const err = await onCorrect(uid);
    setBusy(null);
    if (err) setFixError(err);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-blue-50/60 px-5 py-4">
        <div className="flex items-center gap-4">
          <span className="h-3 w-3 rounded-full bg-red-600" />
          <div>
            <div className="text-xs font-bold text-red-700">Surgery in progress</div>
            <div className="text-lg font-semibold text-slate-900">{surgery.procedureName}</div>
            <div className="text-xs text-slate-600">Surgeon: <span className="text-slate-800">{surgery.surgeon}</span> · started {new Date(surgery.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={toggleMute} title={muted ? 'Alert sound is off' : 'Alert sound is on'} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4z" />{muted ? <path d="m22 9-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
            </svg>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <div className="text-right">
            <div className="text-xs font-bold text-slate-500">Elapsed</div>
            <div className={`font-mono text-3xl font-semibold tabular-nums ${overtime ? 'text-amber-700' : 'text-slate-900'}`}>{fmtClock(elapsed)}</div>
          </div>
          <button onClick={onEnd} className="rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-800">End Surgery</button>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-1 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
          {alerts.map((a) => (
            <div key={a.key} className="flex items-center gap-2 text-sm text-amber-900">
              <svg className="shrink-0 text-amber-600" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-px bg-slate-100 lg:grid-cols-[1.25fr_1fr]">
        {/* Recommended plan */}
        <div className="bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">Recommended plan</div>
            <div className="font-mono text-xs text-slate-600">{analysis.stepsDone}/{steps.length} done</div>
          </div>
          <ol className="space-y-1.5">
            {steps.map((st, i) => {
              const ci = analysis.stepCycle[i];
              const c = ci !== null ? analysis.cycles[ci] : null;
              const isNext = analysis.nextStep === i;
              return (
                <li key={i} className={`flex items-center gap-3 rounded-md px-3 py-2 ring-1 ${c ? 'bg-emerald-50 ring-emerald-200' : isNext ? 'bg-blue-50 ring-blue-300' : 'ring-transparent'}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${c ? 'bg-emerald-600 text-white' : isNext ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {c ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg> : i + 1}
                  </span>
                  <span className={c ? 'text-emerald-700' : isNext ? 'text-blue-700' : 'text-slate-500'}><InstrumentIcon kind={st.tool} size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${c || isNext ? 'text-slate-900' : 'text-slate-600'}`}><span className="font-semibold">{KIND_LABEL[st.tool]}</span> - {st.purpose}</div>
                  </div>
                  <span className="shrink-0 text-right font-mono text-[11px] text-slate-500">
                    {c ? <>T+{fmtClock(c.takenAt - analysis.startMs)}{!c.inOrder && <span className="ml-1.5 rounded bg-amber-50 px-1 font-sans text-amber-800">out of order</span>}</> : isNext ? <span className="font-sans font-semibold text-blue-700">Next</span> : ''}
                  </span>
                </li>
              );
            })}
          </ol>
          {analysis.unplanned.length > 0 && (
            <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
              <span className="font-semibold text-slate-700">Unplanned uses:</span>{' '}
              {analysis.unplanned.map((c) => `${c.name} at T+${fmtClock(c.takenAt - analysis.startMs)}`).join(' · ')}
            </div>
          )}
        </div>

        {/* Instruments now, with manual correction */}
        <div className="bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">Instruments now</div>
            <div className="font-mono text-xs text-slate-600">{analysis.cycles.length} cycle{analysis.cycles.length === 1 ? '' : 's'}</div>
          </div>
          <ul className="space-y-1.5">
            {rows.map((r) => {
              const t = toolState(r.uid);
              const over = !!t?.out && t.outSince !== null && now - t.outSince > limitMs;
              return (
                <li key={r.uid} className={`flex items-center gap-3 rounded-md px-3 py-2 ring-1 ${over ? 'bg-amber-100 ring-amber-400' : t?.out ? 'bg-amber-50 ring-amber-300' : 'bg-slate-50 ring-slate-200'}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{r.name}</span>
                  <span className="font-mono text-[11px] text-slate-500">{t ? `${t.cycles}×` : ''}</span>
                  {t?.out ? (
                    <span className="flex items-center gap-1.5 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      In use <span className="font-mono tabular-nums">{fmtClock(now - (t.outSince ?? now))}</span>
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">In tray</span>
                  )}
                  <button
                    onClick={() => fix(r.uid)} disabled={busy !== null}
                    title={t?.out ? 'The return tap was missed - record it now' : 'The take tap was missed - record it now'}
                    className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
                  >
                    {busy === r.uid ? 'Saving…' : t?.out ? 'Mark returned' : 'Mark taken'}
                  </button>
                </li>
              );
            })}
          </ul>
          {fixError && <div className="mt-2 text-xs text-red-600">{fixError}</div>}
          <p className="mt-2 text-[11px] text-slate-500">Missed or double tap? Use <b>Mark taken / Mark returned</b>. Corrections are flagged in the report.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200"><div className="text-slate-500">Idle (no instrument out)</div><div className="font-mono font-semibold text-slate-800">{fmtDuration(analysis.idleMs)}</div></div>
            <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200"><div className="text-slate-500">Estimate · instrument alert</div><div className="font-mono font-semibold text-slate-800">~{surgery.estMinutes} min · {surgery.alertMinutes} min</div></div>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 px-5 py-4">
        <div className="mb-3 text-sm font-semibold text-slate-800">Instrument timeline</div>
        {analysis.cycles.length ? <SurgeryTimeline analysis={analysis} rows={rows} steps={steps} /> : <div className="py-3 text-sm text-slate-500">Tap an instrument on the reader when it is taken from the tray.</div>}
      </div>
    </section>
  );
}

// Asks for the admin passcode, checks it with the server, saves it, then runs `then`.
export function PasscodeDialog({ onClose, then }: { onClose: () => void; then: () => void }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!pass) return setError('Enter the admin passcode');
    const r = await fetch('/api/auth/check', { method: 'POST', headers: { 'x-admin-passcode': pass } });
    if (!r.ok) return setError('Wrong passcode');
    savePass(pass); onClose(); then();
  };
  return (
    <Modal onClose={onClose}>
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Admin passcode needed</h2>
        <PassField autoFocus value={pass} onChange={(v) => { setPass(v); setError(null); }} onEnter={submit} />
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
        <button onClick={onClose} className="rounded-md px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
        <button onClick={submit} className="rounded-md bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800">Continue</button>
      </div>
    </Modal>
  );
}

export function SurgeryRecords({ items, loaded }: { items: SurgerySummary[]; loaded: boolean }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
        <h2 className="text-[11px] font-bold text-slate-600">Surgery Records</h2>
        <span className="text-[11px] text-slate-500">last {items.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs font-bold text-slate-500">
              <th className="px-5 py-2.5">Date</th><th className="py-2.5">Procedure</th><th className="py-2.5">Surgeon</th>
              <th className="py-2.5">Duration</th><th className="py-2.5">Cycles</th><th className="py-2.5">Plan</th><th className="py-2.5">Status</th><th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-slate-600">{new Date(s.startedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="py-3 font-medium text-slate-900">{s.procedureName}</td>
                <td className="py-3 text-slate-700">{s.surgeon}</td>
                <td className="py-3 font-mono text-xs text-slate-700">{fmtDuration(s.durationMs)}</td>
                <td className="py-3 font-mono text-xs text-slate-700">{s.cycles}</td>
                <td className="py-3 font-mono text-xs text-slate-700">{s.stepsDone}/{s.stepsTotal}</td>
                <td className="py-3">
                  {!s.endedAt ? <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">In progress</span>
                    : s.stillOut ? <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">⚠ {s.stillOut} left out</span>
                    : <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Completed</span>}
                </td>
                <td className="px-5 py-3 text-right"><Link href={`/surgery/${s.id}`} className="text-xs font-semibold text-blue-700 hover:text-blue-700">Report →</Link></td>
              </tr>
            ))}
            {loaded && items.length === 0 && <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-500">No surgeries recorded yet - press <b>Start Surgery</b> to begin one.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// --- Realistic instrument tray ------------------------------------------------

const ring = (cx: number, cy: number, rx: number, ry: number, t: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z` +
  `M${cx - rx + t} ${cy}a${rx - t} ${ry - t} 0 1 0 ${2 * (rx - t)} 0a${rx - t} ${ry - t} 0 1 0 ${-2 * (rx - t)} 0Z`;

// A tapered bar from (x1,y1) width w1 to (x2,y2) width w2.
const bar = (x1: number, y1: number, x2: number, y2: number, w1: number, w2: number) => {
  const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
  return `M${x1 + c * w1 / 2} ${y1 + sn * w1 / 2}L${x2 + c * w2 / 2} ${y2 + sn * w2 / 2}L${x2 - c * w2 / 2} ${y2 - sn * w2 / 2}L${x1 - c * w1 / 2} ${y1 - sn * w1 / 2}Z`;
};

// Stainless-steel instrument seen from above, with chrome shading and a cast shadow.
// `ghost` draws only the faint impression left on the tray when it's lifted.
function SteelInstrument({ kind, ghost = false }: { kind: Kind; ghost?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const fill = ghost ? 'rgba(40,52,64,0.10)' : `url(#st${id})`;
  const stroke = ghost ? 'rgba(40,52,64,0.22)' : '#4a535c';
  const shapes: string[] = [];
  const details: React.ReactNode[] = [];
  if (kind === 'scissors') {
    shapes.push(ring(40, 24, 18, 12, 4.6), ring(40, 66, 18, 12, 4.6), bar(55, 30, 150, 44, 6.5, 5), bar(55, 60, 150, 46, 6.5, 5),
      'M147 40.2L289 39.2Q304 40.6 297 44.6L147 46.6Z', 'M147 43.4L297 45.4Q303 49.6 289 50.8L147 49.8Z');
    if (!ghost) details.push(<circle key="p" cx="150" cy="45" r="5.2" fill={`url(#st${id})`} stroke="#4b545d" strokeWidth=".7" />, <path key="s" d="M146.8 45h6.4" stroke="#4b545d" strokeWidth="1" />);
  } else if (kind === 'clamp') {
    shapes.push(ring(36, 24, 16, 11, 4.4), ring(36, 66, 16, 11, 4.4), bar(50, 30, 168, 43, 6, 5), bar(50, 60, 168, 47, 6, 5),
      'M164 39.5h16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-16a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z',
      'M181 40C207 16 238 16 250 49.5L246.5 48.6C236.5 24 210 25 181 46Z', 'M181 50C207 74 238 74 250 40.5L246.5 41.4C236.5 66 210 65 181 44Z');
    if (!ghost) details.push(<path key="r" d="M92 36.5l3 2.4 3-2.4 3 2.4 3-2.4 3 2.4M92 53.5l3-2.4 3 2.4 3-2.4 3 2.4 3-2.4" fill="none" stroke="#4b545d" strokeWidth=".9" />);
  } else if (kind === 'forceps') {
    shapes.push('M14 40.5h9v9h-9a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3Z', 'M22 40.6L150 36.4L296 43.6L296 44.8L150 41.6L22 45Z', 'M22 49.4L150 53.6L296 46.4L296 45.2L150 48.4L22 45Z');
    if (!ghost) details.push(<path key="g" d={Array.from({ length: 9 }, (_, i) => `M${72 + i * 7} 38.4l0.6 2.6M${72 + i * 7} 51.6l0.6-2.6`).join('')} stroke="#4b545d" strokeWidth=".8" />);
  } else {
    shapes.push('M20 41h120a4 4 0 0 1 0 8H20a4 4 0 0 1 0-8Z', 'M140 44h150v2H140Z');
  }
  return (
    <svg viewBox="0 9 320 72" preserveAspectRatio="xMinYMid meet" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={`st${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="0.3" stopColor="#d3d9df" /><stop offset="0.5" stopColor="#7f8994" />
          <stop offset="0.7" stopColor="#c3cad1" /><stop offset="1" stopColor="#f2f4f6" />
        </linearGradient>
        <filter id={`sh${id}`} x="-5%" y="-25%" width="115%" height="170%">
          <feDropShadow dx="2.5" dy="3.5" stdDeviation="2" floodColor="#1b2631" floodOpacity="0.42" />
        </filter>
      </defs>
      <g filter={ghost ? undefined : `url(#sh${id})`}>
        {shapes.map((d, i) => <path key={i} d={d} fill={fill} fillRule="evenodd" stroke={stroke} strokeWidth=".6" strokeLinejoin="round" />)}
        {details}
      </g>
    </svg>
  );
}

const TRAY_POS_KEY = 'or-tray-pos';

// Floating, draggable window with a top-down stainless tray: each instrument in its
// place, or - while lifted during a surgery - just its outline and an "in use" tag.
export function TrayWindow({ analysis, rows, now, live }: { analysis: Analysis | null; rows: ToolRow[]; now: number; live: boolean }) {
  const [min, setMin] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (window.matchMedia('(max-width: 639px)').matches) { setMin(true); return; }
      try {
        const saved = JSON.parse(localStorage.getItem(TRAY_POS_KEY) ?? 'null');
        if (saved && typeof saved.x === 'number') setPos(saved);
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const clamp = (x: number, y: number) => {
    const w = box.current?.offsetWidth ?? 380, h = box.current?.offsetHeight ?? 300;
    return { x: Math.min(Math.max(8, x), window.innerWidth - w - 8), y: Math.min(Math.max(8, y), window.innerHeight - h - 8) };
  };
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    const r = box.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => { if (drag.current) setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy)); };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try { if (pos) localStorage.setItem(TRAY_POS_KEY, JSON.stringify(pos)); } catch {}
  };

  const outCount = analysis ? analysis.tools.filter((t) => t.out).length : 0;
  const events = (analysis?.cycles ?? [])
    .flatMap((c) => [{ t: c.takenAt, lifted: true, c }, ...(c.returnedAt ? [{ t: c.returnedAt, lifted: false, c }] : [])])
    .sort((a, b) => b.t - a.t)
    .slice(0, 4);
  const status = !live ? { text: 'No surgery', cls: 'bg-slate-100 text-slate-600' }
    : outCount ? { text: `${outCount} in use`, cls: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' }
    : { text: 'All in tray', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' };

  if (min) {
    return (
      <button onClick={() => setMin(false)}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-md">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h8M6 14h12" strokeLinecap="round" /></svg>
        Instrument tray
        <span className={`rounded px-1.5 py-0.5 ${status.cls}`}>{status.text}</span>
      </button>
    );
  }

  return (
    <div
      ref={box}
      className="fixed z-30 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-[0_12px_32px_rgba(15,31,51,0.22)]"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }}
    >
      <div
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        className="flex cursor-grab touch-none select-none items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 active:cursor-grabbing"
        title="Drag to move"
      >
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#94a3b8"><circle cx="8" cy="6" r="1.6" /><circle cx="16" cy="6" r="1.6" /><circle cx="8" cy="12" r="1.6" /><circle cx="16" cy="12" r="1.6" /><circle cx="8" cy="18" r="1.6" /><circle cx="16" cy="18" r="1.6" /></svg>
          <span className="text-sm font-semibold text-slate-800">Instrument tray</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${status.cls}`}>{status.text}</span>
          <button onClick={() => setMin(true)} title="Minimise" className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /></svg>
          </button>
        </div>
      </div>

      {/* Stainless tray, seen from above */}
      <div className="p-3">
        <div
          className="rounded-[10px] p-[7px]"
          style={{
            background: 'linear-gradient(180deg, #eef1f4 0%, #cfd5db 38%, #b9c0c7 100%)',
            border: '1px solid #9aa3ac',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.12), 0 2px 4px rgba(15,31,51,0.18)',
          }}
        >
          <div
            className="space-y-0.5 rounded-[6px] px-2 py-1.5"
            style={{
              backgroundColor: '#b9c0c7',
              backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.13) 0 1px, rgba(0,0,0,0.035) 1px 3px), linear-gradient(180deg, #c7cdd3 0%, #b4bcc4 55%, #bec5cc 100%)',
              boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.22), inset 0 -1px 0 rgba(255,255,255,0.5)',
            }}
          >
            {rows.map((r) => {
              const t = analysis?.tools.find((x) => x.uid === r.uid);
              const out = !!t?.out;
              return (
                <div key={r.uid} className="relative h-[64px]">
                  <div className="absolute inset-0"><SteelInstrument kind={kindOf(r.name)} ghost={out} /></div>
                  <div className="absolute bottom-0.5 right-1 flex items-center gap-1 rounded-sm bg-white/80 px-1 text-[10px] font-semibold text-slate-700">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />{r.name}
                  </div>
                  {out && t?.outSince != null && (
                    <div className="absolute right-1 top-1 -rotate-1 rounded-sm border border-amber-300 bg-[#fffdf4] px-2 py-0.5 text-right shadow-[1px_2px_3px_rgba(0,0,0,0.18)]">
                      <div className="text-[11px] font-bold text-amber-900">In use · {fmtClock(now - t.outSince)}</div>
                      <div className="text-[10px] text-slate-600">since {fmtWall(t.outSince)}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 px-3 py-2">
        {!live ? (
          <div className="text-xs text-slate-500">Lifts and returns are logged here while a surgery is running.</div>
        ) : events.length === 0 ? (
          <div className="text-xs text-slate-500">Tap an instrument on the reader when it is lifted from the tray.</div>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {events.map((e) => (
                <tr key={`${e.c.uid}-${e.t}`}>
                  <td className="w-14 py-0.5 font-mono text-slate-500">T+{fmtClock(e.t - (analysis?.startMs ?? 0))}</td>
                  <td className="py-0.5 text-slate-800">{e.c.name}</td>
                  <td className={`py-0.5 font-medium ${e.lifted ? 'text-amber-800' : 'text-emerald-700'}`}>{e.lifted ? 'Lifted' : `Returned (${fmtDuration(e.t - e.c.takenAt)})`}</td>
                  <td className="py-0.5 text-right font-mono text-slate-400">{fmtWall(e.t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
