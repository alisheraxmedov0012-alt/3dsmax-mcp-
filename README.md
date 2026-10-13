# 3D Studio AI (3dsmax-mcp-)

3D Studio AI — mebel, uy buyumlari, keyinchalik arxitektura va interyer obyektlarining
3D modellarini matn yoki rasm orqali yaratish, brauzerda ko'rish, o'lchamlarini
o'zgartirish va eksport qilish uchun veb-platforma.

Hozirgi holat: **2-bosqich** — 3D model bilan o'zaro ta'sir va `.glb` eksport.

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

Hali qo'shilmagan (keyingi bosqichlar): autentifikatsiya, obuna/to'lov, ma'lumotlar
bazasi, tashqi AI API integratsiyasi, boshqa mebel turlari, arxitektura moduli.

## Texnologiyalar

- **Frontend:** React + TypeScript, Vite.
- **Brauzerdagi 3D ko'rish qatlami:** Three.js (`WebGLRenderer`, `OrbitControls`).
- **Eksport:** Three.js `GLTFExporter` (`.glb`, binary) — faqat brauzerda ishlaydi.
- **Testlar:** Vitest.

> Eslatma: hujjatlardagi texnologiyalar tavsiya sifatida keltirilgan. Hech qanday tayyor
> 3D generator yoki mavjud bo'lmagan API "bor" deb da'vo qilinmaydi. Bu loyihada geometriya
> **parametrik (procedural)** usulda, kodda quriladi — AI ishlatilmaydi.

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
  components/ControlsPanel.tsx
  components/ExportControls.tsx
  components/ViewerCanvas.tsx
```

Qatlamlar ajratilgan: `geometry/` hech qachon `viewer/`ni import qilmaydi; `viewer/`
geometriyani iste'mol qiladi; `export/` alohida (UI'siz) ishlaydi; UI ularni birlashtiradi.

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

- Geometriya: qiymat diapazonlari, xato tekshiruvi, `buildTable` o'lchamlari/tuzilishi.
- Eksport tayyorlash: `buildExportScene` joriy parametrlarni ishlatishi, parametrlarni
  o'zgartirmasligi va mavjud modelga tegmasligi.
- Eksport baytlari: `exportTableToGlb` haqiqiy binary `.glb` (magic/versiya/BIN chunk)
  chiqarishi, material va tanlangan rangni saqlashi (Node'da `FileReader` shim orqali).
- Kamera ramkasi: `computeTableFraming` "Ko'rinishni tiklash" uchun asos.

**Cheklov:** brauzerdagi haqiqiy fayl yuklab olish (download) va sensorli imo-ishoralar
avtomatik testda to'liq tekshirilmaydi (WebGL/DOM talab qilinadi). Ular quyida qo'lda
tekshiriladi.

### Qo'lda test tartibi (eksport va sensorli ekran)

1. `npm run dev` (yoki `npm run build && npm run preview`) va sahifani oching.
2. O'lchamlar va rangni o'zgartiring; model darhol yangilanishini ko'ring.
3. **Modelni eksport qilish (.glb)** tugmasini bosing → `3d-studio-ai-table.glb`
   fayli yuklab olinishi va "Model .glb fayl sifatida yuklab olindi." xabari chiqishi kerak.
4. Yuklangan faylni glTF ko'ruvchida (masalan, https://gltf-viewer.donmccurdy.com)
   ochib, o'lchamlar va rang mos kelishini tekshiring.
5. **Ko'rinishni tiklash** tugmasini bosing → kamera standart holatga qaytishi kerak.
6. Android telefonda: bitta barmoq bilan aylantirish, ikki barmoq bilan zoom ishlashini
   va sahifaning o'zi scroll bo'lmasligini tekshiring.
7. Noto'g'ri qiymat kiriting (masalan, kenglik 999) → xato xabari chiqishi va eksport
   tugmasi o'chirilishini tekshiring.

## Hujjatlar

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — maqsad, modullar, arxitektura, xavfsizlik,
  testlash, deploy va bosqichma-bosqich roadmap.
- [`AGENTS.md`](AGENTS.md) — kod sifati, testlar va Git xavfsizligi qoidalari.