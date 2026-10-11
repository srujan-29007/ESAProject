"use client";

// Pieces shared by the dashboard and the surgery report page.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Kind } from '@/lib/instruments';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/procedures', label: 'Procedures' },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="ml-2 hidden items-center gap-1 md:flex">
      {NAV.map((n) => {
        const on = n.href === '/' ? path === '/' : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} className={`rounded-md px-3 py-1.5 text-sm font-medium ${on ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Top bar for the secondary pages (analytics, procedures, reports).
export function PageHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3.5">
          <Link href="/" className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-700">
            <svg width="24" height="24" viewBox="0 0 24 24"><path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z" fill="white" /></svg>
          </Link>
          <div>
            <div className="text-[17px] font-semibold tracking-tight text-slate-900">Smart OR Tracking</div>
            <p className="text-xs text-slate-600">Surgical Instrument Management · <span className="text-blue-700">Operating Room 1</span></p>
          </div>
          <NavLinks />
        </div>
        {right}
      </div>
    </header>
  );
}

// Live updates come straight from the public MQTT broker over WebSockets (the
// ESP32 publishes there); history and renames go through this app's /api routes.
export const BROKER = 'wss://broker.hivemq.com:8884/mqtt';
export const TOPIC = 'smart_tray_25BCE2885';
export const PASS_KEY = 'or-admin-passcode';

export const readPass = () => { try { return localStorage.getItem(PASS_KEY); } catch { return null; } };
export const savePass = (v: string | null) => { try { if (v) localStorage.setItem(PASS_KEY, v); else localStorage.removeItem(PASS_KEY); } catch {} };

export function InstrumentIcon({ kind, size = 24 }: { kind: Kind; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'scalpel':
      return (
        <svg {...common}>
          <path d="M3 21l9.5-9.5" />
          <path d="M12.5 11.5l3-3c1.8-1.8 4.3-2.6 5.5-2.5.1 1.2-.7 3.7-2.5 5.5l-3 3z" />
          <path d="M12.5 11.5l3 3" />
        </svg>
      );
    case 'forceps':
      return (
        <svg {...common}>
          <path d="M4 3l7.5 13.5L13 21" />
          <path d="M10 3l3 9 2.5 9" />
          <path d="M6 7.5l5.5-1.5" />
        </svg>
      );
    case 'scissors':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M8.1 8.1L20 20" />
          <path d="M8.1 15.9L20 4" />
        </svg>
      );
    case 'clamp':
      return (
        <svg {...common}>
          <circle cx="7" cy="18" r="2.5" />
          <circle cx="13" cy="19" r="2.5" />
          <path d="M8.5 16L16 3" />
          <path d="M12.5 16.5L17.5 3" />
          <path d="M13 10.5l2.5 1" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M9 3h6M10 3v4.5L5.5 18A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3L14 7.5V3" />
          <path d="M7.5 14h9" />
        </svg>
      );
  }
}

export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Categorical series colors for the white surface (CVD-validated, fixed order).
// A tag keeps its slot by registration order, so colors never reshuffle by rank.
// Some sit below 3:1 on white, so charts always label instruments by name too.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
export const OTHER = '#8a94a0';

// Technical line drawings of each instrument type, drawn horizontally (tip to the right).
export function InstrumentArt({ kind, className = '' }: { kind: Kind; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 320 100" className={className} aria-hidden>
      <g {...common}>
        {kind === 'scalpel' && (<>
          <rect x="22" y="42" width="176" height="16" rx="8" fill="currentColor" fillOpacity="0.08" />
          {[44, 54, 64, 74, 84, 94].map((x) => <path key={x} d={`M${x} 46v8`} strokeWidth="1.4" opacity="0.6" />)}
          <path d="M198 46 L220 47.5 L220 52.5 L198 54" />
          <path d="M220 46.5 L262 43 Q296 45 298 51 Q282 58 220 53.5 Z" fill="currentColor" fillOpacity="0.14" />
          <path d="M232 49 L286 49" strokeWidth="1" opacity="0.5" />
        </>)}
        {kind === 'forceps' && (<>
          <path d="M22 50 C40 34 120 34 282 47" />
          <path d="M22 50 C40 66 120 66 282 53" />
          <path d="M22 50 C34 46 34 54 22 50" fill="currentColor" fillOpacity="0.2" />
          {[92, 102, 112, 122, 132, 142].map((x) => <path key={x} d={`M${x} ${41} l3 -3M${x} ${59} l3 3`} strokeWidth="1.3" opacity="0.65" />)}
          <path d="M282 47 l8 2 M282 53 l8 -2" strokeWidth="1.6" />
          <path d="M276 47 l3 2.5 M276 53 l3 -2.5" strokeWidth="1.2" opacity="0.7" />
        </>)}
        {kind === 'scissors' && (<>
          <ellipse cx="46" cy="32" rx="20" ry="13" fill="currentColor" fillOpacity="0.06" />
          <ellipse cx="46" cy="68" rx="20" ry="13" fill="currentColor" fillOpacity="0.06" />
          <path d="M65 37 L150 50 M65 63 L150 50" />
          <path d="M150 50 L294 42 L291 48 L152 52 Z" fill="currentColor" fillOpacity="0.14" />
          <path d="M150 50 L294 58 L291 52 L152 48 Z" fill="currentColor" fillOpacity="0.1" />
          <circle cx="150" cy="50" r="4.5" fill="currentColor" fillOpacity="0.3" />
        </>)}
        {kind === 'clamp' && (<>
          <ellipse cx="44" cy="32" rx="18" ry="12" fill="currentColor" fillOpacity="0.06" />
          <ellipse cx="44" cy="68" rx="18" ry="12" fill="currentColor" fillOpacity="0.06" />
          <path d="M61 36 L172 48 M61 64 L172 52" />
          <path d="M78 41 l4 4 l4 -4 l4 4 l4 -4 M78 59 l4 -4 l4 4 l4 -4 l4 4" strokeWidth="1.3" opacity="0.7" />
          <rect x="166" y="44" width="14" height="12" rx="2" fill="currentColor" fillOpacity="0.2" />
          <path d="M180 46.5 Q236 40 292 47.5" />
          <path d="M180 53.5 Q236 60 292 52.5" />
          <path d="M292 47.5 Q296 50 292 52.5" strokeWidth="1.6" />
          {[200, 212, 224, 236, 248, 260, 272].map((x) => <path key={x} d={`M${x} 46.2 l0 2.6 M${x} 53.8 l0 -2.6`} strokeWidth="1.1" opacity="0.6" />)}
        </>)}
        {kind === 'generic' && (<>
          <rect x="22" y="43" width="120" height="14" rx="7" fill="currentColor" fillOpacity="0.08" />
          <path d="M142 50 L292 50" />
          <circle cx="294" cy="50" r="3" fill="currentColor" />
          {[40, 52, 64].map((x) => <path key={x} d={`M${x} 46v8`} strokeWidth="1.4" opacity="0.6" />)}
        </>)}
      </g>
    </svg>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} />;
}

