# 3D Studio AI (3dsmax-mcp-)

3D Studio AI — mebel, uy buyumlari, keyinchalik arxitektura va interyer obyektlarining
3D modellarini matn yoki rasm orqali yaratish, brauzerda ko'rish, o'lchamlarini
o'zgartirish va eksport qilish uchun veb-platforma.

Hozirgi holat: **1-bosqich MVP** — parametrlar asosida ishlaydigan stol muharriri.

## 1-bosqich MVP imkoniyatlari

- Brauzerda ishlaydigan bitta sahifali 3D muharrir.
- Parametrlar asosida **procedural** stol geometriyasi (stol usti + 4 oyoq).
- Kenglik, balandlik va chuqurlikni o'zgartirish (slayder va son maydoni).
- Material/rang tanlash (tayyor palitra + erkin rang tanlagich).
- Model parametrlar o'zgarganda real vaqtda qayta quriladi.
- Sichqoncha yoki sensorli ekran orqali aylantirish va zoom qilish.
- Moslashuvchan interfeys (desktop va mobil).
- Boshlang'ich holat, qiymat diapazonlari va xato tekshiruvlari.

Hali qo'shilmagan (keyingi bosqichlar): autentifikatsiya, obuna/to'lov, ma'lumotlar
bazasi, eksport, tashqi AI API integratsiyasi.

## Texnologiyalar

- **Frontend:** React + TypeScript, Vite.
- **Brauzerdagi 3D ko'rish qatlami:** Three.js (`WebGLRenderer`, `OrbitControls`).
- **Testlar:** Vitest.

> Eslatma: hujjatlardagi texnologiyalar tavsiya sifatida keltirilgan. Hech qanday tayyor
> 3D generator yoki mavjud bo'lmagan API "bor" deb da'vo qilinmaydi. Bu MVP'da geometriya
> **parametrik (procedural)** usulda, kodda quriladi — AI ishlatilmaydi.

## Loyiha tuzilishi

```
index.html
vite.config.ts, tsconfig.json
src/
  main.tsx, App.tsx, App.css, index.css
  geometry/tableParams.ts   # parametrlar, diapazonlar, validatsiya (Three.js'siz)
  geometry/buildTable.ts    # geometriya qatlami: parametrlardan Three.js modeli
  viewer/TableViewer.ts     # ko'rish qatlami: scena, kamera, chiroqlar, boshqaruv
  components/ControlsPanel.tsx
  components/ViewerCanvas.tsx
```

Qatlamlar ajratilgan: `geometry/` hech qachon `viewer/`ni import qilmaydi; `viewer/`
geometriyani iste'mol qiladi; UI ikkalasidan foydalanadi.

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

Testlar geometriya qatlamini qamrab oladi: qiymat diapazonlari va xato tekshiruvi,
hamda `buildTable` natijasining o'lchamlari va tuzilishi (WebGL talab qilinmaydi).

## Hujjatlar

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — maqsad, modullar, arxitektura, xavfsizlik,
  testlash, deploy va bosqichma-bosqich roadmap.
- [`AGENTS.md`](AGENTS.md) — kod sifati, testlar va Git xavfsizligi qoidalari.