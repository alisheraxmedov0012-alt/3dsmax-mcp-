# 3D Studio AI (3dsmax-mcp-)

3D Studio AI — mebel, uy buyumlari, keyinchalik arxitektura va interyer obyektlarining
3D modellarini matn yoki rasm orqali yaratish, brauzerda ko'rish, o'lchamlarini
o'zgartirish va eksport qilish uchun veb-platforma.

Hozirgi holat: **8-bosqich** — xavfsizlik, testlar va production deploy tayyorgarligi
(production chiqarilmagan; tashqi resurslar kutilmoqda).

## 1-bosqich MVP imkoniyatlari

- Brauzerda ishlaydigan bitta sahifali 3D muharrir.
- Parametrlar asosida **procedural** stol geometriyasi (stol usti + 4 oyoq).
- Kenglik, balandlik va chuqurlikni o'zgartirish (slayder va son maydoni).
- Material/rang tanlash (tayyor palitra + erkin rang tanlagich).
- Model parametrlar o'zgarganda real vaqtda qayta quriladi.
- Sichqoncha yoki sensorli ekran orqali aylantirish va zoom qilish.
- Moslashuvchan interfeys (desktop va mobil).
- Boshlang'ich holat, qiymat diapazonlari va xato tekshiruvlari.

## 2-bosqich imkoniyatlari (o'zaro ta'sir va eksport)

- **Ko'rinishni tiklash** tugmasi — kamerani standart holatga qaytaradi.
- Android va boshqa sensorli qurilmalarda **bir barmoq bilan aylantirish**,
  **ikki barmoq bilan zoom** (OrbitControls, `touch-action: none`).
- **`.glb` eksport**: joriy o'lchamlar va rang bilan modelni yuklab olish
  (Three.js `GLTFExporter`, faqat brauzerda — backend yoki tashqi API yo'q).
- Eksport holati va xatolari foydalanuvchiga o'zbek tilida ko'rsatiladi.
- Tor mobil ekranlarda ham boshqaruv elementlari sig'adi (gorizontal scroll yo'q).

## 3-bosqich imkoniyatlari (AI orqali yaratish)

- **AI adapter interfeysi** (`AiModelAdapter`) — matn→3D va rasm→3D qobiliyatlari
  bilan; kelajakda haqiqiy AI xizmatini shu interfeys orqali ulash mumkin.
- **Mahalliy (oflayn) adapter**: matn tavsifini tahlil qilib stol parametrlarini
  aniqlaydi (o'lchamlar, rang). Tashqi AI xizmati, API kaliti yoki tarmoq ishlatilmaydi.
- **Sifat nazorati**: qiymatlarni ruxsat etilgan diapazonga keltirish, rangni
  normallashtirish, natijani geometriya qatlami tekshiruvidan o'tkazish, ogohlantirishlar
  va ishonch darajasi (yuqori/o'rta/past).
- Natija mavjud boshqaruvlarga qo'llaniladi — model darhol yangilanadi.
- Hozircha **rasm→3D qo'llab-quvvatlanmaydi** (adapter buni aniq bildiradi), chunki
  haqiqiy AI xizmati hali tanlanmagan.

Hali qo'shilmagan (keyingi bosqichlar): autentifikatsiya, obuna/to'lov, ma'lumotlar
bazasi, tashqi AI xizmati integratsiyasi (adapter tayyor), boshqa mebel turlari.

## 4-bosqich imkoniyatlari (loyihalar va saqlash)

- **Loyihani saqlash**: joriy model parametrlari (o'lchamlar + rang) va nom bilan
  saqlanadi.
- **Ro'yxat**: saqlangan loyihalar ro'yxati (nomi va o'lchamlari bilan) ko'rsatiladi.
- **Qayta ochish**: saqlangan loyiha tanlanadi va uning parametrlari/ko'rinishi tiklanadi.
- **Yangilash**: faol loyiha ustidan saqlash — dublikat yaratmaydi ("Saqlash" tugmasi
  faol loyihada "Yangilash"ga aylanadi).
- **O'chirish**: tasdiqlash so'rovi bilan (`window.confirm`).
- **Bo'sh holat va xabarlar**: o'zbek tilida; yuklangan ma'lumotlar qo'llashdan oldin
  tekshiriladi; buzilgan/yaroqsiz yozuvlar ilovani buzmasdan o'tkazib yuboriladi.

### Muhim cheklovlar (Stage 4)

- Saqlash **brauzerda lokal** (`localStorage`) — hozircha backend/ma'lumotlar bazasi
  yo'q. Ma'lumotlar **qurilmalar o'rtasida sinxronlanmaydi** va brauzer ma'lumotlari
  tozalansa yo'qoladi.
- Reja "egalik va rollar" hamda "versiyalash"ni eslatadi, ammo **egalik/rollar**
  autentifikatsiya (7-bosqich) talab qiladi va **to'liq versiya tarixi** hali
  qo'shilmagan. Bular keyingi bosqichlarga qoldirilgan (hujjatlashtirilgan).
- Persistensiya `ProjectRepository` interfeysi ortida — kelajakda backend bilan
  almashtirilishi mumkin.

## 5-bosqich imkoniyatlari (arxitektura va interyer)

- **Xona muharriri**: kenglik, uzunlik va balandlikni sozlash; "Xonani tanlash" va
  "Xonani tiklash". Xona yuzasi (pol) va to'rtta devor alohida geometriyalar sifatida
  quriladi va o'lchamlarga mos keladi. Xato qiymatlar xabar bilan diapazonga keltiriladi.
- **Interyer joylashtirish**: mavjud procedural stol sahnaga obyekt sifatida qo'shiladi
  ("Stol qo'shish"); tanlangan obyektning **joylashuvi (X/Y/Z), burilishi va masshtabi**
  tahrirlanadi; rangi va geometriyasi saqlanadi.
- **Sahna ierarxiyasi**: barcha obyektlar ro'yxati, tanlash, ko'rsatish/yashirish va
  xavfsiz o'chirish (tasdiq bilan). Obyektlar **barqaror ID**ga ega.
- **Tanlash**: ro'yxatdan yoki 3D ko'rinishda sichqoncha/barmoq bilan (raycast).
  Tanlangan obyekt ramka (BoxHelper) bilan ajratiladi.
- **Eksport**: `.glb` endi butun sahnani (xona + ko'rinadigan obyektlar) o'z
  geometriyasi, transformatsiyalari va materiallari bilan chiqaradi.
- **Migratsiya**: eski (Stage 1–4) faqat-stol loyihalari standart xona + stol
  sahnasiga aylantirilib ochiladi; ma'lumot yo'qolmaydi.

**Koordinata tizimi**: o'ng qo'l tizimi, Y — yuqoriga, barcha o'lchovlar santimetrda.
Xona poli Y = 0 tekisligida; xona X/Z markazda (x ∈ [-kenglik/2, kenglik/2],
z ∈ [-uzunlik/2, uzunlik/2]); obyekt `position` — obyekt boshlanishining siljishi
(y = 0 — polda turadi); `rotation` — gradusda (Euler XYZ), ko'rsatishda radianga
o'giriladi; `scale` — o'qlar bo'yicha koeffitsient.

### Muhim cheklovlar (Stage 5)

- Saqlash hanuz **brauzerda lokal** (`localStorage`), **qurilmalar o'rtasida
  sinxronlanmaydi**.
- **Yashirilgan obyektlar `.glb` eksportdan chiqarib tashlanadi** (ko'rinadiganlari
  kiritiladi).
- Obyektlarni 3D ko'rinishda **sudrab (drag) ko'chirish yo'q**; transformatsiya raqamli
  boshqaruvlar va slayderlar orqali (barqarorroq va sensorli ekranda ishonchli).
- Yangi mebel turkumlari qo'shilmagan — faqat mavjud stol joylashtiriladi.

## 6-bosqich imkoniyatlari (mahsulot va reklama vizualizatsiyasi)

- **Sahna va fon**: fon rangini sozlash (tayyor ranglar + erkin tanlagich) — xona
  pol/devor materiallaridan alohida, xona geometriyasi buzilmaydi.
- **Kamera rakurslari**: **Izometrik, Old, Yon, Yuqoridan** presetlariga tez o'tish +
  "Ko'rinishni tiklash". Preset almashganda obyekt koordinatalari o'zgarmaydi; orbit,
  pan va zoom saqlanadi.
- **Yorug'lik**: umumiy (ambient), asosiy (key) va to'ldiruvchi (fill) intensivlik va
  rang; key/fill yoqish-o'chirish; soyalarni yoqish-o'chirish; "Yorug'likni tiklash".
  Qiymatlar 0–5 (intensivlik) oralig'ida, noto'g'ri qiymatlar normallashtiriladi.
- **Material**: tanlangan stol uchun **metallik** va **silliqlik/qo'pollik** (0–1),
  "Materialni tiklash". O'zgarish faqat tanlangan obyektga qo'llanadi. Asosiy rang
  «Stol parametrlari» bo'limidagi rang boshqaruvi orqali.
- **Xona materiali**: pol va devor rangini alohida sozlash.
- **Render (PNG)**: joriy kompozitsiyani (fon, yorug'lik, soyalar, material, kamera)
  PNG sifatida saqlash; **Standart (1280×720)** va **Yuqori (2560×1440)** rezolyutsiya.
  Renderer cheklovlari uchun xavfsiz yukori chegara qo'llanadi.
- **GLB eksporti** saqlanadi va yangi material sozlamalari bilan mos ishlaydi.

### Muhim cheklovlar (Stage 6)

- PNG — brauzerdagi **WebGL render**dan olinadi (vaqtinchalik render target orqali);
  bu **fotorealistik render fermasi emas** va server render infratuzilmasi yo'q.
- **Viewport foni, kamera boshqaruv holati va rendererga xos sozlamalar GLB faylida
  saqlanmaydi** (GLB formati bularni ifodalamaydi); GLB'da geometriya, transformatsiya,
  material (rang, metalness, roughness) saqlanadi.
- **Yashirilgan obyektlar** GLB eksportdan chiqarib tashlanadi.
- 3D ko'rinishda sudrab (drag) ko'chirish yo'q (raqamli boshqaruvlar ishlatiladi).
- Yangi mebel turkumlari va tashqi 3D AI generatorlar yo'q.

## 7-bosqich imkoniyatlari (hisoblar, obuna va to'lovlar)

Backend `backend/` katalogida: **FastAPI + SQLAlchemy 2 + Alembic**.

- **Hisoblar**: email/parol bilan ro'yxatdan o'tish, kirish, chiqish, `me`;
  **emailni tasdiqlash** va **parolni tiklash** oqimlari (bir martalik, muddati
  cheklangan tokenlar); sessiyani bekor qilish.
- **Sessiyalar**: opaque token (faqat SHA-256 xeshi saqlanadi), `HttpOnly` +
  `SameSite` + (productionda) `Secure` cookie, qo'shimcha **CSRF** tokeni.
- **Rollar**: `user` va `admin`; serverda tekshiriladi; admin endpointi alohida
  himoyalangan; birinchi admin **CLI bootstrap** orqali yaratiladi (ochiq admin
  ro'yxatdan o'tish yo'q).
- **Tariflar**: Free va Pro (ma'lumot modeli + `/api/plans`). **Narx va limitlar
  roadmapda tasdiqlanmagan** — shuning uchun ular `null` (hujjatlashtirilgan
  konfiguratsiya nuqtasi) qilib qoldirilgan, o'ylab topilmagan.
- **Limitlar**: loyihalar, PNG/GLB eksportlar, AI so'rovlar uchun **serverda**
  tekshiriladigan, tarifga bog'langan mexanizm (mijoz payloadi bilan chetlab
  bo'lmaydi).
- **Obuna/billing**: `subscription` holat mashinasi (pending/active/
  payment_failed/expired/cancelled), `payment_attempts`, `invoices`,
  `billing_events` (audit). Hodisalar **idempotent**.
- **Sandbox to'lov adapteri**: provayderdan mustaqil `PaymentProvider`
  interfeysi + soxta **sandbox** adapteri (HMAC imzoli webhook, idempotentlik).
  **Haqiqiy to'lov yo'q, karta ma'lumotlari olinmaydi/saqlanmaydi.**
- **Hisob-faktura**: faqat tasdiqlangan billing hodisasidan yaratiladi; bitta
  hodisa uchun takroriy faktura yaratilmaydi; foydalanuvchi faqat o'zinikini
  ko'radi.
- **Lokal loyihalarni import**: brauzerdagi (`localStorage`) loyihalarni
  akkauntga **idempotent** import qilish; lokal ma'lumot o'chirilmaydi.
- **Frontend**: `src/api/client.ts` (cookie + CSRF, xato -> o'zbekcha xabar) va
  `AccountPanel` (kirish/ro'yxatdan o'tish, tarif, limit/usage, sandbox to'lov,
  fakturalar, import). Tarif/limit **serverdan** olinadi.

### Qo'lda test tartibi (Stage 7)

```bash
# 1) Backend
cd backend
cp .env.example .env            # qiymatlarni lokal to'ldiring (gitga qo'shmang)
python -m pip install -r requirements.txt
python -m alembic upgrade head  # yoki ilova ishga tushganda create_all
python -m app.cli create-admin --email admin@example.com
uvicorn app.main:app --reload --port 8000

# 2) Frontend (boshqa terminalda, repo ildizida)
VITE_API_BASE_URL=http://localhost:8000 npm run dev

# 3) Backend testlari
cd backend && python -m pytest
```

### Muhim cheklovlar (Stage 7)

- **Haqiqiy to'lov provayderi ulanmagan**: provayder tanlanmagan, akkaunt va
  production kalitlari yo'q. Faqat **sandbox** adapteri mavjud; UI/hujjatlarda u
  haqiqiy provayder sifatida ko'rsatilmaydi. Haqiqiy to'lovlarni yoqish uchun
  provayder tanlovi, rasmiy akkaunt, webhook konfiguratsiyasi va moliyaviy/huquqiy
  tasdiq talab qilinadi.
- **Email yuborish sozlanmagan**: `APP_EMAIL_BACKEND=console` xabar yuborilmaydi;
  productionda email tasdiqlash/parol tiklash ishlayapti deb hisoblanmaydi. SMTP
  sozlamalari berilganda real yuborish yoqiladi.
- **PostgreSQL hosting yo'q**: sxema/migratsiyalar PostgreSQL uchun tayyor, lekin
  bu muhitda faqat **SQLite** bilan tekshirilgan (PostgreSQL'ga xos xatti-harakat
  tasdiqlanmagan).
- **Rate limiting** jarayon ichida (in-process); productionda Redis kabi umumiy
  xotira kerak.
- **Cloud sinxronlash yo'q**: import bir martalik nusxalash; lokal loyihalar
  o'chirilmaydi. To'liq ikki tomonlama sinxronlash keyingi, hujjatlashtirilgan
  vazifa.
- Karta raqamlari/CVV **hech qachon** qabul qilinmaydi yoki saqlanmaydi.

## 8-bosqich natijalari (xavfsizlik, testlar, production tayyorgarligi)

Bu bosqich **production chiqarilmagan** — faqat tayyorgarlik va ichki audit bajarildi.

### Xavfsizlik (ichki audit, OWASP Top 10 / ASVS bo'yicha yo'naltirilgan)
- Xato javoblari yagona va xavfsiz: noma'lum xatolar umumiy 500 qaytaradi; ichki
  matn/stack trace mijozga chiqmaydi (regressiya testlari bilan qoplangan).
- Xavfsizlik sarlavhalari (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`).
- Har bir so'rov uchun `X-Request-ID` (korrelyatsiya) — noto'g'ri qiymat almashtiriladi.
- Strukturali (JSON) loglar + sirni **redaksiya** qiluvchi filtr (parol, token,
  CSRF, `Bearer`, `api_key`, `dsn` va h.k.).
- `GET /api/health` (liveness) va `GET /api/health/ready` (DB tekshiruvi) —
  maxfiy ma'lumot oshkor qilinmaydi.
- Rate limiting kengaytirildi: login/register/forgot/reset (IP bo'yicha) +
  checkout/sandbox/import (foydalanuvchi bo'yicha) + webhook (IP bo'yicha).
  Redis store adapteri qo'shildi; store ishlamasa **fail-closed**.
- Production konfiguratsiyasi validatsiyasi: default `SECRET_KEY`, `COOKIE_SECURE=false`,
  `EXPOSE_DEV_TOKENS=true`, `DEBUG=true`, CORS `*`, SQLite — ishga tushishni **to'xtatadi**.
- Sentry-mos error-tracking adapteri (faqat `APP_ERROR_TRACKING_DSN` berilganda faol;
  aks holda "o'chirilgan" deb hisobot beradi).
- Dependency auditi: `npm audit` (0 zaiflik), `pip-audit` (0 zaiflik).

#### Ichki audit topilmalari (severity bo'yicha)

| # | Severity | Topilma | Holat |
|---|---|---|---|
| 1 | **High** | `requirements.txt` o'rnatib bo'lmaydigan pin (`email-validator==2.4.0` mavjud emas) — backend CI va Docker build sinardi | **Tuzatildi** (pinlar qayta tiklandi) |
| 2 | **High** | Noma'lum/unhandled xatolar uchun yagona xato ishlovchisi yo'q edi (ichki matn oshkor bo'lishi mumkin) | **Tuzatildi** (catch-all 500 + test) |
| 3 | **High** | Production sozlamalari validatsiyasi yo'q edi (default SECRET_KEY, `COOKIE_SECURE=false`, SQLite bilan ishga tushishi mumkin) | **Tuzatildi** (startup bloklaydi + testlar) |
| 4 | **Medium** | Xavfsizlik sarlavhalari (`X-Content-Type-Options` va h.k.) yo'q edi | **Tuzatildi** |
| 5 | **Medium** | Strukturali loglar va sirlarni redaksiya qilish yo'q edi | **Tuzatildi** (JSON log + filter + testlar) |
| 6 | **Medium** | Rate limiting faqat ayrim endpointlarda va faqat jarayon ichida edi | **Tuzatildi** (ko'proq endpointlar + Redis adapteri; fail-closed) |
| 7 | **Medium** | Request/correlation ID yo'q edi (xatolarni kuzatish qiyin) | **Tuzatildi** |
| 8 | **Medium** | `/health` readiness tekshiruvi yo'q edi | **Tuzatildi** (`/api/health/ready`) |
| 9 | **Medium** | `.dockerignore` yo'q edi — `.env` image'ga tushishi mumkin edi | **Tuzatildi** |
| 10 | **Low** | `pytest 8.4.2` da ma'lum zaiflik (dev dependency) | **Tuzatildi** (`pytest 9.1.1`) |
| 11 | **Low** | Sentry/error-tracking adapteri yo'q edi | **Tuzatildi** (ixtiyoriy, DSN bo'lmasa o'chiq) |
| 12 | **Low** | CI'da lint/audit/migratsiya tekshiruvlari yo'q edi | **Tuzatildi** |
| 13 | **Info** | Monitoring (Prometheus/Grafana) hali sozlanmagan | **Ochiq** (tashqi resurs) |
| 14 | **Info** | Mustaqil (tashqi) pentest o'tkazilmagan | **Ochiq** (talab qilinmagan) |
| 15 | **Info** | Redis store berilmasa rate limiting ko'p worker uchun global emas | **Ochiq** (hujjatlashtirilgan) |

Critical severity topilmalar yo'q. Barcha High topilmalar tuzatildi va regressiya
testlari bilan qoplandi.

### Yuklama testi (o'lchangan, lokal + PostgreSQL)
`backend/loadtest/loadtest.py` — 25 parallel virtual foydalanuvchi, 300 s barqaror yuklama:

| Ko'rsatkich | Natija |
|---|---|
| Jami so'rovlar | 53 473 |
| Requests/second | 177.83 |
| p50 / p95 / p99 latency | 124.52 ms / **241.77 ms** / 291.09 ms |
| Xatolik darajasi | **0.0%** |
| Server RSS (VmHWM) | ~101 MB |
| PostgreSQL konteyner | ~70 MiB, ~0.01% CPU |

Qabul mezoni (p95 < 500 ms, xatolik < 1%): **bajarildi**.

### Docker va muhitlar
- `backend/Dockerfile` — ko'p bosqichli, **non-root** (`appuser`), healthcheck,
  graceful shutdown (`STOPSIGNAL SIGTERM`), faqat 8000-port.
- `docker-compose.yml` — lokal `db` (PostgreSQL 16), `redis` (7), `backend`, `frontend`.
- `.dockerignore` — `.env`, DB fayllari, `node_modules`, `.git` konteynerga tushmaydi.
- Image qurildi va smoke-test qilindi: non-root, `/api/health` = 200, sarlavhalar.

### CI / CD
- CI (`.github/workflows/ci.yml`): frontend lint (oxlint) + typecheck + test + build +
  `npm audit`; backend **ruff** + `pip-audit` + konfiguratsiya import tekshiruvi +
  **migratsiya upgrade/downgrade** + `pytest`. Haqiqiy sirlar yo'q.
- CD (`.github/workflows/cd.yml`): **faqat tayyorlangan**, ishga tushirilmagan.
  Staging avtomatik; production — `workflow_dispatch` + `production` environment
  (reviewer tasdiqi). Deploy sirlari bo'lmasa, guard qadam "sozlanmagan" deb to'xtatadi.

### PostgreSQL, backup va recovery
- Barcha migratsiyalar va testlar haqiqiy **PostgreSQL 16**'da bajarildi (SQLite'ga
  qo'shimcha): `alembic upgrade/downgrade/upgrade` + 75 test.
- `tests/test_postgres.py` — unique-constraint idempotentligi, tranzaksiya rollback
  (PG mavjud bo'lmasa o'tkazib yuboriladi).
- `backend/scripts/backup.sh` (pg_dump + tekshirish + retention) va
  `backend/scripts/restore.sh` (prod nomli DB uchun himoya). Tiklash sinovi o'tkazildi:
  31 foydalanuvchi / 6953 loyiha aynan tiklandi.
- **RPO/RTO biznes tomonidan belgilanmagan** — taklif: RPO ≤ 24 soat, RTO ≤ 4 soat
  (tasdiqlanishi kerak).

### Muhim cheklovlar (8-bosqich)
- **Production deploy BAJARILMAGAN.** Hosting, domen/TLS, boshqariladigan PostgreSQL,
  secret manager va monitoring tashqi resurslari mavjud emas.
- **Haqiqiy to'lov provayderi yo'q** (faqat sandbox); **SMTP sozlanmagan** — email
  tasdiqlash/parol tiklash productionda ishlaydi deb hisoblanmaydi.
- **Rate limiting** Redis berilmasa jarayon ichida ishlaydi (ko'p worker uchun global emas).
- **Monitoring** (Prometheus/Grafana) hali sozlanmagan; Sentry adapteri DSN bo'lmasa
  o'chiq. Health/readiness va strukturali loglar mavjud.
- **Tashqi (mustaqil) pentest o'tkazilmagan** — bu faqat ichki audit.

### Production release siyosati

Production'ga haqiqiy chiqarish faqat quyidagilar tayyor bo'lgach mumkin (hozircha
**hech biri bajarilmagan**):

1. Hosting va domen/TLS.
2. Boshqariladigan PostgreSQL muhiti.
3. Secret manager (env fayl emas) orqali sirlar.
4. Monitoring va error tracking konfiguratsiyasi.
5. Backup/recovery rejasi (RPO/RTO tasdiqlangan).
6. Haqiqiy to'lov provayderi sozlamalari va tasdiqlari (agar kerak bo'lsa).
7. Email xizmati konfiguratsiyasi (agar kerak bo'lsa).
8. CI/CD muvaffaqiyatli natijalari.
9. Xavfsizlik auditidagi Critical/High muammolar yopilganligi.

**Production deploy faqat egasining alohida yozma tasdig'i bilan amalga oshiriladi.**
CD workflow tayyor, lekin ishga tushirilmagan va sirlar mavjud emas.

### Qo'lda ishga tushirish (Docker)

```bash
# Butun lokal stack (PostgreSQL + Redis + backend + frontend)
docker compose up --build

# Yoki faqat backend image
docker build -f backend/Dockerfile -t studio-backend .
docker run --rm -p 8000:8000 \
  -e APP_ENVIRONMENT=development \
  -e APP_DATABASE_URL=sqlite:////tmp/app.db \
  -e APP_SECRET_KEY=local-dev-secret-key-change-me-1234567890 \
  studio-backend
```

### Backup / restore

```bash
# Backup (pg_dump) — natija repozitoriyadan tashqarida saqlanadi
DATABASE_URL=postgresql://user:pass@host:5432/db backend/scripts/backup.sh

# Restore (scratch bazaga; prod nomli DB himoyalangan)
TARGET_DATABASE_URL=postgresql://user:pass@host:5432/db_restore \
  backend/scripts/restore.sh /var/backups/3dstudio/3dstudio-<stamp>.dump
```

### Yuklama testini ishga tushirish

```bash
cd backend
python -m loadtest.loadtest --base-url http://127.0.0.1:8010 --vus 25 --duration 300
# Faqat o'zimiz boshqaradigan manzilga (loopback/staging); --allow-remote bilan
# boshqa hostga ruxsat beriladi (tavsiya etilmaydi).
```

## A bosqichi — professional 3D aktivlar (A1–A4)

Bu bosqich `release/a-3d-glb` branchida bajarilgan; `main`ga merge qilinmagan va
deploy qilinmagan.

### A1 — geometriya va eksport mustahkamlash

- Yashirin subtree'lar GLB, OBJ va STL eksportidan oldin olib tashlanadi.
- OBJ ham STL kabi millimetrda yoziladi.
- Bo'sh sahna fayl yozish o'rniga rad etiladi.
- Geometry guard indeks chegaralari, degeneratsiya, normal atributlari va
  chegaralarni tekshiradi.
- `npm run test:glb` haqiqiy brauzerda GLB eksport → `GLTFLoader` qayta o'qish
  invariantlarini tekshiradi.

### A2 — materiallar, teksturalar va UV xaritalari

- PBR presetlar (yog'och, metall, mato, charm, shisha, plastmassa, bo'yalgan)
  barcha sakkiz mebel turida ishlaydi; asosiy rang `params.color`.
- **Jismoniy UV kafel** (`src/materials/uv.ts`): har bir quti yuzasi 50 sm'lik
  kafelga keltiriladi. Ilgari har bir yuz 0..1 UV olardi, shuning uchun tekstura
  katta stol ustida cho'zilib, 4 sm oyoqda siqilardi. Endi bir UV birligi hamma
  yuzada bir xil santimetrni qoplaydi; `textureScale` faqat detal chastotasini
  ko'paytiradi.
- Teksturalar protsedural va deterministik: standart 128×128, eksportda ixtiyoriy
  512×512 (fayl kattaroq).
- Cheklovlar: ORM (occlusion/roughness/metalness) xaritasi yo'q; ixtiyoriy unwrap
  yo'q — faqat quti yuzalari; xona geometriyasi o'z UV'larida qoladi (uning
  materiallarida tekstura yo'q).

### A3 — AI adapteri va lokal fallback

- Server provayderi (`POST /api/ai/design`) API kalitini faqat serverda saqlaydi;
  kunlik limit, umumiy chegara, retry, deadline, JSON tuzatish va token hisobi
  serverda.
- Mahalliy (oflayn) analizator endi **sakkiz turning hammasini** quradi
  (`src/ai/localDesignAdapter.ts`): tur, o'lchamlar, sonlar (eshik/tortma/javon/
  oyoq), rang va material — o'zbek, rus va ingliz so'zlari bilan. Natija UI bilan
  bir xil `validateFurnitureParams` tekshiruvidan o'tadi.
- Noma'lum tur so'zi (`oshxona`, `office`, ...) jadval yasab bermaydi — sabab
  ko'rsatiladi.
- Fallback siyosati bitta joyda (`src/ai/generateDesign.ts`): xizmat **mavjud
  bo'lmasa** (timeout, tarmoq, band, provayder xatosi, sozlanmagan) lokal
  analizator javob beradi; so'rov **rad etilgan** (limit, noto'g'ri kirish) yoki
  tur qo'llab-quvvatlanmasa — sabab ko'rsatiladi, almashtirilmaydi.

### A4 — marketplace uchun 3D aktiv paketi

Mahsulot paketi (C8) ustaxonaga BOM, kesish va PDF beradi; 3D aktiv xaridori esa
boshqa arxiv oladi. `ProductPackagePanel` ichidagi **“3D aktiv paketini yuklab
olish (ZIP)”** quyidagini yig'adi:

| Fayl | Mazmuni |
| --- | --- |
| `model.glb` | faqat tanlangan mebel (xona emas), A1 eksportchisi bilan |
| `metadata.json` | o'lchamlar (mm), geometriya/uchburchak/material/tekstura soni, UV, preview va SHA-256 |
| `preview-*.png` | viewport'dan olingan real rakurslar (ixtiyoriy) |
| `README.txt` | tarkib, birliklar va cheklovlar |
| `checksums.txt` | har bir faylning SHA-256 qiymati |

- Metadata **faylning o'zidan** o'qiladi: `src/export/glbSummary.ts` GLB JSON/BIN
  chunk'larini ochib, mesh/uchburchak/material/tekstura o'lchamlarini va tashqi
  URI sonini hisoblaydi.
- O'lchamlar C2 chizma bilan bir xil o'lchovdan olinadi (ikki xil raqam chiqmasligi
  uchun).
- `verifyAssetPackage` arxivni qayta ochib, fayl ro'yxati, hajmlar va barcha
  SHA-256 qiymatlarini solishtiradi.
- Noto'g'ri preview nomi, PNG bo'lmagan rasm yoki o'lchanmagan o'lcham rad etiladi.
- Cheklovlar: paket faqat GLB beradi (OBJ/STL materialni yo'qotadi); preview —
  brauzer ko'rinishi, fotosurat emas; litsenziya va sotuvchi maydonlari faqat
  foydalanuvchi kiritganda yoziladi; marketplace tekshiruvi o'tkazilmagan.

### Tekshirish (A yakuni)

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run test:glb
cd backend && python -m ruff check app tests scripts && python -m pytest
```

Natijalar `docs/A4_2_GLB_VALIDATION_REPORT.md` ning “A2–A4 update” bo'limida
yozilgan.

## Texnologiyalar

- **Frontend:** React + TypeScript, Vite.
- **Brauzerdagi 3D ko'rish qatlami:** Three.js (`WebGLRenderer`, `OrbitControls`).
- **Eksport:** Three.js `GLTFExporter` (`.glb`, binary) — faqat brauzerda ishlaydi.
- **AI qatlami:** server provayderi (OpenAI-mos) + sakkiz turni quradigan mahalliy
  (oflayn) adapter va yagona fallback siyosati.
- **Sahna modeli (Stage 5-6):** Three.js'siz `scene/` qatlami (validatsiya + reducer).
- **Vizualizatsiya sozlamalari (Stage 6):** fon, yorug'lik, material va kamera presetlari
  (`scene/sceneSettings.ts`) - sof, testlanadi.
- **PNG eksporti (Stage 6):** brauzerdagi WebGL render (vaqtinchalik render target).
- **Saqlash (Stage 4-6):** brauzerdagi `localStorage` (`ProjectRepository` interfeysi ortida).
- **Backend (Stage 7-8):** Python + FastAPI, SQLAlchemy 2, Alembic, PostgreSQL (mahalliy
  ishlab chiqish uchun SQLite), Redis (umumiy rate limiting uchun ixtiyoriy).
- **Lint / audit (Stage 8):** `oxlint` (frontend), `ruff` (backend), `npm audit`, `pip-audit`.
- **Konteynerlar (Stage 8):** Docker (non-root backend image) + Docker Compose.
- **Testlar:** Vitest (frontend), pytest (backend).

> Eslatma: hujjatlardagi texnologiyalar tavsiya sifatida keltirilgan. Hech qanday tayyor
> 3D generator yoki mavjud bo'lmagan API "bor" deb da'vo qilinmaydi. Geometriya hanuz
> **parametrik (procedural)** usulda, kodda quriladi; Stage 3'dagi "AI" qismi — tashqi
> xizmatga tayyor **adapter** va **mahalliy** matn tahlili, haqiqiy AI xizmati emas.

## Loyiha tuzilishi

```
index.html
vite.config.ts, tsconfig.json
src/
  main.tsx, App.tsx, App.css, index.css
  geometry/tableParams.ts   # parametrlar, diapazonlar, validatsiya (Three.js'siz)
  geometry/buildTable.ts    # geometriya qatlami: parametrlardan stol modeli
  geometry/buildRoom.ts     # geometriya qatlami: xona (pol + 4 devor)
  scene/types.ts            # SceneData/SceneObject/RoomConfig + standartlar/diapazonlar
  scene/sceneSettings.ts    # fon, yorug'lik, material, kamera presetlari (sof)
  scene/sceneValidation.ts  # sahna validatsiyasi + eski loyihani migratsiya
  scene/sceneReducer.ts     # sof sahna amallari (qo'shish/tanlash/transform/sozlama)
  scene/buildSceneObject.ts # SceneObject -> Three.js obyekt + transform + material
  scene/sceneSelection.ts   # eksport uchun bitta obyektni tanlash
  viewer/cameraFraming.ts   # stol/xona kamera ramkasi va presetlar (sof funksiya)
  viewer/SceneViewer.ts     # ko'rish qatlami: scena, kamera, yorug'lik, tanlash, PNG
  materials/uv.ts           # jismoniy UV kafel (har bir quti yuzasi 50 sm)
  export/sceneExport.ts     # butun sahna .glb baytlariga (GLTFExporter)
  export/sceneImage.ts      # PNG rezolyutsiya + eksport orkestratsiyasi (sof)
  export/downloadFile.ts    # brauzerda faylni yuklab olish (DOM)
  export/glbSummary.ts      # GLB tarkibini fayldan o'qish (mesh/material/tekstura)
  export/pngSize.ts         # PNG IHDR o'lchamini o'qish
  export/assetPackage.ts    # A4 marketplace aktiv paketi + SHA-256 tekshiruvi
  util/sha256.ts            # sinxron SHA-256 (checksums)
  ai/types.ts               # AiModelAdapter interfeysi va turlar
  ai/normalizeProposal.ts   # sifat nazorati: diapazon/rang + geometriya tekshiruvi
  ai/localTableAdapter.ts   # Stage 3: mahalliy matn→parametr (faqat stol)
  ai/promptParsing.ts       # matn tahlili uchun umumiy yordamchilar
  ai/localDesignAdapter.ts  # A3: oflayn analizator (sakkiz tur)
  ai/generateDesign.ts      # A3: cloud + lokal fallback siyosati
  projects/types.ts         # SavedProject (schema v3), ProjectRepository interfeysi
  projects/projectValidation.ts      # saqlangan ma'lumotni tekshirish/serializatsiya
  projects/localProjectRepository.ts # localStorage asosidagi repository
  components/ControlsPanel.tsx       # stol parametrlari
  components/RoomPanel.tsx           # xona sozlamalari
  components/SceneSettingsPanel.tsx  # fon, kamera presetlari, xona materiali
  components/LightingPanel.tsx       # yorug'lik sozlamalari
  components/MaterialPanel.tsx       # tanlangan obyekt materiali (metalness/roughness)
  components/RenderExportPanel.tsx   # PNG eksport (rezolyutsiya tanlovi)
  components/SceneHierarchyPanel.tsx # obyektlar ro'yxati
  components/ObjectPanel.tsx         # tanlangan obyekt transformatsiyasi
  components/AiPromptPanel.tsx
  components/ProjectsPanel.tsx
  components/ExportControls.tsx
  components/ViewerCanvas.tsx
  api/client.ts             # backend API klienti (cookie + CSRF)
  components/AccountPanel.tsx # hisob, tarif/limit, sandbox to'lov, fakturalar, import
backend/
  Dockerfile                # non-root backend image
  requirements.txt          # pinned dependencies
  alembic/                  # migratsiyalar (env.py + versions/)
  app/
    main.py                 # FastAPI ilovasi (CORS, middleware, startup)
    config.py               # env sozlamalari + production validatsiyasi
    database.py, models.py, schemas.py, security.py, deps.py, guards.py
    errors.py               # yagona xato formati + catch-all 500
    logging_config.py       # strukturali loglar + sir redaksiyasi
    middleware.py           # request ID + xavfsizlik sarlavhalari
    error_tracking.py       # ixtiyoriy Sentry-mos adapter
    rate_limit.py           # memory/Redis limiter
    cli.py                  # create-admin bootstrap
    routers/                # health, auth, plans, billing, projects, admin
    services/               # email, plans, subscriptions, limits, billing, payments/
  tests/                    # pytest (auth, roles, limits, billing, security, postgres, ...)
  loadtest/loadtest.py      # yuklama testi skripti
  scripts/                  # backup.sh, restore.sh
docker-compose.yml          # lokal stack (PostgreSQL + Redis + backend + frontend)
.github/workflows/          # ci.yml, cd.yml
```

Qatlamlar ajratilgan: `geometry/` va `scene/` hech qachon `viewer/`ni import qilmaydi;
`scene/` — Three.js'siz (sof, testlanadi); `viewer/` geometriya/sahna quruvchilarini
iste'mol qiladi; `export/`, `ai/`, `projects/` alohida (UI'siz) ishlaydi; UI birlashtiradi.

## Lokal ishga tushirish

Talab: Node.js 20+ (npm).

```bash
npm install      # bog'liqliklarni o'rnatadi (package-lock.json bo'yicha)
npm run dev      # ishlab chiqish serveri (standart: http://localhost:5173)
```

Boshqa port/host uchun, masalan: `npm run dev -- --host 0.0.0.0 --port 12000`.

## Build

```bash
npm run build    # tur tekshiruvi (tsc) + production build -> dist/
npm run preview  # build natijasini lokal ko'rish
```

## Testlar

```bash
# Frontend
npm run lint       # oxlint
npm run typecheck  # tsc --noEmit
npm test           # Vitest
npm run build
npm audit          # dependency zaifliklari

# Backend
cd backend
python -m ruff check app tests        # lint
python -m pytest                      # unit/integratsiya testlari
python -m pip_audit                   # dependency zaifliklari
python -m alembic upgrade head && python -m alembic downgrade base  # migratsiyalar

# PostgreSQL integratsion testlari (PG mavjud bo'lsa)
APP_TEST_POSTGRES_URL=postgresql+psycopg://studio:pw@127.0.0.1:5432/studio_test \
  python -m pytest tests/test_postgres.py
```

Avtomatik testlar quyidagilarni qamrab oladi:

- Geometriya: qiymat diapazonlari, xato tekshiruvi, `buildTable` va `buildRoom`
  o'lchamlari/tuzilishi, `paramsToFieldValues` ↔ `parseTableValues` mosligi.
- Sahna: `validateSceneData`/`validateSceneObject` (buzilgan, noma'lum tur, dublikat ID),
  `sceneReducer` amallari (xona, qo'shish, tanlash, transform, ko'rinish, o'chirish,
  yuklash/yangi), eski loyihani migratsiya qilish.
- Sahna obyekti: `buildSceneObject` transformatsiyasi (joylashuv/burilish/masshtab) va
  rangli/ko'rinish bayrog'i.
- Eksport: `buildExportScene` xona + obyektlarni qamrashi, manba ma'lumotni
  o'zgartirmasligi; `exportSceneToGlb` haqiqiy binary `.glb` (magic/versiya/BIN),
  xona/obyekt geometriyasi, materiallar va transformatsiyalar (Node'da `FileReader` shim).
- Kamera ramkasi: `computeTableFraming`, `computeRoomFraming` va `computePresetFraming`
  (front/side/top/iso presetlari).
- Vizualizatsiya sozlamalari: `sceneSettings` standart qiymatlari va validatsiyasi
  (intensivlik 0–5, rang, `NaN`/manfiy qiymatlar), kamera presetlari.
- Material: `buildTable` metalness/roughness override; `sceneReducer` material amallari
  (faqat tanlangan obyekt, 0–1 chegaralash, tiklash).
- Yorug'lik/fon/xona materiali: `sceneReducer` amallari (clamp, noto'g'ri qiymatni rad etish).
- PNG eksporti: `resolvePngSize`/`clampPngSize` (xavfsiz chegara, nisbat), `pngFileName`,
  `exportScenePng` orkestratsiyasi (muvaffaqiyat va xato), `downloadBlob` URL bo'shatish.
- AI adapter: matn tahlili, sifat nazorati, ishonch darajasi, ogohlantirishlar, bo'sh
  matn va rasm kiritishni rad etish.
- Loyihalar: saqlangan yozuvni tekshirish, buzilgan ma'lumotni o'tkazib yuborish,
  serializatsiya/deserializatsiya, CRUD, dublikat bo'lmasligi, `updatedAt` tartibi,
  **v1 (faqat stol) va v2 (sahna, sozlamalarsiz) loyihalarni migratsiya**, sozlama va
  materialning saqlanishi.
- Katta sahna: **100 obyektli sahna** testi (validatsiya/serializatsiya/qayta qurish
  vaqtlari o'lchanadi va `console.info` bilan chiqariladi).

**Cheklov:** brauzerdagi haqiqiy PNG/GLB faylni yuklab olish (download), WebGL renderning
piksel natijasi, sensorli imo-ishoralar, `window.confirm` oynasi, raycast bilan tanlash va
haqiqiy AI xizmati avtomatik testda to'liq tekshirilmaydi (WebGL/DOM/credentials talab
qilinadi). Ular qo'lda tekshiriladi.

### Qo'lda test tartibi (vizualizatsiya, eksport, AI va sensorli ekran)

1. `npm run dev` (yoki `npm run build && npm run preview`) va sahifani oching.
2. **Stol parametrlari**: o'lchamlar va rangni o'zgartiring; model darhol yangilanishini
   ko'ring.
3. **Xona**: kenglik/uzunlik/balandlikni sozlang → pol va devorlar o'lchamga mos
   o'zgarishi kerak. Noto'g'ri qiymat (masalan, 99999) kiriting → xato xabari chiqishi va
   qiymat diapazonga keltirilishi kerak.
4. **Sahna va kamera**: fon rangini o'zgartiring. **Izometrik/Old/Yon/Yuqoridan**
   presetlarini sinab ko'ring → kamera o'tishi, obyektlar joyida qolishi kerak.
   **Ko'rinishni tiklash** → standart (izometrik) holatga qaytishi kerak.
5. **Yorug'lik**: intensivlik va ranglarni o'zgartiring; key/fill va soyalarni
   yoqib/o'chirib ko'ring; **Yorug'likni tiklash** ishlashini tekshiring.
6. **Material**: stolni tanlab, metallik/silliqlikni o'zgartiring → faqat shu stol
   o'zgarishi kerak; **Materialni tiklash** ishlashini tekshiring.
7. **Stol qo'shish**, **transformatsiya**, **Ko'rsatish/Yashirish**, **O'chirish**
   (tasdiq bilan) va 3D ko'rinishda **tanlash** ishlashini tekshiring.
8. **Modelni eksport qilish (.glb)** → `3d-studio-ai-scene.glb` yuklab olinadi; faylni
   glTF ko'ruvchida ochib, xona va obyektlar (geometriya/transform/material) mavjudligini
   tekshiring. (Fon/kamera/soyalar GLB'da saqlanmaydi.)
9. **Render (PNG)**: **Standart** va **Yuqori** rezolyutsiyani tanlab, "PNG sifatida
   saqlash" tugmasini bosing → PNG yuklab olinadi va xabar chiqadi. Natija joriy
   kompozitsiyaga mos kelishini tekshiring.
10. **AI orqali yaratish**: "200x80x75 sm, qizil stol" → tanlangan stol parametrlari
    qo'llanilishi kerak.
11. **Loyihalar**: nom kiriting va **Saqlash** → ro'yxatda paydo bo'ladi. Sahifani
    yangilang → loyiha saqlanib qoladi. **Ochish** → xona, obyektlar, transformlar,
    material va vizualizatsiya sozlamalari (fon/yorug'lik/kamera) tiklanadi.
    **Yangilash** → dublikat yaratilmaydi.
12. Android telefonda: aylantirish/zoom, sahna ro'yxati va boshqaruvlarning tor ekranda
    sig'ishi.

### Qo'lda test (faqat mobil)

- Android telefonda: bitta barmoq bilan aylantirish, ikki barmoq bilan zoom, obyektni
  barmoq bilan tanlash, saqlangan loyihalar ro'yxati va tugmalarning tor ekranda sig'ishi.

## W11 — ishonchlilik, xarajat hisobi, kuzatuv va UX

Bu bosqich **production chiqarilmagan**; merge qilinmagan va deploy qilinmagan.

### Foydalanish va xarajat hisobi
- `usage_records` — har bir operatsiya uchun **append-only** yozuv (loyiha, fayl, job,
  eksport, render, AI). Mavjud tarif/limit tizimi (`UsageCounter`) saqlanadi; bu yozuv
  faqat audit va hisobot uchun.
- Har bir yozuv `(user_id, idempotency_key)` bo'yicha **unikal** — qayta urinish yoki
  parallel so'rov ikki marta hisoblanmaydi. Po'lat DB cheklovi bilan himoyalangan.
- `cost_kind` — `actual` / `estimated` / `unknown`. Narx tasdiqlanmagan bo'lsa xarajat
  **uydirilmaydi** (`cost_micros` bo'sh qoladi). Provayder token soni faqat haqiqatan
  qaytarilganda saqlanadi.
- `GET /api/usage/summary`, `GET /api/usage/records` — foydalanuvchining o'z yozuvlari.

### Rate limiting va resurslar
- Har bir endpoint uchun alohida (per-scope) byudjet; `APP_RATE_LIMIT_SCOPES` bilan
  sozlanadi. 429/503 javoblari `Retry-After` sarlavhasini qaytaradi.
- `X-Forwarded-For` faqat `APP_TRUST_FORWARDED_FOR=true` bo'lganda (ishonchli proksi
  ortida) hisobga olinadi; aks holda so'rovchi o'z IP sini yashira olmaydi.
- So'rov hajmi (multipartdan tashqari) middleware darajasida oldindan rad etiladi (413).

### Job ishonchliligi
- Xatolar `retryable` (vaqtinchalik) va doimiy turlarga ajratiladi; tasniflanmagan xato
  doimiy hisoblanadi.
- `recover_stale_jobs` ishga tushishda (`app.main` startup), worker startupida, admin
  endpointi va CLI orqali chaqiriladi — vaqt tugagan `running` joblar `failed`
  (retryable) holatiga o'tadi.
- Foydalanuvchi uchun parallel job chegarasi (`APP_JOB_MAX_PARALLEL_PER_USER`).
- `python -m app.worker` — backend mustaqil worker (noop bajaradi; providerga bog'liq
  turlarni halol xato bilan yakunlaydi). Heartbeat orqali readiness holati aniqlanadi.

### Kuzatuv
- Strukturali loglar; javoblarda `X-Request-ID`; job diagnostikasi `job_id` bilan
  bog'lanadi.
- Jarayon ichidagi metrikalar: `GET /api/health/metrics` (tashqi monitoring provayderi
  **ulanmagan** — bu aniq ko'rsatiladi).
- `GET /api/health/ready` — DB, saqlash va worker holatini tekshiradi.
- `GET /api/admin/diagnostics` — production tayyorgarligi (sir qiymatlari ko'rsatilmaydi).

### Frontend UX
- Yuklash/jarayon/xato/qayta-urinish holatlari; muvaffaqiyat faqat server tasdiqlagach
  ko'rsatiladi. Jarayon foizsiz (aniq o'lchovsiz) ko'rsatiladi.
- Sessiya muddati tugashi, xizmat ishlamasligi, limit va rate-limit uchun aniq xabarlar.
- Saqlanmagan o'zgarishlardan himoya (sahifadan chiqishda ogohlantirish).
- Takroriy bosishdan himoya (single-flight); mobil ekranlar uchun moslashtirilgan.

## W12 — production tayyorgarligi, xavfsizlik auditi va release gate

Bu bosqich **production deploy qilinmagan**; faqat tayyorgarlik va tekshiruv.

- **PostgreSQL real serverda tekshirildi:** migratsiyalar (`upgrade → downgrade →
  upgrade`) va PostgreSQL-only integratsion testlar (unikal cheklovlar, foreign key
  cascade, `timestamptz`, JSON, stale-job recovery, versioning) o‘tdi. CI’ga
  PostgreSQL job qo‘shildi.
- **SQLite FK muammosi tuzatildi:** SQLite endi `PRAGMA foreign_keys=ON` bilan
  ishlaydi, shuning uchun lokal testlar production (PostgreSQL) kabi FK buzilishini
  ushlaydi.
- **Xavfsizlik:** 2 Medium + 1 Low topilma tuzatildi (sandbox to‘lov va console
  email production’da bloklanadi; admin POST’ga CSRF qo‘shildi). Mustaqil pentest
  o‘tkazilmagan.
- **Hujjatlar:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (12 bo‘lim),
  [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md),
  [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md),
  [`docs/W12_TEST_REPORT.md`](docs/W12_TEST_REPORT.md).
- **Release gate natijasi:** **NOT READY FOR PRODUCTION** — tashqi integratsiyalar
  (haqiqiy AI, to‘lov, monitoring, SMTP), infratuzilma (managed PostgreSQL, hosting,
  backup/restore mashqi) va qo‘lda brauzer/telefon sinovi hali yo‘q.

## Hujjatlar

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — maqsad, modullar, arxitektura, xavfsizlik,
  testlash, deploy va bosqichma-bosqich roadmap.
- [`AGENTS.md`](AGENTS.md) — kod sifati, testlar va Git xavfsizligi qoidalari.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deployment qo‘llanmasi va rollback rejasi.
- [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) — W12 xavfsizlik auditi.
- [`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md) — release mezonlari va bloklovchilar.
- [`docs/W12_TEST_REPORT.md`](docs/W12_TEST_REPORT.md) — test va migratsiya natijalari.