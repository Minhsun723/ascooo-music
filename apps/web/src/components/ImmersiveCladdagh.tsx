import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { getAudio } from '../store/player';
import { useLineTransition, useTrackedNodes, type LineRendererProps, type PreparedLine } from './lyricUnits';

// 指環: every glyph sits on a tilted 3D ellipse. The syllable being sung is at the front of the ring
// (largest, sharpest); the rest recede around it, and the ring turns as the song moves on. An
// accent axis through the ring flares on each new syllable.
// (Re-creates the idea of folia-major's Claddagh mode.)

const ENTER = { opacity: 0, scale: 0.9, '--line-blur': '8px' };
const EXIT = { opacity: 0, scale: 1.1, '--line-blur': '12px' };
const TILT = (-24 * Math.PI) / 180; // the ring's major axis rises to the right
const SPACE_EM = 0.35; // width of a word gap on the ring
const WIDE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/; // CJK, kana, hangul, fullwidth
const SPACING = 1.08; // on-screen distance between neighbours, as a multiple of their (scaled) width
const FOLLOW = 7; // how quickly the ring catches up with the clock (per second)
const BACK = Math.PI * 0.96; // glyphs pushed this far round are behind the ring and hidden

const depthAt = (psi: number) => (1 + Math.cos(psi)) / 2; // 1 at the front of the ring, 0 at the back
const scaleAt = (psi: number) => 0.3 + 0.95 * depthAt(psi) ** 1.5;

/**
 * Angle of each glyph on the ring, walking outwards from the front. Each step advances by the glyph's
 * on-screen size over the ellipse's local speed, so spacing stays even where the ring curves away
 * (an even angle step would pile glyphs up at the ends of the major axis) and shrinks with depth.
 */
function ringAngles(glyphs: RingGlyph[], pos: number, major: number, minor: number, font: number) {
  const angles = new Array<number>(glyphs.length);
  const speed = (psi: number) => Math.hypot(major * Math.cos(psi), minor * Math.sin(psi)) || 1;
  const walk = (from: number, to: number, psi: number) => {
    let d = from;
    while (Math.abs(to - d) > 1e-6 && Math.abs(psi) < Math.PI) {
      const h = Math.sign(to - d) * Math.min(0.25, Math.abs(to - d));
      psi += (h * font * SPACING * scaleAt(psi)) / speed(psi);
      d += h;
    }
    return gsap.utils.clamp(-Math.PI, Math.PI, psi);
  };
  let front = glyphs.findIndex((glyph) => glyph.slot >= pos);
  if (front < 0) front = glyphs.length;
  for (let i = front, psi = 0, d = 0; i < glyphs.length; i++) {
    psi = walk(d, glyphs[i].slot - pos, psi);
    d = glyphs[i].slot - pos;
    angles[i] = psi;
  }
  for (let i = front - 1, psi = 0, d = 0; i >= 0; i--) {
    psi = walk(d, glyphs[i].slot - pos, psi);
    d = glyphs[i].slot - pos;
    angles[i] = psi;
  }
  return angles;
}

interface RingGlyph {
  char: string;
  time: number;
  end: number;
  slot: number; // centre of the glyph along the ring, in em
}

function buildRing(line: PreparedLine) {
  // Slots advance by estimated glyph width, so wide CJK glyphs and narrow Latin letters both sit evenly.
  const glyphs: RingGlyph[] = [];
  let em = 0;
  for (const unit of line.units) {
    for (const glyph of unit.glyphs) {
      const width = WIDE.test(glyph.char) ? 1 : 0.62;
      glyphs.push({ ...glyph, slot: em + width / 2 });
      em += width;
    }
    if (unit.spaceAfter) em += SPACE_EM;
  }
  return glyphs;
}

/** Where the front of the ring should be: glyph slots line up with their start times, linear in between. */
function focusSlot(glyphs: RingGlyph[], time: number) {
  const first = glyphs[0];
  const last = glyphs.at(-1);
  if (!first || !last) return 0;
  if (time <= first.time) return first.slot - Math.min(1.5, (first.time - time) * 2);
  for (let i = 1; i < glyphs.length; i++) {
    const next = glyphs[i];
    if (time < next.time) {
      const previous = glyphs[i - 1];
      const span = Math.max(0.001, next.time - previous.time);
      return previous.slot + (next.slot - previous.slot) * Math.min(1, (time - previous.time) / span);
    }
  }
  // After the last syllable, keep drifting slowly so the ring never freezes mid-gap.
  return last.slot + Math.min(1.5, Math.max(0, time - last.time) * 0.4);
}

export function CladdaghLine({ line, leaving, onExited }: LineRendererProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const axisRef = useRef<HTMLSpanElement | null>(null);
  const glyphRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const sizeRef = useRef({ width: 0, height: 0, font: 16 });
  const track = useTrackedNodes();
  const glyphs = useMemo(() => buildRing(line), [line]);

  useLineTransition(rootRef, leaving, onExited, ENTER, EXIT, line);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      sizeRef.current = { width: root.clientWidth, height: root.clientHeight, font: parseFloat(getComputedStyle(root).fontSize) || 16 };
    };
    measure();
    gsap.set(axisRef.current, { xPercent: -50, yPercent: -50, rotation: (TILT * 180) / Math.PI, opacity: 0.4 });
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    return () => resize.disconnect();
  }, []);

  // Recompute every glyph's place on the ring each frame. While leaving, the last frame simply holds.
  useEffect(() => {
    if (leaving) return;
    const audio = getAudio();
    let pos = Number.NaN;
    let last = performance.now();
    let lastActive = -1;
    const cos = Math.cos(TILT);
    const sin = Math.sin(TILT);

    const frame = () => {
      const time = audio?.currentTime ?? 0;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const target = focusSlot(glyphs, time);
      pos = Number.isNaN(pos) ? target : pos + (target - pos) * (1 - Math.exp(-dt * FOLLOW));

      const { width, height, font } = sizeRef.current;
      const major = Math.min(width * 0.42, height * 0.62);
      const minor = major * 0.36;
      const angles = ringAngles(glyphs, pos, Math.max(1, major), Math.max(1, minor), font);

      let active = -1;
      glyphs.forEach((glyph, i) => {
        const el = glyphRefs.current[i];
        if (!el) return;
        if (time >= glyph.time && time <= glyph.end) active = i;
        const psi = angles[i];
        const depth = depthAt(psi);
        const x = major * Math.sin(psi);
        const y = minor * Math.cos(psi);
        el.style.transform = `translate(${(x * cos - y * sin).toFixed(1)}px, ${(x * sin + y * cos).toFixed(1)}px) translate(-50%, -50%) scale(${scaleAt(psi).toFixed(3)})`;
        el.style.opacity = Math.abs(psi) >= BACK ? '0' : (0.08 + 0.92 * depth ** 2).toFixed(3);
        el.style.filter = depth > 0.92 ? 'none' : `blur(${((1 - depth) * 2.6).toFixed(2)}px)`;
        el.style.zIndex = String(Math.round(depth * 100));
        el.style.setProperty('--glow', Math.max(0, 1 - Math.abs(glyph.slot - pos) / 1.2).toFixed(3));
        el.toggleAttribute('data-sung', time >= glyph.time);
      });

      if (active !== lastActive) {
        lastActive = active;
        if (active >= 0) gsap.fromTo(axisRef.current, { opacity: 0.95, scaleX: 1.12 }, { opacity: 0.4, scaleX: 1, duration: 0.7, ease: 'power2.out', overwrite: 'auto' });
      }
    };
    frame();
    gsap.ticker.add(frame);
    return () => gsap.ticker.remove(frame);
  }, [glyphs, leaving]);

  return (
    <div ref={(node) => { rootRef.current = node; track(node); }} className="immersive-line claddagh-line" aria-hidden={leaving || undefined}>
      <span ref={(node) => { axisRef.current = node; track(node); }} className="claddagh-axis" aria-hidden="true" />
      {glyphs.map((glyph, i) => (
        <span key={i} ref={(node) => { glyphRefs.current[i] = node; }} className="claddagh-glyph">{glyph.char}</span>
      ))}
    </div>
  );
}
