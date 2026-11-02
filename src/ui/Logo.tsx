import React from 'react';

/** The name on a dark plate, with a chip outline and its traces. Drawn, so that it stays sharp at any size. */
export const Logo: React.FC = () => (
  <svg className="logo" viewBox="0 0 190 84" role="img" aria-label="EE_SIM NextGen, by Ing. Di Filippo Davide">
    <defs>
      <linearGradient id="logo-nextgen" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#2ee6ff" />
        <stop offset="1" stopColor="#2f7bff" />
      </linearGradient>
    </defs>
    <rect width="190" height="84" rx="8" fill="#071a38" />
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* The outline of the chip, with its pins */}
      <path d="M 66 12 L 62 8 H 22 L 15 14 L 11 48 L 16 53 H 54 L 59 49 H 70" stroke="#3cb4ff" strokeWidth="2" />
      <path d="M 26 8 V 3 M 35 8 V 3 M 44 8 V 3 M 12 26 H 6 M 11 36 H 5 M 24 53 V 60 M 32 53 V 60 M 40 53 V 60" stroke="#3cb4ff" strokeWidth="2" />
      {/* Its traces */}
      <path d="M 62 12 H 76 L 84 5 H 122" stroke="#2f7bff" strokeWidth="1.6" />
      <path d="M 82 12 L 88 9 H 134" stroke="#2f7bff" strokeWidth="1.6" />
      <path d="M 66 62 H 174" stroke="#3cb4ff" strokeWidth="1.4" />
      <circle cx="125" cy="5" r="2.6" fill="#071a38" stroke="#3cb4ff" strokeWidth="1.4" />
      <circle cx="137" cy="9" r="2.6" fill="#071a38" stroke="#3cb4ff" strokeWidth="1.4" />
      <circle cx="177" cy="62" r="2.6" fill="#071a38" stroke="#3cb4ff" strokeWidth="1.4" />
    </g>
    <g fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" fontStyle="italic" fontWeight="800">
      <text x="20" y="35" fontSize="24" fill="#ffffff" letterSpacing="0.5">
        EE_SIM
      </text>
      <text x="74" y="56" fontSize="21" fill="url(#logo-nextgen)">
        NextGen
      </text>
      <text x="95" y="77" fontSize="11" fontWeight="600" fill="#ffffff" textAnchor="middle">
        by Ing. Di Filippo Davide
      </text>
    </g>
  </svg>
);
