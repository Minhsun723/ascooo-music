import gsap from 'gsap';
import type { ImmersiveStyle } from '../store/preferences';

/** Styles expressed purely as per-word poses; the others have their own renderers. */
export type WordStyle = Exclude<ImmersiveStyle, 'partita' | 'tilt' | 'claddagh' | 'cappella'>;

/** Resting geometry of one word; each style decides what the fields mean for its motion. */
export interface UnitLayout {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  fromX: number;
  fromY: number;
  drift: number;
}

type Random = () => number;

export interface StyleDefinition {
  /** Where the wrapped line block sits in the stage. */
  layout: (random: Random) => { justify: string; align: string };
  /** Per-word offsets; omitted fields are 0 (scale 1). */
  unit: (random: Random) => Partial<UnitLayout>;
  /** Pose of a word before it is sung; also tweened back to when seeking backwards. */
  waiting: (unit: UnitLayout) => gsap.TweenVars;
  /** Start the tweens for a word that is being sung. Earlier tweens on it are already killed. */
  active: (el: HTMLElement, unit: UnitLayout) => void;
  passed: (el: HTMLElement, unit: UnitLayout) => void;
  /** Largest and settled scale a word reaches, so neighbours can be spaced not to collide. */
  peakScale: (unit: UnitLayout) => number;
  restScale: (unit: UnitLayout) => number;
  /** Gap (em) between units the source wrote without a space, e.g. CJK words. */
  gap: number;
  /** Line entrance starts from these vars; exit tweens to them. */
  enter: gsap.TweenVars;
  exit: gsap.TweenVars;
  /** Slow breathing drift on the whole stage. */
  float: boolean;
}

const spread = (random: Random, amount: number) => (random() - 0.5) * 2 * amount;
const pick = <T,>(random: Random, options: T[]) => options[Math.floor(random() * options.length)];
const centered = () => ({ justify: 'center', align: 'center' });

const DEPTH_PERSPECTIVE = 900; // keep in sync with the perspective in styles.css
const DEPTH_ACTIVE_Z = 70;
const DEPTH_PASSED_Z = -160;

export const IMMERSIVE_STYLE_DEFINITIONS: Record<WordStyle, StyleDefinition> = {
  // Words scattered and tilted, swelling in on a spring as they are sung.
  scatter: {
    layout: (random) => ({
      justify: pick(random, ['center', 'center', 'flex-start', 'flex-end']),
      align: pick(random, ['center', 'center', 'flex-start', 'flex-end']),
    }),
    unit: (random) => ({
      x: spread(random, 18),
      y: spread(random, 18),
      rotate: spread(random, 5),
      scale: 1 + random() * 0.14,
      fromX: spread(random, 80),
      fromY: spread(random, 45),
      drift: spread(random, 10),
    }),
    waiting: (u) => ({ opacity: 0, x: u.x + u.fromX, y: u.y + u.fromY, scale: u.scale * 0.55, rotation: u.rotate + u.drift * 2, '--blur': '10px', '--glow': 0 }),
    active: (el, u) => {
      gsap.to(el, { opacity: 1, duration: 0.12, ease: 'none' });
      gsap.to(el, { x: u.x, y: u.y, scale: u.scale * 1.28, rotation: u.rotate, '--blur': '0px', '--glow': 1, duration: 0.6, ease: 'back.out(1.8)' });
    },
    passed: (el, u) => {
      gsap.to(el, { opacity: 0.82, x: u.x, y: u.y, scale: u.scale, '--blur': '0px', '--glow': 0, duration: 0.6, ease: 'power2.out' });
      gsap.to(el, { rotation: u.rotate + u.drift, duration: 5, ease: 'none' });
    },
    peakScale: (u) => u.scale * 1.28,
    restScale: (u) => u.scale,
    gap: 0.18,
    enter: { opacity: 0, scale: 0.92, '--line-blur': '10px' },
    exit: { opacity: 0, scale: 1.08, '--line-blur': '18px' },
    float: true,
  },

  // The whole line is readable up front; a soft wipe fills each word in time (see styles.css).
  calm: {
    layout: centered,
    unit: () => ({}),
    waiting: () => ({ opacity: 1, yPercent: 0, scale: 1, '--blur': '0px', '--glow': 0 }),
    active: (el) => { gsap.to(el, { yPercent: -5, scale: 1.05, '--glow': 1, duration: 0.5, ease: 'power2.out' }); },
    passed: (el) => { gsap.to(el, { yPercent: 0, scale: 1, '--glow': 0, duration: 0.7, ease: 'power2.inOut' }); },
    peakScale: () => 1.05,
    restScale: () => 1,
    gap: 0.04,
    enter: { opacity: 0, y: 36, '--line-blur': '6px' },
    exit: { opacity: 0, y: -36, '--line-blur': '6px' },
    float: false,
  },

  // Words fly in from far behind the screen and sink back once sung.
  depth: {
    layout: (random) => ({ justify: 'center', align: pick(random, ['center', 'center', 'flex-start', 'flex-end']) }),
    unit: (random) => ({ y: spread(random, 10), rotate: spread(random, 14), fromX: spread(random, 120) }),
    waiting: (u) => ({ opacity: 0, x: u.fromX, y: u.y + 30, z: -700, rotationX: 55, rotationY: u.rotate * 2, '--blur': '6px', '--glow': 0 }),
    active: (el, u) => {
      gsap.to(el, { opacity: 1, duration: 0.2, ease: 'none' });
      gsap.to(el, { x: 0, y: u.y, z: DEPTH_ACTIVE_Z, rotationX: 0, rotationY: u.rotate * 0.4, '--blur': '0px', '--glow': 1, duration: 0.75, ease: 'expo.out' });
    },
    passed: (el, u) => {
      gsap.to(el, { opacity: 0.55, x: 0, y: u.y, z: DEPTH_PASSED_Z, rotationX: 0, rotationY: u.rotate, '--blur': '0px', '--glow': 0, duration: 1.1, ease: 'power3.out' });
    },
    peakScale: () => DEPTH_PERSPECTIVE / (DEPTH_PERSPECTIVE - DEPTH_ACTIVE_Z),
    restScale: () => DEPTH_PERSPECTIVE / (DEPTH_PERSPECTIVE - DEPTH_PASSED_Z),
    gap: 0.14,
    enter: { opacity: 0, z: -400, '--line-blur': '8px' },
    exit: { opacity: 0, z: 300, '--line-blur': '14px' },
    float: true,
  },

  // Each word hops on its beat with a squash and stretch, lit in the cover's accent.
  bounce: {
    layout: centered,
    unit: (random) => ({ rotate: spread(random, 4) }),
    waiting: () => ({ opacity: 0.4, yPercent: 0, scaleX: 1, scaleY: 1, rotation: 0, '--blur': '0px', '--glow': 0 }),
    active: (el, u) => {
      gsap.timeline()
        .to(el, { opacity: 1, '--glow': 1, scaleX: 1.12, scaleY: 0.86, duration: 0.08, ease: 'power1.out' })
        .to(el, { yPercent: -32, scaleX: 0.94, scaleY: 1.1, rotation: u.rotate, duration: 0.2, ease: 'power2.out' })
        .to(el, { yPercent: 0, scaleX: 1.06, scaleY: 0.94, duration: 0.18, ease: 'power2.in' })
        .to(el, { scaleX: 1, scaleY: 1, duration: 0.5, ease: 'elastic.out(1, 0.45)' });
    },
    // Short words can end mid-hop, so landing resets the whole pose.
    passed: (el) => { gsap.to(el, { opacity: 0.9, yPercent: 0, scaleX: 1, scaleY: 1, rotation: 0, '--glow': 0, duration: 0.45, ease: 'power2.out' }); },
    peakScale: () => 1.12,
    restScale: () => 1,
    gap: 0.08,
    enter: { opacity: 0, scale: 0.9 },
    exit: { opacity: 0, scale: 0.96, '--line-blur': '8px' },
    float: false,
  },

  // Words condense out of a haze, then blur and drift upwards as they fade.
  mist: {
    layout: (random) => ({ justify: 'center', align: pick(random, ['center', 'center', 'flex-start', 'flex-end']) }),
    unit: (random) => ({ y: spread(random, 6), drift: 10 + random() * 14 }),
    waiting: (u) => ({ opacity: 0, y: u.y + 12, scale: 1.12, '--blur': '18px', '--glow': 0 }),
    active: (el, u) => { gsap.to(el, { opacity: 1, y: u.y, scale: 1.04, '--blur': '0px', '--glow': 1, duration: 0.8, ease: 'power2.out' }); },
    passed: (el, u) => { gsap.to(el, { opacity: 0.5, y: u.y - u.drift, scale: 1, '--blur': '2px', '--glow': 0, duration: 1.8, ease: 'sine.out' }); },
    peakScale: () => 1.04,
    restScale: () => 1,
    gap: 0.1,
    enter: { opacity: 0, '--line-blur': '12px' },
    exit: { opacity: 0, y: -24, '--line-blur': '20px' },
    float: true,
  },

  // A notebook line: a highlighter in the cover's accent swipes under each word (see styles.css).
  marker: {
    layout: () => ({ justify: 'flex-start', align: 'center' }),
    unit: (random) => ({ rotate: spread(random, 1.5) }),
    waiting: () => ({ opacity: 1, scale: 1, rotation: 0, '--glow': 0, '--blur': '0px' }),
    active: (el, u) => { gsap.to(el, { scale: 1.04, rotation: u.rotate, duration: 0.3, ease: 'power2.out' }); },
    passed: (el) => { gsap.to(el, { scale: 1, rotation: 0, duration: 0.4, ease: 'power2.inOut' }); },
    peakScale: () => 1.04,
    restScale: () => 1,
    gap: 0.06,
    enter: { opacity: 0, x: -24 },
    exit: { opacity: 0, x: 24, '--line-blur': '4px' },
    float: false,
  },

  // Split-flap board: each word flips up on its hinge (perspective in styles.css).
  flip: {
    layout: centered,
    unit: () => ({}),
    waiting: () => ({ opacity: 0, rotationX: -95, yPercent: 20, '--glow': 0, '--blur': '0px' }),
    active: (el) => {
      gsap.to(el, { opacity: 1, duration: 0.1, ease: 'none' });
      gsap.to(el, { rotationX: 0, yPercent: 0, '--glow': 1, duration: 0.55, ease: 'back.out(2)' });
    },
    passed: (el) => { gsap.to(el, { opacity: 0.85, rotationX: 0, yPercent: 0, '--glow': 0, duration: 0.5, ease: 'power2.out' }); },
    peakScale: () => 1,
    restScale: () => 1,
    gap: 0.1,
    enter: { opacity: 0 },
    exit: { opacity: 0, y: -30, '--line-blur': '6px' },
    float: false,
  },

  // Words drop from huge onto the page; the impact gives the whole line a small jolt.
  slam: {
    layout: (random) => ({ justify: 'center', align: pick(random, ['center', 'center', 'flex-start', 'flex-end']) }),
    unit: (random) => ({ x: spread(random, 6), rotate: spread(random, 3) }),
    waiting: (u) => ({ opacity: 0, x: u.x, scale: 2.6, rotation: u.rotate * 3, '--blur': '8px', '--glow': 0 }),
    active: (el, u) => {
      gsap.timeline()
        .to(el, { opacity: 1, scale: 0.94, rotation: u.rotate, '--blur': '0px', '--glow': 1, duration: 0.16, ease: 'power4.in' })
        .to(el, { scale: 1.08, duration: 0.12, ease: 'power2.out' })
        .to(el, { scale: 1, duration: 0.3, ease: 'power2.inOut' });
      // xPercent is untouched by the line's own enter/exit tweens, so the jolt never fights them.
      const line = el.parentElement;
      if (line) gsap.fromTo(line, { xPercent: -0.8 }, { xPercent: 0, duration: 0.35, delay: 0.16, ease: 'elastic.out(1, 0.3)', overwrite: 'auto' });
    },
    passed: (el, u) => { gsap.to(el, { opacity: 0.8, scale: 1, rotation: u.rotate, '--blur': '0px', '--glow': 0, duration: 0.5, ease: 'power2.out' }); },
    peakScale: () => 1.08,
    restScale: () => 1,
    gap: 0.14,
    enter: { opacity: 0 },
    exit: { opacity: 0, scale: 0.9, '--line-blur': '10px' },
    float: false,
  },

  // Outlined tubes that flicker on in the cover's accent and stay lit (see styles.css).
  neon: {
    layout: centered,
    unit: () => ({}),
    waiting: () => ({ opacity: 1, '--glow': 0, '--blur': '0px' }),
    active: (el) => {
      gsap.timeline()
        .to(el, { '--glow': 1, duration: 0.05, ease: 'none' })
        .to(el, { '--glow': 0.2, duration: 0.05, ease: 'none' })
        .to(el, { '--glow': 1, duration: 0.05, ease: 'none' })
        .to(el, { '--glow': 0.4, duration: 0.08, ease: 'none' })
        .to(el, { '--glow': 1, duration: 0.12, ease: 'none' });
    },
    passed: (el) => { gsap.to(el, { '--glow': 0.35, duration: 0.8, ease: 'power2.out' }); },
    peakScale: () => 1,
    restScale: () => 1,
    gap: 0.1,
    enter: { opacity: 0 },
    exit: { opacity: 0, '--line-blur': '6px' },
    float: true,
  },
};

/** prefers-reduced-motion: no travel, scale or blur — words only brighten in place. */
export const REDUCED_STYLE: StyleDefinition = {
  layout: centered,
  unit: () => ({}),
  waiting: () => ({ opacity: 0.35, '--blur': '0px', '--glow': 0 }),
  active: (el) => { gsap.to(el, { opacity: 1, '--glow': 1, duration: 0.2, ease: 'none' }); },
  passed: (el) => { gsap.to(el, { opacity: 0.8, '--glow': 0, duration: 0.3, ease: 'none' }); },
  peakScale: () => 1,
  restScale: () => 1,
  gap: 0.1,
  enter: { opacity: 0 },
  exit: { opacity: 0 },
  float: false,
};
