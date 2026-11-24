/** Small stroke icons, drawn to match the hand-made card style. */
type P = { size?: number; className?: string };
const base = (size = 22) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const XGlyph = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-4.71-6.23-5.4 6.23H2.75l7.73-8.84L1.25 2.25h6.83l4.26 5.63 5.9-5.63Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
  </svg>
);

export const FlaskIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3" />
    <path d="M7.5 15h9" />
  </svg>
);

export const CrownIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z" />
  </svg>
);

export const LockIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const DnaIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12" />
    <path d="M8.5 7h7M8.5 17h7M10 12h4" />
  </svg>
);

export const BagIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 8h12l-1 12H7L6 8Z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);

export const CalendarIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const CheckIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const BackIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const SoundIcon = ({ size, className, muted }: P & { muted?: boolean }) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    {muted ? <path d="M17 9l4 6M21 9l-4 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
  </svg>
);

export const QuizIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6V14M12 17.2v.1" />
  </svg>
);

export const RopeIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="5.5" cy="7" r="2.5" />
    <circle cx="18.5" cy="7" r="2.5" />
    <path d="M8 7.5c2 6 6 6 8 0" />
    <path d="M4 20l1.5-10.5M20 20l-1.5-10.5" />
  </svg>
);
