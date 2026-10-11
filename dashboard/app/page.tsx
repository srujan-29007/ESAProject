"use client";

import { useEffect, useRef, useState } from 'react';
import mqtt, { type MqttClient } from 'mqtt';
import QRCode from 'qrcode';
import { kindOf, isUnregistered, type Kind } from '@/lib/instruments';
import { NavLinks, BROKER, TOPIC, readPass, savePass, InstrumentIcon, InstrumentArt, ago, fmtTime, SERIES, OTHER, Skeleton } from './ui';
import type { Procedure } from '@/lib/procedures';
import { analyze, fmtClock as fmtClockShort, type Surgery, type SurgeryScan } from '@/lib/surgery';
import { StartSurgeryDialog, EndSurgeryDialog, LiveSurgeryPanel, SurgeryRecords, TrayWindow, PasscodeDialog, adminPost, type SurgerySummary } from './surgery-ui';
import Link from 'next/link';
import { FloatingIcons } from './effects';

type Scan = { scanId: number; name: string; rfidUid: string; time: string; delayed?: boolean; manual?: boolean };
type Device = { online: boolean; rssi?: number; uptimeS?: number; reader?: 'ok' | 'lost'; queued?: number; ip?: string; receivedAt: number };

// No heartbeat for this long = treat the scanner as offline (it sends one every 5s).
const STALE_MS = 15000;
type Tag = { id: number; rfidUid: string; name: string; active?: boolean };
function fmtUptime(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

function signal(rssi: number) {
  if (rssi >= -55) return { bars: 4, label: 'Excellent' };
  if (rssi >= -67) return { bars: 3, label: 'Good' };
  if (rssi >= -75) return { bars: 2, label: 'Fair' };
  return { bars: 1, label: 'Weak' };
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

// Inline name editor used by the registry and the current-instrument card.
// onSave resolves to null on success, 'PASSCODE' when the admin passcode is
// missing/wrong, or any other error message.
function RenameField({ initial, onSave, onCancel, large }: {
  initial: string; onSave: (name: string, passcode: string | null) => Promise<string | null>; onCancel: () => void; large?: boolean;
}) {
  const [value, setValue] = useState(isUnregistered(initial) ? '' : initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [needPass, setNeedPass] = useState(false);
  const [pass, setPass] = useState('');
  const submit = async () => {
    const name = value.trim();
    if (!name) return setError('Enter a name');
    if (needPass && !pass) return setError('Enter the admin passcode');
    setSaving(true);
    const err = await onSave(name, needPass ? pass : readPass());
    setSaving(false);
    if (err === 'PASSCODE') {
      setError(needPass ? 'Wrong passcode' : null);
      setNeedPass(true);
    } else if (err) setError(err);
  };
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          maxLength={40}
          placeholder="Instrument name, e.g. Kelly Clamp"
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          className={`min-w-0 flex-1 rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-900 outline-none ring-1 ring-blue-300 placeholder:font-normal placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500 ${large ? 'text-2xl' : 'text-sm'}`}
        />
        <button onClick={submit} disabled={saving} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-200">Cancel</button>
      </div>
      {needPass && (
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={pass}
          placeholder="Admin passcode"
          onChange={(e) => { setPass(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          className="mt-2 w-44 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-900 outline-none ring-1 ring-amber-500/50 placeholder:text-slate-600 focus:ring-2 focus:ring-amber-500"
        />
      )}
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  );
}

type Slice = { key: string; name: string; count: number; color: string };

function UsageDonut({ slices, hovered, onHover, centerLabel }: {
  slices: Slice[]; hovered: string | null; onHover: (k: string | null) => void; centerLabel: string;
}) {
  const size = 220, r = 88, width = 28, c = 2 * Math.PI * r, gap = 2;
  const total = slices.reduce((a, s) => a + s.count, 0);
  const shown = slices.filter((s) => s.count > 0);
  const hit = shown.find((s) => s.key === hovered);
  // Arc start of each slice = sum of the slices before it.
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((a, s) => a + (s.count / total) * c, 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label="Instrument usage share">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e9edf2" strokeWidth={width} />
        {shown.map((s, i) => {
          const len = (s.count / total) * c;
          const dash = shown.length > 1 ? Math.max(len - gap, 0.5) : len;
          return (
            <circle
              key={s.key}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color}
              strokeWidth={hovered === s.key ? width + 8 : width}
              strokeDasharray={`${dash} ${c}`}
              strokeDashoffset={-starts[i]}
              opacity={hovered && hovered !== s.key ? 0.3 : 1}
              className="cursor-pointer transition-all duration-300"
              onMouseEnter={() => onHover(s.key)}
              onMouseLeave={() => onHover(null)}
            >
              <title>{`${s.name}: ${s.count} scans (${Math.round((s.count / total) * 100)}%)`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-12 text-center">
        {hit ? (
          <>
            <div className="text-3xl font-bold tabular-nums text-slate-900">{Math.round((hit.count / total) * 100)}%</div>
            <div className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-700">{hit.name}</div>
            <div className="text-[11px] text-slate-500">{hit.count} scans</div>
          </>
        ) : (
          <>
            <div className="text-4xl font-bold tabular-nums text-slate-900">{total}</div>
            <div className="mt-0.5 text-xs font-bold text-slate-500">{centerLabel}</div>
          </>
        )}
      </div>
    </div>
  );
}

type Hit = { time: string; rfidUid: string };

const hourLabel = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase();

// Scans per hour over the last 12 hours (single series, so one hue and no legend).
// Hovering a bar shows that hour's total and which instruments made it up.
function HourlyActivity({ hits, now, nameOf, colorOf }: {
  hits: Hit[]; now: number; nameOf: (uid: string) => string; colorOf: (uid: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!now) return <Skeleton className="h-full min-h-[200px]" />; // clock not started yet (first render)
  const top = new Date(now); top.setMinutes(0, 0, 0);
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(top.getTime() - (11 - i) * 3600_000);
    const end = start.getTime() + 3600_000;
    const inHour = hits.filter((h) => { const t = new Date(h.time).getTime(); return t >= start.getTime() && t < end; });
    const byTag: Record<string, number> = {};
    inHour.forEach((h) => { byTag[h.rfidUid] = (byTag[h.rfidUid] ?? 0) + 1; });
    return { start, count: inHour.length, byTag };
  });
  const max = Math.max(...buckets.map((b) => b.count));
  const peak = max > 0 ? buckets.find((b) => b.count === max)! : null;
  const thisHour = buckets[11].count;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-end gap-6">
        <div>
          <div className="text-xs font-bold text-slate-500">This hour</div>
          <div className="text-2xl font-bold tabular-nums text-slate-900">{thisHour}</div>
        </div>
        <div>
          <div className="text-xs font-bold text-slate-500">Peak hour</div>
          <div className="text-2xl font-bold tabular-nums text-slate-900">
            {peak ? <>{hourLabel(peak.start)} <span className="text-sm font-semibold text-slate-500">· {peak.count}</span></> : '—'}
          </div>
        </div>
      </div>
      <div className="relative flex min-h-[150px] flex-1 items-end gap-1.5 border-b border-slate-200" onMouseLeave={() => setHover(null)}>
        {max > 0 && <div className="pointer-events-none absolute left-0 top-0 text-xs tabular-nums text-slate-400">{max}</div>}
        {buckets.map((b, i) => (
          <div
            key={i}
            className="relative flex h-full flex-1 cursor-default items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onTouchStart={() => setHover(i)}
          >
            <div
              className={`w-full max-w-6 rounded-t-[4px] transition-all duration-500 ${hover === i ? 'bg-blue-500' : i === 11 ? 'bg-blue-600' : 'bg-blue-300'}`}
              style={{ height: b.count ? `${Math.max((b.count / max) * 100, 3)}%` : '0%' }}
            />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full z-10 mb-2 w-max min-w-36 rounded-md bg-white px-3 py-2 text-left shadow-md ring-1 ring-slate-200"
                style={i > 8 ? { right: 0 } : i < 3 ? { left: 0 } : { left: '50%', transform: 'translateX(-50%)' }}>
                <div className="text-[11px] font-semibold text-slate-600">{hourLabel(b.start)} – {hourLabel(new Date(b.start.getTime() + 3600_000))}</div>
                <div className="text-sm font-bold text-slate-900">{b.count} scan{b.count === 1 ? '' : 's'}</div>
                {Object.entries(b.byTag).sort((x, y) => y[1] - x[1]).map(([uid, n]) => (
                  <div key={uid} className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                    <span className="h-2 w-2 rounded-sm" style={{ background: colorOf(uid) }} />
                    <span className="flex-1 truncate">{nameOf(uid)}</span>
                    <span className="tabular-nums text-slate-600">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {buckets.map((b, i) => (
          <div key={i} className="flex-1 text-center text-xs tabular-nums text-slate-500">{i % 3 === 2 ? hourLabel(b.start) : ''}</div>
        ))}
      </div>
    </div>
  );
}

// "Open on your phone" dialog with a QR code of this page.
function ShareDialog({ onClose }: { onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = typeof window === 'undefined' ? '' : window.location.origin;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#0f1f33', light: '#ffffff' } }).then(setQr).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="card-in w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900">Watch live on your phone</h2>
        <p className="mt-1 text-sm text-slate-600">Scan to open the dashboard - it updates as instruments are tapped.</p>
        <div className="mx-auto mt-5 flex aspect-square w-60 items-center justify-center rounded-lg bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, nothing to optimize */}
          {qr ? <img src={qr} alt="QR code for the dashboard link" className="h-full w-full" /> : <div className="h-full w-full animate-pulse rounded-md bg-slate-200" />}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-md bg-white p-1.5 pl-3 ring-1 ring-slate-200">
          <span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-slate-700">{url.replace(/^https?:\/\//, '')}</span>
          <button
            onClick={() => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
            className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-800"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <button onClick={onClose} className="mt-4 text-sm font-semibold text-slate-600 hover:text-slate-200">Close</button>
      </div>
    </div>
  );
}

// Imaging-style viewer for the instrument just identified: corner brackets,
// measurement ticks, and a scan beam that sweeps across on every read.
function IdentificationViewer({ kind, pulse, waiting }: { kind: Kind | null; pulse: number; waiting: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-md bg-[#f8fafc] ring-1 ring-slate-200">
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{ backgroundImage: 'linear-gradient(#e7ecf2 1px, transparent 1px), linear-gradient(90deg, #e7ecf2 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      />
      {/* corner brackets */}
      {['left-3 top-3 border-l-2 border-t-2', 'right-3 top-3 border-r-2 border-t-2', 'left-3 bottom-3 border-l-2 border-b-2', 'right-3 bottom-3 border-r-2 border-b-2'].map((c) => (
        <span key={c} className={`absolute h-5 w-5 border-slate-400 ${c}`} />
      ))}
      {/* measurement ticks */}
      <div className="absolute inset-x-10 bottom-3 flex justify-between">
        {Array.from({ length: 21 }, (_, i) => <span key={i} className={`w-px bg-slate-300 ${i % 5 === 0 ? 'h-2.5' : 'h-1.5'}`} />)}
      </div>
      <div className="relative flex aspect-[16/7] items-center justify-center px-10 py-6">
        {waiting ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-slate-300" />
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round"><path d="M5 12a7 7 0 0 1 7-7M8 12a4 4 0 0 1 4-4" /><circle cx="12" cy="12" r="1.5" fill="#64748b" /></svg>
            </div>
            <div className="text-sm font-semibold text-slate-700">Awaiting instrument scan</div>
            <div className="text-xs text-slate-500">Hold the instrument tag near the reader</div>
          </div>
        ) : (
          <InstrumentArt key={pulse} kind={kind ?? 'generic'} className="w-full max-w-[520px] text-slate-700" />
        )}
      </div>
      {pulse > 0 && !waiting && (
        <div key={pulse} className="scan-beam pointer-events-none absolute inset-y-0 w-24">
          <div className="absolute inset-y-0 right-0 w-0.5 bg-blue-600/70" />
        </div>
      )}
    </div>
  );
}

// Patient-monitor style readout tile.
function MonitorTile({ label, value, sub, tone = 'teal', children }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'teal' | 'good' | 'bad' | 'muted'; children?: React.ReactNode;
}) {
  const accent = { teal: 'bg-blue-600', good: 'bg-emerald-600', bad: 'bg-red-500', muted: 'bg-slate-500' }[tone];
  const labelColor = { teal: 'text-blue-700', good: 'text-emerald-700', bad: 'text-red-700', muted: 'text-slate-600' }[tone];
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-5 py-4">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${accent}`} />
      <div className={`text-xs font-bold ${labelColor}`}>{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[26px] font-semibold leading-none tabular-nums text-slate-900">{value}</div>
          {sub && <div className="mt-1.5 truncate text-[11px] text-slate-500">{sub}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  // 'connecting' until the first broker connection, 'reconnecting' after a drop.
  const [link, setLink] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [scans, setScans] = useState<Scan[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loaded, setLoaded] = useState(false); // initial history fetched
  const [hits, setHits] = useState<Hit[]>([]); // today's scans, for the hourly chart
  const [toasts, setToasts] = useState<Scan[]>([]);
  const [sharing, setSharing] = useState(false);
  const [now, setNow] = useState(0); // 0 until mounted, so SSR and client markup match
  const [pulse, setPulse] = useState(0); // bumps on each live scan to replay animations
  const [usageToday, setUsageToday] = useState<Record<string, number>>({});
  const [usageAll, setUsageAll] = useState<Record<string, number>>({});
  const [range, setRange] = useState<'today' | 'all'>('today');
  const [hovered, setHovered] = useState<string | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // rfidUid being renamed
  const mqttRef = useRef<MqttClient | null>(null);
  const [surgery, setSurgery] = useState<Surgery | null>(null); // the one in progress
  const [surgeryScans, setSurgeryScans] = useState<SurgeryScan[]>([]);
  const [records, setRecords] = useState<SurgerySummary[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [justEnded, setJustEnded] = useState<Surgery | null>(null);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [passFor, setPassFor] = useState<(() => void) | null>(null); // action waiting for the admin passcode
  const surgeryRef = useRef<Surgery | null>(null);
  useEffect(() => { surgeryRef.current = surgery; }, [surgery]);

  const loadRecords = () => {
    fetch('/api/surgeries').then((r) => (r.ok ? r.json() : [])).then(setRecords).catch(() => {}).finally(() => setRecordsLoaded(true));
  };
  const broadcastSurgery = (event: 'start' | 'end', sg: Surgery) => mqttRef.current?.publish(`${TOPIC}/surgery`, JSON.stringify({ event, surgery: sg }));

  useEffect(() => {
    const json = (r: Response) => (r.ok ? r.json() : Promise.reject(r.status));
    Promise.all([
      fetch('/api/scans').then(json).then(setScans),
      fetch('/api/tags').then(json).then(setTags),
    ]).catch(() => {}).finally(() => setLoaded(true));
    const toMap = (rows: { rfidUid: string; count: number }[]) => Object.fromEntries(rows.map((u) => [u.rfidUid, u.count]));
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const twelveAgo = new Date(Date.now() - 12 * 3600_000);
    const since = twelveAgo < midnight ? twelveAgo : midnight;
    fetch(`/api/activity?since=${since.toISOString()}`).then(json).then(setHits).catch(() => {});
    fetch('/api/procedures').then(json).then(setProcedures).catch(() => {});
    fetch('/api/surgeries/active').then(json).then((d) => { if (d) { setSurgery(d.surgery); setSurgeryScans(d.scans); } }).catch(() => {});
    loadRecords();
    fetch(`/api/usage?since=${midnight.toISOString()}`).then((r) => r.json()).then((rows) => setUsageToday(toMap(rows))).catch(() => {});
    fetch('/api/usage').then((r) => r.json()).then((rows) => setUsageAll(toMap(rows))).catch(() => {});

    const onScan = (s: Scan) => {
      // Scans delivered late from the ESP32's offline queue carry their real
      // (earlier) time, so keep the list ordered by time, not arrival.
      setScans((prev) => [s, ...prev.filter((p) => p.scanId !== s.scanId)]
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 50));
      setTags((prev) => (prev.some((t) => t.rfidUid === s.rfidUid) ? prev : [...prev, { id: -s.scanId, rfidUid: s.rfidUid, name: s.name }]));
      const bump = (m: Record<string, number>) => ({ ...m, [s.rfidUid]: (m[s.rfidUid] ?? 0) + 1 });
      if (new Date(s.time).toDateString() === new Date().toDateString()) setUsageToday(bump);
      setUsageAll(bump);
      setHits((prev) => [...prev, { time: s.time, rfidUid: s.rfidUid }]);
      const live = surgeryRef.current;
      if (live && new Date(s.time) >= new Date(live.startedAt)) {
        setSurgeryScans((prev) => (prev.some((p) => p.scanId === s.scanId) ? prev : [...prev, { scanId: s.scanId, time: s.time, rfidUid: s.rfidUid, name: s.name, manual: s.manual }]));
      }
      setPulse((p) => p + 1);
      setToasts((prev) => [s, ...prev.filter((t) => t.scanId !== s.scanId)].slice(0, 3));
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.scanId !== s.scanId)), 4500);
    };
    // Another screen started or ended a surgery.
    const onSurgeryEvent = (event: string, sg: Surgery) => {
      if (event === 'start') { setSurgery(sg); setSurgeryScans([]); setJustEnded(null); }
      if (event === 'end' && surgeryRef.current?.id === sg.id) { setSurgery(null); setJustEnded(sg); }
      loadRecords();
    };
    const onTag = (t: Tag) => {
      setTags((prev) => (prev.some((x) => x.rfidUid === t.rfidUid) ? prev.map((x) => (x.rfidUid === t.rfidUid ? { ...x, name: t.name } : x)) : [...prev, t]));
      setScans((prev) => prev.map((x) => (x.rfidUid === t.rfidUid ? { ...x, name: t.name } : x)));
    };

    const client = mqtt.connect(BROKER, { reconnectPeriod: 3000, connectTimeout: 10000 });
    mqttRef.current = client;
    client.on('connect', () => {
      setLink('live');
      client.subscribe([`${TOPIC}/scan`, `${TOPIC}/status`, `${TOPIC}/tag`, `${TOPIC}/surgery`]);
    });
    client.on('close', () => setLink((l) => (l === 'connecting' ? l : 'reconnecting')));
    client.on('message', (topic, payload) => {
      let data;
      try { data = JSON.parse(payload.toString()); } catch { return; }
      if (topic === `${TOPIC}/scan` && data.scanId && data.rfidUid) onScan(data);
      else if (topic === `${TOPIC}/tag` && data.rfidUid && data.name) onTag(data);
      else if (topic === `${TOPIC}/surgery` && data.surgery) onSurgeryEvent(data.event, data.surgery);
      // Heartbeats are retained, so a new viewer gets the latest one right away;
      // {"online":false} is the ESP32's last will.
      else if (topic === `${TOPIC}/status`) setDevice({ ...data, online: data.online !== false, receivedAt: Date.now() });
    });

    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { client.end(true); mqttRef.current = null; clearInterval(tick); clearTimeout(first); };
  }, []);

  const current = scans[0] ?? null;
  const currentCountToday = current ? usageToday[current.rfidUid] ?? 0 : 0;
  // allTags fixes each instrument's color slot (registration order); realTags are
  // the ones in use - retired instruments only show up in history.
  const allTags = tags.filter((t) => !t.rfidUid.startsWith('TAG_'));
  const realTags = allTags.filter((t) => t.active !== false);

  // Returns null on success, 'PASSCODE' if the admin passcode is needed, or an
  // error message. On success the new name is broadcast over MQTT so every open
  // dashboard (phones included) updates.
  const rename = async (rfidUid: string, name: string, passcode: string | null) => {
    if (!passcode) return 'PASSCODE';
    try {
      const r = await fetch(`/api/tags/${rfidUid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-passcode': passcode },
        body: JSON.stringify({ name }),
      });
      if (r.status === 401) { savePass(null); return 'PASSCODE'; }
      if (!r.ok) return (await r.json().catch(() => ({}))).error ?? 'Could not save';
      const tag: Tag = await r.json();
      savePass(passcode);
      mqttRef.current?.publish(`${TOPIC}/tag`, JSON.stringify(tag));
      setTags((prev) => prev.map((x) => (x.rfidUid === tag.rfidUid ? { ...x, name: tag.name } : x)));
      setScans((prev) => prev.map((x) => (x.rfidUid === tag.rfidUid ? { ...x, name: tag.name } : x)));
      setEditing(null);
      return null;
    } catch {
      return 'Network error - try again';
    }
  };

  const deviceOnline = !!device && device.online && now - device.receivedAt < STALE_MS;
  const readerOk = deviceOnline && device?.reader === 'ok';
  const registry = realTags.map((t) => {
    const last = scans.find((s) => s.rfidUid === t.rfidUid);
    return { ...t, count: usageToday[t.rfidUid] ?? 0, last: last?.time ?? null };
  });
  const todayTotal = Object.values(usageToday).reduce((a, n) => a + n, 0);
  const usedToday = realTags.filter((t) => (usageToday[t.rfidUid] ?? 0) > 0).length;
  // Scans per hour over the last 8 hours, for the tile sparkline.
  const spark = (() => {
    if (!now) return [] as number[];
    const top = new Date(now); top.setMinutes(0, 0, 0);
    return Array.from({ length: 8 }, (_, i) => {
      const start = top.getTime() - (7 - i) * 3600_000;
      return hits.filter((h) => { const t = new Date(h.time).getTime(); return t >= start && t < start + 3600_000; }).length;
    });
  })();
  const sparkMax = Math.max(1, ...spark);
  const colorOf = (uid: string) => {
    const i = allTags.findIndex((t) => t.rfidUid === uid);
    return i >= 0 && i < SERIES.length ? SERIES[i] : OTHER;
  };

  const surgeryAnalysis = surgery && now ? analyze(surgeryScans, surgery.plan, new Date(surgery.startedAt).getTime(), Math.max(now, new Date(surgery.startedAt).getTime())) : null;

  // Manual take/return for a missed tap. The result is broadcast like a reader
  // scan, so every open dashboard (and this one, via the echo) updates.
  const correct = async (uid: string): Promise<string | null> => {
    if (!surgery) return null;
    try {
      const ev = await adminPost<Scan>(`/api/surgeries/${surgery.id}/correct`, { rfidUid: uid }, null);
      mqttRef.current?.publish(`${TOPIC}/scan`, JSON.stringify(ev));
      return null;
    } catch (e) {
      if ((e as Error).message === 'PASSCODE') { setPassFor(() => () => correct(uid)); return null; }
      return (e as Error).message;
    }
  };
  const toolRows = registry.map((t) => ({ uid: t.rfidUid, name: t.name, color: colorOf(t.rfidUid) }));


  // Chart slices: one per tag in its fixed slot; tags past the palette fold into "Other".
  const usage = range === 'today' ? usageToday : usageAll;
  const slices: Slice[] = (() => {
    const out: Slice[] = allTags.slice(0, SERIES.length)
      .map((t, i) => ({ key: t.rfidUid, name: t.name, count: usage[t.rfidUid] ?? 0, color: SERIES[i] }))
      .filter((sl) => realTags.some((t) => t.rfidUid === sl.key) || sl.count > 0);
    const rest = allTags.slice(SERIES.length).reduce((a, t) => a + (usage[t.rfidUid] ?? 0), 0);
    if (rest > 0) out.push({ key: '__other', name: 'Other', count: rest, color: OTHER });
    return out;
  })();
  const usageTotal = slices.reduce((a, s) => a + s.count, 0);
  const maxCount = Math.max(1, ...slices.map((s) => s.count));

  const clock = new Date(now);
  const cardCls = 'rounded-lg border border-slate-200 bg-white shadow-sm';
  const headCls = 'flex items-center justify-between border-b border-slate-200 px-5 py-3.5';
  const titleCls = 'text-[11px] font-bold text-slate-600';

  return (
    <div className="min-h-screen bg-[#f3f5f8] text-slate-900 font-sans">
      <FloatingIcons />

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-700">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z" fill="white" />
              </svg>
            </div>
            <div>
              <h1 className="text-[17px] font-semibold tracking-tight text-slate-900">Smart OR Tracking</h1>
              <p className="text-xs text-slate-600">Surgical Instrument Management · <span className="text-blue-700">Operating Room 1</span></p>
            </div>
            <NavLinks />
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 sm:flex">
              <span className="hidden text-slate-500 2xl:inline">{now ? clock.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</span>
              <span className="hidden h-3 w-px bg-slate-200 2xl:inline" />
              <span className="font-mono font-semibold tabular-nums">{now ? clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}</span>
            </div>
            {surgery ? (
              <a href="#surgery" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800">
                <span className="h-2 w-2 rounded-full bg-red-600" />
                Surgery in progress <span className="font-mono tabular-nums">{surgeryAnalysis ? fmtClockShort(now - surgeryAnalysis.startMs) : ''}</span>
              </a>
            ) : (
              <button onClick={() => setStartOpen(true)} className="flex items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-800">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>
                Start Surgery
              </button>
            )}
            <button
              onClick={() => setSharing(true)}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
              </svg>
              Share
            </button>
            <div className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold ${
 link === 'live' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
 : link === 'reconnecting' ? 'border-amber-200 bg-amber-50 text-amber-800'
 : 'border-slate-200 bg-slate-100 text-slate-700'}`}>
              {link === 'live' ? (
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
              ) : (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              {link === 'live' ? 'Live' : link === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
            </div>
          </div>
        </div>
      </header>

      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-8">

        {surgery && surgeryAnalysis && (
          <div id="surgery" className="scroll-mt-20">
            <LiveSurgeryPanel surgery={surgery} analysis={surgeryAnalysis} rows={toolRows} now={now} onEnd={() => setEndOpen(true)} onCorrect={correct} />
          </div>
        )}
        {!surgery && justEnded && (
          <div className="card-in flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-3.5">
            <div className="text-sm text-emerald-800">
              <span className="font-semibold">Surgery ended.</span> {justEnded.procedureName} by {justEnded.surgeon} has been saved.
            </div>
            <div className="flex items-center gap-3">
              <Link href={`/surgery/${justEnded.id}`} className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-bold text-white hover:bg-emerald-800">View report</Link>
              <button onClick={() => setJustEnded(null)} className="text-xs text-emerald-700 hover:text-emerald-800">Dismiss</button>
            </div>
          </div>
        )}

        {/* Monitor readouts */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MonitorTile label="Scans today" value={loaded ? todayTotal : '—'} sub="all instruments">
            <div className="flex h-8 items-end gap-[3px]" aria-hidden>
              {spark.map((n, i) => <span key={i} className={`w-1.5 rounded-t-sm ${i === spark.length - 1 ? 'bg-blue-600' : 'bg-blue-200'}`} style={{ height: `${Math.max(8, (n / sparkMax) * 100)}%` }} />)}
            </div>
          </MonitorTile>
          <MonitorTile label="Instruments used" value={loaded ? <>{usedToday}<span className="text-lg text-slate-500">/{realTags.length}</span></> : '—'} sub="tagged instruments used today" />
          <MonitorTile label="Last scan" value={current ? ago(current.time, now) : '—'} sub={current ? current.name : 'no scans yet'} />
          <MonitorTile
            label="Scanner"
            tone={deviceOnline ? (readerOk ? 'good' : 'bad') : device ? 'bad' : 'muted'}
            value={<span className="text-[22px]">{deviceOnline ? (readerOk ? 'Online' : 'Reader fault') : device ? 'Offline' : 'Waiting'}</span>}
            sub={deviceOnline && device?.rssi != null ? `Wi-Fi ${signal(device.rssi).label.toLowerCase()} · ${device.rssi} dBm` : 'ESP32 + MFRC522'}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Instrument identification */}
          <section className={cardCls}>
            <div className={headCls}>
              <h2 className={titleCls}>Instrument Identification</h2>
              {current && (
                isUnregistered(current.name) ? (
                  <button onClick={() => setEditing(current.rfidUid)} className="rounded-md bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100">Unregistered tag · Name it</button>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    Verified
                  </span>
                )
              )}
            </div>
            <div className="p-5">
              {!loaded ? (
                <div className="space-y-4"><Skeleton className="aspect-[16/7] w-full rounded-lg" /><Skeleton className="h-16 w-full" /></div>
              ) : (
                <>
                  <IdentificationViewer kind={current ? kindOf(current.name) : null} pulse={pulse} waiting={!current} />
                  {current && (
                    <div key={current.scanId} className="card-in mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                      <div className="col-span-2">
                        <div className="text-xs font-bold text-slate-500">Instrument</div>
                        {editing === current.rfidUid ? (
                          <RenameField initial={current.name} onSave={(n, p) => rename(current.rfidUid, n, p)} onCancel={() => setEditing(null)} />
                        ) : (
                          <div className="group mt-0.5 flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf(current.rfidUid) }} />
                            <span className="truncate text-2xl font-semibold tracking-tight text-slate-900">{current.name}</span>
                            <button onClick={() => setEditing(current.rfidUid)} title="Rename instrument" className={`shrink-0 rounded-md p-1.5 text-slate-500 ring-1 ring-slate-200 transition hover:text-blue-700 hover:ring-blue-300 ${isUnregistered(current.name) ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                              <PencilIcon />
                            </button>
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-500">Tag UID</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-slate-800">{current.rfidUid}</div>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-500">Scanned at</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-slate-800">{fmtTime(current.time)}</div>
                        <div className="text-[11px] text-slate-500">{currentCountToday} use{currentCountToday === 1 ? '' : 's'} today</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Right column — on desktop, sized to the left column's height */}
          <div className="flex flex-col gap-5 lg:h-0 lg:min-h-full">
            {/* Device status */}
            <section className={cardCls}>
              <div className={headCls}>
                <h2 className={titleCls}>Device Status</h2>
                <span className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ${deviceOnline ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : device ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-slate-100 text-slate-400 ring-slate-200'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${deviceOnline ? 'bg-emerald-400' : device ? 'bg-red-500' : 'bg-slate-500'}`} />
                  {deviceOnline ? 'Online' : device ? 'Offline' : 'Waiting'}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 px-5 py-4 text-sm">
                <div>
                  <dt className="text-xs font-bold text-slate-500">RFID reader</dt>
                  <dd className={`mt-0.5 flex items-center gap-1.5 font-semibold ${!deviceOnline ? 'text-slate-500' : readerOk ? 'text-emerald-700' : 'text-red-700'}`}>
                    {deviceOnline && (readerOk
                      ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 8v5M12 17h.01" /></svg>)}
                    {!deviceOnline ? 'Unknown' : readerOk ? 'Responding' : 'Not responding'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-slate-500">Wi-Fi signal</dt>
                  {deviceOnline && device?.rssi != null ? (
                    <dd className="mt-0.5 flex items-center gap-2">
                      <span className="flex h-3.5 items-end gap-[2px]">
                        {[1, 2, 3, 4].map((b) => <span key={b} className={`w-[3px] rounded-sm ${b <= signal(device.rssi!).bars ? 'bg-slate-200' : 'bg-slate-300'}`} style={{ height: `${b * 25}%` }} />)}
                      </span>
                      <span className="font-semibold text-slate-900">{signal(device.rssi).label}</span>
                    </dd>
                  ) : <dd className="mt-0.5 font-semibold text-slate-500">—</dd>}
                </div>
                <div>
                  <dt className="text-xs font-bold text-slate-500">Uptime</dt>
                  <dd className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">{deviceOnline && device?.uptimeS != null ? fmtUptime(device.uptimeS + Math.floor((now - device.receivedAt) / 1000)) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-slate-500">Offline queue</dt>
                  <dd className={`mt-0.5 font-semibold tabular-nums ${device?.queued ? 'text-amber-800' : 'text-slate-900'}`}>{device?.queued ? `${device.queued} waiting` : 'Empty'}</dd>
                </div>
              </dl>
              <div className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-500">
                {!device
                  ? 'No heartbeat yet - is the scanner powered on?'
                  : !deviceOnline
                    ? <span className="text-red-700">
                        {device.online ? `No heartbeat for ${ago(new Date(device.receivedAt).toISOString(), now).replace(' ago', '')}` : 'Scanner disconnected'}
                        {' '}- check power and the hotspot. Taps are saved on the scanner meanwhile.
                      </span>
                    : !readerOk
                      ? <span className="text-red-700">Reader not responding - check the SPI wiring (pins 18, 19, 23, 21).</span>
                      : <>Last heartbeat {ago(new Date(device.receivedAt).toISOString(), now)} · IP {device.ip}</>}
              </div>
            </section>

            {/* Instrument log */}
            <section className={`flex min-h-0 flex-1 flex-col ${cardCls}`}>
              <div className={headCls}>
                <h2 className={titleCls}>Instrument Log</h2>
                <span className="text-[11px] text-slate-500">latest {Math.min(scans.length, 12)}</span>
              </div>
              <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
                {scans.slice(0, 12).map((s, i) => (
                  <li key={s.scanId} className={`flex items-center gap-3 px-5 py-2.5 ${i === 0 ? 'log-in bg-blue-50/70' : ''}`}>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-slate-600">{fmtTime(s.time)}</span>
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: colorOf(s.rfidUid) }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{s.name}</span>
                        {s.manual && <span title="Entered by hand to fix a missed tap" className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-xs font-semibold text-slate-600 ring-1 ring-slate-300">corrected</span>}
                        {s.delayed && <span title="Scanned while offline, delivered when the scanner reconnected" className="shrink-0 rounded bg-amber-50 px-1.5 py-px text-xs font-semibold text-amber-800 ring-1 ring-amber-300">synced late</span>}
                      </div>
                    </div>
                    <span className="hidden font-mono text-[11px] text-slate-500 sm:inline">{s.rfidUid}</span>
                    <span className="w-14 shrink-0 text-right text-[11px] text-slate-500">{ago(s.time, now)}</span>
                  </li>
                ))}
                {!loaded && [0, 1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3"><Skeleton className="h-3.5 w-16" /><Skeleton className="h-3.5 flex-1" /><Skeleton className="h-3.5 w-12" /></li>
                ))}
                {loaded && scans.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">No scans yet</li>}
              </ul>
            </section>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Instrument usage */}
          <section className={cardCls}>
            <div className={`${headCls} flex-wrap gap-3`}>
              <h2 className={titleCls}>Instrument Usage</h2>
              <div className="flex rounded-md bg-slate-100 p-0.5 ring-1 ring-slate-200">
                {(['today', 'all'] as const).map((r) => (
                  <button key={r} onClick={() => setRange(r)} className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${range === r ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:text-slate-300'}`}>
                    {r === 'today' ? 'Today' : 'All time'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-center gap-8 p-6 md:flex-row md:px-8">
              <UsageDonut slices={slices} hovered={hovered} onHover={setHovered} centerLabel={range === 'today' ? 'Scans today' : 'Total scans'} />
              <ul className="grid w-full flex-1 gap-y-1">
                {slices.map((sl) => {
                  const pct = usageTotal ? Math.round((sl.count / usageTotal) * 100) : 0;
                  return (
                    <li key={sl.key} onMouseEnter={() => setHovered(sl.key)} onMouseLeave={() => setHovered(null)}
                      className={`rounded-lg px-3 py-2.5 transition-opacity duration-300 ${hovered && hovered !== sl.key ? 'opacity-40' : ''} ${hovered === sl.key ? 'bg-slate-100' : ''}`}>
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: sl.color }} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{sl.name}</span>
                        <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">{sl.count}</span>
                        <span className="w-10 text-right font-mono text-xs tabular-nums text-slate-500">{pct}%</span>
                      </div>
                      <div className="ml-6 mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(sl.count / maxCount) * 100}%`, background: sl.color }} />
                      </div>
                    </li>
                  );
                })}
                {loaded && slices.length === 0 && <li className="py-6 text-sm text-slate-500">No instruments tagged yet</li>}
              </ul>
            </div>
          </section>

          {/* Hourly activity */}
          <section className={`flex flex-col ${cardCls}`}>
            <div className={headCls}>
              <h2 className={titleCls}>Activity · Last 12 Hours</h2>
              <span className="text-[11px] text-slate-500">scans / hour</span>
            </div>
            <div className="flex-1 px-5 pb-5 pt-4">
              <HourlyActivity hits={hits} now={now} nameOf={(uid) => tags.find((t) => t.rfidUid === uid)?.name ?? uid} colorOf={colorOf} />
            </div>
          </section>
        </div>

        {/* Instrument inventory */}
        <section className={cardCls}>
          <div className={headCls}>
            <h2 className={titleCls}>Instrument Inventory</h2>
            <span className="text-[11px] text-slate-500">{realTags.length} tagged instruments</span>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {!loaded && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px] rounded-md" />)}
            {registry.map((t) => {
              const active = current?.rfidUid === t.rfidUid;
              return (
                <div key={t.rfidUid} className={`group relative overflow-hidden rounded-md px-4 pb-3.5 pt-3 ring-1 transition-colors duration-500 ${active ? 'bg-blue-50 ring-blue-300' : 'bg-slate-50 ring-slate-200'}`}>
                  <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: colorOf(t.rfidUid) }} />
                  <InstrumentArt kind={kindOf(t.name)} className={`h-12 w-full ${active ? 'text-blue-800' : 'text-slate-600'}`} />
                  {editing === t.rfidUid ? (
                    <div className="mt-2"><RenameField initial={t.name} onSave={(n, p) => rename(t.rfidUid, n, p)} onCancel={() => setEditing(null)} /></div>
                  ) : (
                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-slate-900">{t.name}</span>
                          <button onClick={() => setEditing(t.rfidUid)} title="Rename instrument" className={`shrink-0 rounded p-1 text-slate-500 transition hover:text-blue-700 ${isUnregistered(t.name) ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
                            <PencilIcon />
                          </button>
                        </div>
                        <div className="text-[11px] text-slate-500">{t.last ? `Last used ${ago(t.last, now)}` : 'Not used yet'}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg font-semibold tabular-nums text-slate-900">{t.count}</div>
                        <div className="text-xs font-semibold text-slate-500">today</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {loaded && registry.length === 0 && <div className="col-span-full py-6 text-center text-sm text-slate-500">No instruments tagged yet</div>}
          </div>
        </section>

        <SurgeryRecords items={records} loaded={recordsLoaded} />

        <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-2 text-[11px] text-slate-400">
          <span>Smart OR Tracking</span><span>·</span><span>RFID instrument identification (ESP32 + MFRC522)</span><span>·</span><span>Live via MQTT</span>
        </footer>
      </div>

      {/* Live scan toasts */}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-40 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:top-20 sm:items-end">
        {toasts.map((t) => (
          <div key={t.scanId} className="toast-in pointer-events-auto relative w-full max-w-xs overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-slate-200">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md" style={{ color: colorOf(t.rfidUid), background: `${colorOf(t.rfidUid)}24` }}>
                <InstrumentIcon kind={kindOf(t.name)} size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-slate-900">{t.name}</div>
                <div className="text-xs text-slate-600">{t.manual ? 'Corrected by hand' : t.delayed ? `Synced late · scanned ${fmtTime(t.time)}` : 'Scanned just now'}</div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <div className="toast-bar h-0.5" style={{ background: colorOf(t.rfidUid) }} />
          </div>
        ))}
      </div>

      {sharing && <ShareDialog onClose={() => setSharing(false)} />}
      {loaded && <TrayWindow analysis={surgeryAnalysis} rows={toolRows} now={now} live={!!surgery} />}
      {startOpen && (
        <StartSurgeryDialog
          procedures={procedures}
          onClose={() => setStartOpen(false)}
          onStarted={(sg) => { setStartOpen(false); setSurgery(sg); setSurgeryScans([]); setJustEnded(null); broadcastSurgery('start', sg); loadRecords(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        />
      )}
      {passFor && <PasscodeDialog onClose={() => setPassFor(null)} then={passFor} />}
      {endOpen && surgery && surgeryAnalysis && (
        <EndSurgeryDialog
          surgery={surgery}
          stillOut={surgeryAnalysis.stillOut}
          onClose={() => setEndOpen(false)}
          onEnded={(sg) => { setEndOpen(false); setSurgery(null); setJustEnded(sg); broadcastSurgery('end', sg); loadRecords(); }}
        />
      )}

    </div>
  );
}
