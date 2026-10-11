"use client";

import { useEffect, useState } from 'react';
import { KIND_LABEL, kindOf } from '@/lib/instruments';
import { STEP_TOOLS, type Procedure, type Step, type StepTool } from '@/lib/procedures';
import { InstrumentIcon, PageHeader, Skeleton } from '../ui';
import { FloatingIcons } from '../effects';
import { PasscodeDialog, adminSend } from '../surgery-ui';

type Draft = { id: string | null; name: string; summary: string; estMinutes: number; alertMinutes: number; steps: Step[] };

const blank = (): Draft => ({ id: null, name: '', summary: '', estMinutes: 20, alertMinutes: 10, steps: [{ tool: 'clamp', purpose: '' }] });
const toDraft = (p: Procedure): Draft => ({ id: p.id, name: p.name, summary: p.summary, estMinutes: p.estMinutes, alertMinutes: p.alertMinutes, steps: p.steps.map((s) => ({ ...s })) });

export default function ProceduresPage() {
  const [procs, setProcs] = useState<Procedure[] | null>(null);
  const [tagKinds, setTagKinds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [passFor, setPassFor] = useState<(() => void) | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = () => fetch('/api/procedures?all=1').then((r) => r.json()).then(setProcs).catch(() => setProcs([]));
  useEffect(() => {
    load();
    fetch('/api/tags').then((r) => r.json())
      .then((tags: { name: string; active?: boolean }[]) => setTagKinds(new Set(tags.filter((t) => t.active !== false).map((t) => kindOf(t.name)))))
      .catch(() => {});
  }, []);

  const send = async (method: 'POST' | 'PATCH', url: string, body: unknown, retry: () => void) => {
    try {
      return await adminSend<Procedure>(method, url, body, null);
    } catch (e) {
      if ((e as Error).message === 'PASSCODE') { setPassFor(() => retry); return null; }
      throw e;
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const body = { name: draft.name, summary: draft.summary, estMinutes: draft.estMinutes, alertMinutes: draft.alertMinutes, steps: draft.steps };
      const res = draft.id
        ? await send('PATCH', `/api/procedures/${draft.id}`, body, save)
        : await send('POST', '/api/procedures', body, save);
      if (res) { setSaved(`Saved "${res.name}"`); setDraft(null); load(); setTimeout(() => setSaved(null), 3000); }
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  const setActive = async (p: Procedure, active: boolean) => {
    try {
      const res = await send('PATCH', `/api/procedures/${p.id}`, { active }, () => setActive(p, active));
      if (res) load();
    } catch (e) { setError((e as Error).message); }
  };

  const upd = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updStep = (i: number, patch: Partial<Step>) => setDraft((d) => (d ? { ...d, steps: d.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) } : d));
  const moveStep = (i: number, dir: -1 | 1) => setDraft((d) => {
    if (!d) return d;
    const j = i + dir;
    if (j < 0 || j >= d.steps.length) return d;
    const steps = [...d.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...d, steps };
  });

  const active = (procs ?? []).filter((p) => p.active);
  const archived = (procs ?? []).filter((p) => !p.active);
  const field = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
  const input = `w-full ${field}`;

  const card = (p: Procedure) => (
    <div key={p.id} className={`rounded-lg border bg-white p-4 shadow-sm ${draft?.id === p.id ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{p.name}</div>
          <div className="mt-0.5 text-sm text-slate-600">{p.summary}</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {p.active ? (
            <>
              <button onClick={() => { setDraft(toDraft(p)); setError(null); }} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700">Edit</button>
              <button onClick={() => setActive(p, false)} className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">Archive</button>
            </>
          ) : (
            <button onClick={() => setActive(p, true)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700">Restore</button>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>~{p.estMinutes} min</span>
        <span>Instrument alert after {p.alertMinutes} min</span>
        <span>{p.steps.length} steps</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-slate-500">
        {p.steps.map((st, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300">→</span>}
            <span title={`${KIND_LABEL[st.tool]} - ${st.purpose}`} className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-slate-600"><InstrumentIcon kind={st.tool} size={14} /></span>
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f3f5f8] font-sans text-slate-900">
      <FloatingIcons />
      <PageHeader />
      <main className="relative mx-auto max-w-7xl px-4 py-6 sm:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Procedures</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">Recommended instrument plans shown during a surgery. Editing a procedure only affects surgeries started afterwards - past reports keep the plan they used.</p>
          </div>
          <button onClick={() => { setDraft(blank()); setError(null); }} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">+ New procedure</button>
        </div>
        {saved && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{saved}</div>}

        <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
          <div className="space-y-3">
            {!procs && [0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}
            {active.map(card)}
            {procs && active.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No procedures yet.</div>}
            {archived.length > 0 && (
              <div className="pt-2">
                <button onClick={() => setShowArchived((v) => !v)} className="text-sm font-medium text-slate-600 hover:text-slate-900">{showArchived ? '▾' : '▸'} Archived ({archived.length})</button>
                {showArchived && <div className="mt-2 space-y-3 opacity-80">{archived.map(card)}</div>}
              </div>
            )}
          </div>

          <div>
            {draft ? (
              <div className="sticky top-20 rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-3.5">
                  <h2 className="font-semibold text-slate-900">{draft.id ? 'Edit procedure' : 'New procedure'}</h2>
                </div>
                <div className="space-y-4 p-5">
                  <label className="block"><span className="text-sm font-medium text-slate-700">Name</span>
                    <input className={`mt-1 ${input}`} value={draft.name} maxLength={60} placeholder="e.g. Skin Lesion Excision" onChange={(e) => upd({ name: e.target.value })} /></label>
                  <label className="block"><span className="text-sm font-medium text-slate-700">Summary</span>
                    <input className={`mt-1 ${input}`} value={draft.summary} maxLength={200} placeholder="One line describing the procedure" onChange={(e) => upd({ summary: e.target.value })} /></label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block"><span className="text-sm font-medium text-slate-700">Estimated duration (min)</span>
                      <input type="number" min={1} max={600} className={`mt-1 ${input}`} value={draft.estMinutes} onChange={(e) => upd({ estMinutes: Number(e.target.value) })} /></label>
                    <label className="block"><span className="text-sm font-medium text-slate-700">Alert if an instrument is out for (min)</span>
                      <input type="number" min={1} max={240} className={`mt-1 ${input}`} value={draft.alertMinutes} onChange={(e) => upd({ alertMinutes: Number(e.target.value) })} /></label>
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-medium text-slate-700">Recommended plan</div>
                    <ol className="space-y-2">
                      {draft.steps.map((st, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-right font-mono text-xs text-slate-500">{i + 1}</span>
                          <select value={st.tool} onChange={(e) => updStep(i, { tool: e.target.value as StepTool })} className={`${field} w-40 shrink-0 py-1.5`}>
                            {STEP_TOOLS.map((t) => <option key={t} value={t}>{KIND_LABEL[t]}{tagKinds.has(t) ? '' : ' (not tagged)'}</option>)}
                          </select>
                          <input className={`${field} min-w-0 flex-1 py-1.5`} value={st.purpose} maxLength={120} placeholder="What it is used for" onChange={(e) => updStep(i, { purpose: e.target.value })} />
                          <div className="flex shrink-0">
                            <button onClick={() => moveStep(i, -1)} disabled={i === 0} title="Move up" className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">↑</button>
                            <button onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1} title="Move down" className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">↓</button>
                            <button onClick={() => upd({ steps: draft.steps.filter((_, k) => k !== i) })} disabled={draft.steps.length === 1} title="Remove step" className="rounded px-1.5 py-1 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-30">✕</button>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {draft.steps.length < 20 && (
                      <button onClick={() => upd({ steps: [...draft.steps, { tool: 'forceps', purpose: '' }] })} className="mt-2 text-sm font-medium text-blue-700 hover:text-blue-800">+ Add step</button>
                    )}
                    {draft.steps.some((s) => !tagKinds.has(s.tool)) && tagKinds.size > 0 && (
                      <p className="mt-2 text-xs text-amber-800">Steps using an instrument that isn&apos;t tagged can&apos;t be ticked off during a surgery.</p>
                    )}
                  </div>
                  {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>}
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3.5">
                  <button onClick={() => { setDraft(null); setError(null); }} className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</button>
                  <button onClick={save} disabled={saving} className="rounded-md bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save procedure'}</button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                Choose <b>Edit</b> on a procedure, or create a <b>New procedure</b>.
              </div>
            )}
          </div>
        </div>
      </main>
      {passFor && <PasscodeDialog onClose={() => setPassFor(null)} then={passFor} />}
    </div>
  );
}
