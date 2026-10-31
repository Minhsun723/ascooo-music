import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';

/**
 * A silent HLS loop for a hero backdrop, played through hls.js (loaded the
 * first time one is shown) wherever Media Source Extensions exist. Only
 * browsers without them (iPhones before iOS 17.1) get the playlist as the
 * video's src: canPlayType is no guide, as Chrome answers "maybe" for HLS and
 * then fails to play Apple's. The video stays transparent until it is
 * actually playing, so the still beneath it shows while it loads or if it
 * fails. It plays only while `paused` is unset and some of it is on screen,
 * with `rootMargin` (as an IntersectionObserver takes it) trimming the screen
 * of anything that covers it, such as a sticky bar.
 */
export function MotionLoop({ src, paused = false, rootMargin, className = '', onPlaying }: { src: string; paused?: boolean; rootMargin?: string; className?: string; onPlaying?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    let cancelled = false;
    setPlaying(false);
    video.muted = true;
    if (!('MediaSource' in window || 'ManagedMediaSource' in window)) {
      video.src = src;
    } else {
      import('hls.js/light').then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          video.src = src;
          return;
        }
        // Apple's segments are fMP4 and need no transmuxing, so no worker (which the CSP would refuse anyway).
        hls = new Hls({ enableWorker: false, capLevelToPlayerSize: true, maxBufferLength: 12 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          hls?.destroy();
          hls = null;
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { rootMargin });
    observer.observe(video);
    return () => observer.disconnect();
  }, [rootMargin]);

  // Autoplay starts it once enough has loaded, if it should be playing by then; play() and pause() do the rest. A
  // play() before the stream is attached is cut short by the attaching, which autoplay then takes over from.
  const run = onScreen && !paused;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.autoplay = run;
    if (run) video.play().catch(() => {});
    else video.pause();
  }, [run]);

  return (
    <video
      ref={videoRef}
      className={className}
      data-playing={playing || undefined}
      muted
      loop
      playsInline
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => {
        setPlaying(true);
        onPlaying?.();
      }}
    />
  );
}
