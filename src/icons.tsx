import React from 'react';

const I = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Icons = {
  select: (
    <I>
      <path d="M5 3l14 8-6 2-2 6z" />
    </I>
  ),
  node: (
    <I>
      <rect x="6" y="6" width="12" height="12" rx="1" />
      <circle cx="6" cy="12" r="2.2" fill="currentColor" />
      <circle cx="18" cy="9" r="2.2" fill="currentColor" />
    </I>
  ),
  wire: (
    <I>
      <circle cx="4" cy="18" r="2" />
      <circle cx="20" cy="6" r="2" />
      <path d="M6 18h5a2 2 0 002-2V8a2 2 0 012-2h3" />
    </I>
  ),
  box: (
    <I>
      <rect x="4" y="6" width="16" height="12" rx="2" />
    </I>
  ),
  line: (
    <I>
      <path d="M4 18l6-10 4 6 6-9" />
    </I>
  ),
  text: (
    <I>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </I>
  ),
  image: (
    <I>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-8 8" />
    </I>
  ),
  undo: (
    <I>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </I>
  ),
  redo: (
    <I>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 000 12h3" />
    </I>
  ),
  ortho: (
    <I>
      <path d="M4 20V10a2 2 0 012-2h12" />
      <path d="M15 5l3 3-3 3" />
    </I>
  ),
  snap: (
    <I>
      <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />
    </I>
  ),
  grid: (
    <I>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 12h16M12 4v16" />
    </I>
  ),
  organize: (
    <I>
      <path d="M3 6h7a2 2 0 012 2v8a2 2 0 002 2h7" />
      <path d="M3 12h18" />
      <path d="M3 18h4a2 2 0 002-2V8a2 2 0 012-2h10" strokeDasharray="2 2" />
    </I>
  ),
  rotate: (
    <I>
      <path d="M20 11a8 8 0 10-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </I>
  ),
  flip: (
    <I>
      <path d="M12 3v18" strokeDasharray="2 2" />
      <path d="M9 7L4 17h5zM15 7l5 10h-5z" />
    </I>
  ),
  group: (
    <I>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 2" />
      <rect x="7" y="7" width="5" height="5" />
      <rect x="12" y="12" width="5" height="5" />
    </I>
  ),
  ungroup: (
    <I>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </I>
  ),
  trash: (
    <I>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </I>
  ),
  zoomIn: (
    <I>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5-5M8 11h6M11 8v6" />
    </I>
  ),
  zoomOut: (
    <I>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5-5M8 11h6" />
    </I>
  ),
  fit: (
    <I>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </I>
  ),
  ruler: (
    <I>
      <path d="M3 8h18v8H3z" />
      <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
    </I>
  ),
  alignVCenter: (
    <I>
      <path d="M3 12h18" strokeDasharray="2 2" />
      <rect x="5" y="7" width="5" height="10" rx="1" />
      <rect x="14" y="9" width="5" height="6" rx="1" />
    </I>
  ),
  alignHCenter: (
    <I>
      <path d="M12 3v18" strokeDasharray="2 2" />
      <rect x="7" y="5" width="10" height="5" rx="1" />
      <rect x="9" y="14" width="6" height="5" rx="1" />
    </I>
  ),
  help: (
    <I>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01" />
    </I>
  ),
};
