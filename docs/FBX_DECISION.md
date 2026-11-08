# FBX — texnik baholash va qaror

> Holat: **Phase 8B.3 da FBX Blender 4.5.9 LTS orqali yetkaziladi.**
> Bu — mavjud GLB/OBJ/STL/3MF shartnomasiga qo'shimcha format. 3ds Max va Maya
> importi hali **NOT VERIFIED**; 2-DCC sharti saqlanadi.
>
> Phase 6 dagi "FBX hozir implementatsiya qilinmaydi" qarori tarixiy kontekst
> sifatida quyida saqlanadi; amaldagi holat 6-bo'limda.

## 1. Nima tekshirildi

| Savol | Tekshiruv usuli | Natija |
| --- | --- | --- |
| Three.js FBX eksporter beradimi? | `node_modules/three/examples/jsm/exporters/` ro'yxati (three@0.186.1) | **Yo'q.** Mavjud: `DRACOExporter`, `EXRExporter`, `GLTFExporter`, `KTX2Exporter`, `OBJExporter`, `PLYExporter`, `STLExporter`, `USDZExporter` |
| Three.js FBX **importer** beradimi? | `node_modules/three/examples/jsm/loaders/` | Ha — `FBXLoader.js` (faqat o'qish) |
| Loyihada FBX kodi bormi? | `package.json`, `package-lock.json`, `src/` qidiruvi | Yo'q |
| Brauzerda ishlaydigan FBX yozuvchilar bormi? | npm registry (`/-/v1/search?text=fbx exporter`, 2026-11-06) | Bor, lekin yosh va kichik (2-jadval) |

## 2. Mavjud kutubxonalar (npm registry, 2026-11-06)

| Paket | Versiya | Litsenziya | Haftalik yuklab olish | Bog'liqliklar |
| --- | --- | --- | --- | --- |
| `@comfyorg/fbx-exporter-three` | 1.0.2 | MIT | ~89 800 | `fflate` (loyihada allaqachon bor) |
| `three-js-fbx-exporter` | 0.1.3 | MIT | ~243 | yo'q |
| `@fourthtemple/fbx-exporter` | 0.1.2 | MIT | ~30 | yo'q |

Litsenziyalar toza (MIT) va texnik to'siq yo'q: `fflate` allaqachon `dependencies`
ichida, ya'ni yangi tranzitiv yuk deyarli nolga teng.

## 3. Nima uchun baribir hozir implementatsiya qilinmaydi

1. **Sifatni tekshirib bo'lmaydi.** FBX — proprietary binar format. Muvaffaqiyat
   mezoni "fayl ochildi" emas, balki "3ds Max / Blender / Maya / Unity ichida
   geometriya, material va transform to'g'ri keldi". Bu muhitda hech qanday DCC
   o'rnatilmagan, ya'ni bunday tekshiruvni halol bajara olmaymiz.
2. **Yozuvchilar yosh.** Eng yetuk nomzod 1.0.2, qolgan ikkitasi 0.1.x. FBX
   eksportining xato rejimlari (birliklar, o'qlar, material slotlari, UV) aynan
   shu yetilmagan qismda uchraydi.
3. **Material yo'qotilishi.** Loyiha `MeshStandardMaterial` (PBR) ishlatadi. FBX
   materiallari Phong/Lambert yoki FBX 2020 "Stingray PBR" bo'lib, JS yozuvchilar
   odatda faqat Phong yo'lini beradi — ya'ni GLB'dagi PBR ma'lumoti yo'qoladi.
   Bu bizning "material saqlanadi" va'damizga zid bo'lardi.
4. **Foyda cheklangan.** Xaridor DCC'lari GLB'ni allaqachon o'qiydi (Blender 2.8+,
   3ds Max 2024+, Maya 2024+, Unity, Unreal, Godot). FBX'ning asosiy ustunligi —
   rig/animation; bu mahsulot esa statik mebel eksport qiladi.
5. **Xarajat.** Yangi eksport yo'li, yangi test yuzasi (binar format bo'yicha
   bayt-darajasidagi tekshiruv) va qo'llab-quvvatlash majburiyati paydo bo'ladi —
   foyda esa o'lchanmagan.

## 4. Xaridorga nima taklif qilinadi

| Ehtiyoj | Format |
| --- | --- |
| Web / real-time / PBR | **GLB** (tavsiya etiladi) |
| DCC'da tahrirlash (Blender / 3ds Max) | **OBJ + MTL + PNG teksturalar** (paketda) |
| 3D print / slicer | **STL** yoki **3MF** (mm) |
| Matnli ko'rik / diff | **.gltf** (o'zi yetarli JSON) |

FBX kerak bo'lsa, yo'l ochiq va hujjatlashtirilgan:

1. `model.glb` faylini Blender'da ochish (**File → Import → glTF 2.0**).
2. Blender'dan **File → Export → FBX** qilish (birliklar va o'qlar eksport
   dialogida tanlanadi).

Bu yo'l hech qanday qo'shimcha kod talab qilmaydi va foydalanuvchi o'z DCC'sida
natijani darhol tekshira oladi.

## 5. Qayta ko'rib chiqish shartlari

FBX faqat quyidagilar bajarilsa ko'rib chiqiladi:

- kamida bitta real xaridor 3ds Max/Maya uchun FBX talab qilsa;
- sinov muhitida kamida **ikkita** DCC (masalan Blender 4.x va 3ds Max 2025)
  o'rnatilib, oldindan yozilgan qabul testlari (geometriya soni, birliklar,
  transformlar, material slotlari, tekstura yo'llari) o'tkazilsa;
- tanlangan kutubxona versiyasi 1.x dan past bo'lmasa yoki uning xato rejimlari
  bizning testlar bilan qoplansa;
- eksport paketga **qo'shimcha** format sifatida qo'shilsa (mavjud GLB/OBJ/STL/3MF
  shartnomasi o'zgarmasa).

Shu shartlar to'liq bajarilmaguncha FBX faqat **Blender-verified** deb
ko'rsatiladi; 3ds Max/Maya tekshirilmaguncha "barcha DCC'da tekshirilgan"
deyilmaydi.

## 6. Phase 8B.3 yangilanishi (2026-11-06)

FBX endi alohida JS yozuvchi bilan emas, **Blender 4.5.9 LTS** orqali
yetkaziladi. Bu 3-bo'limdagi asosiy texnik xavflarni (birliklar, o'qlar,
material slotlari, tekstura yo'llari) haqiqiy DCC import/eksporti bilan
tekshirish imkonini berdi.

| Tekshiruv | Natija |
| --- | --- |
| Blender versiyasi | 4.5.9 LTS (rasmiy arxiv SHA-256 tekshirilgan) |
| Import → eksport → qayta import | PASS |
| Meshes / triangles | 24 / 4 696 |
| Bounding box | 160 × 80 × 75 cm |
| Material nomlari | 4 ta, o'zgarmagan |
| UV layers / zero-area | 24 / 0 |
| Birlik | FBX: santimetr (`UnitScaleFactor = 1.0`) |
| Teksturalar | 8 ta embed (BaseColor har material uchun takrorlangan + Normal) |
| Roughness / metalness | **Xaritalar yo'q**; doimiy qiymatlar: oak 0 / 0.533, steel 0.97 / 0.340 |

Cheklovlar:

- Faqat bitta DCC — Blender — tekshirilgan. **3ds Max va Maya NOT VERIFIED.**
  Shu sababli 5-bo'limdagi 2-DCC sharti saqlanadi.
- FBX Blender'ning Phong davri kanallariga tushadi: BaseColor va Normal
  saqlanadi, ORM xaritasi yo'qoladi. Bu yashirilmaydi va
  `docs/PHASE8B_BLENDER_EXPORT.md` da qayd etilgan.
- FBX "to'liq PBR" deb e'lon qilinmaydi; u qo'shimcha DCC formati.

Batafsil natijalar, fayl hash'lari va parity jadvali:
`docs/PHASE8B_BLENDER_EXPORT.md`.
