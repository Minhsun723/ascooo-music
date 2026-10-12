interface DolbyLogoProps {
  variant?: 'compact' | 'atmos';
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
