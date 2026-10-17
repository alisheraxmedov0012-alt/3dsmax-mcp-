# 3D Studio AI — Professional Expansion Plan

> **Holat: taklif (reja). Kod hali yozilmagan.**
> Bu hujjat `PROJECT_PLAN.md`dagi **mavjud 8 bosqichli roadmapni o'zgartirmaydi** va unga
> **yangi bosqich qo'shmaydi**. U alohida, professional kengaytirish yo'nalishlarini
> belgilaydi. Yo'nalishlar **W (Workstream)** deb nomlanadi — ular "Stage" yoki "bosqich"
> emas, shuning uchun mavjud raqamlangan roadmapga ta'sir qilmaydi.
>
> Diqqat: bu yerdagi barcha texnologiya/narx/xizmat tavsiyalari **aniqlanishi kerak**
> sifatida keltirilgan. Hech qanday tashqi xizmat, AI model yoki pullik xizmat "bor"
> deb da'vo qilinmaydi. Har bir integratsiya o'z ish doirasida tekshiriladi va
> tasdiqlanadi.

---

## 1. Maqsad va qamrov

Mavjud 3D Studio AI (parametrik stol muharriri + xona + eksport + sandbox billing
skeleti) bazasini **professional, tijoriy foydalanishga mo'ljallangan AI mebel va
interyer yaratish platformasiga** aylantirish.

Maqsadli foydalanuvchi oqimi: **matn (va ixtiyoriy rasm) → model → tahrir → xona ichida
joylashtirish → material/yoritish bilan vizualizatsiya → eksport (GLB + boshqa formatlar) →
(ishlab chiqarish uchun) texnik hujjatlar.**

**Qamrov ichida:** W1–W12 (quyida).
**Qamrov tashqarisi:** mavjud 8 bosqich kodini qayta yozish; raqamlangan roadmapni
o'zgartirish; 3ds Max/Blender'ning to'liq o'rnini bosish; CAD aniqlikdagi barcha mebel
turlarini avtomatik qo'llab-quvvatlash.

## 2. Tamoyillar (mavjudni saqlash)

1. **Mavjud kod asos sifatida saqlanadi.** W ishlari faqat **qo'shimcha** (additive).
2. **Adapter orqali integratsiya.** Har bir tashqi xizmat almashtiriladigan interfeys
   ortida (mavjud `AiModelAdapter`, `PaymentProvider`, email va repository interfeyslari
   kengaytiriladi). Kalitlar faqat serverda.
3. **Qatlamlar ajratilgan holda saqlanadi** (`geometry/`, `scene/` — Three.js'siz va
   testlanadi; `ai/`, `projects/` — UI'siz; backend — FastAPI).
4. **Orqaga moslik.** Saqlangan loyihalar va API shartnomalari buzilmaydi; zarur bo'lsa
   **migratsiya** + regressiya testlari.
5. **Ko'r-ko'rona da'vo yo'q.** Real bo'lmagan imkoniyat "bor" deb ko'rsatilmaydi.
6. **Har bir o'zgarish CI bilan** tekshiriladi (mavjud `ci.yml`), testlarsiz commit yo'q.

## 3. Hozirgi holat (asos)

`main @ e0d0b06` — Stage 0–8 kodi to'liq, CI yashil. Amalda mavjud:

- **Frontend:** React 19 + TypeScript + Vite + Three.js (`OrbitControls`, oddiy
  yorug'lik, raycast tanlash).
- **Geometriya:** faqat **stol** (1 usti + 4 oyoq, `BoxGeometry`) va **xona** (pol +
  4 devor). Sof `scene/` qatlami (validatsiya + reducer).
- **AI:** mahalliy **regex** adapter — faqat stol o'lchami va rang kalit so'zlari.
  **Haqiqiy AI, rasm→3D, modelni AI bilan o'zgartirish YO'Q.**
- **Eksport:** `.glb` (butun sahna) + PNG (WebGL render).
- **Material:** rang + `metalness`/`roughness`. **Tekstura YO'Q.**
- **Backend:** FastAPI + SQLAlchemy 2 + Alembic; auth (opaque session + CSRF), rollar,
  tariflar/limitlar, obuna holat mashinasi, **sandbox** billing, fakturalar.
  **Real to'lov, SMTP, cloud loyiha, object storage, navbat/worker YO'Q.**
- **Infra:** Docker (non-root), Compose (PG + Redis + backend + frontend), CI; CD
  placeholder. **Production deploy qilinmagan.**

> Muhim: hozirgi "AI" — AI emas, deterministik matn tahlili; hozirgi geometriya — 3D
> generatsiya emas, qo'lda yozilgan 2 ta shakl. Quyidagi reja bu farqni yopishga
> qaratilgan va bu farqni **yashirmaydi**.

## 4. Umumiy arxitektura (mavjud + rejalashtirilgan)

```
Frontend (React + Three.js)
  UI panellari (mavjud)        +  PBR / HDRI / post-processing        (W5)
  geometry/ va scene/ (sof)    <-  ko'p-turli mebel kutubxonasi       (W2, W3)
  api/client.ts (mavjud)       ->  backend

Backend (FastAPI)
  AiProvider       (yangi)     <-  LLM / vision                        (W1, W7)
  ImageTo3DProvider(yangi)     <-  generativ 3D xizmati                (W7)
  RenderProvider   (yangi)     <-  GPU / Blender headless              (W5)
  PaymentProvider  (mavjud)    <-  fake -> real                        (W10)
  StorageProvider  (yangi)     <-  S3/R2/MinIO                         (W10)
  QueueProvider    (yangi)     <-  Redis/SQS worker                    (W10, W11)
  usage/metering   (kengaytma) <-  xarajat/limit                       (W11)

Worker (yangi): navbat -> uzoq AI / render / eksport vazifalari (W10, W11)
Ma'lumotlar: PostgreSQL + Redis + (obyekt storage) (W10)
```

## 5. Bog'liqliklar grafigi

```
W1 (AI matn) ----+--> W7 (rasm orqali dizayn)
                 +--> W11 (xarajat/ishonchlilik)  <-- W5, W7, W10
W2 (ko'p mebel) --> W3 (geometriya sifat) --> W9 (ishlab chiqarish)
W4 (material)   --> W5 (vizualizatsiya)   --> W9
W2, W3          --> W6 (interyer)
W2, W9          --> W8 (eksport)
W1,W5,W7        --> W10 (tijoriy backend) --> W12 (production)
W10, W11        --> W12
```

Tavsiya etilgan tartib: **W1 + W4** (parallel mustaqil start) → **W2 + W3** → **W5** →
**W6/W7/W8** → **W9** → **W10 + W11** → **W12**.

---

## 6. Ish yo'nalishlari (W1–W12)

Har bir yo'nalish quyidagi maydonlar bilan: **Maqsad / Bog'liqliklar / Bajarilish
mezonlari (DoD) / Qabul mezonlari / Tashqi bog'liqlik / Xavflar.**

### W1 — Haqiqiy AI matn integratsiyasi (LLM)
- **Maqsad:** matnni LLM bilan tushunib, **strukturaviy dizayn spec** ajratish; mavjud
  modelni suhbat/orqali o'zgartirishni qo'llab-quvvatlash.
- **Bog'liqliklar:** yo'q (mustaqil start). Mavjud `ai/` adapter interfeysidan foydalanadi.
- **DoD:** `AiProvider` real adapteri (structured JSON output, schema validatsiyasi);
  prompt → `DesignSpec` → geometriya; `localTableAdapter` **fallback** sifatida saqlanadi;
  chaqiruv backend orqali (kalit serverda).
- **Qabul mezonlari:** o'zbekcha matnlardan stol + kamida 3 tur mebel spec'i to'g'ri
  ajratiladi; xato/limit holatida foydalanuvchiga o'zbekcha xabar; kalit frontendga
  chiqmaydi; past ishonchda aniqlashtirish savoli.
- **Tashqi bog'liqlik:** LLM API (pullik, token) yoki lokal model (o'z GPU).
- **Xavflar:** o'zbek tili sifati; narx/limit; kechikish; ma'lumot maxfiyligi.

### W2 — Ko'p turli parametrik mebel kutubxonasi
- **Maqsad:** stol, stul, kreslo, divan, karavot, shkaf, javon, komod va dizaynerlik
  mebellar uchun parametrik builderlar.
- **Bog'liqliklar:** W3 (geometriya sifat/validatsiya) — birga olib boriladi.
- **DoD:** har tur uchun `params + builder + validation + testlar`; `SceneObjectType`
  kengaytiriladi; saqlangan loyihalar uchun **migratsiya**.
- **Qabul mezonlari:** har tur brauzerda quriladi/tahrirlanadi/eksport qilinadi; mavjud
  `table` loyihalari buzilmaydi (migratsiya testi bilan).
- **Tashqi bog'liqlik:** yo'q (sof brauzer/kod).
- **Xavflar:** hajm o'sishi (bundle), qismlar soni bilan murakkablik.

### W3 — Geometriya sifati, qismlar va birikmalar
- **Maqsad:** modelni qismlarga (panel, oyoq, rom, furnitura) ajratish, bo'g'inlar va
  **konstruktiv validatsiya**.
- **Bog'liqliklar:** W2.
- **DoD:** qism modeli + bo'g'in turlari + `validateGeometry` (o'lcham/g'ovlash/kolliziya).
- **Qabul mezonlari:** noto'g'ri o'lcham/konstruksiya rad etiladi va tushuntiriladi;
  validatsiya testlari o'tadi.
- **Tashqi bog'liqlik:** yo'q.
- **Xavflar:** validatsiya qoidalari mebel turiga qarab murakkablashadi.

### W4 — Materiallar va teksturalar
- **Maqsad:** yog'och, metall, shisha, mato, charm va boshqa PBR materiallar kutubxonasi;
  tekstura siqish/LOD.
- **Bog'liqliklar:** W5 bilan birga.
- **DoD:** material katalogi (albedo/normal/roughness/metalness), manifest/CDN, tanlash UI.
- **Qabul mezonlari:** material GLB'ga to'g'ri eksport bo'ladi; litsenziya **toza**
  (CC0 yoki tasdiqlangan); yuk hajmi optimallashtirilgan.
- **Tashqi bog'liqlik:** tekstura manbalari (litsenziya shart).
- **Xavflar:** litsenziya; bundle hajmi; format mosligi.

### W5 — Professional vizualizatsiya va fotoreal render
- **Maqsad:** HDRI, soya/ambient occlusion, ACES tonemapping, post-processing; ixtiyoriy
  **server-side fotoreal render** va katalog rasmlari.
- **Bog'liqliklar:** W4.
- **DoD:** brauzer sifat presetlari + (tanlansa) server render adapteri + navbat.
- **Qabul mezonlari:** katalog uchun 2K+ rasm; brauzer o'rtacha qurilmada barqaror;
  render xatosi foydalanuvchiga tushunarli.
- **Tashqi bog'liqlik:** GPU / render xizmati (pullik) — ixtiyoriy.
- **Xavflar:** GPU narxi/kechikish; fotorealizm kutilmasi (cheksiz).

### W6 — Interyer: joylashtirish va to'liq loyiha
- **Maqsad:** snaping, o'lchamga moslash, ko'p xona, to'liq kvartira, ko'rinish boshqaruvi.
- **Bog'liqliklar:** W2, W3.
- **DoD:** snaping/kolliziya; ko'p-xona sahna; izometrik/kesim ko'rinishlar.
- **Qabul mezonlari:** 100+ obyektli sahnada barqaror (mavjud katta-sahna testi asosida).
- **Tashqi bog'liqlik:** yo'q.
- **Xavflar:** katta sahna ishlashi (performance).

### W7 — Rasm orqali dizayn (reference + image→3D)
- **Maqsad:** reference image → uslub/proportsiya spec; keyin **image→3D** tashqi xizmat
  orqali; natijani sahnaga qo'shish.
- **Bog'liqliklar:** W1 (spec sxemasi).
- **DoD:** xavfsiz rasm yuklash/saqlash; vizyon tahlili; image→3D adapteri.
- **Qabul mezonlari:** yuklangan rasm turi/hajmi validatsiyasi; xizmat xatosi fallback;
  **natija parametrik model bilan tenglashtirilmaydi** (topologiya boshqacha).
- **Tashqi bog'liqlik:** vizyon LLM + generativ 3D xizmat (pullik).
- **Xavflar:** topologiya sifati; tijoriy litsenziya; narx; vaqt.

### W8 — Eksport va interoperability
- **Maqsad:** GLB sayqal, glTF extensions (KTX2/Draco), OBJ/STL/FBX, **STEP (CAD)**,
  Blender interop.
- **Bog'liqliklar:** W2, W9.
- **DoD:** format adapterlari, eksport profillari, qayta import sinovi.
- **Qabul mezonlari:** Blender'da fayl ochiladi; STEP aniq o'lchamli (agar OCCT yo'li
  tanlansa).
- **Tashqi bog'liqlik:** yo'q (lokal kutubxonalar) yoki CAD kutubxonasi (litsenziya).
- **Xavflar:** format o'zgaruvchanligi; CAD litsenziyasi (LGPL).

### W9 — Ishlab chiqarishga tayyorgarlik
- **Maqsad:** texnik chizmalar (o'lchamli), **BOM/material ro'yxati**, kesim ro'yxati,
  konstruktiv cheklovlar.
- **Bog'liqliklar:** W3, W5.
- **DoD:** chizma generatori (PDF/SVG), BOM, chegara validatsiyasi.
- **Qabul mezonlari:** chiqarilgan chizma sex uchun tushunarli; BOM to'liq.
- **Tashqi bog'liqlik:** yo'q.
- **Xavflar:** har dizaynerlik mebel uchun avtomatik chizma kafolatlanmaydi.

### W10 — Tijoriy backend: to'lov, cloud loyiha, storage, navbat
- **Maqsad:** real to'lov (W10a), cloud loyihalar (W10b), obyekt storage (W10c), uzoq
  vazifalar uchun navbat/worker (W10d).
- **Bog'liqliklar:** W1, W5, W7; mavjud auth/billing bazasi.
- **DoD:** `PaymentProvider` real adapter; `StorageProvider`; `QueueProvider`; tarif narx
  va limitlari **tasdiqlangan**; `projects` cloud CRUD + egalik.
- **Qabul mezonlari:** sandbox→real **kod o'zgarmasdan** (faqat konfiguratsiya); webhook
  idempotentligi saqlanadi; limitlar serverda; fayl egaligi tekshiriladi.
- **Tashqi bog'liqlik:** to'lov, storage, navbat, DB, Redis (pullik).
- **Xavflar:** PCI/huquqiy; mintaqa; egress narxi.

### W11 — Xarajat, limit, xatolik va UX boshqaruvi
- **Maqsad:** AI/render xarajat metering (token/generatsiya), byudjet/chegara,
  retry/fallback, xato UX.
- **Bog'liqliklar:** W1, W5, W7, W10.
- **DoD:** usage counter (mavjud `limits` kengaytmasi), byudjet alertlari, provayder
  fallback zanjiri.
- **Qabul mezonlari:** limitdagi foydalanuvchiga tushunarli xabar; xarajat kuzatiladi;
  provayder ishlamasa fallback ishlaydi.
- **Tashqi bog'liqlik:** metering/analitika (pullik bo'lishi mumkin).
- **Xavflar:** xarajat nazorati o'lchash aniqligi.

### W12 — Production deployment
- **Maqsad:** hosting, domen, TLS, managed DB/Redis, secret manager, monitoring,
  backup/DR, mustaqil pentest.
- **Bog'liqliklar:** W10, W11.
- **DoD:** CD real deploy; branch protection + required checks; backup/restore jadvali
  (RPO/RTO); alerting.
- **Qabul mezonlari:** staging→production chiqarish; smoke testlar; **mustaqil pentest**
  yopilgan.
- **Tashqi bog'liqlik:** hosting/DB/Redis/monitoring (pullik).
- **Xavflar:** operatsion xatolar; SLA; xavfsizlik.

---

## 7. Tashqi xizmatlarga bog'liqlik (xarajat/limit/aniqlanadigan jihatlar)

| Yo'nalish | Tashqi xizmat | Nima aniqlanishi kerak |
|---|---|---|
| W1 | LLM API (OpenAI/Anthropic/Gemini/Azure/Mistral yoki lokal Llama) | structured output, token narxi, rate limit, kechikish, ma'lumot rezidentligi, o'zbek tili sifati |
| W7 | Vizyon LLM + image→3D (Meshy/Tripo/Rodin/CSM/Stability yoki ochiq TripoSR/InstantMesh) | chiqish formati, topologiya, PBR, **tijoriy litsenziya**, generatsiya narxi, kechikish |
| W5 | GPU / Blender headless (cloud/self-host) | GPU narxi, render vaqti, sifat, navbat |
| W4 | Tekstura manbalari (ambientCG/Poly Haven CC0, Megascans/Substance) | litsenziya, hajm, CDN |
| W10 | To'lov (Stripe/Paddle/Payme/Click) | mintaqa, komissiya, PCI, webhook, soliq/hujjat |
| W10 | Email (Resend/SES/Postmark) | deliverability, narx, SPF/DKIM/DMARC |
| W10 | Object storage (S3/R2/B2/MinIO) | narx/egress, presigned URL, domen |
| W10 | Navbat (Redis RQ/Celery/ARQ, SQS) | murakkablik, retry, narx |
| W12 | Monitoring (Sentry/Datadog/Grafana) | narx, sampling, retention |
| W12 | Hosting/DB/Redis | narx, region, backup, SLA |
| — | **Bepul:** parametrik geometriya (W2/W3/W6), brauzer render, GLB/PNG eksport, regex fallback, auth/billing mantiqi | tashqi xizmatga bog'liq emas |

> Aniq narx raqamlari **tanlangan provayder va hajmga bog'liq**; har bir ish doirasida
> integratsiyadan oldin tasdiqlanadi.

---

## 8. W1 — Texnik topshiriq (batafsil)

**Nomi:** Real AI matn integratsiyasi (structured design spec).

**Maqsad:** foydalanuvchi o'zbek/ingliz tilida mebel g'oyasini yozadi; tizim uni
**validatsiyalangan `DesignSpec`**ga aylantiradi; spec mavjud geometriya qatlamiga uzatiladi.
Mavjud modelni **suhbat orqali** o'zgartirish ham qo'llab-quvvatlanadi.

**Chegaralar (scope):**
- Kiradi: bitta LLM provayder adapteri; prompt→spec; spec→geometriya; fallback; limit hisobi.
- Kirmaydi: rasm tahlili (W7), image→3D (W7), murakkab CAD (W9).

**Interfeys shartnomasi (mavjudni kengaytiradi):**
- `ai/types.ts`dagi `AiModelAdapter` saqlanadi; yangi `AiProvider` interfeysi qo'shiladi
  (matn spec uchun) — ikkisi yonma-yon.
- Yangi tur: `DesignSpec` (furniture type + o'lchamlar + qismlar + material + uslub +
  izohlar). **Schema qat'iy** (JSON Schema / pydantic model).
- `localTableAdapter` **fallback** bo'lib qoladi (provayder yo'q yoki xato bo'lsa).

**Oqim:** `UI → api/client → backend /api/ai/design → AiProvider → DesignSpec (validatsiya)
→ geometriya qatlami → sahna`. Kalit faqat backendda (env/secret).

**Bajarilish mezonlari (DoD):**
1. Backendda AI router + provider adapter (structured output, timeout, retry).
2. `DesignSpec` sxemasi + validatsiya + testlar.
3. Frontend `AiPromptPanel` natijani spec orqali qo'llaydi (mavjud UI saqlanadi).
4. Fallback: provayder sozlanmagan bo'lsa mahalliy adapter ishlaydi va bu **aniq** xabar beriladi.
5. Xarajat/limit hisobi W11 interfeysiga ulanadi (stub bo'lsa ham).

**Qabul mezonlari:**
- 20+ o'zbekcha matn bilan stol + ≥3 tur mebel spec'i to'g'ri ajratiladi.
- Schema buzilsa (LLM noto'g'ri JSON) — xato ushlanadi, foydalanuvchiga tushunarli xabar.
- Kalit/secret hech qachon frontend yoki logga chiqmaydi.
- CI yashil (lint, typecheck, test, build, audit).

**Tashqi bog'liqlik:** LLM API (yoki lokal model). Narx/limit aniqlanishi kerak.
**Xavflar:** o'zbek tili sifati; narx; kechikish; provayder uzilishi (retry/fallback).

**Holat (amalga oshirildi):** backend adapteri qo'shildi —
`backend/app/services/ai/` (`base`, `spec`, `local_provider`, `openai_provider`,
`registry`) va `POST /api/ai/design` (`backend/app/routers/ai.py`); konfiguratsiya
`APP_AI_PROVIDER` (`none`|`local`|`openai_compatible`). Frontend:
`src/ai/designSpec.ts`, `src/ai/cloudDesignAdapter.ts`, `AiPromptPanel` fallback.
Haqiqiy provayder kaliti bilan so'rov **yuborilmagan**; testlar mock/oflayn.
Qolgan: real provayder bilan 20+ o'zbekcha matn qabul sinovi va W11 xarajat
metering integratsiyasi.

---

## 9. W2 — Texnik topshiriq (batafsil)

**Nomi:** Ko'p turli parametrik mebel kutubxonasi.

**Maqsad:** `table`dan tashqari: **stul, kreslo, divan, karavot, shkaf, javon, komod** +
dizaynerlik mebellar. Har biri parametrik (o'lcham/qism/material) bo'ladi.

**Chegaralar (scope):**
- Kiradi: yangi turlar uchun `params + builder + validation + testlar`; sahna modeli
  kengaytmasi + migratsiya.
- Kirmaydi: AI bilan generatsiya (W1), rasm→3D (W7), bo'g'inlarning to'liq konstruktiv
  tahlili (W3), eksport formatlari (W8).

**Interfeys shartnomasi:**
- `geometry/` — har tur uchun alohida modul (`buildChair.ts`, `buildSofa.ts`, ...),
  umumiy `FurnitureParams` bazasi.
- `scene/types.ts` — `SceneObjectType` birlashmasi kengaytiriladi; `scene/sceneValidation.ts`
  eski turlarni **migratsiya** qiladi.
- `scene/buildSceneObject.ts` — tur bo'yicha builder dispatch.

**Bajarilish mezonlari (DoD):**
1. Har tur: parametr sxemasi + diapazon + validatsiya + testlar.
2. Sahna modeli ko'p-turni qo'llab-quvvatlaydi; reducer amallari tur-agnostik.
3. Eski (v1–v3) saqlangan loyihalar buzilmasdan ochiladi (migratsiya testi).
4. Eksport (GLB) yangi turlarni o'z ichiga oladi.
5. UI'da tur tanlash; har turning o'z parametrlari.

**Qabul mezonlari:**
- Har tur brauzerda quriladi, tahrirlanadi, saqlanadi, GLB'ga eksport qilinadi.
- Mavjud `table` oqimi va testlari buzilmaydi.
- Katta sahna testi (mavjud) yangi turlar bilan barqaror.
- CI yashil.

**Tashqi bog'liqlik:** yo'q.
**Xavflar:** bundle hajmi; turlar ko'payishi bilan murakkablik; nomlash izchilligi.

---

## 10. W1 ↔ W2 o'zaro bog'liqlik va shartnoma

**Umumiy nuqta:** `DesignSpec` (W1 chiqishi) va `FurnitureParams` (W2 kirishi) **bir xil
lug'at**ga ega bo'lishi shart.

**Shartnoma (tavsiya):**
```
DesignSpec = {
  furniture: "table" | "chair" | "armchair" | "sofa" | "bed"
             | "wardrobe" | "shelf" | "dresser" | ...,
  dimensions: { widthCm, heightCm, depthCm, ... },
  parts?: [...],          // W3 uchun (ixtiyoriy)
  material: { kind, color, ... },
  style?: {...},
  confidence, notes[], warnings[]
}
```
- W1 `furniture` turini W2 lug'atidan **oladi** (umumiy `FurnitureType` konstantasi).
- W2 builderlar W1 spec'ini **to'g'ridan-to'g'ri** qabul qila oladigan qilib yoziladi.
- Agar W2 tur hali mavjud bo'lmasa, W1 fallback + aniq xabar beradi (yolg'on da'vo yo'q).

**Tartib tavsiyasi:** W1 va W2 **parallel** boshlanishi mumkin, lekin `FurnitureType`
lug'ati va `DesignSpec` sxemasi **birgalikda** (bitta mini-shartnomada) tasdiqlansin —
aks holda integratsiya qayta ish talab qiladi.

**Bog'liqlik matritsasi (qisqa):**
| | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 | W9 | W10 | W11 | W12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W1 | — | spec | — | — | — | — | asos | — | — | kirish | kirish | — |
| W2 | spec | — | kirish | — | — | kirish | — | kirish | kirish | — | — | — |
| W3 | — | chiqish | — | — | — | — | — | — | kirish | — | — | — |
| W5 | — | — | — | chiqish | — | — | — | — | kirish | — | kirish | — |
| W10 | chiqish | — | — | — | chiqish | — | chiqish | — | — | — | chiqish | kirish |

---

## 11. Umumiy xavflar va ochiq savollar

1. **Generativ 3D (W7) va fotoreal render (W5) sifati** provayder/byudjetga bog'liq;
   natija parametrik model bilan teng emas (iflos topologiya, noaniq o'lcham).
2. **AI sifati (W1)** — o'zbek tilida noaniq matnni to'liq to'g'ri ajratish kafolatlanmaydi;
   past ishonchda aniqlashtirish savollari kerak.
3. **CAD aniqlik (W8/W9)** faqat OCCT/CadQuery yo'li tanlansa erishiladi.
4. **Litsenziya** (tekstura, CAD kutubxona, generativ xizmat) oldindan tekshirilishi shart.
5. **Xarajat nazorati (W11)** — AI/render xarajati byudjetdan oshib ketmasligi kerak.
6. **Ochiq savollar:** LLM tanlovi; image→3D sotib olish yoki ochiq model; real to'lov
   mintaqasi; hosting mintaqasi; tarif narxlari.

## 12. Nima O'ZGARMAYDI

- `PROJECT_PLAN.md`dagi **8 bosqichli roadmap** va uning **bosqichlar soni** o'zgarmaydi;
  unga **Stage 9 qo'shilmaydi**.
- Mavjud ishlaydigan funksiyalar sababsiz qayta yozilmaydi yoki olib tashlanmaydi.
- Barcha yangi ishlar **additive** va `AGENTS.md` qoidalariga muvofiq (kichik
  o'zgarishlar, testlar, CI yashil, sir yo'q, tarix saqlanadi).

---

*Ushbu hujjat taklif sifatida tayyorlandi. Tasdiqlangach, W1 va W2 texnik topshiriqlari
asosida kichik, tekshiriladigan qadamlarga bo'lib amalga oshiriladi.*
