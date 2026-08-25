import { type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
});

/** 🚫 None — circle slash */
export function IconNone({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <line
        x1="3.5"
        y1="3.5"
        x2="12.5"
        y2="12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 🌫️ Dark Veil — moon */
export function IconDarkVeil({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <path
        d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 💡 Light Pillar — beam up from center */
export function IconLightPillar({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <line
        x1="8"
        y1="14"
        x2="8"
        y2="2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <ellipse
        cx="8"
        cy="10"
        rx="3"
        ry="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.6"
      />
    </svg>
  );
}

/** 〰️ Floating Lines — wavy lines */
export function IconFloatingLines({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <path
        d="M1 5c1.5-2 3-2 4.5 0s3 2 4.5 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M1 8.5c1.5-2 3-2 4.5 0s3 2 4.5 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M1 12c1.5-2 3-2 4.5 0s3 2 4.5 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** ☀️ Light Rays — sun with rays */
export function IconLightRays({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = 8 + 4 * Math.cos(rad);
        const y1 = 8 + 4 * Math.sin(rad);
        const x2 = 8 + 6 * Math.cos(rad);
        const y2 = 8 + 6 * Math.sin(rad);
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

/** 🎨 Color Bends — gradient circle */
export function IconColorBends({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <defs>
        <linearGradient id="icb-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff5c7a" />
          <stop offset="50%" stopColor="#8a5cff" />
          <stop offset="100%" stopColor="#00ffd1" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="8" r="6" stroke="url(#icb-grad)" strokeWidth="1.5" />
      <path
        d="M4 8c2-3 6-3 8 0"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

/** ✨ Particles — dots scattered */
export function IconParticles({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      {[
        [3, 3, 1.5],
        [8, 2, 1],
        [13, 4, 1.2],
        [2, 9, 1],
        [6, 7, 1.8],
        [11, 8, 1],
        [4, 13, 1.2],
        [9, 12, 1.5],
        [13, 11, 1],
        [7.5, 5, 0.8],
      ].map(([cx, cy, r], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="currentColor"
          opacity={0.7}
        />
      ))}
    </svg>
  );
}

/** 🔦 Beams — parallel angled beams */
export function IconBeams({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      <path
        d="M2 14L6 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M5.5 14L8.5 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M9 14L11 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M12.5 14L13.5 2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}

/** 🕹️ Pixel Blast — pixel grid */
export function IconPixelBlast({ size = 16, ...p }: IconProps) {
  return (
    <svg {...base(size)} {...p}>
      {[
        [2, 2],
        [6, 2],
        [10, 2],
        [4, 6],
        [8, 6],
        [12, 6],
        [2, 10],
        [6, 10],
        [10, 10],
        [4, 14],
        [8, 14],
      ].map(([x, y], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width="2.5"
          height="2.5"
          rx={0.4}
          fill="currentColor"
          opacity={i % 3 === 0 ? 1 : 0.5}
        />
      ))}
    </svg>
  );
}
