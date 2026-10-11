"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { KIND_LABEL } from '@/lib/instruments';
import { analyze, fmtClock, fmtDuration, type Surgery, type SurgeryScan } from '@/lib/surgery';
import { InstrumentIcon, PageHeader, SERIES, OTHER, Skeleton } from '../../ui';
import { SurgeryTimeline } from '../../surgery-ui';
import { FloatingIcons } from '../../effects';

type Tag = { id: number; rfidUid: string; name: string; active?: boolean };

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-3.5">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${tone === 'bad' ? 'bg-red-500' : tone === 'good' ? 'bg-emerald-400' : 'bg-blue-600'}`} />
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const fmtWall = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function SurgeryReport() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ surgery: Surgery; scans: SurgeryScan[] } | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/surgeries/${id}`).then(async (r) => (r.ok ? setData(await r.json()) : setError('Surgery not found'))).catch(() => setError('Could not load the report'));
    fetch('/api/tags').then((r) => r.json()).then(setTags).catch(() => {});
  }, [id]);

  const card = 'rounded-lg border border-slate-200 bg-white';
  const title = 'text-[11px] font-bold text-slate-600';

  if (error) return <div className="flex min-h-screen items-center justify-center bg-[#f3f5f8] text-slate-600">{error} · <Link href="/" className="ml-2 text-blue-700">Back to dashboard</Link></div>;

  const surgery = data?.surgery;
  // The plan snapshot the surgery was started with.
  const proc = surgery ? { name: surgery.procedureName, estMinutes: surgery.estMinutes, steps: surgery.plan } : null;
  const startMs = surgery ? new Date(surgery.startedAt).getTime() : 0;
  // eslint-disable-next-line react-hooks/purity -- an in-progress surgery's report is a snapshot up to "now"
  const endMs = surgery ? (surgery.endedAt ? new Date(surgery.endedAt).getTime() : Date.now()) : 0;
  const a = data && proc ? analyze(data.scans, proc.steps, startMs, endMs) : null;

  const allTags = tags.filter((t) => !t.rfidUid.startsWith('TAG_'));
  const colorOf = (uid: string) => { const i = allTags.findIndex((t) => t.rfidUid === uid); return i >= 0 && i < SERIES.length ? SERIES[i] : OTHER; };
  // Instruments in use, plus any retired one that was used in this surgery.
  const rows = allTags
    .filter((t) => t.active !== false || a?.tools.some((x) => x.uid === t.rfidUid))
    .map((t) => ({ uid: t.rfidUid, name: t.name, color: colorOf(t.rfidUid) }));

  return (
    <div className="min-h-screen bg-[#f3f5f8] font-sans text-slate-900">
      <div className="print:hidden"><FloatingIcons /></div>
      <PageHeader right={<button onClick={() => window.print()} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700">Print / Save PDF</button>} />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-8">
        <Link href="/" className="text-sm font-medium text-slate-600 hover:text-blue-700 print:hidden">← Back to dashboard</Link>

        {!a || !surgery || !proc ? (
          <div className="space-y-4"><Skeleton className="h-24" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-48" /></div>
        ) : (
          <>
            <header className="border-b border-slate-200 pb-5">
              <div className="text-xs font-bold text-blue-700">Surgery report · #{surgery.id}</div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{proc.name}</h1>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                <span>Surgeon: <span className="text-slate-800">{surgery.surgeon}</span></span>
                <span>{new Date(startMs).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span className="font-mono">{fmtWall(startMs)} – {surgery.endedAt ? fmtWall(endMs) : 'in progress'}</span>
                {!surgery.endedAt && <span className="rounded-md bg-red-50 px-2 font-bold text-red-700">In progress</span>}
              </div>
            </header>

            {a.stillOut.length > 0 && (
              <div className="flex items-start gap-3 rounded-md bg-red-50 px-4 py-3 ring-1 ring-red-200">
                <svg className="mt-0.5 shrink-0 text-red-700" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                <div className="text-sm text-red-800">
                  <span className="font-bold">{a.stillOut.length} instrument{a.stillOut.length === 1 ? ' was' : 's were'} not returned to the tray</span>
                  {surgery.endedAt ? ' when the surgery ended' : ' yet'}: {a.stillOut.map((c) => `${c.name} (taken at T+${fmtClock(c.takenAt - startMs)})`).join(', ')}.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Duration" value={fmtDuration(a.durationMs)} sub={`estimate ~${proc.estMinutes} min`} />
              <Stat label="Instrument cycles" value={a.cycles.length} sub={`${a.tools.length} different instruments`} />
              <Stat label="Plan steps covered" value={<>{a.stepsDone}<span className="text-base text-slate-500">/{proc.steps.length}</span></>} sub={`${pctOf(a.stepsDone, proc.steps.length)}% of the recommended plan`} tone={a.stepsDone === proc.steps.length ? 'good' : undefined} />
              <Stat label="In planned order" value={`${pctOf(a.inOrder, a.stepsDone)}%`} sub={`${a.inOrder} of ${a.stepsDone} matched uses`} />
              <Stat label="Idle time" value={fmtDuration(a.idleMs)} sub={`${pctOf(a.idleMs, a.durationMs)}% with no instrument out`} />
              <Stat label="Longest idle gap" value={fmtDuration(a.longestIdleMs)} />
              <Stat label="First instrument" value={a.firstToolMs !== null ? `T+${fmtClock(a.firstToolMs)}` : '—'} sub="after the start" />
              <Stat label="Not returned" value={a.stillOut.length} tone={a.stillOut.length ? 'bad' : 'good'} sub={a.stillOut.length ? 'check the tray' : 'all instruments back'} />
              {a.corrections > 0 && <Stat label="Manual corrections" value={a.corrections} sub="taps entered by hand (missed or double taps)" />}
            </div>

            <section className={card}>
              <div className="border-b border-slate-200 px-5 py-3.5"><h2 className={title}>Instrument timeline</h2></div>
              <div className="p-5">
                {a.cycles.length ? <SurgeryTimeline analysis={a} rows={rows} steps={proc.steps} /> : <div className="text-sm text-slate-500">No instruments were used.</div>}
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
              <section className={card}>
                <div className="border-b border-slate-200 px-5 py-3.5"><h2 className={title}>Recommended plan vs actual</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="text-left text-xs font-bold text-slate-500">
                      <th className="px-5 py-2.5">#</th><th className="py-2.5">Instrument · purpose</th><th className="py-2.5">Used at</th><th className="py-2.5">Time out</th><th className="px-5 py-2.5">Order</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {proc.steps.map((st, i) => {
                        const ci = a.stepCycle[i];
                        const c = ci !== null ? a.cycles[ci] : null;
                        return (
                          <tr key={i}>
                            <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{i + 1}</td>
                            <td className="py-2.5"><span className="inline-flex items-center gap-2"><span className="text-blue-700"><InstrumentIcon kind={st.tool} size={15} /></span><span className="font-medium text-slate-900">{KIND_LABEL[st.tool]}</span></span><div className="text-xs text-slate-600">{st.purpose}</div></td>
                            <td className="py-2.5 font-mono text-xs text-slate-700">{c ? `T+${fmtClock(c.takenAt - startMs)}` : '—'}</td>
                            <td className="py-2.5 font-mono text-xs text-slate-700">{c ? (c.returnedAt ? fmtDuration(c.returnedAt - c.takenAt) : 'not returned') : '—'}{c?.corrected && <span title="Take or return entered by hand" className="ml-1.5 rounded bg-slate-100 px-1 font-sans text-[10px] text-slate-600">corrected</span>}</td>
                            <td className="px-5 py-2.5">{!c ? <span className="text-xs text-slate-500">skipped</span> : c.inOrder ? <span className="text-xs font-semibold text-emerald-700">✓ in order</span> : <span className="text-xs font-semibold text-amber-800">out of order</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {a.unplanned.length > 0 && (
                  <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Unplanned uses ({a.unplanned.length}):</span>{' '}
                    {a.unplanned.map((c) => `${c.name} at T+${fmtClock(c.takenAt - startMs)}${c.returnedAt ? ` for ${fmtDuration(c.returnedAt - c.takenAt)}` : ''}`).join(' · ')}
                  </div>
                )}
              </section>

              <section className={card}>
                <div className="border-b border-slate-200 px-5 py-3.5"><h2 className={title}>Per instrument</h2></div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs font-bold text-slate-500">
                    <th className="px-5 py-2.5">Instrument</th><th className="py-2.5">Uses</th><th className="py-2.5">Total out</th><th className="px-5 py-2.5">Avg / use</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {a.tools.map((t) => (
                      <tr key={t.uid}>
                        <td className="px-5 py-2.5"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(t.uid) }} /><span className="font-medium text-slate-900">{t.name}</span>{t.out && <span className="rounded bg-red-50 px-1.5 text-xs font-bold text-red-700">Out</span>}</span></td>
                        <td className="py-2.5 font-mono text-xs text-slate-700">{t.cycles}</td>
                        <td className="py-2.5 font-mono text-xs text-slate-700">{fmtDuration(t.outMs)}</td>
                        <td className="px-5 py-2.5 font-mono text-xs text-slate-700">{fmtDuration(t.outMs / t.cycles)}</td>
                      </tr>
                    ))}
                    {a.tools.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-slate-500">No instruments used</td></tr>}
                  </tbody>
                </table>
              </section>
            </div>

            <p className="text-center text-[11px] text-slate-400">
              Each instrument&apos;s 1st tap = taken from the tray, 2nd tap = returned. Plans are trial sequences for demonstration, not clinical guidance; metrics are indicative.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
