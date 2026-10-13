import { useMemo, useState, type CSSProperties } from 'react';
import { artUrl, type ArtworkSize } from '../api/client';
import { IconMusic } from './Icons';

interface ArtworkProps {
  artworkId?: string | null;
  title: string;
  artist?: string;
  className?: string;
  rounded?: 'soft' | 'circle';
  loading?: 'eager' | 'lazy';
  size?: ArtworkSize;
}

function hueFor(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = value.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

export function Artwork({ artworkId, title, artist, className = '', rounded = 'soft', loading = 'lazy', size = 512 }: ArtworkProps) {
  const requestedSrc = artUrl(artworkId, size);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = requestedSrc !== failedSrc ? requestedSrc : null;
  const hue = useMemo(() => hueFor(`${title}${artist ?? ''}`), [artist, title]);
  const style = { '--art-hue': hue } as CSSProperties;

  return (
    <div className={`artwork artwork--${rounded} ${className}`} style={style}>
      {src ? (
        <img
          src={src}
          alt={`${title}${artist ? `，${artist}` : ''} 封面`}
          loading={loading}
          decoding="async"
          fetchPriority={loading === 'eager' ? 'high' : 'auto'}
          draggable={false}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div className="artwork__fallback" role="img" aria-label={`${title} 的預設封面`}>
          <span className="artwork__orbit" aria-hidden="true" />
          <IconMusic size={30} />
          <strong>{title.slice(0, 1).toUpperCase()}</strong>
        </div>
      )}
    </div>
  );
}
