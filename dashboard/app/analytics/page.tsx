"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtDuration } from '@/lib/surgery';
import { PageHeader, Skeleton } from '../ui';
import { FloatingIcons } from '../effects';

type Case = {
  id: number; procedureId: string; procedureName: string; surgeon: string; startedAt: string; estMinutes: number;
  durationMs: number; cycles: number; stepsDone: number; stepsTotal: number; inOrder: number; idleMs: number; busyMs: number;
  stillOut: number; corrections: number; tools: { name: string; cycles: number; outMs: number }[];
};

type SurgeonRow = {
  surgeon: string; cases: Case[]; avgMs: number; minMs: number; maxMs: number; vsEstimate: number | null;
  idlePct: number; coveragePct: number; inOrderPct: number; avgUseMs: number; stillOut: number; corrections: number;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number) => `${Math.round(n)}%`;
// Group surgeon names case- and space-insensitively ("Dr Rao" == "dr  rao").
const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

function summarise(cases: Case[]): SurgeonRow[] {
  const groups = new Map<string, Case[]>();
  for (const c of cases) groups.set(keyOf(c.surgeon), [...(groups.get(keyOf(c.surgeon)) ?? []), c]);
  return [...groups.values()].map((cs) => {
    const durations = cs.map((c) => c.durationMs);
    const withEst = cs.filter((c) => c.estMinutes > 0);
    const uses = cs.reduce((a, c) => a + c.cycles, 0);
    const matched = cs.reduce((a, c) => a + c.stepsDone, 0);
    return {
      surgeon: cs[0].surgeon.trim(),
      cases: cs,
      avgMs: avg(durations),
      minMs: Math.min(...durations),
      maxMs: Math.max(...durations),
      vsEstimate: withEst.length ? avg(withEst.map((c) => (c.durationMs / (c.estMinutes * 60_000) - 1) * 100)) : null,
      idlePct: avg(cs.map((c) => (c.durationMs ? (c.idleMs / c.durationMs) * 100 : 0))),
      coveragePct: avg(cs.map((c) => (c.stepsTotal ? (c.stepsDone / c.stepsTotal) * 100 : 0))),
      inOrderPct: matched ? (cs.reduce((a, c) => a + c.inOrder, 0) / matched) * 100 : 0,
      avgUseMs: uses ? cs.reduce((a, c) => a + c.tools.reduce((b, t) => b + t.outMs, 0), 0) / uses : 0,
      stillOut: cs.reduce((a, c) => a + c.stillOut, 0),
      corrections: cs.reduce((a, c) => a + c.corrections, 0),
    };
  }).sort((a, b) => a.avgMs - b.avgMs);
}

export default function AnalyticsPage() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [proc, setProc] = useState('all');
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => { fetch('/api/analytics').then((r) => r.json()).then(setCases).catch(() => setCases([])); }, []);

  const procs = [...new Map((cases ?? []).map((c) => [c.procedureId, c.procedureName])).entries()];
  const shown = (cases ?? []).filter((c) => proc === 'all' || c.procedureId === proc);
  const rows = summarise(shown);
  const maxMs = Math.max(1, ...shown.map((c) => c.durationMs));
  const est = proc !== 'all' && shown.length ? shown[0].estMinutes * 60_000 : null;
  const scaleMax = Math.max(maxMs, est ?? 0) * 1.05;
  const toolNames = [...new Set(shown.flatMap((c) => c.tools.map((t) => t.name)))].sort();

  // Best value in each column (only meaningful with 2+ surgeons).
  const best = rows.length > 1 ? {
    avgMs: Math.min(...rows.map((r) => r.avgMs)),
    idlePct: Math.min(...rows.map((r) => r.idlePct)),
    coveragePct: Math.max(...rows.map((r) => r.coveragePct)),
    inOrderPct: Math.max(...rows.map((r) => r.inOrderPct)),
  } : null;
  const isBest = (k: keyof NonNullable<typeof best>, v: number) => best !== null && Math.abs(best[k] - v) < 1e-6;

  const card = 'rounded-lg border border-slate-200 bg-white shadow-sm';
  const head = 'flex items-center justify-between border-b border-slate-200 px-5 py-3.5';

  return (
    <div className="min-h-screen bg-[#f3f5f8] font-sans text-slate-900">
      <FloatingIcons />
      <PageHeader />
      <main className="relative mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Surgeon analytics</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">How each surgeon handles instruments across completed surgeries. For a fair comparison, filter to one procedure.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Procedure
            <select value={proc} onChange={(e) => setProc(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500">
              <option value="all">All procedures</option>
              {procs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        </div>

        {!cases ? (
          <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>
        ) : shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No completed surgeries yet. Run one from the <Link href="/" className="font-semibold text-blue-700">dashboard</Link> and end it to see analytics here.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ['Surgeries', String(shown.length), proc === 'all' ? `${procs.length} procedures` : 'this procedure'],
                ['Surgeons', String(rows.length), 'with completed cases'],
                ['Average duration', fmtDuration(avg(shown.map((c) => c.durationMs))), est ? `estimate ${fmtDuration(est)}` : 'all cases'],
                ['Average plan coverage', pct(avg(shown.map((c) => (c.stepsTotal ? (c.stepsDone / c.stepsTotal) * 100 : 0)))), 'of recommended steps'],
              ].map(([label, value, sub]) => (
                <div key={label} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <span className="absolute inset-y-0 left-0 w-[3px] bg-blue-600" />
                  <div className="text-xs font-medium text-slate-500">{label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
                </div>
              ))}
            </div>

            {/* Duration by surgeon: bar = average, dots = individual surgeries */}
            <section className={card}>
              <div className={head}>
                <h2 className="text-sm font-semibold text-slate-800">Surgery duration by surgeon</h2>
                <span className="text-xs text-slate-500">bar = average · dot = one surgery{est ? ' · dashed line = estimate' : ''}</span>
              </div>
              <div className="space-y-3 px-5 py-5" onMouseLeave={() => setHover(null)}>
                {rows.map((r) => (
                  <div key={r.surgeon} className="relative flex items-center gap-3" onMouseEnter={() => setHover(r.surgeon)}>
                    <div className="w-32 shrink-0 truncate text-sm font-medium text-slate-800">{r.surgeon}</div>
                    <div className="relative h-7 flex-1 rounded bg-slate-50">
                      <div className={`absolute inset-y-1.5 left-0 rounded-r-[4px] ${hover === r.surgeon ? 'bg-blue-600' : 'bg-blue-500/80'}`} style={{ width: `${(r.avgMs / scaleMax) * 100}%`, maxHeight: 24 }} />
                      {r.cases.map((c) => (
                        <span key={c.id} title={`${new Date(c.startedAt).toLocaleDateString()} · ${fmtDuration(c.durationMs)}`}
                          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-800" style={{ left: `${(c.durationMs / scaleMax) * 100}%` }} />
                      ))}
                      {est && <span className="absolute inset-y-0 border-l-2 border-dashed border-slate-400" style={{ left: `${(est / scaleMax) * 100}%` }} />}
                    </div>
                    <div className="w-20 shrink-0 text-right text-sm tabular-nums text-slate-700">{fmtDuration(r.avgMs)}</div>
                    {hover === r.surgeon && (
                      <div className="pointer-events-none absolute right-24 top-full z-10 mt-1 rounded-md bg-white px-3 py-2 text-xs shadow-md ring-1 ring-slate-200">
                        <div className="font-semibold text-slate-900">{r.surgeon}</div>
                        <div className="text-slate-600">{r.cases.length} surgeries · avg {fmtDuration(r.avgMs)}</div>
                        <div className="text-slate-600">fastest {fmtDuration(r.minMs)} · slowest {fmtDuration(r.maxMs)}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Comparison table */}
            <section className={card}>
              <div className={head}>
                <h2 className="text-sm font-semibold text-slate-800">Surgeon comparison</h2>
                <span className="text-xs text-slate-500">best value in each column in <b className="text-emerald-700">green</b></span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                      <th className="px-5 py-2.5">Surgeon</th><th className="py-2.5">Surgeries</th><th className="py-2.5">Avg duration</th><th className="py-2.5">vs estimate</th>
                      <th className="py-2.5">Idle time</th><th className="py-2.5">Plan coverage</th><th className="py-2.5">In planned order</th><th className="py-2.5">Avg time per instrument use</th>
                      <th className="py-2.5">Not returned</th><th className="px-5 py-2.5">Corrections</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.surgeon} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{r.surgeon}</td>
                        <td className="py-3 tabular-nums text-slate-700">{r.cases.length}</td>
                        <td className={`py-3 tabular-nums ${isBest('avgMs', r.avgMs) ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}>{fmtDuration(r.avgMs)}</td>
                        <td className={`py-3 tabular-nums ${r.vsEstimate === null ? 'text-slate-400' : r.vsEstimate > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>{r.vsEstimate === null ? '—' : `${r.vsEstimate > 0 ? '+' : ''}${Math.round(r.vsEstimate)}%`}</td>
                        <td className={`py-3 tabular-nums ${isBest('idlePct', r.idlePct) ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}>{pct(r.idlePct)}</td>
                        <td className={`py-3 tabular-nums ${isBest('coveragePct', r.coveragePct) ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}>{pct(r.coveragePct)}</td>
                        <td className={`py-3 tabular-nums ${isBest('inOrderPct', r.inOrderPct) ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}>{pct(r.inOrderPct)}</td>
                        <td className="py-3 tabular-nums text-slate-700">{fmtDuration(r.avgUseMs)}</td>
                        <td className={`py-3 tabular-nums ${r.stillOut ? 'font-semibold text-red-700' : 'text-slate-700'}`}>{r.stillOut}</td>
                        <td className="px-5 py-3 tabular-nums text-slate-700">{r.corrections}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
              {/* Average time out per use, surgeon x instrument */}
              <section className={card}>
                <div className={head}><h2 className="text-sm font-semibold text-slate-800">Average time per use, by instrument</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500"><th className="px-5 py-2.5">Surgeon</th>{toolNames.map((t) => <th key={t} className="py-2.5 pr-4">{t}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r) => (
                        <tr key={r.surgeon}>
                          <td className="px-5 py-2.5 font-medium text-slate-900">{r.surgeon}</td>
                          {toolNames.map((t) => {
                            const uses = r.cases.flatMap((c) => c.tools.filter((x) => x.name === t));
                            const n = uses.reduce((a, x) => a + x.cycles, 0);
                            return <td key={t} className="py-2.5 pr-4 tabular-nums text-slate-700">{n ? <>{fmtDuration(uses.reduce((a, x) => a + x.outMs, 0) / n)} <span className="text-xs text-slate-400">×{n}</span></> : '—'}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Individual surgeries */}
              <section className={card}>
                <div className={head}><h2 className="text-sm font-semibold text-slate-800">Surgeries</h2><span className="text-xs text-slate-500">{shown.length}</span></div>
                <div className="max-h-[360px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                      <th className="px-5 py-2.5">Date</th><th className="py-2.5">Procedure</th><th className="py-2.5">Surgeon</th><th className="py-2.5">Duration</th><th className="py-2.5">Plan</th><th className="px-5 py-2.5" />
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {shown.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-5 py-2.5 text-xs text-slate-500">{new Date(c.startedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="py-2.5 text-slate-800">{c.procedureName}</td>
                          <td className="py-2.5 text-slate-700">{c.surgeon}</td>
                          <td className="py-2.5 tabular-nums text-slate-700">{fmtDuration(c.durationMs)}</td>
                          <td className="py-2.5 tabular-nums text-slate-700">{c.stepsDone}/{c.stepsTotal}</td>
                          <td className="px-5 py-2.5 text-right"><Link href={`/surgery/${c.id}`} className="text-xs font-semibold text-blue-700 hover:text-blue-800">Report →</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            <p className="text-center text-xs text-slate-400">Metrics are indicative and depend on staff tapping every instrument. Small numbers of surgeries can be misleading.</p>
          </>
        )}
      </main>
    </div>
  );
}
