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
      <img src={atmos ? '/dolby-atmos-logo.png' : '/dolby-logo.png'} alt="" aria-hidden="true" draggable={false} />
    </span>
  );
}
