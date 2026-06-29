"use client";
/**
 * Lightweight SVG hero — no R3F, no three.js.
 * Animated with CSS only. ~5kb, paints in a single frame.
 */
export default function HeroVisual({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 600 600"
        className="h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <radialGradient id="halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" />
            <stop offset="60%" stopColor="#22D3EE" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ring" x1="0" x2="1">
            <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.0" />
            <stop offset="50%" stopColor="#06B6D4" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* halo */}
        <circle cx="300" cy="300" r="260" fill="url(#halo)" />

        {/* concentric grid */}
        {[60, 120, 180, 240].map((r, i) => (
          <circle
            key={r}
            cx="300"
            cy="300"
            r={r}
            fill="none"
            stroke="#0B1220"
            strokeOpacity={0.06}
            strokeDasharray={i % 2 ? "2 6" : "0"}
          />
        ))}

        {/* rotating thin ring */}
        <g style={{ transformOrigin: "300px 300px", animation: "spinSlow 32s linear infinite" }}>
          <circle cx="300" cy="300" r="220" fill="none" stroke="url(#ring)" strokeWidth="1.2" />
          <circle cx="300" cy="80"  r="3" fill="#06B6D4" />
          <circle cx="520" cy="300" r="2" fill="#06B6D4" opacity="0.6" />
        </g>

        {/* second ring, opposite */}
        <g style={{ transformOrigin: "300px 300px", animation: "spinSlowRev 48s linear infinite" }}>
          <circle cx="300" cy="300" r="160" fill="none" stroke="#0B1220" strokeOpacity="0.15" strokeDasharray="1 8" />
          <circle cx="460" cy="300" r="2.5" fill="#0B1220" opacity="0.7" />
        </g>

        {/* nucleus — molecule-ish */}
        <g style={{ transformOrigin: "300px 300px", animation: "drift 9s ease-in-out infinite alternate" }}>
          {/* edges */}
          {[
            [300, 240, 348, 280],
            [348, 280, 348, 332],
            [348, 332, 300, 372],
            [300, 372, 252, 332],
            [252, 332, 252, 280],
            [252, 280, 300, 240],
            [300, 240, 300, 300],
            [300, 300, 348, 332],
            [300, 300, 252, 332]
          ].map((e, i) => (
            <line
              key={i}
              x1={e[0]} y1={e[1]} x2={e[2]} y2={e[3]}
              stroke="#0B1220" strokeOpacity="0.5" strokeWidth="1.1"
            />
          ))}
          {/* nodes */}
          {[
            [300, 240], [348, 280], [348, 332], [300, 372],
            [252, 332], [252, 280], [300, 300]
          ].map((n, i) => (
            <g key={i}>
              <circle cx={n[0]} cy={n[1]} r="9" fill="#ffffff" stroke="#0B1220" strokeWidth="1.4" />
              <circle cx={n[0]} cy={n[1]} r="3.5" fill={i === 6 ? "#06B6D4" : "#0B1220"} />
            </g>
          ))}
        </g>

        {/* outer marker */}
        <g>
          <circle cx="300" cy="80" r="6" fill="#fff" stroke="#06B6D4" strokeWidth="2">
            <animate attributeName="r" values="6;9;6" dur="2.4s" repeatCount="indefinite" />
          </circle>
        </g>

        {/* corner tick marks */}
        {[
          [40, 40], [560, 40], [40, 560], [560, 560]
        ].map(([x, y], i) => (
          <g key={i} stroke="#0B1220" strokeOpacity="0.18">
            <line x1={x - 8} y1={y} x2={x + 8} y2={y} />
            <line x1={x} y1={y - 8} x2={x} y2={y + 8} />
          </g>
        ))}
      </svg>

      <style jsx>{`
        @keyframes spinSlow    { to { transform: rotate(360deg); } }
        @keyframes spinSlowRev { to { transform: rotate(-360deg); } }
        @keyframes drift       { from { transform: translateY(-4px); } to { transform: translateY(4px); } }
      `}</style>
    </div>
  );
}
