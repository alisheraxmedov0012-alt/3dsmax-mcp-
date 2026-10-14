# 3D Studio AI (3dsmax-mcp-)

3D Studio AI — mebel, uy buyumlari, keyinchalik arxitektura va interyer obyektlarining
3D modellarini matn yoki rasm orqali yaratish, brauzerda ko'rish, o'lchamlarini
o'zgartirish va eksport qilish uchun veb-platforma.

Hozirgi holat: **4-bosqich** — foydalanuvchi loyihalari va saqlash (brauzerda lokal).

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
bazasi, tashqi AI xizmati integratsiyasi (adapter tayyor), boshqa mebel turlari,
arxitektura moduli.

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

## Texnologiyalar

- **Frontend:** React + TypeScript, Vite.
- **Brauzerdagi 3D ko'rish qatlami:** Three.js (`WebGLRenderer`, `OrbitControls`).
- **Eksport:** Three.js `GLTFExporter` (`.glb`, binary) — faqat brauzerda ishlaydi.
- **AI qatlami:** adapter interfeysi + mahalliy (oflayn) qoidaga asoslangan implementatsiya.
- **Saqlash (Stage 4):** brauzerdagi `localStorage` (`ProjectRepository` interfeysi ortida).
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
  geometry/buildTable.ts    # geometriya qatlami: parametrlardan Three.js modeli
  viewer/cameraFraming.ts   # standart kamera ramkasi (sof funksiya, testlanadi)
  viewer/TableViewer.ts     # ko'rish qatlami: scena, kamera, chiroqlar, boshqaruv
  export/tableExport.ts     # modelni .glb baytlariga aylantirish (GLTFExporter)
  export/downloadFile.ts    # brauzerda faylni yuklab olish (DOM)
  ai/types.ts               # AiModelAdapter interfeysi va turlar
  ai/normalizeProposal.ts   # sifat nazorati: diapazon/rang + geometriya tekshiruvi
  ai/localTableAdapter.ts   # mahalliy matn→parametr adapteri (oflayn)
  projects/types.ts         # SavedProject, ProjectRepository interfeysi
  projects/projectValidation.ts      # saqlangan ma'lumotni tekshirish/serializatsiya
  projects/localProjectRepository.ts # localStorage asosidagi repository
  components/ControlsPanel.tsx
  components/AiPromptPanel.tsx
  components/ProjectsPanel.tsx
  components/ExportControls.tsx
  components/ViewerCanvas.tsx
```

Qatlamlar ajratilgan: `geometry/` hech qachon `viewer/`ni import qilmaydi; `viewer/`
geometriyani iste'mol qiladi; `export/`, `ai/` va `projects/` alohida (UI'siz) ishlaydi;
UI ularni birlashtiradi.

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

- Geometriya: qiymat diapazonlari, xato tekshiruvi, `buildTable` o'lchamlari/tuzilishi,
  `paramsToFieldValues` ↔ `parseTableValues` mosligi.
- Eksport tayyorlash: `buildExportScene` joriy parametrlarni ishlatishi, parametrlarni
  o'zgartirmasligi va mavjud modelga tegmasligi.
- Eksport baytlari: `exportTableToGlb` haqiqiy binary `.glb` (magic/versiya/BIN chunk)
  chiqarishi, material va tanlangan rangni saqlashi (Node'da `FileReader` shim orqali).
- Kamera ramkasi: `computeTableFraming` "Ko'rinishni tiklash" uchun asos.
- AI adapter: matn tahlili (o'lchamlar, rang, `WxDxH`), sifat nazorati (diapazon/rang),
  ishonch darajasi, qo'llab-quvvatlanmagan obyekt ogohlantirishi, bo'sh matn va rasm
  kiritishni rad etish.
- Loyihalar: saqlangan yozuvni tekshirish, buzilgan/yetishmayotgan ma'lumotni o'tkazib
  yuborish, serializatsiya/deserializatsiya, CRUD (yaratish/yangilash/o'chirish),
  dublikat bo'lmasligi va `updatedAt` bo'yicha tartiblash.

**Cheklov:** brauzerdagi haqiqiy fayl yuklab olish (download), sensorli imo-ishoralar,
`window.confirm` oynasi va haqiqiy AI xizmati avtomatik testda to'liq tekshirilmaydi
(WebGL/DOM/credentials talab qilinadi). Ular qo'lda tekshiriladi.

### Qo'lda test tartibi (eksport, AI va sensorli ekran)

1. `npm run dev` (yoki `npm run build && npm run preview`) va sahifani oching.
2. O'lchamlar va rangni o'zgartiring; model darhol yangilanishini ko'ring.
3. **Modelni eksport qilish (.glb)** tugmasini bosing → `3d-studio-ai-table.glb`
   fayli yuklab olinishi va "Model .glb fayl sifatida yuklab olindi." xabari chiqishi kerak.
4. Yuklangan faylni glTF ko'ruvchida (masalan, https://gltf-viewer.donmccurdy.com)
   ochib, o'lchamlar va rang mos kelishini tekshiring.
5. **Ko'rinishni tiklash** tugmasini bosing → kamera standart holatga qaytishi kerak.
6. **AI orqali yaratish**: masalan, "200x80x75 sm, qizil stol" kiriting va tugmani bosing →
   parametrlar qo'llanishi, model yangilanishi va izohlar ko'rinishi kerak. "kenglik 500"
   kabi qiymat diapazonga keltirilishini tekshiring.
7. Android telefonda: bitta barmoq bilan aylantirish, ikki barmoq bilan zoom ishlashini
   va sahifaning o'zi scroll bo'lmasligini tekshiring.
8. Noto'g'ri qiymat kiriting (masalan, kenglik 999) → xato xabari chiqishi va eksport
   tugmasi o'chirilishini tekshiring.
9. **Loyihalar**: nom kiriting va **Saqlash** → ro'yxatda paydo bo'lishi kerak. Sahifani
   yangilang → loyiha saqlanib qolganini tekshiring. **Ochish** → parametrlar tiklanadi.
   Parametrni o'zgartirib **Yangilash** → dublikat yaratilmasligi kerak. **O'chirish** →
   tasdiqlash so'rovi chiqishi va o'chirilishi kerak.

### Qo'lda test (faqat mobil)

- Android telefonda: bitta barmoq bilan aylantirish, ikki barmoq bilan zoom, loyihalar
  ro'yxati va tugmalarning tor ekranda sig'ishi.

## Hujjatlar

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — maqsad, modullar, arxitektura, xavfsizlik,
  testlash, deploy va bosqichma-bosqich roadmap.
- [`AGENTS.md`](AGENTS.md) — kod sifati, testlar va Git xavfsizligi qoidalari.