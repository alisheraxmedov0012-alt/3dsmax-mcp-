# SYSTEM_ARCHITECTURE — 3D Studio AI

> **Hujjat holati:** Phase 0 (reja). Repository holati `integration/w1-w12` @
> `439c047b5380e609a84260e2ab7bbfe8785edaaf`.
> **Takrorlamaydi:** umumiy arxitektura tavsifi `PROFESSIONAL_EXPANSION_PLAN.md §4` da;
> deployment/konfiguratsiya `docs/DEPLOYMENT.md` da. Bu hujjat **hozirgi kod bilan
> tasdiqlangan** tuzilmani, chegaralarni va kengaytirish qarorlarini beradi.

---

## 1. Mavjud tizim (kod bilan tasdiqlangan)

### 1.1 Qatlamlar

```
┌───────────────────────────────────────────────────────────────────┐
│ Frontend  React 19 + TypeScript + Vite + Three.js                 │
│  src/components  (17 panel, 2 914 LOC)                            │
│  src/scene       (reducer + validatsiya, Three.js'siz, 2 848 LOC) │
│  src/geometry    (8 mebel quruvchisi, 2 468 LOC)                  │
│  src/materials   (PBR preset + tekstura, 919 LOC)                 │
│  src/export      (5 format, 1 741 LOC)                            │
│  src/manufacturing (BOM/cut list/chizma, 1 495 LOC)               │
│  src/image       (rasm validatsiyasi + heuristika, 988 LOC)       │
│  src/ai          (DesignSpec adapteri, 828 LOC)                   │
│  src/projects    (localStorage repo, 910 LOC)                     │
│  src/viewer      (Three.js sahna, 752 LOC)                        │
└───────────────────────────────┬───────────────────────────────────┘
                                │  HTTPS + cookie session + CSRF
┌───────────────────────────────▼───────────────────────────────────┐
│ Backend  FastAPI + SQLAlchemy 2 + Alembic                         │
│  routers/  auth ai billing files health jobs plans projects usage  │
│  services/ ai jobs usage storage heartbeat diagnostics billing ... │
│  worker.py (mustaqil jarayon)                                     │
└───────┬──────────────────────────┬──────────────────┬─────────────┘
        │                          │                  │
   PostgreSQL                 Redis (ixtiyoriy)   Storage adapter
   (Alembic, 3 migratsiya)    (rate limit)        memory | local | (s3: yo'q)
```

**Dalil:** `find backend/app -name "*.py"` (55 fayl), `src/*` LOC hisobi,
`backend/app/routers/*.py` (10 router, 41 endpoint).

### 1.2 Ma'lumotlar bazasi — 14 jadval

`backend/app/models.py`:

| Jadval | Vazifa |
|---|---|
| `users`, `sessions`, `one_time_tokens` | auth, sessiya, email/reset |
| `plans`, `subscriptions`, `payment_attempts`, `invoices`, `billing_events` | billing |
| `projects` | loyiha + `version` (optimistik), `schema_version` |
| `jobs` | navbat, holat, `attempts`, `timeout`, `retryable` |
| `stored_files` | fayl metadatasi (bайtlar adapterda) |
| `usage_counters` | tarif limitlari (bloklash) |
| `usage_records` | append-only cost ledger (audit) |
| `worker_heartbeats` | worker tirikligi |

**Migratsiya zanjiri (yagona head):** `847f4f77d525 → b2f1c4a9d3e7 → c3a7e1d5f9b2`
(`alembic heads` → `c3a7e1d5f9b2`).

### 1.3 3D arxitektura qoidasi (majburiy)

`src/scene/` va `src/geometry/` **Three.js'dan mustaqil** bo'lib qoladi (faqat
`buildTable.ts` va builderlar Three.js ishlatadi, lekin ular WebGL kontekstisiz
testlanadi). Bu `AGENTS.md` qoidasi va `PROJECT_PLAN.md §4` bilan mos.

---

## 2. AI provider abstraction va DesignSpec oqimi

### 2.1 Hozirgi holat (aniq)

```
POST /api/ai/design                     backend/app/routers/ai.py
   ↓
get_ai_provider()                       services/ai/registry.py
   ├─ "none" (default)  → ProviderNotConfigured  (503, halol)
   ├─ "local"           → LocalHeuristicProvider  (regex/kalit so'z)
   └─ "openai*"          → OpenAiCompatibleProvider (httpx)
      "azure*"           → ProviderNotConfigured  (503, alohida protokol kerak)
   ↓ xom matn/JSON
build_design_spec()                     services/ai/spec.py
   ↓ sxema + chegara + supported
DesignSpec { furniture, dimensions, color, material_kind,
             style, confidence, notes, warnings, supported }
```

**Muhim cheklov (tekshirilgan):** `SUPPORTED_FURNITURE_TYPES` **faqat `table`**
(`backend/app/services/ai/spec.py:54`, `src/ai/designSpec.ts:22`), holbuki geometriya
qatlami 8 turni qura oladi (`src/geometry/furniture/types.ts:23-31`). Ya'ni
prompt → model oqimi hozir **faqat stol** uchun ishlaydi. Bu **W13** da yopiladi.

### 2.2 Kengaytirish qarori

- Interfeys saqlanadi (`services/ai/base.py`), yangi framework **qo'shilmaydi**.
- `DesignSpec` v2: JSON-schema + `repair loop` (1 marta qayta so'rash) + qat'iy validatsiya.
- **Hech qanday AI chiqishi validatsiyasiz qo'llanmaydi** — `spec.py` hujjati buni
  allaqachon talab qiladi.
- Provayder tanlash mezonlari: rasmiy hujjat, o'zbek/rus prompt sifati, narx, kechikish,
  litsenziya, data residency. **Narx taxmin qilinmaydi.**

---

## 3. 3D generator, render va image-to-3D adapterlari

| Adapter | Hozir | Kengaytirish |
|---|---|---|
| Parametrik generator | `src/geometry/furniture/buildFurniture.ts` (8 tur) | **W14**: assembly + constraint |
| Render | brauzer `WebGLRenderer` + `capturePng` (`src/viewer/SceneViewer.ts`) | **W17**: headless Chromium/SwiftShader → GPU |
| Image→3D | faqat interfeys, `unconfigured` (`src/image/imageTo3dProvider.ts`) | **W18**: vendor adapter + mesh validatsiya |
| Textura/HDRI | procedural tekstura (`src/materials/textures.ts`) | **W16**: image texture, UV, HDRI |

**Adapter qoidasi:** har biri `Protocol`/`interface` ortida; kalit faqat serverda;
xato turlari tiplashtirilgan (auth / rate_limit / timeout / invalid_output).

---

## 4. Fayl saqlash, worker va job queue

### 4.1 Storage (hozir)

| Backend | Holat | Production |
|---|---|---|
| `memory` | ishlaydi (test) | **rad etiladi** (`config.production_problems`) |
| `local` | ishlaydi (`APP_STORAGE_DIR`) | bitta node uchun ruxsat |
| `s3` | **amalga oshirilmagan** (`storage.py:157-171`) | yoqilsa startup bloklanadi |

Kalit **server tomonda** generatsiya qilinadi (`generate_storage_key`), yo'l
traversal himoyasi bor (`LocalStorageAdapter._path`). → **W21** S3/R2 adapter.

### 4.2 Job queue (hozir)

```
POST /api/jobs → enqueue_job()  (idempotency: user+key unique)
   → queued → running → succeeded | failed | cancelled
                 ↑ retry (failed, attempts<max, retryable=true)
```
- Holatlar: `queueing/running/succeeded/failed/cancelled` (`services/jobs.py:41-45`).
- Turlar: `export | ai_generate | render | noop` (`jobs.py:66`).
- `inline` (test) yoki `worker` (`python -m app.worker`).
- Stale recovery: startup + worker + admin endpoint + CLI.
- **Cheklov:** bitta DB-navbat; ko'p worker uchun Redis/`SKIP LOCKED` → **W21**.
- Worker heartbeat readiness'ga ta'sir qiladi (`services/heartbeat.py`).

---

## 5. Auth, usage metering va billing

### 5.1 Auth
- Parol: bcrypt (`security.py:20`), ≤72 bayt.
- Sessiya: opaque token, DB'da faqat SHA-256 hash (`hash_token`).
- CSRF: double-submit, `X-CSRF-Token`, constant-time compare.
- Rollar: `user | admin`; admin bootstrap faqat CLI orqali (`cli.py`).
- Rate limit: per-scope (`rate_limit.py`), `X-Forwarded-For` faqat ishonchli proksida.

### 5.2 Usage metering
- `usage_counters` — tarif limiti (bloklaydi).
- `usage_records` — append-only ledger, `(user_id, idempotency_key)` unikal.
- `cost_kind`: `actual | estimated | unknown`; noma'lum narx **uydirilmaydi**.
- Amallar: `ai.generate, export, render, project.create, project.update,
  file.upload, job.enqueue, job.run` (`services/usage.py:42-49`).

### 5.3 Billing
- Provayder adapter: `services/payments/base.py`; hozir **faqat** `fake-sandbox`
  (`fake.py:24-25`, `is_real_provider=False`).
- Production'da sandbox **rad etiladi** (`config.production_problems`).
- Invoice `source_event_id` unikal → webhook idempotent.
- → **W21**: real provayder + dunning + refund.

---

## 6. Ma'lumotlar oqimi, xatolar va xavfsizlik chegaralari

### 6.1 So'rov oqimi
```
Client → ObservabilityMiddleware (request_id, body limit, metrics)
       → CORS → router → guard(rate limit) → deps(auth/CSRF) → service → DB
       → error handlers (yagona JSON shape) → response (+X-Request-ID)
```

### 6.2 Xato ishlash
- `ApiError` — barqaror `code`, foydalanuvchi xabari, `Retry-After`.
- Kutilmagan xato → generic 500; stack trace faqat serverda.
- Handler xatosi → job `failed` + `retryable` tasnifi; soxta muvaffaqiyat **yo'q**.

### 6.3 Xavfsizlik chegaralari
| Chegara | Himoya | Dalil |
|---|---|---|
| Browser ↔ API | cookie HttpOnly + CSRF + CORS allowlist | `deps.py`, `main.py` |
| Foydalanuvchi ↔ foydalanuvchi | har so'rovda `user_id` tekshiruvi; 404 (403 emas) | `services/projects.py` |
| API ↔ AI provayder | kalit faqat serverda | `config.ai_api_key` |
| API ↔ storage | server-generatsiya kalit, path guard | `services/storage.py` |
| Loglar | redaction filter (parol/token/DSN) | `logging_config.py` |
| Admin | rol + CSRF; diagnostika sir chiqarmaydi | `routers/admin.py` |

### 6.4 Hozirgi xavfsizlik kamchiliklari (halol)
- Tashqi monitoring/alerting **yo'q** (metrics process-local).
- Pentest **o'tkazilmagan**.
- `s3` va real to'lov **yo'q** — production bloklovchi.

---

## 7. Tashqi servislar va vendor lock-in

| Servis | Hozir | Rejadagi adapter | Lock-in xavfi | Kamaytirish |
|---|---|---|---|---|
| LLM | `none` | `AiProvider` | o'rtacha | 2+ provayder, OpenAI-mos interfeys |
| Image→3D | yo'q | `ImageTo3DProvider` | **yuqori** | natija GLB sifatida saqlanadi |
| Render | brauzer | headless → GPU | past | renderer almashtiriladi |
| Storage | memory/local | `StorageAdapter` | past | S3 API standarti |
| To'lov | sandbox | `PaymentProvider` | **yuqori** | mintaqaviy 2 provayder |
| Monitoring | yo'q | OTel/Sentry | o'rtacha | OpenTelemetry standarti |

**Narx/SLA taxmin qilinmagan** — har biri tanlovda rasmiy manbadan tekshiriladi
(`RISK_REGISTER.md` R-30…R-34).

---

## 8. Nega mavjud arxitektura saqlanadi

1. **Qatlamlar ajratilgan** — AI/geometriya/viewer mustaqil testlanadi.
2. **Adapterlar bor** — yangi provayder kod o'zgarishisiz qo'shiladi.
3. **Migratsiyalar chiziqli** — W13+ additive migratsiya qo'shadi.
4. **Testlar mavjud** — 452 frontend + 175 backend; regressiya bazasi.
5. **Almashtirish narxi yuqori, foyda past** — yangi framework (Next.js, Celery,
   Prisma) hech qanday hozirgi muammoni hal qilmaydi.

**O'zgartirish faqat shu hollarda:** (a) o'lchov benchmarkda yetmasa,
(b) xavfsizlik talabi, (c) litsenziya cheklovi.

## 9. Arxitektura qarorlari (ADR uslubida, qisqa)

| ID | Qaror | Sabab | Muqobil rad etildi |
|---|---|---|---|
| AD-1 | Monolit FastAPI + alohida worker | joriy masshtab, oddiy deploy | mikroservislar (ortiqcha) |
| AD-2 | DB-navbat → keyin Redis | tranzaksiya ishonchliligi | Kafka (ortiqcha) |
| AD-3 | Three.js brauzerda | mavjud, bepul, WebGL | Blender server-only (sekin iteratsiya) |
| AD-4 | S3-mos storage | standart, portativ | vendor-specific (lock-in) |
| AD-5 | JSON-schema AI chiqishi | deterministik validatsiya | erkin matn (xavfli) |
| AD-6 | Kredit/limit barcha qimmat amallarda | xarajat nazorati | cheksiz bepul (bankrot) |
