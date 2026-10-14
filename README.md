# 3D Studio AI (3dsmax-mcp-)

3D Studio AI — mebel, uy buyumlari, keyinchalik arxitektura va interyer obyektlarining
3D modellarini matn yoki rasm orqali yaratish, brauzerda ko'rish, o'lchamlarini
o'zgartirish va eksport qilish uchun veb-platforma.

Hozirgi holat: **7-bosqich** — hisoblar, obuna va to'lovlar (backend FastAPI + PostgreSQL
uchun tayyor sxema; sandbox to'lov adapteri).

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

## Texnologiyalar

- **Frontend:** React + TypeScript, Vite.
- **Brauzerdagi 3D ko'rish qatlami:** Three.js (`WebGLRenderer`, `OrbitControls`).
- **Eksport:** Three.js `GLTFExporter` (`.glb`, binary) — faqat brauzerda ishlaydi.
- **AI qatlami:** adapter interfeysi + mahalliy (oflayn) qoidaga asoslangan implementatsiya.
- **Sahna modeli (Stage 5-6):** Three.js'siz `scene/` qatlami (validatsiya + reducer).
- **Vizualizatsiya sozlamalari (Stage 6):** fon, yorug'lik, material va kamera presetlari
  (`scene/sceneSettings.ts`) - sof, testlanadi.
- **PNG eksporti (Stage 6):** brauzerdagi WebGL render (vaqtinchalik render target).
- **Saqlash (Stage 4-6):** brauzerdagi `localStorage` (`ProjectRepository` interfeysi ortida).
- **Testlar:** Vitest.

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
  viewer/cameraFraming.ts   # stol/xona kamera ramkasi va presetlar (sof funksiya)
  viewer/SceneViewer.ts     # ko'rish qatlami: scena, kamera, yorug'lik, tanlash, PNG
  export/sceneExport.ts     # butun sahna .glb baytlariga (GLTFExporter)
  export/sceneImage.ts      # PNG rezolyutsiya + eksport orkestratsiyasi (sof)
  export/downloadFile.ts    # brauzerda faylni yuklab olish (DOM)
  ai/types.ts               # AiModelAdapter interfeysi va turlar
  ai/normalizeProposal.ts   # sifat nazorati: diapazon/rang + geometriya tekshiruvi
  ai/localTableAdapter.ts   # mahalliy matn→parametr adapteri (oflayn)
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
npm test         # Vitest (unit testlar)
npm run typecheck
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

## Hujjatlar

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — maqsad, modullar, arxitektura, xavfsizlik,
  testlash, deploy va bosqichma-bosqich roadmap.
- [`AGENTS.md`](AGENTS.md) — kod sifati, testlar va Git xavfsizligi qoidalari.