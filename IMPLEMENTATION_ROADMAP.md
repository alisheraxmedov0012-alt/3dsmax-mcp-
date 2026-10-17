# IMPLEMENTATION_ROADMAP — W13…W23

> **Hujjat holati:** W13–W23 uchun reja. Bosqichlar holati har bir bo'limda yoziladi.
> **W15** (W15.1–W15.10) implementatsiya qilingan va avtomatik frontend testlari yashil,
> lekin draft PR'larda turadi: **merge qilinmagan, deploy qilinmagan, brauzer/mobil QA
> bajarilmagan**. Qolgan bosqichlar (W16–W23) hali bajarilmagan — ular bo'yicha da'vo
> yo'q. W15 ham "production-ready" deb belgilanmagan; cheklovlari o'z bo'limida.
> **Baza:** `integration/w1-w12` @ `439c047b5380e609a84260e2ab7bbfe8785edaaf`.
> **W1–W12 — mavjud poydevor.** Bu hujjat ularni qayta implementatsiya qilmaydi va
> ularning tarixini o'zgartirmaydi. Yangi ishlar **W13–W23** identifikatorlarini oladi.
> `PROJECT_PLAN.md` (0–8-bosqich) tarixiy hujjat bo'lib qoladi.

**Umumiy darvoza (har bosqich oxirida):**
1. `npm test` + `oxlint` + `typecheck` + `build` yashil.
2. `ruff` + `pytest` yashil; PostgreSQL job yashil.
3. Yangi acceptance criteria testlari yozilgan va o'tgan.
4. Regressiya: oldingi bosqich testlari soni kamaymagan.
5. Hech qanday `skipped`/`xfail` qo'shilmagan (PG-only istisno).

---

## Bosqichlar xaritasi

| ID | Nomi | Bog'liq | Asosiy qiymat |
|---|---|---|---|
| W13 | Real LLM + DesignSpec v2 | W1, W11 | prompt haqiqatan tushuniladi |
| W14 | Assembly + constraint engine | W2, W3, W13 | murakkab obyektlar |
| W15 | AI copilot (tahrir) | W13, W10 | mavjud loyihani AI bilan tahrir |
| W16 | Tekstura/HDRI/UV | W4 (qattiq); W21 (yumshoq — faqat prod storage) | fotoreal ko'rinish |
| W17 | Server render | W5, W10, W11 | 4K render xizmati |
| W18 | Real image→3D | W7, W13 | rasm → model |
| W19 | Interop v2 + validatsiya | W8 | professional vositalar |
| W20 | Manufacturing v2 | W9, W14 | CNC/DXF/nesting |
| W21 | Commercial backend v2 | W10, W11, W12 | real pul/storage/navbat |
| W22 | Production platform | W21 | ishonchli ekspluatatsiya |
| W23 | UX, Android, i18n, a11y | barchasi | bozorga tayyor interfeys |

\* W16 ning qattiq bog'liqligi — W4. Production storage (S3/R2) faqat **W21** da
keladi; W16 shu vaqtgacha `local` adapter bilan ishlaydi va production storage
tayyor bo'lgach qo'shimcha konfiguratsiya talab qilmaydi.

**Parallel ishlash:** W18 va W19 W16/W17 bilan parallel mumkin (fayl to'qnashuvi yo'q).
W20 faqat W14 dan keyin. W23 eng oxirida.

---

## W13 — Real LLM integratsiyasi va DesignSpec v2

**Maqsad / qiymat.** Prompt o'zbek/rus/ingliz tillarida ishonchli tushuniladi; noto'g'ri
AI javobi loyihaga tushmaydi. **Bugungi bo'shliq:** `SUPPORTED_FURNITURE_TYPES` faqat
`table` (`backend/app/services/ai/spec.py:54`).

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `backend/app/services/ai/{base,registry,spec,openai_provider,local_provider}.py`; `routers/ai.py`; `schemas.py`; `src/ai/*`; `src/components/AiPromptPanel.tsx` |
| **Bog'liqlik** | W1 (adapter), W11 (usage) |
| **Vazifalar** | 1) provayder tanlash (mezоnlar §SYSTEM_ARCHITECTURE 2.2); 2) `DesignSpec` v2 JSON-schema (8 tur + material/style); 3) repair-loop (1 retry); 4) `SUPPORTED_FURNITURE_TYPES` ni geometriya bilan sinxronlash; 5) token metering; 6) prompt injection himoyasi; 7) uz/ru prompt katalogi |
| **Testlar** | 40 mock fixture (uz/ru/en); sxema testi; injection korpusi; fallback testi |
| **Xavfsizlik** | kalit faqat serverda; foydalanuvchi matni tizim ko'rsatmasi emas; chiqish validatsiyasi |
| **Acceptance** | (a) 8 tur `supported=true`; (b) ≥90% fixture to'g'ri; (c) 0 invalid spec qo'llanadi; (d) provayder yo'q bo'lsa 503 + aniq xabar |
| **Regressiya** | W1 `test_ai.py`; W2 builder testlari |
| **Rollback** | `APP_AI_PROVIDER=local` (env) — kod qaytarishsiz |
| **Servis/xarajat** | LLM: **T2**; narx tekshiriladi |
| **Tayyorlik** | opt-in live smoke (qo'lda) yashil |

---

## W14 — Assembly va constraint engine

| Bo'lim | Mazmun |
|---|---|
| **Maqsad** | 8 mebel + assembly: oshxona moduli, zinapoya, eshik/deraza, shkaf seksiyasi |
| **Modullar** | `src/geometry/assemblies/*` (yangi), `src/geometry/furniture/*`, `src/scene/{types,sceneReducer,sceneValidation}.ts`, `src/manufacturing/parts.ts` |
| **Bog'liqlik** | W2, W3, W13 |
| **Vazifalar** | assembly DSL; qism bog'lanish grafigi; constraint solver (o'lcham/joylashuv); ko'p xonali sahna; qism ID barqarorligi |
| **Testlar** | property-based (0 NaN, 0 self-intersection); snapshot; 500+ qism benchmark |
| **Xavfsizlik** | cheksiz rekursiya himoyasi; qism soni chegarasi |
| **Acceptance** | 4 assembly; 500 qismda 60 FPS **benchmarkda**; validatsiya 100% |
| **Rollback** | assembly flag bilan o'chiriladi; eski builderlar saqlanadi |
| **Xarajat** | **T0** |

---

## W15 — AI copilot: mavjud loyihani tahrirlash

> **Holat: implementatsiya qilingan (W15.1–W15.10), avtomatik testlar yashil.
> Merge qilinmagan, deploy qilinmagan, brauzer/mobil QA bajarilmagan.**
> Batafsil: `W15_IMPLEMENTATION_PLAN.md` (reja) va `docs/W15_AI_EDIT_FLAG.md` (flag/rollback).

| Bo'lim | Mazmun |
|---|---|
| **Maqsad** | "shkafni 20 sm kengaytir" → xavfsiz diff → tasdiq → qo'llash |
| **Modullar** | `src/scene/{sceneDiff,sceneTargets,buildDiff,applyDiff,sceneRevision,sceneHistory}.ts`, `src/hooks/useSceneHistory*.ts`, `src/ai/{editCommandParser,mockEditProvider,editFlag}.ts`, `src/components/AiEditPanel.tsx` — hammasi **yangi**; `src/scene/{types,sceneReducer}.ts` va `src/App.{tsx,css}` **additive** o'zgargan |
| **Bog'liqlik** | W13, W10 (version) |
| **Qarorlar** | **M6** — assembly'ni AI orqali tahrirlash W15 doirasidan tashqarida. **M7** — faqat mock provayder, haqiqiy LLM yo'q |
| **Vazifalar** | 1) `validateOp`/`validateOps` — 30 reducer action tasniflandi: **6 allowlist + 24 denylist**; ixtiyoriy JSON path yoki reducer action rad etiladi. 2) `SET_VISIBILITY` — idempotent reducer action qo'shildi; `TOGGLE_VISIBILITY` saqlanib qoldi va AI DSL'dan **taqiqlangan**. 3) Scene target validatsiyasi — `resolveEditTarget` + `validateSceneOps`: obyekt mavjudligi, turi, room/assembly ajratilishi, bitta obyekt qoidasi, atomik rad + xato indeksi. 4) `buildDiff` — typed `SceneEditDiff`, `EDIT_SCHEMA_VERSION=1`, deterministik tartib, `duplicate_change`. 5) `applyDiff` — atomik replay, `before` qiymatlari qayta tekshiriladi, `stale_version` / `revision_mismatch` / `stale_content` / `reducer_mismatch`. 6) `sceneRevision` — `SceneState.revision`, `INITIAL_SCENE_REVISION=1`, faqat haqiqiy o'zgarishda +1, no-op'da o'zgarmaydi; `SceneData`ga qo'shilmagan. 7) Undo/redo — snapshot-based `sceneHistoryReducer` + `useSceneHistory`, limit 50, UI-only action'lar tarixga kirmaydi, revision orqaga qaytmaydi. 8) Deterministik parser + `mockEditProvider` — o'zbek/rus/ingliz buyruqlari, faqat 7 DSL operatori. 9) `AiEditPanel` — taklif, preview (before/after + birlik), tasdiq, rad etish, xato xabarlari, undo/redo tugmalari. 10) `VITE_AI_EDIT_ENABLED` — default **false**, faqat aniq `true` yoqadi, rollback hujjati |
| **Testlar** | Frontend: **69 fayl / 1070 test o'tadi** (W15 boshlanishida 610; **+460**). W15 fayllari bo'yicha: `sceneDiff` 141, `sceneTargets` 39, `buildDiff` 45, `applyDiff` 45, `sceneRevision` 49, `sceneHistory` 31, `useSceneHistory` (jsdom) 7, `editCommandParser` 35, `editFlag` 22, `AiEditPanel` (jsdom) 36, `sceneReducer` ga +11. Qamrov: valid/invalid diff fixture'lar (talab ≥30 edi), invalid action/ID/parametr, atomiklik, idempotentlik, revision monotonligi, undo/redo, stale diff, flag on/off, no-op taklif. Backend: **tegilmagan** — 287 passed / 14 skipped (PostgreSQL-only) W14 bazasidagi o'lchov |
| **Xavfsizlik** | AI faqat allowlist'dagi operatorlarni taklif qiladi; klient validatsiyasi yagona himoya emas — `buildDiff` va `applyDiff` har bir amalni, obyekt ID'sini va `before` qiymatini qayta tekshiradi. Server-side endpoint bu bosqichda **qo'shilmagan**, shuning uchun server avtorizatsiyasi haqida da'vo yo'q |
| **Acceptance** | Bajarilgan: har tahrir bitta undo bilan qaytariladi; 0 jimgina o'zgarish (clamp/drop yo'q, `reducer_mismatch` bilan aniqlanadi); diff foydalanuvchiga ko'rsatiladi; tasdiqsiz sahnaga o'zgarish kirmaydi. **Bajarilmagan:** brauzer va mobil qurilmada qo'lda QA |
| **Rollback** | `VITE_AI_EDIT_ENABLED=false` bilan **qayta build** (Vite `VITE_*` ni build vaqtida bundle'ga yozadi). R1 — `App.tsx`dan panelni olib tashlash; R2 — commit revert. Batafsil: `docs/W15_AI_EDIT_FLAG.md` |
| **PRlar** | Zanjir draft, merge qilinmagan: #23 `w15-ai-edit-plan` → #24 `w15-scene-diff` → #25 `w15-set-visibility` → #26 `w15-scene-validation` → #27 `w15-build-diff` → #28 `w15-apply-diff` → #29 `w15-scene-revision` → #30 `w15-scene-history` → #31 `w15-ai-edit-panel` → #32 `w15-ai-edit-flag`. Bazasi `main` emas, oldingi bosqich branchi |
| **Ochiq cheklovlar** | 1) Haqiqiy LLM provider **ulanmagan** — parser deterministik va cheklangan buyruqlar to'plamiga tayanadi. 2) `POST /api/ai/edit` backend endpoint **yo'q**; barcha validatsiya klientda. 3) Billing/to'lov **tegilmagan**. 4) Brauzer/mobil QA **bajarilmagan**. 5) Rejadagi "20 amallik DSL" amalda **7 operator** (6 allowlist action + DSL-only `set_visibility`); kengaytirish alohida qaror talab qiladi. 6) Material reset flat diff'da `apply_material_preset('default')` ga map qilinadi (render natijasi bir xil, saqlangan maydonlar farq qiladi) |
| **Xarajat** | **T0** — W15 doirasida pullik API chaqirilmagan (reja bo'yicha T2 faqat haqiqiy LLM ulanganda) |

---

## W16 — Tekstura, HDRI, UV va material kutubxonasi

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `src/materials/*`, `src/viewer/SceneViewer.ts`, `backend/app/services/storage.py`, `routers/files.py` |
| **Bog'liqlik** | W4 (qattiq). W21 (yumshoq — production S3/R2 storage; unga qadar `local` adapter) |
| **Vazifalar** | image texture; UV unwrap; HDRI environment; 20 preset; tekstura upload |
| **Testlar** | texture load; UV mapping; visual regression |
| **Xavfsizlik** | fayl turi/hajmi; EXIF tozalash; SVG sanitizatsiya |
| **Acceptance** | 20 preset; 8K tekstura bilan 30 FPS benchmark |
| **Rollback** | preset flag; procedural tekstura fallback |
| **Xarajat** | **T1** (storage/egress) |

---

## W17 — Photoreal render xizmati

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `backend/app/services/render/*` (yangi), `worker.py`, `routers/jobs.py`, `src/components/RenderExportPanel.tsx` |
| **Bog'liqlik** | W5, W10, W11 |
| **Vazifalar** | headless Chromium + SwiftShader; 4K; navbat; progress; watermark; render tarixi |
| **Testlar** | deterministik kichik render (piksel toleransi); navbat/retry; timeout |
| **Xavfsizlik** | render sandbox (tashqi URL bloklangan); resurs limiti |
| **Acceptance** | 4K < 60 s **benchmarkda**; xato halol; progress real |
| **Rollback** | server render flag; brauzer PNG saqlanadi |
| **Xarajat** | **T1–T3** (GPU) |

---

## W18 — Real image→3D

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `src/image/imageTo3dProvider.ts`, `backend/app/services/image_to_3d.py` (yangi), `routers/ai.py` |
| **Bog'liqlik** | W7, W13 |
| **Vazifalar** | vendor adapter; mesh validatsiya (GLB, vertex budget); rozilik oqimi; limit; heuristik fallback |
| **Testlar** | mock adapter (auth/timeout/rate-limit/invalid); mesh validator |
| **Xavfsizlik** | rasm faqat rozilik bilan; PII siyosati; o'lcham chegarasi |
| **Acceptance** | 20 tests rasmi → valid GLB; xato turlari aniq |
| **Rollback** | `unconfigured` holatiga qaytish (kod yo'q) |
| **Xarajat** | **T2–T3** |

---

## W19 — Interoperability v2 + eksport validatsiya harness

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `src/export/*`, `backend/scripts/validate_exports.py` (yangi) |
| **Bog'liqlik** | W8 |
| **Vazifalar** | 3MF, DXF, PDF chizma; (ixtiyoriy) FBX; har format parser testi |
| **Testlar** | `@gltf-transform/core`, XML/CSV parser, binary STL |
| **Acceptance** | har format mustaqil parser bilan o'qiladi; OBJ "faqat geometriya" shartnomasi saqlanadi |
| **Rollback** | format flag bilan o'chiriladi |
| **Xarajat** | **T0** |

---

## W20 — Manufacturing v2

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `src/manufacturing/{bom,cutList,technicalDrawing,parts,nesting}.ts`, `manufacturingExport.ts` |
| **Bog'liqlik** | W9, W14 |
| **Vazifalar** | nesting algoritmi; CNC DXF; furnitura BOM; material sarfi; taxminiy narx (biznes qoidasi) |
| **Testlar** | hisob-kitob testlari; snapshot; 50 qismli shkaf |
| **Xavfsizlik** | "sertifikatlangan CAD" deb da'vo qilmaslik (UI matni) |
| **Acceptance** | 50 qism → to'g'ri cut list + DXF |
| **Rollback** | yangi modul flag; SVG/CSV saqlanadi |
| **Xarajat** | **T0** |

---

## W21 — Commercial backend v2

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `services/payments/*`, `services/storage.py`, `worker.py`, `routers/billing.py`, `services/subscriptions.py` |
| **Bog'liqlik** | W10, W11, W12 |
| **Vazifalar** | real provayder (mintaqa bo'yicha); webhook imzo/replay; dunning; refund; S3/R2 adapter; Redis navbat; ko'p worker |
| **Testlar** | sandbox E2E; idempotent webhook (PG); concurrency; failure injection |
| **Xavfsizlik** | karta saqlanmaydi (PCI SAQ-A); imzo; replay himoyasi; `X-Forwarded-For` |
| **Acceptance** | to'lov → obuna → invoice; takroriy webhook 1 marta; `s3` production'da ishlaydi |
| **Rollback** | provayder flag; sandbox'ga qaytish (production'da taqiqlangan — ehtiyot) |
| **Xarajat** | **T2** (to'lov + storage) |

**Diqqat:** production'da sandbox'ga qaytish `config.production_problems` tomonidan
bloklanadi. Shuning uchun rollback = **oldingi reliz obrazi + DB migratsiya downgrade**.

---

## W22 — Production platform

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `deploy/*` (IaC), `.github/workflows/{ci,cd}.yml`, monitoring config |
| **Bog'liqlik** | W21 |
| **Vazifalar** | IaC; TLS; secret manager; OTel/Sentry; PITR; DR mashqi; load test; pentest; SLO |
| **Testlar** | restore drill (majburiy); chaos (worker kill); load |
| **Acceptance** | RPO/RTO kelishilgan va mashqda tasdiqlangan; pentest 0 Critical/High; `PRODUCTION_READINESS.md` to'liq PASS |
| **Rollback** | oldingi image + migratsiya downgrade + backup |
| **Xarajat** | **T2–T3** |

---

## W23 — UX, Android, i18n, accessibility

| Bo'lim | Mazmun |
|---|---|
| **Modullar** | `src/components/*`, `src/App.css`, `public/`, `capacitor` yoki TWA |
| **Bog'liqlik** | barcha oldingi |
| **Vazifalar** | 3 breakpoint; PWA/TWA; touch gesture; uz/ru/en; WCAG AA; onboarding |
| **Testlar** | Playwright `Pixel 7`; axe; visual regression |
| **Acceptance** | Android'da 3 oqim; axe critical = 0; Lighthouse PWA ≥ 90 |
| **Rollback** | PWA manifest flag |
| **Xarajat** | **T0–T1** |

---

## Bog'liqlik grafigi (tekshirilgan)

**Qattiq bog'liqlik** (sikl yo'q — faqat orqaga):

```
W13 ──► W14 ──► W20
 │        │
 ├──► W15 │
 │        ▼
 └──► W18   (W18 W14 ga bog'liq emas)
 W16 ──► W17
 W19 (W8 dan; mustaqil)
 W21 ──► W22 ──► W23
```

**Yumshoq bog'liqlik** (faqat production konfiguratsiyasi uchun):

```
W16 ···► W21 storage (S3/R2)   — W16 local bilan boshlanadi
W17 ···► W21 storage (render chiqishi)  — avval lokal disk
```

**Kritik yo'l:** `W13 → W14 → W21 → W22 → W23`.
**Parallel:** `W19` istalgan vaqtda; `W18` W13 dan keyin; `W16/W17` W14 bilan parallel
(lekin W21 tayyor bo'lmaguncha `local` storage bilan).

**Tekshiruv:** qattiq bog'liqliklarning barchasi **orqaga** qaratilgan (`W13` dan `W22` gacha
tartibda); sikl yo'q. `W16 → W21` va `W17 → W21` faqat **yumshoq** (production storage) —
ular bosqichni bloklamaydi, faqat production sozlamasini talab qiladi.

---

## Xarajat toifalari (taxminiy, narx emas)

| Toifa | Ma'nosi |
|---|---|
| T0 | bepul / lokal |
| T1 | past |
| T2 | o'rta |
| T3 | yuqori |

Aniq narxlar **taxmin qilinmaydi** — `RISK_REGISTER.md` R-30…R-34 ga qarang.

---

## Rollback umumiy siyosati

1. Har bosqich **flag** ortida (env yoki feature flag) — kod qaytarishsiz o'chirish.
2. Migratsiya har doim **reversible** (`downgrade` test qilinadi).
3. Har reliz oldidan **backup** + `alembic current` tekshiruvi.
4. Rollback = oldingi image + (kerak bo'lsa) migratsiya downgrade + backup restore.
5. Destruktiv migratsiya (ustun/jadval o'chirish) **faqat** alohida relizda, backup bilan.
