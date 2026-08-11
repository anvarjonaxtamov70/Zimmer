/* ==========================================================================
   Parametrik fara (SVG). Konfiguratorda tanlangan Bi-LED linza, ochki va
   optika rangiga qarab real vaqtda qayta chiziladi.

   ZimmerHeadlight.render({ biled, shroud, color, power })
   ========================================================================== */

window.ZimmerHeadlight = (function () {
  "use strict";

  const BODY_OUTER =
    "M24 132 C30 78 92 40 208 34 C316 28 404 58 416 100 C428 142 392 192 296 200 C186 210 48 188 24 132 Z";
  const BODY_GLASS =
    "M40 129 C46 86 102 53 209 47 C310 42 392 69 402 104 C412 139 379 181 292 188 C191 197 61 177 40 129 Z";

  const LENS = { cx: 152, cy: 133, r: 33 };
  const HIGH = { cx: 302, cy: 124, r: 33 };

  /* ---------------------------------------------------------- ochki (shroud) */
  function shroudLayer(shroud) {
    const style = (shroud && shroud.style) || "classic";
    const ring = (shroud && shroud.ring_color) || "#d9dee6";
    const { cx, cy, r } = LENS;

    const base = `
      <circle cx="${cx}" cy="${cy}" r="${r + 15}" fill="url(#shroudMetal)"/>
      <circle cx="${cx}" cy="${cy}" r="${r + 15}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="1.5"/>`;

    if (style === "devil") {
      return `${base}
        <circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="${ring}"
                stroke-width="7" opacity=".95" filter="url(#glowRed)"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="#ff8b8b"
                stroke-width="1.6" opacity=".9" class="pulse"/>`;
    }
    if (style === "angel") {
      return `${base}
        <circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="none" stroke="${ring}"
                stroke-width="6" filter="url(#glowWhite)" class="pulse"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 15}" fill="none" stroke="rgba(234,246,255,.55)"
                stroke-width="1.4"/>`;
    }
    if (style === "sport") {
      return `
        <circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="#22252b"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="none" stroke="#0c0d10" stroke-width="2"/>
        <path d="M${cx - 15} ${cy + r + 13} h30 l-5 9 h-20 z" fill="#191c21"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="${ring}" stroke-width="3" opacity=".8"/>`;
    }
    if (style === "carbon") {
      return `
        <circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="url(#carbonPat)"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="2"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="#6f757f" stroke-width="2.4" opacity=".9"/>`;
    }
    /* classic */
    return `${base}
      <circle cx="${cx}" cy="${cy}" r="${r + 8}" fill="none" stroke="${ring}" stroke-width="6"/>
      <circle cx="${cx}" cy="${cy}" r="${r + 12}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.2"/>`;
  }

  /* ------------------------------------------------------------------- linza */
  function lensLayer(biled, power) {
    const { cx, cy, r } = LENS;
    const label = biled && biled.size ? biled.size : "";
    return `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#lensGlass)"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.2"/>
      <ellipse cx="${cx - 9}" cy="${cy - 12}" rx="13" ry="8" fill="rgba(255,255,255,.55)"
               transform="rotate(-28 ${cx - 9} ${cy - 12})" opacity=".8"/>
      <path d="M${cx - r + 4} ${cy + 12} Q${cx} ${cy + 26} ${cx + r - 4} ${cy + 12}"
            fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
      <g class="core" opacity="${0.55 + power * 0.09}">
        <circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="url(#lensCore)" filter="url(#glowWhite)"/>
      </g>
      ${label ? `<text x="${cx}" y="${cy + r + 26}" class="lbl">${label}</text>` : ""}`;
  }

  /* ------------------------------------------------------------------ nur */
  function beamLayer(power) {
    const { cx, cy } = LENS;
    const o = 0.14 + power * 0.05;
    return `
      <g class="beam" opacity="${o}">
        <path d="M${cx} ${cy} L-70 ${cy - 74} L-70 ${cy + 86} Z" fill="url(#beamGrad)" filter="url(#softBlur)"/>
      </g>`;
  }

  /* ---------------------------------------------------------------- to'liq */
  function render(state) {
    const biled = state.biled || null;
    const shroud = state.shroud || null;
    const color = state.color || { hex_from: "#e7ebf1", hex_to: "#8b929c" };
    const power = Math.max(1, Math.min(5, state.power || 3));
    const glow = (biled && biled.glow) || "#eaf4ff";
    const ring = (shroud && shroud.ring_color) || "#d9dee6";

    return `
<svg viewBox="0 0 440 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fara ko'rinishi">
  <style>
    .beam { animation: beamPulse 3.6s ease-in-out infinite; }
    .core { animation: corePulse 2.6s ease-in-out infinite; }
    .pulse { animation: ringPulse 2.8s ease-in-out infinite; }
    .drl { animation: drlOn .9s cubic-bezier(.2,.8,.2,1) both; }
    .lbl { fill: rgba(255,255,255,.5); font: 700 11px Inter, sans-serif; text-anchor: middle; letter-spacing: .5px; }
    @keyframes beamPulse { 0%,100% { opacity: var(--o,.3); } 50% { opacity: calc(var(--o,.3) * 1.5); } }
    @keyframes corePulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    @keyframes ringPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
    @keyframes drlOn { from { opacity: 0; stroke-dasharray: 0 400; } to { opacity: 1; stroke-dasharray: 400 0; } }
    @media (prefers-reduced-motion: reduce) { .beam,.core,.pulse { animation: none; } }
  </style>

  <defs>
    <linearGradient id="bodyGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="${color.hex_from}"/>
      <stop offset="55%"  stop-color="${color.hex_to}"/>
      <stop offset="100%" stop-color="#0b0c0f"/>
    </linearGradient>
    <linearGradient id="glassGrad" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%"   stop-color="rgba(255,255,255,.16)"/>
      <stop offset="45%"  stop-color="rgba(255,255,255,.04)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,.55)"/>
    </linearGradient>
    <radialGradient id="lensGlass" cx="42%" cy="36%" r="72%">
      <stop offset="0%"   stop-color="#ffffff"/>
      <stop offset="34%"  stop-color="${glow}"/>
      <stop offset="72%"  stop-color="#5d7488"/>
      <stop offset="100%" stop-color="#14171c"/>
    </radialGradient>
    <radialGradient id="lensCore" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#ffffff"/>
      <stop offset="60%"  stop-color="${glow}"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <linearGradient id="shroudMetal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#4a4f58"/>
      <stop offset="45%"  stop-color="#22252b"/>
      <stop offset="100%" stop-color="#0e1013"/>
    </linearGradient>
    <linearGradient id="drlGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="rgba(255,255,255,.25)"/>
      <stop offset="35%"  stop-color="#ffffff"/>
      <stop offset="100%" stop-color="${ring}"/>
    </linearGradient>
    <linearGradient id="beamGrad" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0%"   stop-color="${glow}" stop-opacity=".85"/>
      <stop offset="60%"  stop-color="${glow}" stop-opacity=".18"/>
      <stop offset="100%" stop-color="${glow}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="highGrad" cx="50%" cy="45%" r="60%">
      <stop offset="0%"   stop-color="#9fb4c6"/>
      <stop offset="70%"  stop-color="#2b3138"/>
      <stop offset="100%" stop-color="#0d0f12"/>
    </radialGradient>

    <pattern id="carbonPat" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#242830"/>
      <path d="M0 8 L8 0 M-2 2 L2 -2 M6 10 L10 6" stroke="#33383f" stroke-width="2.4"/>
    </pattern>

    <filter id="glowWhite" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glowRed" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="softBlur" x="-30%" y="-40%" width="180%" height="200%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
  </defs>

  ${beamLayer(power)}

  <!-- korpus -->
  <path d="${BODY_OUTER}" fill="url(#bodyGrad)"/>
  <path d="${BODY_OUTER}" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="2.5"/>
  <path d="${BODY_GLASS}" fill="#0a0b0e"/>
  <path d="${BODY_GLASS}" fill="url(#glassGrad)"/>

  <!-- DRL chizig'i -->
  <path class="drl" d="M70 90 C132 62 258 56 370 86" fill="none" stroke="url(#drlGrad)"
        stroke-width="8" stroke-linecap="round" filter="url(#glowWhite)"/>

  <!-- uzoq nur reflektori -->
  <circle cx="${HIGH.cx}" cy="${HIGH.cy}" r="${HIGH.r}" fill="url(#highGrad)"/>
  <circle cx="${HIGH.cx}" cy="${HIGH.cy}" r="${HIGH.r - 8}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.4"/>
  <circle cx="${HIGH.cx}" cy="${HIGH.cy}" r="${HIGH.r - 16}" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="1.2"/>
  <circle cx="${HIGH.cx - 8}" cy="${HIGH.cy - 9}" r="4" fill="rgba(255,255,255,.5)"/>

  <!-- burilish signali -->
  <path d="M236 176 C288 184 344 176 376 156" fill="none" stroke="#ffb020"
        stroke-width="6" stroke-linecap="round" opacity=".75"/>

  <!-- ochki + linza -->
  ${shroudLayer(shroud)}
  ${lensLayer(biled, power)}

  <!-- shisha aksi -->
  <path d="M74 74 C150 44 268 42 352 66" fill="none" stroke="rgba(255,255,255,.22)"
        stroke-width="3" stroke-linecap="round"/>
</svg>`;
  }

  return { render };
})();
