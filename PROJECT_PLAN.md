# 3D Studio AI — Project Plan

> Holat: 0–6-bosqich bajarildi (poydevor, MVP, o'zaro ta'sir/eksport, AI adapter,
> loyihalarni saqlash, arxitektura va interyer, mahsulot vizualizatsiyasi). Ushbu hujjat
> reja va arxitektura tavsiyalarini belgilaydi.
> Diqqat: bu yerdagi barcha texnologiyalar **tavsiya** sifatida keltirilgan. Hech qanday
> tayyor 3D generator yoki mavjud bo'lmagan API "bor" deb da'vo qilinmaydi — har bir
> integratsiya tanlovi tegishli bosqichda tekshiriladi va tasdiqlanadi.

## 1. Loyiha maqsadi

3D Studio AI — foydalanuvchiga oddiy matn yoki rasm orqali mebel, uy buyumlari,
keyinchalik arxitektura va interyer obyektlarining 3D modellarini yaratish, ularni
brauzerda ko'rish, o'lchamlarini o'zgartirish va standart formatlarda eksport qilish
imkonini beruvchi veb-platforma.

Maqsadlar:
- Professional 3D dastur o'rganmasdan ham model yaratishni osonlashtirish.
- Mebel va interyer sohasidagi kichik biznes, dizayner va ishlab chiqaruvchilar uchun
  tez prototiplash vositasi bo'lish.
- Modellarni yagona loyiha ichida saqlash, qayta ishlatish va eksport qilish.

Maqsad bo'lmagan (hozircha): foto-realistik render fermasi, to'liq CAD aniqlikdagi
muhandislik hisob-kitoblari, 3ds Max/Blender'ning to'liq o'rnini bosish.

## 2. Asosiy foydalanuvchi ssenariysi

1. Foydalanuvchi tizimga kiradi (yoki mehmon sifatida boshlaydi).
2. Yangi loyiha yaratadi va obyekt turini tanlaydi (masalan, "stol", "shkaf").
3. So'rovni kiritadi: matn tavsifi ("3 eshikli, 180 sm kenglikdagi shkaf") yoki
   namuna rasm yuklaydi.
4. Tizim model loyihasini (geometriya) shakllantiradi va brauzerda ko'rsatadi.
5. Foydalanuvchi modelni aylantiradi, yaqinlashtiradi, o'lchamlarini o'zgartiradi.
6. Natijani tasdiqlaydi va eksport qiladi (masalan, `glTF`/`GLB`; kelajakda boshqa formatlar).
7. Loyiha saqlanadi va keyin qayta ochilishi mumkin.

## 3. Modullar

- **Auth / Hisoblar** — ro'yxatdan o'tish, kirish, sessiyalar, rollar (0-bosqichda skelet).
- **Loyihalar (Projects)** — loyiha CRUD, saqlash, versiyalash, egalik huquqi.
- **Prompt / Kiritish** — matn va rasm qabul qilish, validatsiya, navbatga qo'yish.
- **AI Orkestrator** — so'rovni AI xizmatiga uzatish, natijani normallashtirish (3-bosqich).
- **Geometriya xizmati** — 3D geometriyani yaratish/transformatsiya qilish qatlami.
- **Ko'rish (Viewer)** — brauzerdagi 3D ko'rish, kamera, o'lchash, o'lchamni tahrirlash.
- **Eksport** — `glTF`/`GLB` va boshqa formatlarga chiqarish.
- **Vizualizatsiya** — mahsulot/reklama renderlari va sahnalar (6-bosqich).
- **To'lov/Obuna** — tariflar, limitlar, to'lov integratsiyasi (7-bosqich).
- **Infratuzilma** — konfiguratsiya, logging, monitoring, deploy, xavfsizlik.

## 4. Tavsiya etiladigan arxitektura

Ilova qatlamlarga bo'linadi; har bir qatlam alohida-alohida ko'rib chiqiladi va
almashtirilishi mumkin bo'lishi kerak:

1. **Frontend (brauzerdagi 3D ko'rish qatlami)** — UI va 3D ko'rish. Bu qatlam
   geometriya yaratmaydi; u faqat mavjud 3D ma'lumotni ko'rsatadi va tahrir
   buyruqlarini yuboradi.
2. **Backend API** — biznes-logika, autentifikatsiya, loyihalar, orkestratsiya.
   Frontend bilan faqat API orqali gaplashadi.
3. **3D geometriya yaratish qatlami** — model geometriyasini parametrik yoki
   generativ usulda shakllantiradi. Bu alohida servis/modul bo'lib, AI qatlamiga
   bevosita bog'lanmaydi.
4. **AI API qatlami** — tashqi AI xizmatlari bilan integratsiya uchun abstraksiya
   (adapter). Real xizmat tanlanmaguncha mock/interfeys bilan cheklanadi.
5. **Ma'lumotlar qatlami** — ma'lumotlar bazasi va fayl/obyekt saqlash.
6. **Navbat/Worker** — uzoq davom etadigan generatsiya va render vazifalari uchun.

Oqim: `Frontend → Backend API → (AI Orkestrator / Geometriya xizmati) → Saqlash → Frontend`.

Tamoyillar: modul chegaralari aniq, qatlamlar orasidagi bog'liqlik bir tomonlama,
tashqi xizmatlar adapter orqali (kelajakda almashtirish oson).

## 5. Texnologiyalar (tavsiya)

Quyidagilar **taklif**, qat'iy talab emas. Yakuniy tanlov 0-bosqichda tasdiqlanadi.

- **Frontend:** React + TypeScript, Vite; holat boshqaruvi uchun yengil yechim.
- **Brauzerdagi 3D ko'rish qatlami:** WebGL asosidagi kutubxona (masalan, Three.js
  yoki Babylon.js) — faqat ko'rish/tahrirlash uchun.
- **Backend:** Python (FastAPI) yoki Node.js (NestJS) — jamoa tajribasiga qarab.
- **Ma'lumotlar bazasi:** PostgreSQL; fayl/obyekt saqlash uchun S3-mos xizmat.
- **Navbat:** Redis + worker (uzoq vazifalar uchun).
- **3D formatlar:** `glTF`/`GLB` (asosiy), eksport uchun qo'shimcha formatlar keyinroq.
- **AI API qatlami:** matn→3D va rasm→3D xizmatlar uchun **adapter** interfeysi.
  Aniq xizmat hali tanlanmagan; mavjud deb da'vo qilinmaydi. Tanlov 3-bosqichda,
  narx/sifat/litsenziya tekshiruvidan so'ng amalga oshiriladi.
- **Deploy:** konteynerlar (Docker), CI/CD, boshqariladigan hosting.

Uchta qatlam alohida ajratiladi (talab bo'yicha):
- **3D geometriya yaratish** — backenddagi geometriya xizmati.
- **AI API** — faqat adapter orqali, almashtiriladigan.
- **Brauzerdagi 3D ko'rish** — frontenddagi viewer.

## 6. Xavfsizlik talablari

- Autentifikatsiya va avtorizatsiya: barcha loyiha amallarida egalik tekshiriladi.
- Maxfiy kalitlar (AI API, DB, to'lov) faqat serverda, environment/secret manager'da;
  hech qachon repozitoriyga yoki frontendga chiqmaydi.
- Kiritish validatsiyasi: matn, rasm va fayl yuklamalari hajmi/turi bo'yicha cheklanadi.
- Yuklangan fayllar va generatsiya natijalari izolyatsiyada saqlanadi.
- To'lov ma'lumotlari (7-bosqich) PCI talablariga mos tashqi provayder orqali.
- Rate limiting, audit logging, xatolarni foydalanuvchiga xavfsiz ko'rsatish.
- Bog'liqliklar (dependency) zaifliklari muntazam tekshiriladi.

## 7. Testlash

- **Unit testlar** — geometriya transformatsiyalari, validatsiya, biznes-logika.
- **Integratsiya testlar** — API, ma'lumotlar bazasi, AI adapter (mock bilan).
- **Frontend testlar** — komponentlar va viewer interaksiyalari.
- **E2E testlar** — asosiy foydalanuvchi ssenariysi (yaratish → ko'rish → eksport).
- **Xavfsizlik testlari** — avtorizatsiya chegaralari, kiritish validatsiyasi.
- Har bir bosqich o'z qabul mezonlari va testlariga ega bo'lishi shart.

## 8. Deploy

- Konteynerlashtirish (Docker) va muhitlar: `dev`, `staging`, `production`.
- CI: lint, test, build; CD: staging'ga avtomatik, production'ga tasdiq bilan.
- Konfiguratsiya environment orqali; sirlar boshqariladigan xizmatda.
- Monitoring, logging va xato kuzatuvi (error tracking) 0-bosqichdan.
- Zaxira (backup) va tiklash rejasi ma'lumotlar bazasi uchun.

## 9. Bosqichma-bosqich roadmap

Tartib qat'iy; har bir bosqich oldingisiga tayanishi shart.

- **0-bosqich — loyiha poydevori va arxitektura**
  Repo tuzilishi, hujjatlar, CI skeleti, qatlamlar interfeyslari, konfiguratsiya va
  muhitlar. Ilova logikasi hali yozilmaydi. Qabul mezoni: hujjatlar + CI + bo'sh skelet.

- **1-bosqich — mebel va uy buyumlari uchun birinchi ishlaydigan MVP**
  Parametrik (shablon asosidagi) bir nechta oddiy obyekt (masalan, stol, shkaf),
  minimal API va asosiy saqlash. AI hali shart emas. Qabul mezoni: foydalanuvchi oddiy
  modelni yaratib, ko'ra oladi.

- **2-bosqich — 3D modelni ko'rish, o'lchamlarni o'zgartirish va eksport qilish**
  Viewer'ni yaxshilash, o'lchamlarni tahrirlash, `glTF`/`GLB` eksport. Qabul mezoni:
  modelni o'zgartirib, faylga eksport qilish ishlaydi.

- **3-bosqich — AI orqali model yaratishni yaxshilash**
  AI API adapterini joriy etish (matn→3D, rasm→3D), natijani geometriya qatlamiga
  ulash, sifatni nazorat qilish. Xizmat tanlovi shu bosqichda tekshiriladi.

- **4-bosqich — foydalanuvchi loyihalari va saqlash**
  To'liq loyiha CRUD, versiyalash, qayta ochish, egalik va rollar.

- **5-bosqich — arxitektura va interyer moduli**
  Binolar/xonalar, interyer joylashtirish, katta sahnalar boshqaruvi.

- **6-bosqich — mahsulot va reklama vizualizatsiyasi**
  Sahnaga qo'yish (staging), yorug'lik/material sozlamalari, sifatli render/eksport.

- **7-bosqich — hisoblar, obuna va to'lovlar**
  Tariflar, limitlar, to'lov provayderi integratsiyasi, hisob-faktura.

- **8-bosqich — xavfsizlik, testlar va production deploy**
  To'liq xavfsizlik auditi, yuklama testlari, monitoring, production chiqarish.

## 10. Ochiq savollar

- AI xizmati tanlovi (narx, sifat, litsenziya, maxfiylik) — 3-bosqichda hal qilinadi.
- Maqsadli eksport formatlari ro'yxati — 2-bosqichda aniqlashtiriladi.
- Ko'p foydalanuvchili ish (collaboration) kerak-mi — 4-bosqichda ko'rib chiqiladi.
- To'lov provayderi tanlovi mintaqaga bog'liq — 7-bosqichda.
