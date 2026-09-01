/* ==========================================================================
   MASHINALAR — siluetlar (SVG) va ichki ro'yxat

   Rasm fayllari kerak emas: hammasi vektor, ya'ni internetdan hech narsa
   yuklanmaydi va ro'yxat bir zumda chiziladi.

   Tashqi interfeys:
     ZimmerCars.art(slug)  -> SVG matni (mashina siluetii)
     ZimmerCars.list       -> ichki ro'yxat (server bo'sh bo'lganda)

   ISHLASH QOIDASI (styles.css boshidagi kelishuv bilan bir xil):
   SVG `filter` ISHLATILMAYDI — yorug'lik ko'p bosqichli gradient bilan
   yasaladi, bu mobil GPU uchun deyarli bepul.
   ========================================================================== */

window.ZimmerCars = (function () {
  "use strict";

  /* ------------------------------------------------------------- g'ildirak */
  /** Har siluetning O'Z g'ildirak joyi bor (uzunligi har xil), shuning
   *  uchun ular shakl ichida chiziladi — ilgari hammasi bitta qattiq
   *  joyda edi va qisqa mashinalarda g'ildirak korpusdan chiqib turardi. */
  function wheels(front, rear, r) {
    const rad = r || 13;
    const hub = rad * 0.5;
    return (
      `<circle cx="${front}" cy="76" r="${rad}" fill="#0a0b0d"/>` +
      `<circle cx="${front}" cy="76" r="${hub}" fill="#2c313a"/>` +
      `<circle cx="${rear}" cy="76" r="${rad}" fill="#0a0b0d"/>` +
      `<circle cx="${rear}" cy="76" r="${hub}" fill="#2c313a"/>`
    );
  }

  const GLASS = 'fill="#0e1014" opacity=".85"';

  /* ------------------------------------------------------------- siluetlar */

  /* 1. Zamonaviy sedan — silliq tom chizig'i (Gentra, Cobalt, Lacetti...) */
  const SEDAN =
    `<path d="M14 62 C18 50 30 46 44 45 L70 30 C78 25 92 22 112 22 L150 22
              C168 22 180 26 190 34 L208 45 L232 48 C244 50 250 55 251 63
              L251 70 C251 74 248 76 243 76 L22 76 C17 76 14 74 14 70 Z"
           fill="url(#carBody)"/>
     <path d="M74 44 L96 29 C102 26 112 25 124 25 L146 25 C158 25 166 27 172 32 L188 44 Z" ${GLASS}/>
     <path d="M120 26 L120 44" stroke="#2a2f37" stroke-width="2"/>` +
    wheels(70, 196);

  /* 2. Eski maktab sedan — burchakli, tik tom (Nexia, Espero, Nubira...) */
  const OLD_SEDAN =
    `<path d="M14 63 C16 51 28 47 42 46 L62 30 C70 25 84 23 104 23 L152 23
              C170 23 182 26 190 33 L210 46 L234 49 C246 51 251 56 251 64
              L251 70 C251 74 248 76 243 76 L22 76 C17 76 14 74 14 70 Z"
           fill="url(#carBody)"/>
     <path d="M68 45 L84 30 C89 27 98 26 110 26 L150 26 C160 26 168 28 173 33 L188 45 Z" ${GLASS}/>
     <path d="M116 27 L116 45" stroke="#2a2f37" stroke-width="2"/>` +
    wheels(70, 196);

  /* 3. Xetchbek — qisqa, tik orqa (Matiz, Spark, Tico, Ravon R2) */
  const HATCH =
    `<path d="M14 60 C17 48 29 44 43 43 L62 27 C70 22 84 20 104 20 L146 20
              C160 20 170 23 177 30 L196 46 C205 51 210 57 211 64
              L211 70 C211 74 208 76 203 76 L22 76 C17 76 14 74 14 70 Z"
           fill="url(#carBody)"/>
     <path d="M68 42 L86 27 C91 24 100 23 112 23 L142 23 C152 23 159 25 164 30 L178 42 Z" ${GLASS}/>
     <path d="M118 24 L118 42" stroke="#2a2f37" stroke-width="2"/>` +
    wheels(62, 176);

  /* 4. Mikroavtobus — tik peshtoq, uzun tom (Damas) */
  const VAN =
    `<path d="M16 26 C16 21 19 18 25 18 L204 18 C214 18 221 21 226 28 L242 50
              C248 55 251 59 251 65 L251 70 C251 74 248 76 243 76
              L22 76 C17 76 14 74 14 70 L14 32 Z"
           fill="url(#carBody)"/>
     <path d="M26 26 L74 26 L74 46 L20 46 Z" ${GLASS}/>
     <path d="M84 26 L138 26 L138 46 L84 46 Z" ${GLASS}/>
     <path d="M148 26 L200 26 L208 46 L148 46 Z" ${GLASS}/>` +
    wheels(58, 202);

  /* 5. Pikap — kabina oldinda, ortida ochiq kuzov (Labo) */
  const PICKUP =
    `<path d="M16 26 C16 21 19 18 25 18 L122 18 C130 18 135 21 138 28 L145 46
              L246 46 C249 46 251 48 251 51 L251 70 C251 74 248 76 243 76
              L22 76 C17 76 14 74 14 70 L14 32 Z"
           fill="url(#carBody)"/>
     <path d="M26 26 L76 26 L76 44 L20 44 Z" ${GLASS}/>
     <path d="M86 26 L126 26 L132 44 L86 44 Z" ${GLASS}/>
     <path d="M150 50 L246 50" stroke="#2a2f37" stroke-width="2"/>` +
    wheels(58, 206);

  /* 6. Krossover / SUV — baland tom, katta g'ildirak (Tracker, Captiva, Tahoe) */
  const SUV =
    `<path d="M14 56 C16 44 26 40 40 39 L58 23 C66 18 80 16 102 16 L168 16
              C186 16 198 19 206 26 L224 39 L238 43 C248 45 251 50 251 57
              L251 70 C251 74 248 76 243 76 L22 76 C17 76 14 74 14 70 Z"
           fill="url(#carBody)"/>
     <path d="M64 38 L78 23 C83 20 92 19 104 19 L134 19 L134 38 Z" ${GLASS}/>
     <path d="M142 19 L166 19 C178 19 187 21 192 26 L202 38 L142 38 Z" ${GLASS}/>
     <path d="M58 14 L206 14" stroke="#2a2f37" stroke-width="2.5" stroke-linecap="round"/>` +
    wheels(68, 198, 15);

  /* 7. Universal / minivan — uzun tekis tom (Orlando, Nubira wagon) */
  const WAGON =
    `<path d="M14 60 C17 48 29 44 43 43 L60 26 C68 21 82 19 104 19 L198 19
              C210 19 218 22 224 29 L238 44 C248 47 251 52 251 60
              L251 70 C251 74 248 76 243 76 L22 76 C17 76 14 74 14 70 Z"
           fill="url(#carBody)"/>
     <path d="M66 43 L84 26 C89 23 98 22 110 22 L138 22 L138 43 Z" ${GLASS}/>
     <path d="M146 22 L196 22 C204 22 210 24 214 29 L222 43 L146 43 Z" ${GLASS}/>` +
    wheels(70, 200);

  const SHAPES = {
    sedan: SEDAN,
    old: OLD_SEDAN,
    hatch: HATCH,
    van: VAN,
    pickup: PICKUP,
    suv: SUV,
    wagon: WAGON,
  };

  /* ==================================================================
     ICHKI RO'YXAT — O'zbekistonda eng ko'p uchraydigan GM / Chevrolet /
     Daewoo / Ravon modellari (Damas'dan Tahoe'gacha).

     QACHON ISHLATILADI: server (`/api/cars`) va bulut (`catalog/cars`)
     BO'SH ro'yxat qaytarganda. Admin bazaga mashina qo'shsa — server
     ro'yxati ustun turadi va bu yerga qaralmaydi.

     `type` — siluet kaliti (yuqoridagi `SHAPES`).
     ================================================================== */
  const LIST = [
    // --- yengil tijorat ---
    ["Damas", "damas", "1996 – hozir", "Chevrolet / Daewoo Damas", "van"],
    ["Labo", "labo", "1996 – hozir", "Chevrolet / Daewoo Labo", "pickup"],

    // --- kichik sinf ---
    ["Tico", "tico", "1996 – 2001", "Daewoo Tico", "hatch"],
    ["Matiz", "matiz", "2001 – 2015", "Daewoo / Chevrolet Matiz", "hatch"],
    ["Spark", "spark", "2011 – 2015", "Chevrolet Spark (M300)", "hatch"],
    ["Spark 2", "spark2", "2016 – 2022", "Chevrolet Spark (M400)", "hatch"],
    ["Ravon R2", "ravon-r2", "2016 – 2018", "Ravon R2 (Spark)", "hatch"],

    // --- Nexia oilasi ---
    ["Nexia 1", "nexia1", "1996 – 2008", "Daewoo Nexia (SOHC / DOHC)", "old"],
    ["Nexia 2", "nexia2", "2008 – 2016", "Daewoo Nexia 2", "old"],
    ["Nexia 3", "nexia3", "2016 – hozir", "Ravon Nexia R3 / Nexia 3", "sedan"],
    ["Ravon R3", "ravon-r3", "2016 – 2018", "Ravon R3 (Nexia)", "sedan"],

    // --- klassik Daewoo ---
    ["Espero", "espero", "1995 – 1999", "Daewoo Espero", "old"],
    ["Nubira", "nubira", "1999 – 2003", "Daewoo Nubira", "old"],
    ["Leganza", "leganza", "1997 – 2002", "Daewoo Leganza", "old"],
    ["Magnus", "magnus", "2003 – 2007", "Daewoo Magnus / Evanda", "old"],
    ["Epica", "epica", "2007 – 2011", "Chevrolet Epica", "sedan"],

    // --- o'rta sinf sedanlar ---
    ["Lacetti", "lacetti", "2004 – 2018", "Chevrolet Lacetti", "sedan"],
    ["Gentra", "gentra", "2013 – 2024", "Chevrolet / Ravon Gentra", "sedan"],
    ["Aveo", "aveo", "2011 – 2015", "Chevrolet Aveo", "sedan"],
    ["Cobalt", "cobalt", "2013 – hozir", "Chevrolet / Ravon Cobalt", "sedan"],
    ["Ravon R4", "ravon-r4", "2016 – 2020", "Ravon R4 (Cobalt)", "sedan"],
    ["Onix", "onix", "2019 – hozir", "Chevrolet Onix", "sedan"],
    ["Monza", "monza", "2023 – hozir", "Chevrolet Monza", "sedan"],

    // --- katta sedanlar ---
    ["Malibu", "malibu", "2012 – 2016", "Chevrolet Malibu", "sedan"],
    ["Malibu 2", "malibu2", "2018 – hozir", "Chevrolet Malibu 2", "sedan"],
    ["Malibu XL", "malibu-xl", "2021 – hozir", "Chevrolet Malibu XL", "sedan"],

    // --- universal / minivan ---
    ["Orlando", "orlando", "2011 – 2018", "Chevrolet Orlando (7 o'rin)", "wagon"],

    // --- krossover va SUV ---
    ["Tracker", "tracker", "2013 – 2020", "Chevrolet Tracker 1", "suv"],
    ["Tracker 2", "tracker2", "2020 – hozir", "Chevrolet Tracker 2", "suv"],
    ["Captiva", "captiva", "2007 – 2018", "Chevrolet Captiva", "suv"],
    ["Captiva 5", "captiva5", "2021 – hozir", "Chevrolet Captiva 5", "suv"],
    ["Trailblazer", "trailblazer", "2021 – hozir", "Chevrolet Trailblazer", "suv"],
    ["Equinox", "equinox", "2018 – hozir", "Chevrolet Equinox", "suv"],
    ["Traverse", "traverse", "2018 – hozir", "Chevrolet Traverse (7 o'rin)", "suv"],
    ["Tahoe", "tahoe", "2015 – hozir", "Chevrolet Tahoe", "suv"],
  ];

  /* Slug -> siluet turi. Ro'yxatdan avtomatik yasaladi, ya'ni yangi
     mashina qo'shilganda ikki joyni yangilash kerak bo'lmaydi. */
  const TYPE_BY_SLUG = {};
  LIST.forEach(function (row) {
    TYPE_BY_SLUG[row[1]] = row[4];
  });

  /** Ichki ro'yxat — API javobi bilan BIR XIL shaklda.
   *  `id` manfiy: haqiqiy bazadagi id'lar bilan hech qachon urishmaydi va
   *  kod «bu server yozuvi emas» ekanini `_fallback` bo'yicha biladi. */
  const list = LIST.map(function (row, i) {
    return {
      id: -(i + 1),
      name: row[0],
      slug: row[1],
      years: row[2],
      note: row[3],
      type: row[4],
      _fallback: true,
    };
  });

  /** Slug (yoki tur nomi) bo'yicha siluet turini aniqlaydi.
   *  Notanish slug kelsa — nomidan taxmin qilamiz, aks holda sedan. */
  function typeOf(slug) {
    const key = String(slug || "").toLowerCase().trim();
    if (SHAPES[key]) return key; // to'g'ridan tur berilgan
    if (TYPE_BY_SLUG[key]) return TYPE_BY_SLUG[key];

    if (key.indexOf("damas") !== -1) return "van";
    if (key.indexOf("labo") !== -1) return "pickup";
    if (key.indexOf("matiz") !== -1 || key.indexOf("spark") !== -1 || key.indexOf("tico") !== -1) {
      return "hatch";
    }
    if (
      key.indexOf("tracker") !== -1 || key.indexOf("captiva") !== -1 ||
      key.indexOf("tahoe") !== -1 || key.indexOf("equinox") !== -1 ||
      key.indexOf("traverse") !== -1 || key.indexOf("trailblazer") !== -1 ||
      key.indexOf("suv") !== -1
    ) {
      return "suv";
    }
    if (key.indexOf("orlando") !== -1) return "wagon";
    if (key.indexOf("nexia1") !== -1 || key.indexOf("nexia2") !== -1) return "old";
    if (
      key.indexOf("espero") !== -1 || key.indexOf("nubira") !== -1 ||
      key.indexOf("leganza") !== -1 || key.indexOf("magnus") !== -1
    ) {
      return "old";
    }
    return "sedan";
  }

  function art(slug) {
    const shape = SHAPES[typeOf(slug)] || SEDAN;
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

  <!-- yoniq fara (brend aksenti) -->
  <ellipse cx="20" cy="60" rx="17" ry="9" fill="url(#carLight)"/>
  <path d="M14 57 C18 55 23 55 27 57 L27 63 C22 65 18 65 14 63 Z" fill="#ffe9e6"/>
  <path d="M-16 60 L14 51 L14 69 Z" fill="url(#carBeam)"/>

  <!-- orqa chiroq -->
  <path d="M244 56 h6 c2 0 3 1 3 3 v4 c0 2 -1 3 -3 3 h-6 z" fill="#ff2d3a" opacity=".8"/>
</svg>`;
  }

  return { art: art, list: list, typeOf: typeOf };
})();
