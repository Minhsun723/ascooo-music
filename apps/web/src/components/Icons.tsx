import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 20, rest: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...rest,
});

const icon = (paths: React.ReactNode, filled = false) =>
  function Icon({ size, ...rest }: P) {
    return <svg {...base(size, rest)} {...(filled ? { fill: 'currentColor', stroke: 'none' } : {})}>{paths}</svg>;
  };

export const IconHome = icon(<><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></>);
export const IconSearch = icon(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconLibrary = icon(<><path d="M5 4v16M9.5 4v16" /><path d="m14 4.6 4.6 15" /></>);
export const IconHeart = icon(<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />);
export const IconHeartFill = icon(<path d="M12 20.6s-8.3-5-8.3-11A4.9 4.9 0 0 1 12 6.6a4.9 4.9 0 0 1 8.3 3c0 6-8.3 11-8.3 11z" />, true);
export const IconPlay = icon(<path d="M7.5 4.8v14.4a.9.9 0 0 0 1.4.8l11.2-7.2a.9.9 0 0 0 0-1.6L8.9 4a.9.9 0 0 0-1.4.8z" />, true);
export const IconPause = icon(<><rect x="6" y="4.5" width="4.2" height="15" rx="1.2" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" /></>, true);
export const IconNext = icon(<><path d="M5 5.6v12.8a.8.8 0 0 0 1.2.7L16 12.7a.8.8 0 0 0 0-1.4L6.2 4.9A.8.8 0 0 0 5 5.6z" /><rect x="17.2" y="4.5" width="2.6" height="15" rx="1" /></>, true);
export const IconPrev = icon(<><path d="M19 5.6v12.8a.8.8 0 0 1-1.2.7L8 12.7a.8.8 0 0 1 0-1.4l9.8-6.4a.8.8 0 0 1 1.2.7z" /><rect x="4.2" y="4.5" width="2.6" height="15" rx="1" /></>, true);
export const IconShuffle = icon(<><path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21" /><path d="M3 17h3.5c1.3 0 2.2-.4 3-1.2M13.7 8.2c.8-.8 1.7-1.2 3-1.2H21" /><path d="m18.5 4.5 2.5 2.5-2.5 2.5M18.5 14.5l2.5 2.5-2.5 2.5" /></>);
export const IconRepeat = icon(<><path d="M17 3.5 20 6.5l-3 3" /><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20" /><path d="M7 20.5 4 17.5l3-3" /><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" /></>);
export const IconRepeatOne = icon(<><path d="M17 3.5 20 6.5l-3 3" /><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20" /><path d="M7 20.5 4 17.5l3-3" /><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" /><path d="M11.2 10.6 12.5 10v4.5" /></>);
export const IconVolume = icon(<><path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>);
export const IconVolumeLow = icon(<><path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6" /></>);
export const IconMute = icon(<><path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>);
export const IconQueue = icon(<><path d="M4 6h12M4 11h12M4 16h7" /><path d="M15.5 14.5v5.5l4.5-2.75z" fill="currentColor" stroke="none" /></>);
export const IconLyrics = icon(<><path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" /><path d="M8 9.5h8M8 12.5h5" /></>);
export const IconChevronDown = icon(<path d="m6 9 6 6 6-6" />);
export const IconChevronLeft = icon(<path d="m15 6-6 6 6 6" />);
export const IconChevronRight = icon(<path d="m9 6 6 6-6 6" />);
export const IconPlus = icon(<path d="M12 5v14M5 12h14" />);
export const IconMore = icon(<><circle cx="5.5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18.5" cy="12" r="1.4" fill="currentColor" /></>);
export const IconSettings = icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconDisc = icon(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.5" /></>);
export const IconMic = icon(<><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></>);
export const IconLogout = icon(<><path d="M15 4.5h3a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>);
export const IconClose = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const IconTrash = icon(<><path d="M4.5 7h15M10 11v6M14 11v6" /><path d="M6 7l.8 11.2A2 2 0 0 0 8.8 20h6.4a2 2 0 0 0 2-1.8L18 7M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>);
export const IconSync = icon(<><path d="M20 11a8 8 0 0 0-14.7-4.3L4 8.5" /><path d="M4 4v4.5h4.5" /><path d="M4 13a8 8 0 0 0 14.7 4.3L20 15.5" /><path d="M20 20v-4.5h-4.5" /></>);
export const IconClock = icon(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IconMusic = icon(<><path d="M9 18V5.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>);
export const IconUser = icon(<><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>);
export const IconPlaylistAdd = icon(<><path d="M4 6h12M4 11h12M4 16h7" /><path d="M17.5 14v6M14.5 17h6" /></>);
export const IconNextUp = icon(<><path d="M4 6h10M4 11h10M4 16h6" /><path d="m16 13 4 3-4 3z" fill="currentColor" stroke="none" /></>);
export const IconCheck = icon(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconWave = icon(<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21 12h0" />);
export const IconEye = icon(<><path d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6z" /><circle cx="12" cy="12" r="2.7" /></>);
export const IconEyeOff = icon(<><path d="m4 4 16 16" /><path d="M10.3 6.2A9.8 9.8 0 0 1 12 6c5.9 0 9.2 6 9.2 6a13.5 13.5 0 0 1-2.2 3.1M6.8 7.1A14.1 14.1 0 0 0 2.8 12s3.3 6 9.2 6a9.7 9.7 0 0 0 3.1-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>);
