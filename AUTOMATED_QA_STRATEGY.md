# AUTOMATED_QA_STRATEGY — 3D Studio AI

> **Hujjat holati:** Phase 0 (reja). Hozirgi test holati **tekshirilgan**:
> frontend **452** test / 48 fayl, backend **175 passed / 14 skipped** (SQLite).
> CI: 3 job — `frontend`, `backend`, `postgres` (`.github/workflows/ci.yml`).
> Mavjud test natijalari: `docs/W12_TEST_REPORT.md`.

Bu hujjat **W13–W23 uchun** QA tizimini belgilaydi. Mavjud testlarni qayta yozmaydi;
ularga qo'shadi.

---

## 1. Hozirgi holat (audit)

| Qatlam | Mavjud | Yo'q |
|---|---|---|
| Frontend unit | Vitest, `environment: 'node'` (`vite.config.ts`), 48 fayl | komponent test (jsdom yo'q) |
| Backend unit/API | pytest + TestClient, 20 fayl | — |
| PostgreSQL | `tests/test_postgres*.py` (14 test) | parallel/concurrency stress |
| E2E | **yo'q** | Playwright |
| Visual regression | **yo'q** | screenshot baseline |
| Android viewport | **yo'q** | device emulation |
| WebGL | **yo'q** (node env) | headless GL test |
| AI live | **yo'q** | opt-in smoke |
| Dependency audit | `npm audit`, `pip_audit` | — |
| CI | 3 job | E2E job, a11y job |

**Xulosa:** unit/API qatlami yaxshi; **brauzer, vizual, qurilma va real provayder**
qatlamlari umuman yo'q.

---

## 2. Test piramidasi (maqsad)

```
        ┌──────────────┐
        │ Live smoke   │  qo'lda, opt-in, pullik — CI'da EMAS
        ├──────────────┤
        │ E2E (Playwright) │  8–12 oqim
        ├──────────────────┤
        │ Visual / a11y    │  screenshot + axe
        ├──────────────────┤
        │ Integration/API  │  pytest + PG
        ├──────────────────┤
        │ Unit (FE + BE)   │  eng ko'p
        └──────────────────┘
```

Nisbat maqsadi: unit 70%, integration 20%, E2E 10%. E2E faqat **kritik oqimlar** uchun.

---

## 3. Unit testlar

### 3.1 Frontend
- **Vosita:** Vitest (mavjud).
- **Qamrov maqsadi:** `src/scene`, `src/geometry`, `src/materials`, `src/export`,
  `src/manufacturing`, `src/ai` — **pure funksiyalar** (Three.js'siz yoki WebGL'siz).
- **Yangi:** `src/geometry/assemblies`, `src/scene/sceneDiff` (W14/W15).
- **Qoida:** har yangi funksiya uchun kamida 1 happy path + 1 chegara + 1 xato testi.

### 3.2 Backend
- **Vosita:** pytest + FastAPI TestClient (mavjud).
- **Qamrov:** service qatlami, validatsiya, holat mashinalari (job/subscription),
  idempotency, ownership.
- **Yangi:** `services/image_to_3d`, `services/render`, `payments/<real>` adapterlari.

### 3.3 Komponent testlar (yangi)
- **Vosita:** `@testing-library/react` + `jsdom` (yoki `happy-dom`).
- **Sabab:** hozir UI xatti-harakati (loading/error/retry) faqat qo'lda tekshiriladi.
- **Qamrov:** `JobsPanel`, `ProjectsPanel`, `AiPromptPanel`, `MaterialPanel`,
  `ServerPanel`, `AccountPanel` — state o'tishlari.
- **Cheklov:** WebGL komponentlar (`ViewerCanvas`) jsdom'da **testlanmaydi** — E2E ga.

---

## 4. Integratsion va API testlar

| Tur | Vosita | Nimani tekshiradi |
|---|---|---|
| API kontrakt | pytest + TestClient | status, xato `code`, CSRF, auth |
| Ownership/IDOR | pytest | boshqa foydalanuvchi 404 |
| Rate limit | pytest | 429 + `Retry-After` |
| Job lifecycle | pytest | queued→running→terminal, retry cap |
| Usage idempotency | pytest + DB | `(user_id, key)` unikal |
| Billing webhook | pytest | takroriy event 1 marta |

**Majburiy:** har endpoint uchun kamida auth, validation, not-found holati.

---

## 5. PostgreSQL, migratsiya va concurrency

- **Mavjud:** 14 PG-only test (unique, FK cascade, timestamptz, JSON, recovery).
- **Muhim (tekshirilgan):** Phase 0 vaqtida lokal muhitda PostgreSQL serveri **yo'q**
  (`psql` mavjud emas, 5432 yopiq), shuning uchun PG testlari lokalda **NOT VERIFIED**.
  CI'dagi `postgres` job aynan shu commit uchun yashil (run `38695782617`).
  Bu natija lokal muhit uchun dalil emas.
- **Yangi (W21):** parallel enqueue stress (2 worker, 100 job), `SKIP LOCKED` bo'lsa
  dublikat yo'qligi, to'lov webhook race.
- **Migratsiya:** `upgrade head → downgrade base → upgrade head` har PRda.
  **Qo'shimcha:** `alembic heads` natijasi **bitta** bo'lishi tekshiriladi.
- **CI:** `postgres:16` service (mavjud).

```bash
# majburiy tekshiruv
python -m alembic heads            # bitta head
python -m alembic upgrade head
python -m alembic downgrade base
python -m alembic upgrade head
```

---

## 6. E2E — Playwright (yangi)

**Sabab:** hozir brauzer oqimi umuman avtomatlashtirilmagan; W23 talabi.

### 6.1 Ssenariylar (8–12)
1. Ro'yxatdan o'tish → kirish → chiqish.
2. Prompt → model → tahrir → saqlash.
3. Loyihani ochish → tahrir → versiya konflikti.
4. Interyer: xona → mebel → kolliziya ogohlantirishi.
5. Eksport: GLB yuklab olish → fayl mavjudligi.
6. Render: PNG → o'lcham tekshiruvi.
7. Xato holati: server o'chiq → xabar + retry.
8. Sessiya muddati → qayta kirish.
9. Rate limit → `Retry-After` xabari.
10. Mobil viewport: asosiy oqim.

### 6.2 Konfiguratsiya
- `playwright.config.ts`: `chromium` + `--use-gl=swiftshader` (WebGL headless).
- `webServer`: `vite preview` + `uvicorn` (test DB).
- Artefakt: screenshot, trace (faqat failure), video (retry'da).
- Timeout: 30 s; retry: **1** (faqat CI, flake o'lchash uchun).

### 6.3 WebGL
- **Muammo:** headless WebGL flaky bo'lishi mumkin.
- **Yechim:** `swiftshader` + `preserveDrawingBuffer` + piksel-chegaraviy tekshiruv
  (aynan piksel emas, **bo'sh emas** + o'lcham + asosiy rang).
- **Cheklov:** GPU render sifati E2E bilan **kafolatlanmaydi** → qo'lda QA.

---

## 7. Android viewport va touch

- **Vosita:** Playwright device emulation (`Pixel 7`, `Galaxy S9+`).
- **Tekshiriladi:** touch target ≥ 40px, horizontal scroll yo'q, panel ochilishi,
  gesture (pinch — Playwright'da cheklangan, qo'lda qo'shimcha).
- **Cheklov:** haqiqiy qurilma xatti-harakati (GPU, sensor) **avtomatlashtirilmaydi** →
  `PRODUCTION_READINESS.md` da qo'lda QA sifatida qoladi.

---

## 8. Visual regression

- **Vosita:** Playwright `toHaveScreenshot`.
- **Baseline:** `e2e/__screenshots__/`.
- **Barqarorlik:** animatsiya o'chiriladi, shrift yuklanishi kutiladi, vaqt muzlatiladi.
- **Threshold:** 0.2% piksel (GPU farqi uchun).
- **Qoida:** baseline faqat **review** bilan yangilanadi; avtomatik yangilash yo'q.

---

## 9. 3D eksport validatsiyasi (contract test)

Test matn grep emas — **parser** bilan:

| Format | Tekshirish |
|---|---|
| GLB | `@gltf-transform/core`: magic, versiya, node/mesh soni, material |
| OBJ | `usemtl`/`mtllib` **yo'q** (W8 shartnomasi), `v`/`f` mavjud |
| STL | binary: `(len-84) % 50 == 0`, uchburchak soni > 0 |
| JSON | `ajv` schema: `format`, `scene.objects`, `schema_version` |
| PNG | signature + o'lcham |
| SVG | XML well-formed + `viewBox` |
| CSV/BOM | qator/ustun soni, sarlavha |

**Majburiy:** har format uchun "bo'sh fayl qaytarmaslik" testi.

---

## 10. AI testlari

### 10.1 Mock (har push, deterministik)
- `AiProvider` stub: 40 fixture (uz/ru/en) → kutilgan `DesignSpec`.
- Xato fixture: timeout, invalid JSON, noto'g'ri o'lcham, noma'lum tur, injection.
- **Tekshiriladi:** qo'llanadi/qo'llanmaydi, ogohlantirish matni, 0 jimgina o'zgarish.

### 10.2 Live smoke (opt-in, CI'da EMAS)
- `workflow_dispatch` + repository secret (`AI_SMOKE_KEY`).
- 5 prompt, narx chegarasi, natija sxemasi.
- **Hech qachon** oddiy CI'da pullik API chaqirilmaydi.
- Natija artefakt sifatida saqlanadi (narx hisobi bilan).

---

## 11. Dependency va xavfsizlik auditi

| Tekshiruv | Buyruq | CI |
|---|---|---|
| npm | `npm audit --audit-level=high` | ✅ |
| Python | `python -m pip_audit` | ✅ |
| Secret scan | `git grep` pattern + pre-commit | qo'shiladi |
| SAST (ixtiyoriy) | `semgrep` | W22 |
| Container | `trivy` (image) | W22 |

**Qoida:** High/Critical zaiflik → release bloklanadi.

---

## 12. GitHub Actions qabul mezonlari

### 12.1 Majburiy joblar (har PR)
| Job | Qadamlar | Maks. vaqt |
|---|---|---|
| `frontend` | ci → oxlint → typecheck → test → build → audit | 3 daq |
| `backend` | pip → ruff → pip_audit → import → alembic → pytest | 4 daq |
| `postgres` | service → alembic → pytest | 4 daq |
| `e2e` (yangi, W23) | build → preview → playwright → artefakt | 8 daq |

### 12.2 Shartlar
- **Hammasi yashil** bo'lmasa merge yo'q.
- `skipped`/`xfail` qo'shish **taqiqlanadi** (PG-only istisno, izoh bilan).
- Test soni kamaymasligi tekshiriladi (baseline).
- Flaky retry maksimum 1; flake darajasi hisoblanadi.

---

## 13. Flaky test siyosati

1. **O'chirish taqiqlanadi.** Test `quarantine` ro'yxatiga o'tadi + issue ochiladi.
2. **14 kun** ichida tuzatiladi yoki sabab hujjatlashtiriladi.
3. Quarantine'dagi test **release bloklovchisi** hisoblanadi (agar kritik oqim bo'lsa).
4. **Flake rate** = (qayta urinishlar / umumiy run). 3% dan yuqori → bloklovchi.
5. Sabab tahlili: timing, tarmoq, GPU, shared state, tartib bog'liqligi.
6. `retries: 1` faqat diagnostika uchun; yashil natija "tuzatildi" degani emas.

---

## 14. Avtomatik testlar KAFOLATLAY OLMAYDIGAN holatlar

**Bu ro'yxat hujjatning majburiy qismi** — bular `PRODUCTION_READINESS.md` da
qo'lda tekshiruv sifatida qoladi:

| Holat | Nega avtomatlashtirilmaydi |
|---|---|
| Haqiqiy GPU render sifati | headless SwiftShader ≠ GPU; rang/precision farqi |
| Haqiqiy Android qurilma | sensor, GPU, brauzer versiyasi, touch fiziologiyasi |
| Real AI provayder sifati | nondeterministik, pullik, kvota |
| Real to'lov | haqiqiy karta/huquqiy |
| Tarmoq uzilishi/geo-latency | simulyatsiya ≠ real |
| Katta hajmli (1 GB) fayl | CI resurs chegarasi |
| Uzoq muddatli barqarorlik (soatlar) | CI vaqt chegarasi |
| Vizual "chiroyli" natija | sub'ektiv, inson bahosi |
| Xavfsizlik (pentest) | ijodiy hujum, avtomatik skaner yetarli emas |

**Qoida:** avtomatik test yashil bo'lishi **production tayyorligini anglatmaydi.**
