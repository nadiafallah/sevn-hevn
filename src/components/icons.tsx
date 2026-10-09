type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  "aria-hidden": true as const,
  focusable: "false" as const,
});

export const SearchIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L20 20" />
  </svg>
);

export const BagIcon = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 8h14l-1 12H6L5 8z" />
    <path d="M9 8V6.5a3 3 0 016 0V8" />
  </svg>
);

export const MenuIcon = ({ size = 22, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7h18M3 12h18M3 17h18" />
  </svg>
);

/** Mirrored in right-to-left pages (see "Languages" in globals.css). */
export const ArrowIcon = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className ? `icon-arrow ${className}` : "icon-arrow"}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export const PhoneIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6.5 3.5h3l1.5 4-2 1.3a11 11 0 005.2 5.2l1.3-2 4 1.5v3a2 2 0 01-2 2A16.5 16.5 0 014.5 5.5a2 2 0 012-2z" />
  </svg>
);

export const MailIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="5.5" width="18" height="13" rx="1" />
    <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
  </svg>
);

export const InstagramIcon = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.3" cy="6.7" r="0.6" fill="currentColor" />
  </svg>
);

export const WhatsAppIcon = ({ size = 22, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
    <path
      fill="currentColor"
      d="M12.04 2.5a9.43 9.43 0 00-8.1 14.28L2.5 21.5l4.85-1.4A9.43 9.43 0 1012.04 2.5zm0 17.2a7.77 7.77 0 01-3.96-1.08l-.28-.17-2.88.83.84-2.8-.19-.29a7.78 7.78 0 116.47 3.51zm4.27-5.82c-.23-.12-1.38-.68-1.6-.76-.21-.08-.37-.12-.52.12-.16.23-.6.76-.74.91-.14.16-.27.18-.5.06a6.4 6.4 0 01-1.88-1.16 7.06 7.06 0 01-1.3-1.62c-.14-.23-.02-.36.1-.47.1-.1.23-.27.35-.41.12-.14.16-.23.23-.39.08-.16.04-.29-.02-.41-.06-.12-.52-1.26-.72-1.72-.19-.45-.38-.39-.52-.4h-.45a.86.86 0 00-.62.3 2.6 2.6 0 00-.82 1.94 4.52 4.52 0 00.95 2.4 10.34 10.34 0 003.96 3.5c.55.24.98.38 1.32.49.55.18 1.06.15 1.46.09.44-.07 1.38-.56 1.57-1.1.2-.55.2-1.02.14-1.12-.06-.1-.21-.16-.44-.27z"
    />
  </svg>
);
