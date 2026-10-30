import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';

/**
 * A silent HLS loop for a hero backdrop, played through hls.js (loaded the
 * first time one is shown) wherever Media Source Extensions exist. Only
 * browsers without them (iPhones before iOS 17.1) get the playlist as the
 * video's src: canPlayType is no guide, as Chrome answers "maybe" for HLS and
 * then fails to play Apple's. The video stays transparent until it is
 * actually playing, so the still beneath it shows while it loads or if it
 * fails, and it pauses while scrolled out of view.
 */
export function MotionLoop({ src, className = '', onPlaying }: { src: string; className?: string; onPlaying?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

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
    // autoPlay starts it; this only stops it off screen and resumes it on the way back.
    let offscreen = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        offscreen = true;
        video.pause();
      } else if (offscreen) {
        offscreen = false;
        video.play().catch(() => {});
      }
    });
    observer.observe(video);
    return () => {
      cancelled = true;
      observer.disconnect();
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      className={className}
      data-playing={playing || undefined}
      autoPlay
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
