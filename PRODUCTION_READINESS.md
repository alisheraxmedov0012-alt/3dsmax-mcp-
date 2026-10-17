# PRODUCTION_READINESS — master release checklist

> **Hujjat holati:** Phase 0. Bu — **indeks va darvoza** hujjati.
> Batafsil mazmun **takrorlanmaydi**; quyidagi hujjatlarga havola qilinadi:
>
> - [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — arxitektura, env, migratsiya, worker,
>   storage/backup, health, rollback, pre-deploy checklist (12 bo'lim).
> - [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) — W12 topilmalari va holati.
> - [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md) — W12 gate natijasi (hozircha
>   **NOT READY FOR PRODUCTION**).
> - [`docs/W12_TEST_REPORT.md`](docs/W12_TEST_REPORT.md) — test/migratsiya natijalari.
> - [`AUTOMATED_QA_STRATEGY.md`](AUTOMATED_QA_STRATEGY.md) — test qatlamlari.
> - [`RISK_REGISTER.md`](RISK_REGISTER.md) — xavflar va rollback.

Bu hujjat **W13–W23** tugagach yakuniy release qarori uchun asosiy ro'yxat bo'ladi.

---

## 0. Hozirgi holat (tekshirilgan)

| Ko'rsatkich | Qiymat | Manba |
|---|---|---|
| Branch / HEAD | `integration/w1-w12` @ `439c047` | `git rev-parse` |
| `main` | `e0d0b06` (o'zgarmagan) | `git ls-remote` |
| Frontend testlar | 452 passed / 48 fayl | `npm test` |
| Backend testlar | 175 passed / 14 skipped (SQLite) | `pytest` |
| PostgreSQL (lokal) | **NOT VERIFIED** (server bu muhitda yo'q) | tekshirilgan |
| PostgreSQL (CI) | yashil, aynan shu SHA | run `38695782617` |
| Alembic | yagona head `c3a7e1d5f9b2` | `alembic heads` |
| Real AI | **yo'q** | `ai_provider=none` |
| Real to'lov | **yo'q** | faqat `fake-sandbox` |
| S3/R2 storage | **yo'q** | `storage.py:157` |
| Tashqi monitoring | **yo'q** | process-local metrics |
| Pentest | **o'tkazilmagan** | — |
| Qo'lda brauzer/telefon QA | **bajarilmagan** | — |

**Umumiy:** **NOT READY FOR PRODUCTION** (W12 xulosasi o'z kuchida).

---

## 1. Darvoza tuzilishi

Har band: **PASS** (dalil bilan) · **FAIL** · **BLOCKED** (tashqi resurs yo'q) ·
**NOT TESTED**.

Release faqat **barcha P0 bandlari PASS** bo'lganda. P1 bandlar release'dan keyin
bo'lishi mumkin, lekin hujjatlashtiriladi.

---

## 2. P0 — Release bloklovchilari

### 2.1 Real AI provayder
| Tekshiruv | Holat | Dalil / havola |
|---|---|---|
| Provayder tanlangan va shartnoma imzolangan | **BLOCKED** | tanlov `IMPLEMENTATION_ROADMAP` W13 |
| Kalit faqat secret managerda | **NOT TESTED** | `docs/DEPLOYMENT.md §3` |
| `ai_provider` production'da `none` emas | **NOT TESTED** | `config.py` |
| Timeout/retry/rate-limit sozlangan | **NOT TESTED** | W13 |
| Narx limiti (kredit) faol | **BLOCKED** | W21 |
| Live smoke (5 prompt) yashil | **NOT TESTED** | `AUTOMATED_QA_STRATEGY §10.2` |

### 2.2 Real billing
| Tekshiruv | Holat | Dalal |
|---|---|---|
| Haqiqiy provayder ulangan | **BLOCKED** | faqat `fake-sandbox` |
| Webhook imzo tekshiruvi | **PASS** (kod) / **NOT TESTED** (real) | `payments/base.py`, `billing.py` |
| Idempotentlik (takroriy event) | **PASS** | `test_billing.py` |
| Refund/dunning siyosati | **NOT TESTED** | W21 |
| Production'da sandbox rad etilishi | **PASS** | `config.production_problems` |
| Huquqiy (O'Z soliq/refund) | **BLOCKED** | tekshirilishi kerak |

### 2.3 Production DB va storage
| Tekshiruv | Holat | Dalil |
|---|---|---|
| PostgreSQL (managed) | **BLOCKED** | infratuzilma yo'q |
| Migratsiya head bilan mos | **PASS** (CI) | `alembic heads` |
| `memory` storage production'da rad etiladi | **PASS** | `config.py` |
| Doimiy storage (S3/R2) | **BLOCKED** | `storage.py:157` |
| Storage + DB izchilligi | **NOT TESTED** | `docs/DEPLOYMENT.md §6` |

### 2.4 Worker, monitoring, alertlar
| Tekshiruv | Holat | Dalil |
|---|---|---|
| Worker alohida jarayon | **PASS** (kod) / **NOT TESTED** (prod) | `worker.py` |
| Heartbeat readiness'da | **PASS** | `services/heartbeat.py` |
| Stale recovery idempotent | **PASS** | `test_worker.py` |
| Tashqi monitoring | **BLOCKED** | metrics process-local |
| Alertlar (xato/latency/queue) | **BLOCKED** | W22 |
| Log retention siyosati | **NOT TESTED** | platformaga bog'liq |

### 2.5 Secret management
| Tekshiruv | Holat | Dalil |
|---|---|---|
| Repoda sir yo'q | **PASS** | faqat `.env.example` |
| Barcha majburiy env hujjatli | **PASS** | `docs/DEPLOYMENT.md §3` |
| Secret manager (Vault/cloud) | **BLOCKED** | infratuzilma |
| Rotatsiya rejasi | **NOT TESTED** | W22 |
| Loglarda sir yo'q | **PASS** | `logging_config.redact`, testlar |

### 2.6 Backup/restore va RPO/RTO
| Tekshiruv | Holat | Dalil |
|---|---|---|
| Backup skripti | **PASS** (mavjud) | `backend/scripts/backup.sh` |
| Restore skripti | **PASS** (mavjud) | `backend/scripts/restore.sh` |
| **Restore mashqi** | **NOT TESTED** | bajarilmagan |
| Storage backup bilan mosligi | **NOT TESTED** | `docs/DEPLOYMENT.md §6` |
| **RPO/RTO kelishilgan** | **BLOCKED** | biznes qarori yo'q |

### 2.7 Xavfsizlik va pentest
| Tekshiruv | Holat | Dalil |
|---|---|---|
| W12 topilmalari tuzatilgan | **PASS** | `docs/SECURITY_AUDIT.md` |
| Dependency audit (0 High/Critical) | **PASS** | CI |
| CSRF/IDOR/rate-limit testlari | **PASS** | testlar |
| **Mustaqil pentest** | **NOT TESTED** | o'tkazilmagan |
| SAST/DAST | **BLOCKED** | W22 |

### 2.8 Brauzer va mobil QA
| Tekshiruv | Holat | Dalil |
|---|---|---|
| Desktop brauzer (Chrome/Firefox/Safari) | **NOT TESTED** | qo'lda |
| Android telefon (real qurilma) | **NOT TESTED** | qo'lda |
| E2E avtomatik | **BLOCKED** | Playwright hali yo'q (W23) |
| Accessibility (axe) | **NOT TESTED** | W23 |

---

## 3. P1 — Release'dan keyin ruxsat etiladi

| Band | Holat | Izoh |
|---|---|---|
| 3MF/DXF/PDF eksport | yo'q | W19 |
| Nesting/CNC | yo'q | W20 |
| HDRI/UV unwrap | yo'q | W16 |
| i18n (ru/en) | yo'q | W23 |
| PWA/TWA | yo'q | W23 |
| Marketplace | yo'q | P2 |

---

## 4. Release darvozalari (tartib)

```
G1  W13 tugadi      → AI sxema + 8 tur + mock testlar yashil
G2  W21 tugadi      → real to'lov sandbox E2E + storage S3
G3  W22 tugadi      → monitoring + restore drill + pentest 0 High
G4  W23 tugadi      → Playwright + Android QA + a11y
G5  Release review  → barcha P0 PASS
G6  Staging deploy  → 2 hafta kuzatuv, SLO bajarilishi
G7  Production      → qo'lda tasdiq + rollback tayyor
```

**Har darvoza:** `docs/RELEASE_GATE.md` formatida PASS/FAIL/BLOCKED/NOT TESTED.

---

## 5. Rollback darvozasi

Release oldidan majburiy:
1. Backup olingan va **restore sinovi** o'tgan.
2. Oldingi image tag saqlangan.
3. `alembic downgrade` sinovi o'tgan.
4. Rollback qo'lda bajarilgan (staging'da).
5. RTO ichida tiklash o'lchangan.

Batafsil: `docs/DEPLOYMENT.md §10`.

---

## 6. Yakuniy qaror shakli

```
RELEASE DECISION: <READY | NOT READY>
Sana:
HEAD:
P0 PASS: __/8
Bloklovchilar:
  - ...
Rollback tayyor: <ha/yo'q>
Imzo (mas'ul): ______
```

**Qoida:** avtomatik testlar yashil bo'lishi release uchun **yetarli emas**
(`AUTOMATED_QA_STRATEGY §14`).
