/**
 * Hero graphic: a top-down airliner rendered in horizontal scanlines, with
 * "holding pattern" streaks trailing off to the right — after the reference.
 */
export function ScanPlane() {
  const streaks = Array.from({ length: 46 }, (_, i) => i);
  return (
    <div className="relative h-[340px] w-full select-none sm:h-[440px]" aria-hidden>
      {/* trailing streaks (the holding stack) */}
      <div className="absolute inset-y-6 right-0 w-[62%] overflow-hidden">
        {streaks.map((i) => {
          const y = (i / streaks.length) * 100;
          const w = 30 + ((i * 37) % 70);
          const op = 0.25 + ((i * 13) % 10) / 14;
          return (
            <div
              key={i}
              className="absolute right-0 bg-ink"
              style={{ top: `${y}%`, height: 1.6, width: `${w}%`, opacity: i > 8 && i < 36 ? op * 0.35 : op }}
            />
          );
        })}
      </div>
      {/* the plane */}
      <svg viewBox="0 0 200 200" className="absolute left-[4%] top-1/2 h-[92%] -translate-y-1/2 drop-shadow-[0_0_24px_rgba(255,255,255,0.9)]">
        <defs>
          <pattern id="scan" width="4" height="4.2" patternUnits="userSpaceOnUse">
            <rect width="4" height="1.6" fill="#0e0e0e" />
          </pattern>
          <radialGradient id="glow" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="100" cy="100" rx="95" ry="95" fill="url(#glow)" />
        <g fill="url(#scan)">
          {/* fuselage */}
          <path d="M100 6 C108 6 112 22 112 40 L112 150 C112 170 106 186 100 194 C94 186 88 170 88 150 L88 40 C88 22 92 6 100 6 Z" />
          {/* main wings */}
          <path d="M112 72 L192 110 L192 122 L112 104 Z" />
          <path d="M88 72 L8 110 L8 122 L88 104 Z" />
          {/* engines */}
          <rect x="132" y="92" width="10" height="22" rx="3" />
          <rect x="58" y="92" width="10" height="22" rx="3" />
          {/* tailplane */}
          <path d="M108 160 L146 176 L146 184 L106 176 Z" />
          <path d="M92 160 L54 176 L54 184 L94 176 Z" />
        </g>
        {/* cockpit windows */}
        <rect x="95" y="20" width="10" height="4" fill="#0e0e0e" />
      </svg>
      {/* ground shadow */}
      <div className="absolute bottom-0 left-[10%] right-[30%] h-[2px] bg-ink/40" />
      <div className="absolute bottom-3 left-[18%] right-[46%] h-[2px] bg-ink/20" />
    </div>
  );
}
