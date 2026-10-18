import { canPlayAtmos } from '../store/player';

type LogoVariant = 'compact' | 'atmos';

interface DolbyLogoProps {
  variant?: LogoVariant;
  className?: string;
}

export function DolbyLogo({ variant = 'compact', className = '' }: DolbyLogoProps) {
  const atmos = variant === 'atmos';
  return (
    <span
      className={`dolby-logo dolby-logo--${variant} ${className}`}
      role="img"
      aria-label="Dolby Atmos"
      title="Dolby Atmos"
    >
      <picture>
        {atmos ? <source media="(max-width: 1220px)" srcSet="/dolby-logo.png" /> : null}
        <img src={atmos ? '/dolby-atmos-logo.png' : '/dolby-logo.png'} alt="" aria-hidden="true" draggable={false} />
      </picture>
    </span>
  );
}

/** The AAC 5.1 mark, sized to sit where the Dolby logo would. */
export function SurroundLogo({ variant = 'compact', className = '' }: DolbyLogoProps) {
  return (
    <span className={`surround-logo surround-logo--${variant} ${className}`} role="img" aria-label="AAC 5.1" title="AAC 5.1">
      <svg viewBox="0 0 19 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2.2H3l-.5 4.4c.8-.6 1.7-.8 2.6-.8 2 0 3.3 1.4 3.3 3.2 0 1.9-1.4 3.2-3.4 3.2-1.3 0-2.3-.6-2.9-1.5" />
        <circle cx="11.2" cy="11.2" r="1.15" fill="currentColor" stroke="none" />
        <path d="M14 4.2 16.6 2v10.2" />
      </svg>
    </span>
  );
}

/** Whether Atmos content has a version this browser can play, and so a mark worth showing. */
export const hasAtmosMark = (hasAac51: boolean | undefined) => canPlayAtmos || !!hasAac51;

/** Dolby Atmos where this browser decodes EC-3, AAC 5.1 where it falls back to that copy, nothing otherwise. */
export function AtmosMark({ hasAac51, ...props }: DolbyLogoProps & { hasAac51: boolean | undefined }) {
  if (canPlayAtmos) return <DolbyLogo {...props} />;
  return hasAac51 ? <SurroundLogo {...props} /> : null;
}
