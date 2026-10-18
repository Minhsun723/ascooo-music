'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';

import './RubberSegment.css';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SPRING_UI = { type: 'spring' as const, duration: 0.3, bounce: 0 };
const SPRING_MOMENTUM = { type: 'spring' as const, duration: 0.4, bounce: 0.2 };
const SPRING_RELAX = { type: 'spring' as const, duration: 0.16, bounce: 0 };
const DILATE = 0.19;
const HANDOFF = 0.15;
const FLICK = 110;
const MAX_VELOCITY = 2000;
const DEADZONE = 4;
const SLOP = 10;
const RUBBER = 0.55;
const SIZES = {
  sm: { height: 28, font: 12, pad: 10, min: 36 },
  md: { height: 36, font: 13, pad: 14, min: 44 },
  lg: { height: 44, font: 14, pad: 18, min: 48 }
};

type SegmentOption = {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Shown dimmed; taps, drags and arrow keys skip over it. */
  disabled?: boolean;
};

type RubberSegmentItem = string | SegmentOption;

type RubberSegmentProps = {
  items: readonly RubberSegmentItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, index: number) => void;
  trackColor?: string;
  thumbColor?: string;
  textColor?: string;
  activeTextColor?: string;
  size?: keyof typeof SIZES;
  radius?: number;
  inset?: number;
  equalSlots?: boolean;
  stretch?: number;
  squash?: number;
  speed?: number;
  glide?: number;
  draggable?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
};

type Slot = { l: number; r: number };

type DragState = {
  id: number;
  x0: number;
  slot: number;
  onThumb: boolean;
  live: boolean;
  offset: number;
  w: number;
  hist: Array<[number, number]>;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rubber = (over: number, dim: number) => (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over));
const project = (velocity: number, glide: number) => {
  const decay = 1 - 0.1 * Math.pow(0.05, glide / 100);
  return ((velocity / 1000) * decay) / (1 - decay);
};
const velocityOf = (history: Array<[number, number]>, now: number) => {
  const recent = history.filter(([time]) => now - time <= 100);
  if (recent.length < 2) return 0;
  const [t0, x0] = recent[0];
  const [t1, x1] = recent[recent.length - 1];
  return t1 - t0 >= 8 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
};
const nearestSlot = (slots: Slot[], x: number, allowed: (index: number) => boolean) => {
  let best = -1;
  for (let index = 0; index < slots.length; index += 1) {
    if (!allowed(index)) continue;
    if (best < 0 || Math.abs((slots[index].l + slots[index].r) / 2 - x) < Math.abs((slots[best].l + slots[best].r) / 2 - x)) best = index;
  }
  return Math.max(0, best);
};

export function RubberSegment({
  items,
  value,
  defaultValue,
  onChange,
  trackColor = '#27272a',
  thumbColor = '#fafafa',
  textColor = '#fafafa',
  activeTextColor = '#18181b',
  size = 'md',
  radius = 10,
  inset = 3,
  equalSlots = true,
  stretch = 100,
  squash = 3,
  speed = 1,
  glide = 75,
  draggable = true,
  disabled = false,
  className = '',
  'aria-label': ariaLabel = 'Segmented control'
}: RubberSegmentProps) {
  const list: SegmentOption[] = items.map((item) => (typeof item === 'string' ? { value: item, label: item } : item));
  const [inner, setInner] = useState(defaultValue ?? list[0]?.value);
  const current = value !== undefined ? value : inner;
  const index = Math.max(0, list.findIndex((item) => item.value === current));
  const reduce = useReducedMotion();
  const enabled = (itemIndex: number) => !!list[itemIndex] && !list[itemIndex].disabled;
  /** The next enabled item from `from` in `direction`, or `from` itself when there is none. */
  const step = (from: number, direction: number) => {
    for (let next = from + direction; next >= 0 && next < list.length; next += direction) {
      if (enabled(next)) return next;
    }
    return from;
  };

  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const slots = useRef<Slot[]>([]);
  const box = useRef<DOMRect | null>(null);
  const committed = useRef(index);
  const handoff = useRef<number | undefined>(undefined);
  const drag = useRef<DragState | null>(null);
  const generation = useRef(0);

  const edgeL = useMotionValue(0);
  const edgeR = useMotionValue(0);
  const innerW = useMotionValue(0);
  const thumbRadius = Math.max(0, radius - inset);
  const clipPath = useTransform(
    () => `inset(0 ${Math.max(0, innerW.get() - edgeR.get())}px 0 ${Math.max(0, edgeL.get())}px round ${thumbRadius}px)`
  );

  const duration = (seconds: number) => seconds / speed;

  const jumpTo = (nextIndex: number) => {
    const slot = slots.current[nextIndex];
    if (!slot) return;
    window.clearTimeout(handoff.current);
    generation.current += 1;
    edgeL.jump(slot.l);
    edgeR.jump(slot.r);
  };

  const measure = () => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    box.current = rect;
    slots.current = list.map((_, itemIndex) => {
      const element = itemRefs.current[itemIndex];
      if (!element) return { l: 0, r: 0 };
      const itemRect = element.getBoundingClientRect();
      return { l: itemRect.left - rect.left - inset, r: itemRect.right - rect.left - inset };
    });
    innerW.set(rect.width - inset * 2);
    jumpTo(committed.current);
  };

  const listKey = list.map((item) => item.value).join('|');
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    if (typeof document !== 'undefined' && document.fonts) void document.fonts.ready.then(measure);
    return () => observer.disconnect();
    // The item values, size and layout props fully describe the measurements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, size, inset, equalSlots]);

  useEffect(() => {
    if (!drag.current && committed.current !== index) {
      committed.current = index;
      jumpTo(index);
    }
  });

  useEffect(
    () => () => {
      window.clearTimeout(handoff.current);
      edgeL.stop();
      edgeR.stop();
    },
    [edgeL, edgeR]
  );

  const commit = (nextIndex: number) => {
    committed.current = nextIndex;
    if (nextIndex === index) return;
    if (value === undefined) setInner(list[nextIndex].value);
    onChange?.(list[nextIndex].value, nextIndex);
  };

  const land = (to: number, velocity: number | null, flick: boolean, withSquash: boolean) => {
    const target = slots.current[to];
    if (!target) return;
    const currentGeneration = ++generation.current;
    const direction = Math.sign((target.l + target.r) / 2 - (edgeL.get() + edgeR.get()) / 2) || 1;
    const [lead, leadTo, trail, trailTo] = direction > 0
      ? [edgeR, target.r, edgeL, target.l]
      : [edgeL, target.l, edgeR, target.r];
    const velocityFor = (motionValue: typeof edgeL) => clamp(velocity === null ? motionValue.getVelocity() : velocity, -MAX_VELOCITY, MAX_VELOCITY);
    animate(lead, leadTo, {
      ...(flick ? SPRING_MOMENTUM : SPRING_UI),
      duration: duration(flick ? 0.4 : 0.3),
      velocity: velocityFor(lead)
    });
    const trailVelocity = velocityFor(trail);
    if (!withSquash || squash <= 0) {
      animate(trail, trailTo, { ...SPRING_UI, duration: duration(0.3), velocity: trailVelocity });
      return;
    }
    animate(trail, trailTo + direction * squash, { ...SPRING_UI, duration: duration(0.3), velocity: trailVelocity }).then(() => {
      if (generation.current === currentGeneration) animate(trail, trailTo, { ...SPRING_RELAX, duration: duration(0.16) });
    });
  };

  const travel = (from: number, to: number) => {
    const start = slots.current[from];
    const target = slots.current[to];
    if (!start || !target) return;
    window.clearTimeout(handoff.current);
    generation.current += 1;
    if (reduce) {
      edgeL.jump(target.l);
      edgeR.jump(target.r);
      return;
    }
    const stretchAmount = stretch / 100;
    const tween = { duration: duration(DILATE), ease: EASE_OUT };
    animate(edgeL, target.l + (Math.min(start.l, target.l) - target.l) * stretchAmount, tween);
    animate(edgeR, target.r + (Math.max(start.r, target.r) - target.r) * stretchAmount, tween);
    handoff.current = window.setTimeout(() => land(to, null, false, true), duration(HANDOFF) * 1000);
  };

  const localX = (event: ReactPointerEvent) => event.clientX - (box.current ? box.current.left : 0) - inset;

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, itemIndex: number) => {
    if (disabled || !enabled(itemIndex) || drag.current || event.button !== 0) return;
    if (!trackRef.current) return;
    box.current = trackRef.current.getBoundingClientRect();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional on older browsers.
    }
    const x = localX(event);
    const onThumb = draggable && x >= edgeL.get() && x <= edgeR.get();
    drag.current = { id: event.pointerId, x0: x, slot: itemIndex, onThumb, live: false, offset: 0, w: 0, hist: [[event.timeStamp, x]] };
    if (onThumb) {
      window.clearTimeout(handoff.current);
      generation.current += 1;
      edgeL.stop();
      edgeR.stop();
    } else if (!reduce) {
      event.currentTarget.dataset.pressed = '';
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || event.pointerId !== currentDrag.id || !currentDrag.onThumb) return;
    const x = localX(event);
    currentDrag.hist.push([event.timeStamp, x]);
    if (currentDrag.hist.length > 8) currentDrag.hist.shift();
    if (!currentDrag.live) {
      if (Math.abs(x - currentDrag.x0) < DEADZONE) return;
      currentDrag.live = true;
      currentDrag.offset = x - edgeL.get();
      currentDrag.w = edgeR.get() - edgeL.get();
      if (trackRef.current) trackRef.current.dataset.held = '';
    }
    const width = innerW.get();
    const left = x - currentDrag.offset;
    const maxLeft = width - currentDrag.w;
    if (reduce) {
      const clampedLeft = clamp(left, 0, maxLeft);
      edgeL.set(clampedLeft);
      edgeR.set(clampedLeft + currentDrag.w);
    } else if (left < 0) {
      edgeL.set(0);
      edgeR.set(currentDrag.w - rubber(-left, currentDrag.w));
    } else if (left > maxLeft) {
      edgeR.set(width);
      edgeL.set(maxLeft + rubber(left - maxLeft, currentDrag.w));
    } else {
      edgeL.set(left);
      edgeR.set(left + currentDrag.w);
    }
  };

  const release = () => {
    const currentDrag = drag.current;
    if (!currentDrag) return;
    drag.current = null;
    if (trackRef.current) delete trackRef.current.dataset.held;
    const element = itemRefs.current[currentDrag.slot];
    if (element) delete element.dataset.pressed;
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || event.pointerId !== currentDrag.id) return;
    release();
    const x = localX(event);
    if (!currentDrag.live) {
      if (Math.abs(x - currentDrag.x0) <= SLOP && currentDrag.slot !== committed.current && enabled(currentDrag.slot)) {
        const from = committed.current;
        commit(currentDrag.slot);
        travel(from, currentDrag.slot);
      }
      return;
    }
    const velocity = velocityOf(currentDrag.hist, event.timeStamp);
    const flick = Math.abs(velocity) > FLICK;
    let to = nearestSlot(slots.current, (edgeL.get() + edgeR.get()) / 2 + project(velocity, glide), enabled);
    if (flick && to === committed.current) to = step(to, Math.sign(velocity));
    commit(to);
    if (reduce) jumpTo(to);
    else land(to, velocity, flick, flick);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || event.pointerId !== currentDrag.id) return;
    release();
    if (!currentDrag.live) return;
    if (reduce) jumpTo(committed.current);
    else land(committed.current, null, false, false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = step(index, 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = step(index, -1);
    else if (event.key === 'Home') next = step(-1, 1);
    else if (event.key === 'End') next = step(list.length, -1);
    if (next === null || !enabled(next)) return;
    event.preventDefault();
    if (next === index) return;
    commit(next);
    jumpTo(next);
    itemRefs.current[next]?.focus();
  };

  const preset = SIZES[size] || SIZES.md;
  const customProperties = {
    '--rs-track': trackColor,
    '--rs-thumb': thumbColor,
    '--rs-ink': textColor,
    '--rs-ink-active': activeTextColor,
    '--rs-radius': `${radius}px`,
    '--rs-inset': `${inset}px`,
    '--rs-thumb-radius': `${thumbRadius}px`,
    '--rs-h': `${preset.height}px`,
    '--rs-font': `${preset.font}px`,
    '--rs-pad': `${preset.pad}px`,
    '--rs-min': `${preset.min}px`
  } as CSSProperties;

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-equal={equalSlots ? '' : undefined}
      data-draggable={draggable && !disabled ? '' : undefined}
      className={`rubber-segment${className ? ` ${className}` : ''}`}
      style={customProperties}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      {list.map((item, itemIndex) => (
        <button
          key={item.value}
          ref={(element) => {
            itemRefs.current[itemIndex] = element;
          }}
          type="button"
          role="radio"
          aria-checked={itemIndex === index}
          tabIndex={itemIndex === index ? 0 : -1}
          disabled={disabled || item.disabled}
          className="rubber-segment__item"
          onPointerDown={(event) => handlePointerDown(event, itemIndex)}
          onKeyDown={handleKeyDown}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      <motion.div className="rubber-segment__thumb" aria-hidden="true" style={{ clipPath }}>
        {list.map((item) => (
          <span key={item.value} className="rubber-segment__item rubber-segment__copy">
            {item.icon}
            {item.label}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
