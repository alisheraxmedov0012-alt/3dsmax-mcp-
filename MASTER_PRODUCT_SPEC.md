# MASTER_PRODUCT_SPEC — 3D Studio AI Commercial Platform

> **Hujjat holati:** Phase 0 (reja). Kod yozilmagan, hech qanday tashqi xizmat chaqirilmagan.
> **Asos:** `integration/w1-w12` @ `439c047b5380e609a84260e2ab7bbfe8785edaaf`.
> **Tarixiy hujjatlar o'zgartirilmagan:** `PROJECT_PLAN.md` (0–8-bosqich, o'zgarmas),
> `PROFESSIONAL_EXPANSION_PLAN.md` (W1–W12 taklifi), `AGENTS.md`, `docs/*`.

Bu hujjat **mahsulot** talablarini belgilaydi. Texnik yechim: `SYSTEM_ARCHITECTURE.md`;
bajarish rejasi: `IMPLEMENTATION_ROADMAP.md`; testlar: `AUTOMATED_QA_STRATEGY.md`;
release: `PRODUCTION_READINESS.md`; xavflar: `RISK_REGISTER.md`.

Har bir fakt repository fayl:satr bilan bog'langan. Tekshirilmagan narsa
"**tekshirilishi kerak**" deb belgilangan.

---

## 1. Mahsulot maqsadi va foydalanuvchi muammosi

**Maqsad.** Matn (va ixtiyoriy rasm) orqali professional, tahrirlanadigan 3D mebel va
interyer loyihasini yaratish, uni tekshirish, render qilish, ishlab chiqarishga tayyor
fayl sifatida eksport qilish va saqlash.

**Muammolar (bozor gipotezalari — validatsiya qilinishi kerak):**

| # | Muammo | Kim uchun | Hozirgi yechim | Bizning farq |
|---|---|---|---|---|
| P1 | Professional 3D dastur (3ds Max, SketchUp) o'rganish qimmat va uzoq | kichik mebel ustaxonasi | mutaxassis yollash | matn → tayyor parametrik model |
| P2 | Har bir buyurtma uchun modelni noldan chizish | dizayner | qo'lda modellashtirish | shablon + parametr + AI tahrir |
| P3 | Chizma/BOM/cut list alohida dasturda qilinadi | ishlab chiqaruvchi | Excel + CAD | modeldan avtomatik BOM |
| P4 | Mijozga variant ko'rsatish sekin | sotuv | render studiyasi | tez render + interyer ko'rinishi |

**Mahsulot chegarasi (hozircha EMAS):** 3ds Max/Blender to'liq o'rnini bosish,
CAD-sertifikatlangan muhandislik hisoblari, foto-real render fermasi.

---

## 2. Foydalanuvchi guruhlari

| Persona | Ehtiyoj | Muvaffaqiyat mezoni | Ustuvorlik |
|---|---|---|---|
| **Ustaxona egasi** (O'Z, 1–20 xodim) | tez prototip + cut list | 1 loyiha < 15 daqiqada tayyor | **P0** |
| **Dizayner** | mijozga variant, interyer | 3 variant < 30 daqiqada | **P0** |
| **Ishlab chiqaruvchi** | aniq BOM/chizma | BOM 100% qismlarni qoplaydi | **P1** |
| **Yakuniy xaridor** (B2C) | "shunday stol" rasmdan | model 2 daqiqada | **P2** |
| **Developer/integrator** | API orqali avtomatlashtirish | API barqaror, hujjatli | **P2** |

---

## 3. Asosiy foydalanish ssenariylari

### S1 — Promptdan model (P0, asosiy oqim)
```
"3 eshikli, 180 sm keng shkaf, eman rangli, balandligi 220 sm"
  → DesignSpec (validatsiya) → parametrik model → ko'rish → tahrir → saqlash
```
**Bugungi holat:** `DesignSpec` va validatsiya bor
(`backend/app/services/ai/spec.py:1-30`), lekin AI oqimi **faqat `table`** turini
qo'llab-quvvatlaydi (`spec.py:54`, `src/ai/designSpec.ts:22`). Shkaf uchun `supported=false`
qaytadi va model qo'llanmaydi. → **W13/W14** ishi.

### S2 — Mavjud loyihani AI bilan tahrirlash (P0)
```
"shkafni 20 sm ga kengaytir va 2 ta qo'shimcha tokcha qo'sh"
  → diff → foydalanuvchi tasdiqlaydi → qo'llanadi → undo mumkin
```
**Bugungi holat:** bunday endpoint **yo'q**. → **W15**.

### S3 — Interyer kompozitsiyasi (P0)
Xona o'lchamlari, eshik/deraza, mebel joylashtirish, kolliziya.
**Bugungi holat:** **bor** — `src/scene/placement.ts`, `layoutPresets.ts`,
`sceneValidation.ts`; W6 testlari.

### S4 — Rasm → model (P1)
**Bugungi holat:** faqat interfeys va `unconfigured` holat
(`src/image/imageTo3dProvider.ts:1-30`); heuristik tahlil bor (`referenceInference.ts`),
haqiqiy provayder **yo'q**. → **W18**.

### S5 — Render va eksport (P0)
**Bugungi holat:** brauzer PNG (W5), GLB/JSON/OBJ/STL/PNG
(`src/export/exportFormats.ts:53,74,94,114,134`). Server render **yo'q** → **W17**.

### S6 — Ishlab chiqarishga tayyorlash (P1)
**Bugungi holat:** SVG chizma, BOM, qismlar, cut list (`src/manufacturing/`).
DXF/CNC/nesting **yo'q** → **W20**.

### S7 — Hisob, saqlash, obuna (P0)
**Bugungi holat:** auth + sessiya + CSRF bor; loyiha CRUD + optimistic version bor;
job queue + worker bor; usage ledger bor. To'lov **faqat sandbox**; storage `s3`
**amalga oshirilmagan**. → **W21**.

---

## 4. Oqim: promptdan yakuniy loyihagacha

```
[1] Matn/rasm (frontend)
      ↓ POST /api/ai/design            (backend/app/routers/ai.py)
[2] AI provider adapter                (services/ai/registry.py)
      ↓ xom javob
[3] DesignSpec validatsiyasi           (services/ai/spec.py)
      ↓ sxema + chegara + supported
[4] Geometriya qurish                  (src/geometry/furniture/buildFurniture.ts)
      ↓ Three.js obyektlar
[5] Sahna + validatsiya                (src/scene/sceneReducer.ts, sceneValidation.ts)
      ↓
[6] Tahrir (parametr / transform / material / AI diff)
      ↓
[7] Render (PNG / server render)       (src/export/sceneImage.ts, W17)
      ↓
[8] Eksport (GLB/OBJ/STL/JSON/…)       (src/export/sceneFileExport.ts)
      ↓
[9] Saqlash (lokal + server)           (src/projects/, backend/services/projects.py)
      ↓
[10] Ishlab chiqarish (BOM/chizma)     (src/manufacturing/)
```

**Muhim tamoyil (majburiy):** qadam [3] dan o'tmagan AI natijasi hech qachon [4] ga
o'tmaydi. `services/ai/spec.py` hujjati buni aynan shunday belgilaydi
("anything a provider produces is treated as untrusted").

---

## 5. Imkoniyatlar holati (dalil bilan)

Belgilar: **I** to'liq · **P** qisman · **M** yo'q.

| # | Imkoniyat | Holat | Dalil | Izoh |
|---|---|---|---|---|
| C1 | 8 turdagi parametrik mebel | **I** | `src/geometry/furniture/types.ts:23-31` | stol, stul, kreslo, divan, karavot, shkaf, tokcha, komod |
| C2 | Prompt → DesignSpec | **P** | `backend/app/services/ai/spec.py:146` | sxema bor; faqat `table` qo'llanadi |
| C3 | AI bilan loyiha tahriri | **M** | endpoint yo'q | W15 |
| C4 | Geometriya validatsiyasi | **I** | `src/scene/sceneValidation.ts`, `geometryQuality.test.ts` | NaN/chegara/qism |
| C5 | PBR material + procedural tekstura | **P** | `src/materials/*` | HDRI/UV unwrap yo'q → W16 |
| C6 | Kamera/yoritish/sifat presetlari | **I** | `src/render/renderPresets.ts` | brauzer render |
| C7 | Xona, ochilish, joylashtirish | **I** | `src/scene/placement.ts`, `layoutPresets.ts` | bir xona |
| C8 | Rasm tahlili (heuristik) | **P** | `src/image/referenceInference.ts` | real provayder yo'q |
| C9 | Image→3D provayder | **M** | `src/image/imageTo3dProvider.ts` (faqat interfeys) | W18 |
| C10 | Eksport: GLB/JSON/OBJ/STL/PNG | **I** | `src/export/exportFormats.ts:53-140` | 3MF/DXF/PDF yo'q → W19 |
| C11 | SVG chizma, BOM, cut list | **P** | `src/manufacturing/{technicalDrawing,bom,cutList}.ts` | nesting/CNC yo'q → W20 |
| C12 | Auth, sessiya, CSRF, rollar | **I** | `backend/app/security.py`, `deps.py` | |
| C13 | Loyiha CRUD + optimistik versiya | **I** | `backend/app/services/projects.py` | versiya tarixi yo'q |
| C14 | Job queue + worker + stale recovery | **I** | `backend/app/services/jobs.py`, `worker.py` | ko'p worker uchun navbat W21 |
| C15 | Usage/cost ledger | **I** | `backend/app/services/usage.py:27-49` | actual/estimated/unknown |
| C16 | To'lov | **P** | `backend/app/services/payments/fake.py:24-25` | faqat sandbox |
| C17 | Storage | **P** | `backend/app/services/storage.py:157-171` | memory/local; `s3` yo'q |
| C18 | Observability | **P** | `backend/app/metrics.py`, `routers/health.py` | process-local; tashqi monitoring yo'q |
| C19 | Rasm yuklash validatsiyasi | **I** | `src/image/imageFile.ts` | hajm/tur |
| C20 | Android/responsive | **P** | `src/App.css:1107` (bitta 720px breakpoint) | PWA/TWA yo'q → W23 |

---

## 6. Acceptance criteria (har muhim funksiya uchun)

Har bir mezon **avtomatik** tekshiriladi (test turi qavsda). "Kafolat" emas — **maqsad**.

| ID | Mezon | Tekshirish |
|---|---|---|
| AC-1 | 8 mebel turining har biri o'z parametrlari bilan quriladi va validatsiyadan o'tadi | unit + property (W2/W3 mavjud) |
| AC-2 | Promptdan olingan spec faqat `supported=true` turlar uchun qo'llanadi; aks holda aniq ogohlantirish | API test (`test_ai.py`) |
| AC-3 | Noto'g'ri/chegaradan tashqari AI javobi **hech qachon** sahnaga tushmaydi | mock fixture + schema test |
| AC-4 | AI tahriri (W15) har doim qaytariladi (undo) va diff ko'rsatiladi | deterministik diff test |
| AC-5 | Xona ichida joylashtirish kolliziya va tashqarida qolishni aniqlaydi | unit (mavjud) |
| AC-6 | Har eksport formati mustaqil parser bilan o'qiladi | contract test (W19) |
| AC-7 | 500+ qismli sahna uchun 60 FPS **benchmark bilan o'lchanadi** (kafolat emas) | perf benchmark (W14) |
| AC-8 | 4K render vaqti benchmarkda qayd etiladi va SLO sifatida belgilanadi | perf benchmark (W17) |
| AC-9 | Foydalanuvchi faqat o'z loyihasiga kira oladi (IDOR yo'q) | API test (mavjud) |
| AC-10 | Har pullik amal usage ledgerga idempotent yozuv qoldiradi | DB test (mavjud) |
| AC-11 | To'lov webhook takroriy kelsa, obuna 2 marta faollashmaydi | PG test (W21) |
| AC-12 | Readiness DB/worker/storage holatini to'g'ri aks ettiradi | API test (mavjud) |
| AC-13 | Android viewportda 3 asosiy oqim ishlaydi | Playwright device (W23) |
| AC-14 | Klaviatura bilan asosiy oqim bajariladi, axe critical = 0 | a11y test (W23) |

---

## 7. Bozorni tekshirish va mijoz validatsiyasi rejasi

**Bu reja bajarilmagan.** Quyidagilar **tekshirilishi kerak**, taxmin qilinmagan.

| Bosqich | Usul | Namuna | Qaror mezoni |
|---|---|---|---|
| V1 | 8–12 ustaxona egasi bilan chuqur intervyu (Toshkent/Samarqand) | 8–12 | 5+ "ha, to'lardim" |
| V2 | 3 dizayner bilan prototip testi (mavjud W1–W12 demo) | 3 | 2+ haftalik ishlatadi |
| V3 | Narx sezgirligi (kredit vs obuna) | 15 | aniq narx oralig'i |
| V4 | 2 ishlab chiqaruvchi bilan BOM/chizma sinovi | 2 | BOM qabul qilinadi |
| V5 | O'zbek/rus prompt sifati testi | 30 prompt | ≥90% to'g'ri spec |
| V6 | Raqobatchi tahlili (SketchUp, Planner 5D, Foyr, Tripo) | 5 | farq aniq |

**Tekshirilishi kerak:** O'zbekiston bozorida to'lov usullari (Payme/Click/Uzum)
shartlari va huquqiy talablari; mahalliy hosting/ma'lumot residency talabi.

---

## 8. Muvaffaqiyat ko'rsatkichlari (KPI)

| KPI | Boshlang'ich | 6 oy maqsadi | O'lchov |
|---|---|---|---|
| Prompt → qo'llanilgan model (muvaffaqiyat %) | o'lchanmagan | ≥85% | usage ledger + job natijalari |
| Birinchi loyiha tugatilish vaqti | o'lchanmagan | < 15 daq | event tracking (W21+) |
| 7-kunlik qaytish (retention) | 0 (yangi) | ≥25% | analytics |
| Render muvaffaqiyat darajasi | o'lchanmagan | ≥98% | job metrics |
| Export xatosizlik | o'lchanmagan | ≥99% | contract test + prod log |
| AI xarajati / foydalanuvchi / oy | o'lchanmagan | belgilangan byudjet ichida | usage ledger |
| p95 API kechikishi | o'lchanmagan | < 500 ms (CRUD) | metrics |

> Barcha "boshlang'ich" qiymatlar hozir **yo'q** — analytics hali yoqilmagan.
> Bu KPI'lar W21 (commercial backend) bilan birga o'lchanadigan bo'ladi.

---

## 9. Monetizatsiya — variantlar (qaror qilinmagan)

| Model | Tavsif | Afzallik | Kamchilik | Holat |
|---|---|---|---|---|
| **Free + kredit** | bepul: 3 loyiha, 5 AI, 2 render; keyin kredit paketi | AI/render xarajati nazoratda | kredit hisobi murakkab | **tavsiya etiladi** |
| Obuna (oylik) | Free / Pro / Studio | bashoratli daromad | AI xarajati cheklanmagan xavf | mavjud `Plan` modeli mos |
| Seat-based | har foydalanuvchi | jamoalar uchun qulay | kichik ustaxona uchun qimmat | kechiktiriladi |
| Marketplace komissiyasi | model/asset sotish | qo'shimcha daromad | moderatsiya | P2 |

**Majburiy cheklov:** qimmat AI/render amallari har doim **kredit yoki limit** bilan
cheklanadi (`backend/app/services/limits.py` + W11 usage). Cheklovsiz bepul AI **yo'q**.

**Tekshirilishi kerak:** narx nuqtalari, kredit→so'm kursi, refund siyosati,
O'zbekiston soliq/huquq talablari.

---

## 10. Nima o'zgarmaydi

1. `PROJECT_PLAN.md` — tarixiy, o'zgartirilmaydi.
2. W1–W12 identifikatorlari va commit tarixi — saqlanadi.
3. `main` — bugungi holatda (`e0d0b06`).
4. Mavjud API shartnomalari — buzilmaydi; kengaytirish additive.
5. Adapter tamoyili — har tashqi servis almashtiriladigan.

## 11. Ochiq savollar

- Bozor: avval O'Z ichida, keyin MDH/global?
- Monetizatsiya: kredit, obuna yoki aralash?
- LLM: qaysi provayder (o'zbek/rus sifati prioritet)?
- Image→3D: vendor yoki self-host?
- Render: GPU xarajatini kim ko'taradi (bepul tarifda)?
- O'zbek/rus tillari: faqat UI yoki AI prompt ham?
