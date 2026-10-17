# RISK_REGISTER — 3D Studio AI

> **Hujjat holati:** Phase 0. Xavflar `integration/w1-w12` @ `439c047` holatiga ko'ra
> baholangan. **Yangi xavf** qo'shilsa ID beriladi; mavjud ID o'zgartirilmaydi.
>
> Ehtimollik (E): **1** past · **2** o'rta · **3** yuqori
> Ta'sir (T): **1** kichik · **2** o'rta · **3** katta
> Risk = E × T (1–9). **≥6** — release bloklovchisi.

---

## 1. Texnik xavflar

| ID | Xavf | E | T | R | Oldini olish | Aniqlash | Mas'ul | Rollback |
|---|---|---|---|---|---|---|---|---|
| R-01 | AI noto'g'ri/`NaN` o'lcham qaytarib geometriyani buzadi | 2 | 3 | **6** | `build_design_spec` validatsiyasi; sxema; chegara | mock fixture + property test | W13 | `ai_provider=local`; flag |
| R-02 | AI chiqishi prompt injection orqali tizim xatti-harakatini o'zgartiradi | 2 | 3 | **6** | chiqish sxemasi; `supported` tekshiruvi; amal allowlist | injection korpusi | W13/W15 | endpoint flag |
| R-03 | `SUPPORTED_FURNITURE_TYPES` va geometriya sinxron emas | 3 | 2 | **6** | bitta manba + test | `test_ai.py` (mavjud) | W13 | — |
| R-04 | 500+ qism sahnada FPS tushadi | 2 | 2 | 4 | benchmark; LOD; instancing | perf test | W14 | assembly flag |
| R-05 | Server render GPU'siz sekin/xato | 2 | 2 | 4 | Swiftshader fallback; navbat | render E2E | W17 | brauzer PNG |
| R-06 | Headless WebGL flaky testlar | 3 | 1 | 3 | piksel-tolerant tekshiruv; retry 1 | flake rate | W23 | quarantine |
| R-07 | Migratsiya production'da qaytarilmaydi | 1 | 3 | 3 | `downgrade` testi; backup | alembic CI | W21+ | backup restore |
| R-08 | Job navbati ko'p worker'da dublikat ishlaydi | 2 | 2 | 4 | `SKIP LOCKED` / Redis; idempotency | concurrency test | W21 | worker sonini 1 |
| R-09 | Storage va DB izchilligi buziladi (fayl bor, metadata yo'q) | 2 | 2 | 4 | tranzaksiya; orphan tozalash | izchillik testi | W21 | storage backup |
| R-10 | Xotira oqishi (Three.js dispose qilinmasa) | 2 | 2 | 4 | `dispose()` majburiy; test | heap snapshot | W14/W16 | sahna qayta yuklash |
| R-11 | Eksport formati buziladi (regressiya) | 2 | 2 | 4 | parser contract test | `AUTOMATED_QA §9` | W19 | format flag |
| R-12 | Katta fayl yuklash serverни to'ldiradi | 2 | 2 | 4 | hajm limiti (mavjud) | 413 test | mavjud | — |

## 2. Biznes xavflari

| ID | Xavf | E | T | R | Oldini olish | Aniqlash | Mas'ul | Rollback |
|---|---|---|---|---|---|---|---|---|
| R-13 | Bozor talabi yo'q (mahsulot kerak emas) | 2 | 3 | **6** | V1–V6 validatsiya (`MASTER_PRODUCT_SPEC §7`) | intervyu | Phase 0 | pivot |
| R-14 | Narx modeli noto'g'ri (kredit vs obuna) | 2 | 2 | 4 | V3 narx testi | konversiya | W21 | tarifni o'zgartirish |
| R-15 | Raqobatchi tezroq (SketchUp AI, Tripo) | 2 | 2 | 4 | mahalliy til + BOM farqi | bozor monitoring | — | — |
| R-16 | Bepul foydalanuvchilar AI xarajatini ko'taradi | 3 | 3 | **9** | kredit/limit majburiy; rate limit | usage ledger | W21 | limitni pasaytirish |
| R-17 | To'lov provayderi rad etadi (huquqiy) | 2 | 3 | **6** | 2 provayder; huquqiy tekshiruv | sandbox sinov | W21 | alternativa |

## 3. Xarajat xavflari

| ID | Xavf | E | T | R | Oldini olish | Aniqlash | Mas'ul | Rollback |
|---|---|---|---|---|---|---|---|---|
| R-18 | LLM narxi oshadi | 2 | 2 | 4 | provayder abstraksiyasi; kesh; qisqa prompt | usage ledger | W13 | arzon model |
| R-19 | Image→3D narxi yuqori | 2 | 3 | **6** | kredit; kunlik limit | usage | W18 | o'chirish (flag) |
| R-20 | GPU render narxi | 2 | 2 | 4 | navbat; kvota; past sifat | metrics | W17 | brauzer render |
| R-21 | Egress/storage narxi | 2 | 2 | 4 | CDN; siqish; retention | billing | W21 | retention qisqartirish |

## 4. Maxfiylik va huquqiy xavflar

| ID | Xavf | E | T | R | Oldini olish | Aniqlash | Mas'ul | Rollback |
|---|---|---|---|---|---|---|---|---|
| R-22 | Foydalanuvchi rasmi roziliksiz tashqi servisga ketadi | 2 | 3 | **6** | aniq rozilik UI; siyosat | audit log | W18 | provayder o'chirish |
| R-23 | PII logga tushadi | 1 | 3 | 3 | redaction filter (mavjud) | log audit | mavjud | — |
| R-24 | Ma'lumot rezidentligi talabi (O'Z) | 2 | 2 | 4 | mintaqaviy hosting | huquqiy tekshiruv | W22 | region ko'chirish |
| R-25 | Foydalanuvchi loyihalari yo'qoladi | 1 | 3 | 3 | backup + restore drill | monitoring | W22 | backup restore |

## 5. Litsenziya xavflari

| ID | Xavf | E | T | R | Oldini olish | Aniqlash | Mas'ul | Rollback |
|---|---|---|---|---|---|---|---|---|
| R-26 | 3D asset/tekstura litsenziyasi noto'g'ri | 2 | 2 | 4 | litsenziya ro'yxati; manba | review | W16 | asset o'chirish |
| R-27 | Model/LLM chiqishi tijoriy foydalanishga cheklangan | 2 | 3 | **6** | provayder shartlarini tekshirish | huquqiy review | W13 | provayder almashtirish |
| R-28 | Ochiq kod litsenziyasi buziladi | 1 | 2 | 2 | `license-checker` | CI | mavjud | dependency almashtirish |
| R-29 | 3ds Max nomi/brandi bilan bog'liq da'vo | 1 | 2 | 2 | nomlash siyosati (`3D Studio AI`) | review | — | nom o'zgartirish |

## 6. Tashqi servis xavflari

| ID | Xavf | E | T | R | Oldini olish | Aniqlash | Mas'ul | Rollback |
|---|---|---|---|---|---|---|---|---|
| R-30 | LLM provayder SLA buziladi | 2 | 2 | 4 | 2 provayder; fallback | uptime metrics | W13 | fallback |
| R-31 | Image→3D vendor yopiladi | 2 | 3 | **6** | adapter; GLB eksport | shartnoma | W18 | self-host/almashtirish |
| R-32 | To'lov provayderi API o'zgaradi | 2 | 2 | 4 | adapter; versiya pin | CI contract | W21 | alternativa |
| R-33 | Vendor lock-in (storage/queue) | 2 | 2 | 4 | S3 API; adapter | review | W21 | migratsiya |
| R-34 | Narx kutilmaganda o'zgaradi | 2 | 2 | 4 | byudjet alert; limit | billing | W21 | model almashtirish |

## 7. Operatsion xavflar

| ID | Xavf | E | T | R | Oldini olish | Aniqlash | Mas'ul | Rollback |
|---|---|---|---|---|---|---|---|---|
| R-35 | Pentest topilmalari Critical | 2 | 3 | **6** | W22 pentest; SAST | pentest | W22 | release to'xtatish |
| R-36 | Monitoring yo'qligi sabab nosozlik kech aniqlanadi | 3 | 2 | **6** | OTel/Sentry + alert | SLO | W22 | — |
| R-37 | RPO/RTO kelishilmagan | 3 | 2 | **6** | biznes qarori | drill | W22 | — |
| R-38 | Qo'lda QA o'tkazilmagan holda release | 2 | 3 | **6** | `PRODUCTION_READINESS §2.8` | checklist | W23 | release to'xtatish |
| R-39 | Flaky testlar yashiriladi | 2 | 2 | 4 | quarantine siyosati | flake rate | doimiy | — |
| R-40 | CI sekretlari sizib chiqadi | 1 | 3 | 3 | secret scan; minimal scope | audit | doimiy | rotatsiya |

---

## 8. Eng yuqori risklar (R ≥ 6) — qisqa ro'yxat

| ID | Xavf | R | Birinchi chora |
|---|---|---|---|
| R-16 | Bepul AI xarajati | **9** | kredit/limit majburiy (W21) |
| R-01 | AI noto'g'ri geometriya | 6 | sxema + chegara (W13) |
| R-02 | Prompt injection | 6 | allowlist + validatsiya |
| R-03 | Tur sinxronizatsiyasi | 6 | bitta manba + test |
| R-13 | Bozor talabi yo'q | 6 | V1–V6 validatsiya |
| R-17 | To'lov rad etilishi | 6 | 2 provayder |
| R-19 | Image→3D narxi | 6 | kredit |
| R-22 | Rasmiy rozilik | 6 | UI + siyosat |
| R-27 | Litsenziya cheklovi | 6 | huquqiy review |
| R-31 | Vendor yopilishi | 6 | adapter |
| R-35 | Pentest Critical | 6 | W22 |
| R-36 | Monitoring yo'q | 6 | W22 |
| R-37 | RPO/RTO yo'q | 6 | biznes qarori |
| R-38 | Qo'lda QA yo'q | 6 | W23 |

**Qoida:** R ≥ 6 risk **yopilmaguncha** release qilinmaydi
(`PRODUCTION_READINESS.md §2`).

---

## 9. Risk boshqaruv jarayoni

1. Har bosqich boshida tegishli risklar ko'rib chiqiladi.
2. Yangi risk → yangi ID (R-41+), mavjudlar o'zgartirilmaydi.
3. Risk yopilishi dalil bilan (`PRODUCTION_READINESS` bandiga havola).
4. Har release oldidan R ≥ 6 ro'yxati qayta tekshiriladi.
