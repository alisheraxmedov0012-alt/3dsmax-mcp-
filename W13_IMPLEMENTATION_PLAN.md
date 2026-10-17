# W13 — Implementation Plan and Competitive Update

> **Holat:** reja. Kod yozilmagan, implementatsiya boshlanmagan.
> **Branch:** `integration/w1-w12` @ `251d2820cb3b79a0e82104b952b95e1e1b100cd0`.
> **Tadqiqot sanasi:** 2026-10-17 (barcha havolalar shu sanada ochilgan).
>
> **Muhim kontekst:** mahsulot egasi bu bosqichda bevosita mijoz intervyularini
> o'tkazmaslikka qaror qildi. Shuning uchun bu hujjat **faqat onlayn tadqiqot va
> ommaviy dalillarga** tayanadi. **Talab (demand) validatsiya qilingan deb
> hisoblanmaydi.**

---

# A QISM — Raqobatchi tahlilining yangilanishi

## A.1 Nima o'zgardi

Oldingi `MARKET_VALIDATION_V1_V6.md` (§4) xulosasi shunday edi:

> "Hech bir tekshirilgan raqobatchi *prompt → parametrik → cut list* katakni
> egallamaydi."

**Bu xulosa endi noto'g'ri.** Yangi tadqiqot ikkita mahsulotni aniqladi — **Srezio**
va **Prompt2CAD** — ikkisi ham aynan shu katakda ishlaydi. Bundan tashqari
**OpenCutList** va **Eclipse Cabinets PRO** manufacturing chiqishini allaqachon
yaxshi qoplaydi.

Bu — muhim tuzatish. Differensiatsiya taxmini **sezilarli darajada zaiflashdi**.

## A.2 Srezio (`srez.io`) — eng yaqin raqobatchi

| Parametr | Qiymat (rasmiy saytdan) |
|---|---|
| Pozitsiya | "AI-powered CAD for Cabinetry" — "From a photo, to a cut list" |
| Kirish | Rasm/sketch/PDF yuklash (5 tagacha) → 3D model → cut list |
| Tahrirlash | Brauzerda; "Every cabinet is a live, interactive model — grab a shelf, drag a divider, resize a compartment" |
| Konstruktiv validatsiya | "Flags edge-banding errors, grain orientation mismatches, and overlapping cabinets" |
| Manufacturing | Cut lists, cutting diagrams, **DXF**, part labels, assembly data, saw-shop integratsiyasi |
| Platforma | Brauzer, "Desktop · Tablet · Phone" |
| Tillar | **English · Български** |
| Narx (beta) | Bench €0 (50 parts, 2 loyiha, 30 kredit/oy); Studio €24.17/oy yillik (€290/yil); Workshop €82.50/oy yillik (€990/yil) |
| Holat | Beta, hozircha bepul; "Free during beta · No account required" |
| Manba | https://srez.io (2026-10-17) |

**Nima uchun bu jiddiy:**

1. Ular **bizning aniq pozitsiyamizni** egallagan: rasm → tahrirlanadigan
   parametrik model → cut list → DXF.
2. Ular **konstruktiv validatsiyani** allaqachon qiladi (edge banding, grain,
   overlap) — bizda bunday narsa **yo'q** (`src/manufacturing/parts.ts` faqat
   geometriyadan o'lcham o'qiydi; edge banding modeli yo'q).
3. Ular **telefonda** ishlaydi — bizning W23 hali reja bosqichida.
4. Ular **bepul** (beta davomida).

**Ular bizdan farq qiladigan joylar (dalil bilan):**

- **Tillar:** faqat English + Bulgarian. **O'zbek va rus tili yo'q.**
- **Qamrov:** faqat "cabinetry" (shkaf/oshxona). Yumshoq mebel (divan, karavot,
  kreslo) haqida hech qanday da'vo yo'q.
- **Interyer:** xona/exa konteksti haqida da'vo yo'q.

> **Ehtiyot:** "Srezio o'zbek tilini qo'llab-quvvatlamaydi" — bu saytda tillar
> ro'yxati `en bg` ekaniga asoslangan kuzatuv. Ularning yo'l xaritasida o'zbek tili
> bo'lishi mumkinligini inkor etmaymiz.

## A.3 Prompt2CAD (`prompt2cad.com`) — AI-native concepting

| Parametr | Qiymat (rasmiy manbadan) |
|---|---|
| Pozitsiya | "Agentic cabinet and built-in concepting from a description" |
| Imkoniyat | Tavsif → parametrik model → "re-spec conversationally" → render → **STEP yoki DXF** eksport |
| Platforma | Brauzer (Mac/Windows) |
| Narx | 160 bepul trial kredit, keyin **$10 / 1,000 kredit** (pay-as-you-go) |
| Tillar | E'lon qilinmagan (sayt ingliz tilida) |
| Manba | https://prompt2cad.com/best-cabinet-design-software-2026 (2026-10-17) |

**Ahamiyati:** "tavsif → parametrik → DXF" oqimi allaqachon sotilmoqda va juda
arzon (pay-as-you-go). Bu bizning asosiy texnik g'oyamiz **yangi emas**.

## A.4 OpenCutList (`docs.opencutlist.org`)

| Parametr | Qiymat |
|---|---|
| Turi | SketchUp kengaytmasi (plagin) |
| Imkoniyat | Parts list, cutting diagrams, labels, cost/weight, exploded views, **SVG + DXF**, CSV/XLSX |
| Materiallar | Solid wood, sheet goods, dimensional lumber, veneers, **edge bandings**, accessories |
| Narx | **Bepul, GPLv3** ochiq kod |
| Tillar | French, English, German, **Russian**, Italian, Portuguese, Spanish, Polish, Czech, Vietnamese, Ukrainian, Dutch, Chinese |
| Cheklov | SketchUp talab qiladi; **SketchUp Pro obuna kerak** (desktop); "not available for the online and iPad versions of SketchUp" |
| Manba | https://docs.opencutlist.org · https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension (2026-10-17) |

**Ahamiyati:**
1. **Rus tili allaqachon bor.** "Rus tili — bizning afzalligimiz" degan faraz
   zaiflashadi (garchi u SketchUp ichida ishlasa ham).
2. Edge banding va material turlari allaqachon modellashtirilgan — bizda yo'q.
3. Bepul va ochiq kod — narx bosimi kuchli.

**Ular qila olmaydigan narsa:** tabiiy til bilan model yaratish. OpenCutList mavjud
modeldan cut list chiqaradi; modelni qo'lda chizish kerak.

## A.5 Eclipse Cabinets PRO (SketchUp kengaytmasi)

| Parametr | Qiymat |
|---|---|
| Imkoniyat | 28 parametrik shkaf turi, **9 til** (English, Japanese, German, Spanish, French, Portuguese, Italian, Korean, **Russian**), tahrirlash, 4 eshik uslubi, hardware tracking, **CNC-ready cut lists**, nesting, **DXF**, narx baholash, Blum clearances |
| Ish oqimi | "Design → Cut Lists → Nesting → DXF Export → CNC Production" |
| Narx | **UNKNOWN** — rasmiy narx sahifasi bu tadqiqotda topilmadi/ochilmadi. 30 kunlik bepul sinov e'lon qilingan. |
| Manba | https://www.youtube.com/watch?v=-OCcRYLNse0 (rasmiy kanal, 2026-03-22) · https://extensions.sketchup.com/extension/c5d61892-9b99-41ea-863a-1be6b6ed6abb/eclipse-cabinets-pro (2026-10-17) |

**Ahamiyati:** rus tili bor, CNC/DXF bor, nesting bor. Ya'ni "rus tili + manufacturing"
kombinatsiyasi ham bo'sh emas. Farq: SketchUp desktop talab qiladi va tabiiy til
yo'q.

> **Diqqat:** narxni **taxmin qilmadim**. "UNKNOWN" deb qoldirdim.

## A.6 Boshqa bevosita tegishli mahsulotlar

| Mahsulot | Turi | Narx (rasmiy/e'lon qilingan) | Manufacturing | Izoh |
|---|---|---|---|---|
| **PolyBoard** | Parametrik shkaf CAD, Windows | Perpetual ~$1,995–$2,345; bepul demo (manufacturing chiqishi yo'q) | Cut list, CNC, tooling maps, hardware | Rus tili tasdiqlanmagan; Windows-only |
| **Cabinet Vision** | Sanoat cabinet CAD/CAM | Quote-based (~$249 CAD/oy minimum, 12 oy) | To'liq CNC | Katta ishlab chiqaruvchilar uchun |
| **Mozaik** | Cabinet shop software | ~$125–$195/oy/seat | Nesting + CNC | Windows |
| **Cabinet Planner** | Oddiy cabinet tool | $69.95 bir martalik | Panel optimizer + DXF | Juda arzon |
| **SketchList 3D** | Woodworking cut list | ~$599.99/yil yoki $999.99 bir martalik | Cut list + DXF | Mac/Windows |
| **Flatma** | AI cabinet, brauzer | Hobby $7/oy, Pro $19/oy | DXF/Excel/CSV (G-code yo'q) | AI render + cabinet |
| **Blender** | Umumiy 3D | **$0 (GPL)** | Add-on orqali | Tabiiy til yo'q |
| **SketchUp** | Umumiy 3D | $10.75–$71.58/oy (yillik) | Kengaytma orqali | Desktop kengaytmalar faqat Pro'da |

Manbalar: https://prompt2cad.com/best-cabinet-design-software-2026 ·
https://www.myarchitectai.com/blog/cabinet-design-software ·
https://planitcanada.ca/solutions/cabinet-vision/subscription-cost-pricing ·
https://www.boole.eu/polyboard.php (barchasi 2026-10-17).

## A.7 Differensiasiya haqida halol xulosa

Dastlabki faraz uchta ustunga tayangan edi. Har birini dalil bilan tekshiramiz:

| Ustun | Holat | Dalil |
|---|---|---|
| **1. O'zbek/rus tabiiy til kiritish** | **QISMAN HAQIQIY** | O'zbek tili hech bir tekshirilgan mahsulotda yo'q. Rus tili: OpenCutList, Eclipse Cabinets PRO **interfeysida** bor, lekin **tabiiy til bilan model yaratish** hech birida yo'q. Ya'ni "rus tilida gapirib model yaratish" hali bo'sh. |
| **2. Tahrirlanadigan parametrik model** | **HAQIQIY EMAS** | Srezio ("grab a shelf, drag a divider"), Prompt2CAD ("re-spec conversationally"), PolyBoard, Eclipse — hammasi parametrik. Bu endi differensiator emas, **kirish chiptasi**. |
| **3. Manufacturing chiqishi** | **BIZDAN USTUN RAQOBATCHILAR BOR** | Srezio: cut list + DXF + edge banding + grain + saw-shop. OpenCutList: DXF/SVG, edge banding, material turlari. Eclipse: nesting + DXF + hardware. **Bizda:** cut list (CSV) va SVG chizma bor, lekin **DXF, nesting, edge banding, hardware, joinery yo'q**. |

### A.7.1 Haqiqiy qolgan farq (ehtiyotkorlik bilan)

Faqat bittasi dalil bilan qo'llab-quvvatlanadi:

> **O'zbek va rus tilida tabiiy til kiritish + mahalliy to'lov va qo'llab-quvvatlash.**

Bu — **til va bozor** farqi, texnologik farq emas. U himoyalanishi qiyin
(Srezio yoki Prompt2CAD o'zbek tilini qo'shishi mumkin) va **texnik to'siq emas**.

Ikkinchi potentsial farq — **yumshoq mebel (divan, karavot, kreslo) + interyer
konteksti**. Buni hech bir tekshirilgan cabinet-mahsulot qilmaydi, lekin bu
bo'shliq **talab borligini isbotlamaydi** — faqat hech kim hujjatlashtirmaganini
ko'rsatadi.

### A.7.2 Bu W13 ga qanday ta'sir qiladi

W13 "AI ni 8 turga kengaytirish" bo'lib qoladi, lekin **pozitsiya o'zgaradi**:

- ❌ "Manufacturing-ready" deb da'vo qilish — **hali mumkin emas** (A.7 ga qarang).
- ✅ "O'zbek/rus tilida tez parametrik model yaratish" — halol va tekshiriladigan da'vo.
- ⚠️ Raqobatchilar bepul yoki juda arzon — narx bosimi kuchli.

---

# B QISM — W13 texnik rejasi

## B.1 Hozirgi holat (tekshirilgan)

| Element | Holat | Dalil |
|---|---|---|
| Backend `SUPPORTED_FURNITURE_TYPES` | **faqat `table`** | `backend/app/services/ai/spec.py:54` |
| Frontend `SUPPORTED_FURNITURE_TYPES` | **faqat `table`** | `src/ai/designSpec.ts:22` |
| Geometriya quruvchilari | **8 tur** | `src/geometry/furniture/types.ts:23-31` |
| Backend `FurnitureType` enum | 8 tur | `backend/app/services/ai/spec.py:40-47` |
| Noto'g'ri tur → xatti-harakat | `supported=false` + ogohlantirish, model qo'llanmaydi | `spec.py:146-152` |
| Frontend qo'llash | faqat `table` proposal yo'li | `src/ai/cloudDesignAdapter.ts:61-76` |
| AI usage ledger | **yozilmaydi** (faqat limit counter) | `backend/app/routers/ai.py:52` |
| Repair-loop | **yo'q** — buzuq JSON darhol xato | `backend/app/services/ai/openai_provider.py:117-119` |
| Rus tili (lokal provayder) | **yo'q** (Cyrillic 0 ta) | `backend/app/services/ai/local_provider.py` |
| AI testlari | backend 25, frontend 30 | `tests/test_ai.py`, `src/ai/*.test.ts` |

## B.2 Muammo tahlili: nima uchun "ro'yxatni kengaytirish" yetarli emas

Oddiy yechim (`SUPPORTED_FURNITURE_TYPES = 8 tur`) **buziladi**, chunki har bir
turda o'lcham diapazonlari tubdan farq qiladi:

| Tur | `heightCm` diapazoni | Muammo |
|---|---|---|
| table | 40–120 | — |
| chair | 40–120 | — |
| armchair | 60–130 | — |
| sofa | 60–130 | — |
| **bed** | **20–60** (karkas) | AI "karavot balandligi 90" desa → rad etiladi |
| wardrobe | 100–260 | — |
| shelf | 40–240 | — |
| dresser | 40–140 | — |

`validateFurnitureParams` (`src/geometry/furniture/params.ts:159-199`) diapazondan
tashqari qiymatda **`null`** qaytaradi → model **umuman qo'llanmaydi** va
foydalanuvchi faqat "ishlamadi" xabarini ko'radi.

**Qo'shimcha:** `bed` da `depthCm` aslida **uzunlik** (150–220). AI buni
"chuqurlik" deb tushunishi mumkin. Bu semantik mapping muammosi.

**Xulosa:** W13 ikki qatlamli bo'lishi shart:
1. Sxema darajasida 8 turni qabul qilish.
2. Har bir tur uchun **o'lcham semantikasi va diapazoni** bo'yicha normallashtirish
   (clamp emas — **defaults + merge**, chunki clamp noto'g'ri natija beradi).

> **Muhim qaror:** "clamp" (qiymatni chegaraga keltirish) **noto'g'ri** yondashuv.
> Karavot balandligi 90 sm deb kelsa, uni 60 ga "clamp" qilish mantiqsiz model
> yaratadi. To'g'riroq: **noto'g'ri deb belgilash va foydalanuvchiga aniq aytish**,
> yoki tur uchun defaultni ishlatish va buni **ochiq ogohlantirish** bilan aytish.

## B.3 Yagona DesignSpec shartnomasi (8 tur)

### B.3.1 Hozirgi shartnoma

```
DesignSpec = {
  furniture: FurnitureType,          # 8 tur
  dimensions: {width_cm, height_cm, depth_cm} | null,
  color: "#rrggbb" | null,
  material_kind: str | null,
  style: str | null,
  confidence: "high"|"medium"|"low",
  notes: [str],
  warnings: [str],
  supported: bool
}
```

### B.3.2 Taklif etilgan v2 (additive, orqaga mos)

```diff
 DesignSpec = {
   furniture: FurnitureType,
   dimensions: {width_cm, height_cm, depth_cm} | null,
+  # Har bir tur uchun ixtiyoriy, turga xos maydonlar (W2 `FurnitureParams` bilan bir xil nomda)
+  details: {
+    topThicknessCm?, legCount?,          # table
+    seatHeightCm?, backHeightCm?, armHeightCm?,   # chair/armchair/sofa
+    wallThicknessCm?, shelfCount?,       # wardrobe/shelf
+    doorCount?, drawerCount?, legHeightCm?,       # wardrobe/dresser
+    mattressHeightCm?, headboardHeightCm?,        # bed
+  } | null,
   color, material_kind, style, confidence, notes, warnings, supported
 }
```

**Nega `details` alohida obyekt:** `dimensions` barcha turlar uchun majburiy
uchta o'lchamni saqlaydi; turga xos maydonlar ixtiyoriy. Bu orqaga moslikni
saqlaydi (eski mijozlar `details` ni e'tiborsiz qoldiradi).

**Manba haqiqati:** bu maydon nomlari **aynan** `FurnitureParams`
(`src/geometry/furniture/types.ts:58-80`) bilan mos bo'lishi shart, aks holda
frontend ularni qo'llay olmaydi.

### B.3.3 Shartnoma validatsiyasi (ikki tomonlama)

| Qatlam | Nima tekshiradi | Qayerda |
|---|---|---|
| **Backend sxema** | tur ∈ 8; o'lchamlar 1–1000 sm; `details` maydonlari ma'lum ro'yxatdan | `services/ai/spec.py` |
| **Backend tur-chegarasi** | turga xos mantiqiy chegara (masalan `topThicknessCm < heightCm`) | yangi: `spec_rules.py` |
| **Frontend merge** | `FURNITURE_DEFAULTS[type]` + `details` + `dimensions` | yangi: `src/ai/furnitureSpec.ts` |
| **Frontend geometriya** | `validateFurnitureParams(type, params)` | mavjud, **o'zgarmaydi** |

**Qoida:** oxirgi darvoza — `validateFurnitureParams`. Agar u `null` qaytarsa,
model qo'llanmaydi va foydalanuvchiga aniq sabab ko'rsatiladi.

## B.4 Prompt parsing va normalizatsiya

### B.4.1 Uch tilli fixture korpusi (deterministik, tarmoqsiz)

Har bir tur uchun 3 tilda 5 ta variant = **8 × 3 × 5 = 120 fixture** (tavsiya;
minimum 40).

Format (JSON, test tomonidan o'qiladi):

```json
{
  "id": "uz-table-01",
  "lang": "uz",
  "prompt": "180x60x75 sm oq yog'och stol",
  "expect": {
    "furniture": "table",
    "dimensions": {"width_cm": 180, "height_cm": 75, "depth_cm": 60},
    "color": "#ffffff",
    "must_warn": false
  }
}
```

Qamrov talablari:
- **O'zbek:** lotin va kirill yozuvi; o'lchamlar `180x60x75`, `180×60×75`,
  `180 ga 60 ga 75`, `kengligi 180`, `balandligi 75`.
- **Rus:** `ширина 180`, `высота 75`, `глубина 60`, `180х60х75` (kirill `х`).
- **Ingliz:** `180 wide`, `75 high`, `60 deep`, `W180 D60 H75`.
- **Noaniq holatlar:** o'lchamsiz prompt, ziddiyatli o'lcham, noma'lum tur,
  ortiqcha ma'lumot ("oshxona uchun" — tur emas, kontekst).

### B.4.2 Lokal (offline) provayderni kengaytirish

Hozir `local_provider.py` faqat lotin o'zbek/ingliz kalit so'zlarini biladi.
W13 da:
- 8 tur uchun o'zbek (lotin + kirill) va rus kalit so'zlari.
- O'lcham kalit so'zlari: `kenglik/eni/ширина/width`, `balandlik/высота/height`,
  `chuqurlik/uzunlik/глубина/длина/depth`.
- **`bed` uchun maxsus:** "uzunlik" → `depth_cm` ga map qilinadi (semantik qoida).
- Bu **deterministik** — hech qanday tarmoq yo'q, test qilinadi.

> **Cheklov:** lokal provayder — regex/kalit so'z. U murakkab gaplarni tushunmaydi
> va **shunday deb hujjatlashtiriladi**. U "AI" emas, "offline heuristic".

### B.4.3 LLM provayder (tanlanmagan)

W13 **provayder tanlamaydi**. Mavjud `OpenAiCompatibleProvider` saqlanadi va
`MockTransport` bilan test qilinadi. Yangi provayder qo'shilmaydi.

## B.5 Sxema va geometriya validatsiyasi (qo'llashdan oldin)

### B.5.1 Ketma-ket darvozalar

```
1. JSON parse           → xato: ai_invalid_output
2. RawDesignSpec (pydantic) → xato: ai_invalid_output
3. build_design_spec()  → tur + o'lcham + rang → xato: ai_invalid_output
4. type_rules()         → turga xos mantiq  → xato: ai_invalid_output
   ↓ DesignSpec (supported=true)
5. frontend: merge defaults + details + dimensions
6. validateFurnitureParams(type, params)
   ├─ null → qo'llanmaydi + aniq xabar
   └─ params → ADD_FURNITURE
7. reducer validatsiyasi (mavjud) → oxirgi himoya
```

### B.5.2 Turga xos qoidalar (`spec_rules.py`, yangi)

Minimal, deterministik qoidalar (geometriyada allaqachon mavjud bo'lganlar bilan
bir xil, lekin **backendda erta ushlash** uchun):

| Tur | Qoida |
|---|---|
| table | `topThicknessCm < heightCm` |
| chair/armchair/sofa | `seatHeightCm < heightCm`; `armHeightCm ≤ heightCm` |
| wardrobe/shelf | `wallThicknessCm*2 < min(heightCm, depthCm)` |
| dresser | `legHeightCm < heightCm` |
| bed | `depthCm` — uzunlik (150–220); `headboardHeightCm ≥ heightCm` |

**Muhim:** bu qoidalar **takrorlanadi** (frontendda ham bor). Bu ataylab —
backend erta rad etadi, frontend esa oxirgi himoya. Ikkisi bir xil manbadan
kelishi kerak (kod generatsiyasi emas, **izchil test** bilan).

### B.5.3 Nima uchun bu "manufacturing-ready" degani emas

**Bu reja manufacturing-ready model yaratmaydi.** Quyidagilar **yo'q** va W13
doirasida **qo'shilmaydi**:

| Manufacturing tushunchasi | Holat | Kimda bor |
|---|---|---|
| Panel qalinligi (material bo'yicha) | qisman (`wallThicknessCm` faqat shkaf/javon) | Srezio, OpenCutList, PolyBoard |
| **Edge banding (qirra)** | **yo'q** | Srezio, OpenCutList, Eclipse |
| **Grain orientation** | **yo'q** | Srezio, OpenCutList |
| **Joinery (dado, mortise, dowel)** | **yo'q** | PolyBoard, Eclipse, Cabinet Vision |
| **Hardware (menteşa, rels)** | **yo'q** | Eclipse (Blum), PolyBoard |
| **Nesting** | **yo'q** | Eclipse, Mozaik, OpenCutList |
| **DXF** | **yo'q** | Srezio, Prompt2CAD, OpenCutList, Eclipse |
| Cut list (o'lchamlar) | **bor** (CSV) | — |
| SVG chizma | **bor** | OpenCutList |

**Xulosa:** W13 dan keyin ham mahsulot **"manufacturing-ready" emas**, "parametric
model + oddiy cut list" darajasida qoladi. Buni UI va hujjatlarda **ochiq** aytish
shart.

## B.6 Xato boshqaruvi (noaniq, to'liq bo'lmagan, noto'g'ri promptlar)

| Holat | HTTP | `code` | Foydalanuvchi xabari |
|---|---|---|---|
| Tur aniqlanmadi | 422 | `ai_ambiguous_type` | "Qanday mebel ekanini aniqlay olmadim. Masalan: «180 sm shkaf»." |
| Tur ma'lum, o'lcham yo'q | 200 | — | `supported=true`, `warnings` da "standart o'lchamlar ishlatiladi" |
| O'lcham noto'g'ri (manfiy/NaN/chegara) | 422 | `ai_invalid_output` | "O'lcham noto'g'ri. Iltimos, sm da aniq raqam kiriting." |
| O'lcham turga mos emas (bed 90 sm balandlik) | 422 | `ai_inconsistent_dimensions` | "Karavot uchun balandlik 20–60 sm. 90 sm mos emas." |
| Til aniqlanmadi | 422 | `ai_unsupported_language` | "Iltimos, o'zbek, rus yoki ingliz tilida yozing." |
| Provayder sozlanmagan | 503 | `ai_unconfigured` | "AI xizmati sozlanmagan. Mahalliy tahlil ishlatilmoqda." |
| Provayder xatosi | 502 | `ai_provider_error` | "AI xizmatiga ulanib bo'lmadi." |
| Chaqiruv limiti | 402 | `limit_reached` | mavjud |

**Muhim:** `ai_ambiguous_type` va `ai_inconsistent_dimensions` — **yangi** kodlar.
Frontend ularni alohida ko'rsatishi va mahalliy fallback taklif qilishi kerak.

## B.7 Regressiya testlari

| Test guruhi | Nima | Soni (tavsiya) |
|---|---|---|
| Backend: `build_design_spec` 8 tur | har tur × to'g'ri/noto'g'ri | 24 |
| Backend: tur qoidalari | har tur × chegara | 16 |
| Backend: uch tilli fixture | uz/ru/en | 40 (minimum) |
| Backend: provider (MockTransport) | valid, buzuq JSON, 4xx, timeout | 10 |
| Backend: API | auth, limit, 422/502/503, ledger idempotency | 8 |
| Frontend: `specToFurnitureParams` 8 tur | merge + default | 16 |
| Frontend: `cloudDesignAdapter` | applied/unsupported/unavailable | 8 |
| **Mavjud testlar** | W1–W12 regressiyasi | **452 + 175 o'zgarmasdan yashil** |

**Mavjud testlarni o'zgartirish:** `test_ai.py` da "chair unsupported" kabi
da'volar **yangilanadi** (o'chirilmaydi) — chunki xatti-harakat ataylab o'zgaradi.
Har bir o'zgartirilgan test commit xabarida sabab bilan qayd etiladi.

## B.8 Provayder-neytral chegaralar

| Qoida | Holat |
|---|---|
| Yangi provayder tanlanmaydi | ✅ W13 da yo'q |
| Mavjud `AiProvider` Protocol saqlanadi | ✅ `services/ai/base.py:44-54` |
| Provayder nomi javobda ko'rsatiladi | ✅ `AiDesignResponse.provider` |
| Provayder yo'q bo'lsa 503 + lokal fallback | ✅ mavjud |
| Testlar `MockTransport` bilan | ✅ tarmoqsiz |
| Yangi dependency | **yo'q** (httpx allaqachon bor) |

## B.9 Xavfsizlik

| Talab | Chora | Tekshirish |
|---|---|---|
| API kalit faqat serverda | `APP_AI_API_KEY` env; frontendda yo'q | `grep -r "API_KEY" src/` bo'sh bo'lishi |
| Kalit logga tushmasin | mavjud `RedactionFilter`; provayder xatosida body loglanmaydi | mavjud testlar |
| Kalit javobda bo'lmasin | `AiDesignResponse` da kalit maydoni yo'q | sxema testi |
| Prompt injection | chiqish faqat sxema orqali qabul qilinadi; tizim ko'rsatmasi foydalanuvchi matnidan ajratilgan | injection fixture |
| Foydalanuvchi matni logga tushmasin | hozir loglanmaydi — saqlanadi | `grep logger` |
| Testlarda haqiqiy kalit yo'q | `MockTransport` | CI |
| Pullik chaqiruv CI'da yo'q | `ai_provider=none` testlarda | CI konfiguratsiyasi |

## B.10 Usage metering (to'lovsiz)

**Muammo:** `routers/ai.py:52` faqat `enforce_limit` chaqiradi; `usage_records` ga
**yozmaydi**. Ya'ni AI xarajati ledgerda ko'rinmaydi.

**Yechim (W13):**
```
record_usage(
  db, user,
  operation=OPERATION_AI_GENERATE,
  idempotency_key=f"ai:{request_id}",     # mavjud correlation id
  quantity=1,
  unit=UNIT_REQUEST,
  duration_ms=<measured>,
  cost_kind=COST_UNKNOWN,                  # narx hali ma'lum emas
  provider=spec_provider,
  total_tokens=<agar provayder qaytarsa>,
  meta={"furniture": type},
)
```

**Cheklovlar:**
- `cost_kind=unknown` — narx **uydirilmaydi** (`services/usage.py:27-30`).
- Token soni faqat provayder qaytarsa (hozir lokal provayder qaytarmaydi).
- **To'lov tizimi ulanmaydi.** Bu faqat hisob yozuvi.
- Idempotent: bir so'rov ikki marta yozilmaydi.

## B.11 Bajarish ketma-ketligi

| Qadam | Nima | Bog'liqlik | Tekshiruv |
|---|---|---|---|
| **W13.1** | Backend: `SUPPORTED_FURNITURE_TYPES` = 8 tur + `spec_rules.py` | — | 24+16 test |
| **W13.2** | Backend: `details` maydoni (additive) | W13.1 | sxema testi |
| **W13.3** | Backend: 3 tilli fixture korpusi + lokal provayder kengaytmasi | W13.1 | 40 test |
| **W13.4** | Backend: repair-loop (1 marta) + yangi xato kodlari | W13.1 | 10 test |
| **W13.5** | Backend: usage ledger yozuvi | W13.1 | idempotency test |
| **W13.6** | Frontend: `furnitureSpec.ts` (merge + turga xos) | W13.1 | 16 test |
| **W13.7** | Frontend: `designSpec.ts` 8 tur + `specToFurnitureParams` | W13.6 | 8 test |
| **W13.8** | Frontend: `cloudDesignAdapter` + `AiPromptPanel` (yangi tur) | W13.7 | 8 test |
| **W13.9** | Frontend: `App.tsx` `applyDesign` (ADD_FURNITURE, tur tekshiruvi) | W13.8 | qo'lda + test |
| **W13.10** | Regressiya: to'liq suite (452 + 175) | barchasi | CI 3 job |

**Har qadamdan keyin:** `npm test` + `oxlint` + `typecheck` + `build`;
`ruff` + `pytest`; PG job.

## B.12 Qabul mezonlari (acceptance)

| ID | Mezon | Tekshirish |
|---|---|---|
| AC-W13-1 | 8 turning har biri promptdan yaratiladi va model qo'llanadi | API test × 8 |
| AC-W13-2 | `supported=true` faqat haqiqiy 8 tur uchun | sxema testi |
| AC-W13-3 | Noto'g'ri/o'lchamsiz/chegaradan tashqari natija **hech qachon** qo'llanmaydi | 24 test |
| AC-W13-4 | Uch tilda (uz/ru/en) kamida 40 fixture to'g'ri ishlaydi | fixture testlari |
| AC-W13-5 | Noaniq prompt aniq xato kodi va xabar qaytaradi | 6 xato testi |
| AC-W13-6 | `bed` o'lcham semantikasi (depth=uzunlik) to'g'ri | maxsus test |
| AC-W13-7 | Har chaqiruv ledgerda **bir marta** yoziladi | idempotency test |
| AC-W13-8 | API kalit frontendda yo'q, logda yo'q, javobda yo'q | grep + test |
| AC-W13-9 | Mavjud 452 + 175 test yashil qoladi | CI |
| AC-W13-10 | CI'da haqiqiy AI chaqiruvi yo'q | `ai_provider=none` |
| AC-W13-11 | "Manufacturing-ready" da'vosi UI/hujjatda yo'q | matn tekshiruvi |

## B.13 Rollback strategiyasi

| Daraja | Chora |
|---|---|
| **Feature flag** | `APP_AI_SUPPORTED_TYPES` env (default: 8). 1 ga qaytarish = eski xatti-harakat, kod qaytarishsiz |
| **Kod** | W13 commitlarini revert (merge commit, tarix saqlanadi) |
| **Frontend** | `SUPPORTED_FURNITURE_TYPES` ni `['table']` ga qaytarish — 1 qator |
| **Ma'lumot** | Yangi migratsiya **yo'q** (W13 sxema o'zgartirmaydi) |
| **Xavfsizlik** | Provayder o'chirilgan bo'lsa, lokal fallback ishlaydi |

**Muhim:** W13 **ma'lumotlar bazasi sxemasini o'zgartirmaydi** — migratsiya yo'q,
shuning uchun rollback xavfsiz.

## B.14 Ochiq cheklovlar (W13 dan keyin ham qoladi)

1. **"Manufacturing-ready" emas** — edge banding, grain, joinery, hardware,
   nesting, DXF yo'q.
2. **LLM sifati o'lchanmagan** — provayder tanlanmagan; faqat mock.
3. **Talab validatsiya qilinmagan** — intervyu yo'q (mahsulot egasi qarori).
4. **Raqobatchilar bepul/arzon** — Srezio beta'da bepul, Prompt2CAD $10/1000 kredit.
5. **O'zbek tili afzalligi himoyalanmagan** — texnik to'siq emas.
6. **Lokal provayder faqat regex** — murakkab gaplarni tushunmaydi.
7. **Cut list material/edge ma'lumotini bilmaydi** — `CutListRow` da faqat
   o'lchamlar (`src/manufacturing/cutList.ts:15-26`).

## B.15 Ochiq savollar (javob talab qiladi)

1. `bed.depth_cm` = uzunlik degan qaror tasdiqlanadimi?
2. AI natijasi **yangi obyekt** qo'shsinmi yoki tanlanganni yangilasинmi?
3. `details` maydoni `DesignSpec` ga qo'shilsinmi yoki alohida endpoint?
4. O'zbek kirill yozuvi W13 da majburiymi yoki keyinroqmi?
5. W13 branch nomi: `w13-ai-designspec-v2`?

---

## Xulosa

**A qism:** differensiatsiya taxmini **sezilarli zaiflashdi**. Srezio va Prompt2CAD
aynan bizning texnik g'oyamizni allaqachon qilmoqda; OpenCutList va Eclipse
manufacturing chiqishida bizdan ustun. Faqat **o'zbek tili** va **yumshoq mebel +
interyer** qamrovi dalil bilan qoladi — va bu **texnik to'siq emas**.

**B qism:** W13 — 10 qadamli, 2 qavatli validatsiyali, provaydersiz, migratsiyasiz
va to'liq qaytariladigan o'zgarish. U 8 turni AI oqimiga qo'shadi va "parametrik
model + oddiy cut list" darajasini beradi — **manufacturing-ready emas**.

**Tavsiya:** W13 ni "pozitsiyani tekshirish" vazifasi sifatida qabul qilish: agar
o'zbek tilidagi prompt sifati va 8 tur qamrovi foydalanuvchiga haqiqatan qadrli
bo'lsa, bu keyingi qadamlar uchun asos bo'ladi. Aks holda raqobatchilar bilan
texnologik poyga yutqaziladi.

**Bu hujjat talabni validatsiya qilmaydi.** Faqat implementatsiya rejasini beradi.
