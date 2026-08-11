/* ==========================================================================
   Parametrik fara (SVG) — tanlangan linza, ochki va optika rangiga qarab
   real vaqtda qayta chiziladi.

   ISHLASH: SVG filtrlari (feGaussianBlur) ISHLATILMAYDI — ular mobil
   qurilmada har kadrda qayta hisoblanadi va telefonni qizdiradi. Yorug'lik
   effekti radial-gradientlar bilan yasalgan (GPU uchun arzon).
   Cheksiz animatsiya faqat bitta: linzaning opacity "nafas olishi".

   ZimmerHeadlight.render({ biled, shroud, color, power })
   ========================================================================== */

window.ZimmerHeadlight = (function () {
  "use strict";

  const BODY =
    "M24 132 C30 78 92 40 208 34 C316 28 404 58 416 100 C428 142 392 192 296 200 C186 210 48 188 24 132 Z";
  const GLASS =
    "M40 129 C46 86 102 53 209 47 C310 42 392 69 402 104 C412 139 379 181 292 188 C191 197 61 177 40 129 Z";

  const LENS = { cx: 152, cy: 133, r: 33 };
  const HIGH = { cx: 302, cy: 124, r: 33 };

  /* ---------------------------------------------------------- ochki (shroud) */
  function shroudLayer(shroud) {
    const style = (shroud && shroud.style) || "classic";
    const ring = (shroud && shroud.ring_color) || "#d9dee6";
    const { cx, cy, r } = LENS;

    const base =
      `<circle cx="${cx}" cy="${cy}" r="${r + 15}" fill="url(#metal)"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r + 15}" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="1.5"/>`;

    if (style === "devil") {
      return (
        base +
        `<circle cx="${cx}" cy="${cy}" r="${r + 20}" fill="url(#ringGlow)"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="${ring}" stroke-width="7"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="#ffb3b3" stroke-width="1.4" opacity=".85"/>`
      );
    }
    if (style === "angel") {
      return (
        base +
        `<circle cx="${cx}" cy="${cy}" r="${r + 21}" fill="url(#ringGlow)"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="none" stroke="${ring}" stroke-width="6"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r + 15}" fill="none" stroke="rgba(234,246,255,.5)" stroke-width="1.4"/>`
      );
    }
    if (style === "sport") {
      return (
        `<circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="#22252b"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="none" stroke="#0c0d10" stroke-width="2"/>` +
        `<path d="M${cx - 15} ${cy + r + 13} h30 l-5 9 h-20 z" fill="#191c21"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="${ring}" stroke-width="3" opacity=".8"/>`
      );
    }
    if (style === "carbon") {
      return (
        `<circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="url(#carbon)"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="2"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="#6f757f" stroke-width="2.4" opacity=".9"/>`
      );
    }
    return (
      base +
      `<circle cx="${cx}" cy="${cy}" r="${r + 8}" fill="none" stroke="${ring}" stroke-width="6"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r + 12}" fill="none" stroke="rgba(255,255,255,.26)" stroke-width="1.2"/>`
    );
  }

  /* ------------------------------------------------------------------- linza */
  function lensLayer(biled, power) {
    const { cx, cy, r } = LENS;
    const label = biled && biled.size ? String(biled.size) : "";
    const coreOpacity = (0.5 + power * 0.09).toFixed(2);
    return (
      `<circle cx="${cx}" cy="${cy}" r="${r + 26}" fill="url(#lensHalo)" class="glow"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#lensGlass)"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.38)" stroke-width="1.2"/>` +
      `<ellipse cx="${cx - 9}" cy="${cy - 12}" rx="12" ry="7" fill="rgba(255,255,255,.5)" transform="rotate(-28 ${
        cx - 9
      } ${cy - 12})"/>` +
      `<path d="M${cx - r + 4} ${cy + 12} Q${cx} ${cy + 25} ${cx + r - 4} ${cy + 12}" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.4}" fill="url(#lensCore)" opacity="${coreOpacity}"/>` +
      (label
        ? `<text x="${cx}" y="${cy + r + 26}" class="lbl">${label}</text>`
        : "")
    );
  }

  /* -------------------------------------------------------------------- nur */
  function beamLayer(power) {
    const { cx, cy } = LENS;
    const o = (0.12 + power * 0.045).toFixed(2);
    return (
      `<g opacity="${o}">` +
      `<path d="M${cx} ${cy} L-70 ${cy - 70} L-70 ${cy + 82} Z" fill="url(#beam)"/>` +
      `</g>`
    );
  }

  function render(state) {
    const biled = (state && state.biled) || null;
    const shroud = (state && state.shroud) || null;
    const color = (state && state.color) || { hex_from: "#e7ebf1", hex_to: "#8b929c" };
    const power = Math.max(1, Math.min(5, (state && state.power) || 3));
    const glow = (biled && biled.glow) || "#eaf4ff";
    const ring = (shroud && shroud.ring_color) || "#d9dee6";

    return `
<svg viewBox="0 0 440 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fara ko'rinishi">
  <style>
    .glow { animation: breathe 4.5s ease-in-out infinite; transform-origin: ${LENS.cx}px ${LENS.cy}px; }
    .drl { animation: drlOn .7s cubic-bezier(.2,.8,.2,1) both; }
    .lbl { fill: rgba(255,255,255,.45); font: 700 11px Inter, sans-serif; text-anchor: middle; letter-spacing: .5px; }
    @keyframes breathe { 0%,100% { opacity: .75; } 50% { opacity: 1; } }
    @keyframes drlOn { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .glow, .drl { animation: none; } }
  </style>
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${color.hex_from}"/>
      <stop offset="55%" stop-color="${color.hex_to}"/>
      <stop offset="100%" stop-color="#0b0c0f"/>
    </linearGradient>
    <linearGradient id="glassSheen" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,.15)"/>
      <stop offset="45%" stop-color="rgba(255,255,255,.03)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,.5)"/>
    </linearGradient>
    <radialGradient id="lensGlass" cx="42%" cy="36%" r="72%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="34%" stop-color="${glow}"/>
      <stop offset="72%" stop-color="#5d7488"/>
      <stop offset="100%" stop-color="#14171c"/>
    </radialGradient>
    <radialGradient id="lensCore" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="${glow}"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <!-- blur o'rniga: yumshoq halo gradient -->
    <radialGradient id="lensHalo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${glow}" stop-opacity=".5"/>
      <stop offset="45%" stop-color="${glow}" stop-opacity=".18"/>
      <stop offset="100%" stop-color="${glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ringGlow" cx="50%" cy="50%" r="50%">
      <stop offset="55%" stop-color="${ring}" stop-opacity="0"/>
      <stop offset="78%" stop-color="${ring}" stop-opacity=".35"/>
      <stop offset="100%" stop-color="${ring}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4a4f58"/>
      <stop offset="45%" stop-color="#22252b"/>
      <stop offset="100%" stop-color="#0e1013"/>
    </linearGradient>
    <linearGradient id="drlGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgba(255,255,255,.2)"/>
      <stop offset="35%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="${ring}"/>
    </linearGradient>
    <linearGradient id="beam" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0%" stop-color="${glow}" stop-opacity=".8"/>
      <stop offset="55%" stop-color="${glow}" stop-opacity=".16"/>
      <stop offset="100%" stop-color="${glow}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="high" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#9fb4c6"/>
      <stop offset="70%" stop-color="#2b3138"/>
      <stop offset="100%" stop-color="#0d0f12"/>
    </radialGradient>
    <pattern id="carbon" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#242830"/>
      <path d="M0 8 L8 0 M-2 2 L2 -2 M6 10 L10 6" stroke="#33383f" stroke-width="2.4"/>
    </pattern>
  </defs>

  ${beamLayer(power)}

  <path d="${BODY}" fill="url(#body)"/>
  <path d="${BODY}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="2.5"/>
  <path d="${GLASS}" fill="#0a0b0e"/>
  <path d="${GLASS}" fill="url(#glassSheen)"/>

  <path class="drl" d="M70 90 C132 62 258 56 370 86" fill="none" stroke="url(#drlGrad)"
        stroke-width="7" stroke-linecap="round"/>

  <circle cx="${HIGH.cx}" cy="${HIGH.cy}" r="${HIGH.r}" fill="url(#high)"/>
  <circle cx="${HIGH.cx}" cy="${HIGH.cy}" r="${HIGH.r - 8}" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="1.4"/>
  <circle cx="${HIGH.cx}" cy="${HIGH.cy}" r="${HIGH.r - 16}" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="1.2"/>
  <circle cx="${HIGH.cx - 8}" cy="${HIGH.cy - 9}" r="3.6" fill="rgba(255,255,255,.45)"/>

  <path d="M236 176 C288 184 344 176 376 156" fill="none" stroke="#ffb020"
        stroke-width="5.5" stroke-linecap="round" opacity=".7"/>

  ${shroudLayer(shroud)}
  ${lensLayer(biled, power)}

  <path d="M74 74 C150 44 268 42 352 66" fill="none" stroke="rgba(255,255,255,.2)"
        stroke-width="3" stroke-linecap="round"/>
</svg>`;
  }

  return { render };
})();
