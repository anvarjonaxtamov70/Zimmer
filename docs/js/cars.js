/* ==========================================================================
   Mashina siluetlari (SVG). Rasm fayllari kerak emas — hammasi vektor.
   ZimmerCars.art(slug) -> SVG matni
   ========================================================================== */

window.ZimmerCars = (function () {
  "use strict";

  /* zamonaviy sedan (Gentra) — silliq tom chizig'i */
  const GENTRA = `
    <path d="M14 62 C18 50 30 46 44 45 L70 30 C78 25 92 22 112 22 L150 22
             C168 22 180 26 190 34 L208 45 L232 48 C244 50 250 55 251 63
             L251 70 C251 74 248 76 243 76 L22 76 C17 76 14 74 14 70 Z"
          fill="url(#carBody)"/>
    <path d="M74 44 L96 29 C102 26 112 25 124 25 L146 25 C158 25 166 27 172 32 L188 44 Z"
          fill="#0e1014" opacity=".85"/>
    <path d="M120 26 L120 44" stroke="#2a2f37" stroke-width="2"/>`;

  /* eski maktab sedan (Nexia 2) — burchakli, tik tom */
  const NEXIA = `
    <path d="M14 63 C16 51 28 47 42 46 L62 30 C70 25 84 23 104 23 L152 23
             C170 23 182 26 190 33 L210 46 L234 49 C246 51 251 56 251 64
             L251 70 C251 74 248 76 243 76 L22 76 C17 76 14 74 14 70 Z"
          fill="url(#carBody)"/>
    <path d="M68 45 L84 30 C89 27 98 26 110 26 L150 26 C160 26 168 28 173 33 L188 45 Z"
          fill="#0e1014" opacity=".85"/>
    <path d="M116 27 L116 45" stroke="#2a2f37" stroke-width="2"/>`;

  function art(slug) {
    const shape = slug === "nexia2" ? NEXIA : GENTRA;
    return `
<svg viewBox="0 0 265 92" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#2b2f37"/>
      <stop offset="55%"  stop-color="#191c22"/>
      <stop offset="100%" stop-color="#0b0c0f"/>
    </linearGradient>
    <!-- Yorug'lik: blur filtri emas, ko'p bosqichli gradient (mobil uchun arzon) -->
    <radialGradient id="carLight" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity=".95"/>
      <stop offset="30%"  stop-color="#ff7a68" stop-opacity=".6"/>
      <stop offset="62%"  stop-color="#ff2d3a" stop-opacity=".24"/>
      <stop offset="100%" stop-color="#ff2d3a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="carBeam" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0%"   stop-color="#ffd9d4" stop-opacity=".5"/>
      <stop offset="60%"  stop-color="#ff2d3a" stop-opacity=".12"/>
      <stop offset="100%" stop-color="#ff2d3a" stop-opacity="0"/>
    </linearGradient>
  </defs>

  ${shape}

  <!-- g'ildiraklar -->
  <circle cx="70" cy="76" r="13" fill="#0a0b0d"/>
  <circle cx="70" cy="76" r="6.5" fill="#2c313a"/>
  <circle cx="196" cy="76" r="13" fill="#0a0b0d"/>
  <circle cx="196" cy="76" r="6.5" fill="#2c313a"/>

  <!-- yoniq fara (brend aksenti) -->
  <ellipse cx="20" cy="60" rx="17" ry="9" fill="url(#carLight)"/>
  <path d="M14 57 C18 55 23 55 27 57 L27 63 C22 65 18 65 14 63 Z" fill="#ffe9e6"/>
  <path d="M-16 60 L14 51 L14 69 Z" fill="url(#carBeam)"/>

  <!-- orqa chiroq -->
  <path d="M244 56 h6 c2 0 3 1 3 3 v4 c0 2 -1 3 -3 3 h-6 z" fill="#ff2d3a" opacity=".8"/>
</svg>`;
  }

  return { art };
})();
