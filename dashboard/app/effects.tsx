"use client";

import { useEffect, useRef } from 'react';

// Faint medical line icons drifting in the page background, with a slight
// parallax against the mouse. Purely decorative.
const ICONS: { d: string; x: number; y: number; size: number; depth: number; dur: number }[] = [
  { d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z', x: 6, y: 18, size: 46, depth: 18, dur: 14 }, // cross
  { d: 'M7.5 16.5l9-9a3.2 3.2 0 0 1 4.5 4.5l-9 9a3.2 3.2 0 0 1-4.5-4.5zM12 12l4.5 4.5', x: 90, y: 14, size: 40, depth: 12, dur: 17 }, // capsule
  { d: 'M2 12h4l2-5 3 10 3-8 2 3h6', x: 83, y: 62, size: 54, depth: 22, dur: 16 }, // heartbeat
  { d: 'M6 3v6a6 6 0 0 0 12 0V3M12 15v3a3 3 0 0 0 6 0v-1M18 15.5a1.5 1.5 0 1 0 0 .01', x: 4, y: 70, size: 44, depth: 15, dur: 19 }, // stethoscope
  { d: 'M18 3l3 3M16 5l3 3-9.5 9.5-4 1 1-4zM5.5 18.5 3 21', x: 48, y: 88, size: 36, depth: 10, dur: 15 }, // syringe
  { d: 'M12 21s-7-4.4-9.3-9C1 8.5 3.2 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.8 0 6 4 4.3 7.5C19 16.6 12 21 12 21z', x: 30, y: 6, size: 30, depth: 9, dur: 18 }, // heart
  { d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z', x: 64, y: 40, size: 24, depth: 6, dur: 12 }, // small cross
  { d: 'M8 3c0 6 8 6 8 12M16 3c0 6-8 6-8 12M8 21c0-2 8-2 8-6M9 6h6M9 18h6', x: 96, y: 92, size: 38, depth: 14, dur: 20 }, // DNA
];

export function FloatingIcons() {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const onMove = (e: MouseEvent) => {
      layer.current?.style.setProperty('--mx', String(e.clientX / window.innerWidth - 0.5));
      layer.current?.style.setProperty('--my', String(e.clientY / window.innerHeight - 0.5));
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  return (
    <div ref={layer} className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {ICONS.map((ic, i) => (
        <div
          key={i}
          className="absolute"
          style={{ left: `${ic.x}%`, top: `${ic.y}%`, transform: `translate(calc(var(--mx, 0) * ${-ic.depth}px), calc(var(--my, 0) * ${-ic.depth}px))`, transition: 'transform 0.6s ease-out' }}
        >
          <svg className="float-drift text-[#c5d3e6]" style={{ animationDuration: `${ic.dur}s`, animationDelay: `-${i * 2.3}s` }} width={ic.size} height={ic.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d={ic.d} />
          </svg>
        </div>
      ))}
    </div>
  );
}

// Custom pointer for mouse users: a blue dot with a trailing ring. Over anything
// clickable the ring widens and shows a small medical cross. Touch screens and
// text fields keep their normal cursor.
export function MedicalCursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.add('medical-cursor');
    let x = -100, y = -100, rx = -100, ry = -100, raf = 0;

    const onMove = (e: MouseEvent) => {
      x = e.clientX; y = e.clientY;
      dot.current!.style.transform = `translate(${x}px, ${y}px)`;
      dot.current!.style.opacity = '1'; ring.current!.style.opacity = '1';
      const t = e.target as Element | null;
      const text = !!t?.closest('input, textarea, [contenteditable="true"]');
      const hot = !text && !!t?.closest('a, button, [role="button"], select, label, summary');
      ring.current!.dataset.hot = hot ? '1' : '';
      dot.current!.style.visibility = ring.current!.style.visibility = text ? 'hidden' : 'visible';
    };
    const onDown = () => { ring.current!.dataset.down = '1'; };
    const onUp = () => { ring.current!.dataset.down = ''; };
    const onLeave = () => { dot.current!.style.opacity = '0'; ring.current!.style.opacity = '0'; };
    const loop = () => {
      rx += (x - rx) * (still ? 1 : 0.22); ry += (y - ry) * (still ? 1 : 0.22);
      ring.current!.style.transform = `translate(${rx}px, ${ry}px)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('mouseleave', onLeave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove('medical-cursor');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <>
      <div ref={ring} className="cursor-ring" aria-hidden>
        <span className="cursor-ring-circle">
          <svg className="cursor-cross" viewBox="0 0 24 24"><path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z" /></svg>
        </span>
      </div>
      <div ref={dot} className="cursor-dot" aria-hidden />
    </>
  );
}
