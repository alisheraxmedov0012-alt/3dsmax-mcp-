# W14 — Implementation Plan (Assembly & Constraint Engine)

> **Holat: REJA. Kod yozilmagan, implementatsiya boshlanmagan.**
>
> **Baseline:** `w13.1-validation-fixes` @ `8ddf6b28336af93f2f587f61c5b5591fc8ef53f3`
> (W13 `be96280` + W13.1 tuzatishlari).
>
> **Manba hujjat:** `IMPLEMENTATION_ROADMAP.md` §W14 (yagona mavjud ta'rif).
> Bu hujjat o'sha maqsadlarni **saqlaydi**, ularni kengaytiradi va
> implementatsiyadan oldin hal qilinishi kerak bo'lgan noaniqliklarni ochib beradi.
>
> Barcha kod da'volari fayl:satr bilan tasdiqlangan. Tasdiqlanmagan narsa
> **OPEN DECISION** deb belgilangan.

---

## 1. Maqsad, scope va scope'dan tashqari

### 1.1 Maqsad (roadmapdan o'zgartirilmagan)

`IMPLEMENTATION_ROADMAP.md:67`:
> "8 mebel + assembly: oshxona moduli, zinapoya, eshik/deraza, shkaf seksiyasi"

Ya'ni W14 mavjud sakkizta parametrik mebel turini **ko'p qismli assembly**'lar bilan
to'ldiradi: bir nechta mebel/qismdan tashkil topgan, o'zaro bog'langan va yagona
obyekt sifatida tahrirlanadigan konstruksiya.

### 1.2 Scope ichida

| # | Element | Izoh |
|---|---|---|
| S1 | Assembly ma'lumot modeli (TypeScript) | mavjud `SceneObject` ustiga additive |
| S2 | Assembly builder API (yangi `src/geometry/assemblies/`) | mavjud `buildFurniture` naqshiga mos |
| S3 | To'rtta assembly (2-bo'limda aniqlanadi) | qabul mezoni |
| S4 | Qismlar bog'lanish grafigi + constraint tekshiruvi | deterministik, solver emas (6-bo'lim) |
| S5 | Chuqurlik/qism soni chegaralari | cheksiz rekursiya himoyasi |
| S6 | Manufacturing/BOM mosligi | `parts.ts` bilan ishlashi |
| S7 | Export mosligi (GLB/OBJ/STL) | mavjud `buildSceneObject` orqali |
| S8 | Feature flag + rollback | 14-bo'lim |
| S9 | Testlar: unit, snapshot, property, regression, brauzer benchmark | 11–12-bo'lim |

### 1.3 Scope'dan tashqari (W14 da **yo'q**)

| Element | Kimga |
|---|---|
| DXF/CNC/nesting | W20 |
| To'liq CNC toolpath | W20 |
| Material/edge banding modeli | W16/W20 |
| AI bilan assembly yaratish (promptdan) | W15 |
| Server render | W17 |
| Ko'p **xonali** sahna, agar alohida qaror talab qilsa | **OPEN DECISION D3** |
| Haqiqiy CAD-grade toleranslar | hech qachon (mahsulot chegarasi) |

### 1.4 "Manufacturing-ready" da'vosi

**W14 hech qanday manufacturing-ready kafolat bermaydi.** Edge banding, grain,
joinery, hardware va nesting modellashtirilmaydi. BOM o'lchamlari geometriyadan
o'qiladi (`src/manufacturing/parts.ts:122`), bu "kesishga tayyor" degani **emas**.
UI va hujjatlarda bu ochiq yozilishi shart.

---

## 2. W14 ning oldingi bosqichlarga bog'liqligi

| Bog'liqlik | Holat (kod bilan tasdiqlangan) |
|---|---|
| **W2** — 8 mebel quruvchisi | ✅ `src/geometry/furniture/buildFurniture.ts:25-61` (8 `case`), `types.ts:23-31` |
| **W3** — geometriya sifati | ✅ `geometryQuality.test.ts` (17 test), `params.ts` (`relationErrors`, `validateFurnitureParams`) |
| **W13** — AI DesignSpec v2, 8 tur | ✅ `spec.py:71` (`frozenset(FurnitureType)`), `designSpec.ts:28` |
| **W13.1** — validatsiya tuzatishlari | ✅ commit `8ddf6b2` |
| *Qo'shimcha (hujjatda yozilmagan)* **W4** — PBR | Assembly qismlari `PartMaterialOptions` olishi kerak (`parts.ts:41-52`) |
| *Qo'shimcha* **W6** — interyer | Assembly xona ichida joylashishi kerak; `placement.ts` bilan moslik |
| *Qo'shimcha* **W9** — BOM | `parts.ts` → `bom.ts` zanjiri assembly'ni tushunishi kerak |

**Xulosa:** barcha rasmiy bog'liqliklar (W2, W3, W13) **qondirilgan**.

---

## 3. To'rtta assembly — aniq ta'rif va qabul mezonlari

### 3.1 Tanlov va asoslash

Roadmap to'rt elementni nomlaydi (`:67`): *oshxona moduli, zinapoya, eshik/deraza,
shkaf seksiyasi*. Muammo: **eshik/deraza allaqachon W6 da bor** — `RoomOpening`
(`src/scene/types.ts:41-56`), `buildRoom.ts:129-160` uni devorga ramka sifatida
chizadi (haqiqiy teshik kesilmaydi). Uni qayta qilish **takrorlash** bo'ladi.

**Qaror (D1):** `eshik/deraza` assembly sifatida **qayta implementatsiya qilinmaydi**.
Buning o'rniga to'rtinchi assembly — **"Oshxona tokchasi moduli"** (wall cabinet),
chunki u mavjud `wardrobe`/`shelf` builderlaridan farqli ravishda **osilib turuvchi**
konstruksiya va devorga mahkamlash constraintini talab qiladi.

### 3.2 To'rtta assembly (final)

| ID | Nomi | Tarkibi | Nega alohida |
|---|---|---|---|
| **ASM-1** | `kitchen-base-run` — oshxona pastki moduli | 2–4 korpus + ustki panel + plintus | modullar orasidagi bo'shliq/hizalash constraint |
| **ASM-2** | `wall-cabinet` — osma oshxona shkafi | korpus + 1–3 eshik + osma mahkamlash | **devorga osish** constraint (yerga tegmaydi) |
| **ASM-3** | `wardrobe-section` — shkaf seksiyasi | korpus + tokchalar + eshiklar + bo'linma | ichki bo'linmalar ierarxiyasi |
| **ASM-4** | `stair-straight` — to'g'ri zinapoya | 6–16 pog'ona + 2 kosour | **takrorlanuvchi qismlar** + balandlik/qadam nisbati constraint |

### 3.3 Har assembly uchun funksional ta'rif va qabul mezonlari

#### ASM-1 `kitchen-base-run`

**Parametrlar:** `moduleCount` (2–4), `moduleWidthCm` (40–90), `heightCm` (70–95),
`depthCm` (45–65), `plinthHeightCm` (0–20), `color`, `material`.

**Quriladi:** `moduleCount` ta korpus yonma-yon, orasida 0 sm bo'shliq (hizalangan),
umumiy ustki panel, old tomonda plintus.

**Qabul mezonlari:**
| ID | Mezon | Tekshirish |
|---|---|---|
| AC-ASM1-1 | `moduleCount × moduleWidthCm` umumiy kenglikka teng | unit |
| AC-ASM1-2 | Modullar orasida bo'shliq yoki ustma-ust tushish **yo'q** | unit (AABB) |
| AC-ASM1-3 | Butun assembly `[0, heightCm]` Y oralig'ida, pol ostiga tushmaydi | unit |
| AC-ASM1-4 | `plinthHeightCm > heightCm` bo'lsa rad etiladi | unit (xato) |

#### ASM-2 `wall-cabinet`

**Parametrlar:** `widthCm` (40–120), `heightCm` (40–100), `depthCm` (25–40),
`doorCount` (1–3), `mountHeightCm` (120–180), `color`, `material`.

**Quriladi:** korpus + eshiklar; pastki tekislik `mountHeightCm` da (yerga tegmaydi).

**Qabul mezonlari:**
| ID | Mezon | Tekshirish |
|---|---|---|
| AC-ASM2-1 | Eng past qism Y ≥ `mountHeightCm` (yerga tegmaydi) | unit (AABB) |
| AC-ASM2-2 | Eng yuqori qism Y = `mountHeightCm + heightCm` | unit |
| AC-ASM2-3 | `mountHeightCm + heightCm` xona balandligidan oshsa **ogohlantirish** (rad emas) | unit |
| AC-ASM2-4 | `doorCount` eshik soni bilan mos | unit |

#### ASM-3 `wardrobe-section`

**Parametrlar:** `widthCm` (60–240), `heightCm` (150–260), `depthCm` (40–70),
`sectionCount` (1–4), `shelfCountPerSection` (0–6), `doorCount` (0–4).

**Quriladi:** korpus + `sectionCount` bo'linma (vertikal to'siq) +
har bo'linmada tokchalar + eshiklar.

**Qabul mezonlari:**
| ID | Mezon | Tekshirish |
|---|---|---|
| AC-ASM3-1 | Bo'linmalar yig'indisi korpus ichki kengligiga teng (±0.5 sm) | unit |
| AC-ASM3-2 | Tokchalar korpus ichida, ustki/ostki paneldan tashqarida emas | unit |
| AC-ASM3-3 | `sectionCount = 1` — mavjud `wardrobe` bilan **bir xil** natija bermaydi (yangi builder) | unit (farq testi) |
| AC-ASM3-4 | Eshiklar korpus kengligini qoplamaydi | unit |

#### ASM-4 `stair-straight`

**Parametrlar:** `stepCount` (6–16), `stepWidthCm` (70–120), `stepDepthCm` (22–32),
`riseCm` (15–20), `stringerThicknessCm` (3–8).

**Quriladi:** `stepCount` pog'ona + 2 kosour (yon panellar).

**Qabul mezonlari:**
| ID | Mezon | Tekshirish |
|---|---|---|
| AC-ASM4-1 | Umumiy balandlik = `stepCount × riseCm` | unit |
| AC-ASM4-2 | Risers `15 ≤ riseCm ≤ 20` (xavfsizlik diapazoni); tashqarida **ogohlantirish** | unit |
| AC-ASM4-3 | Har pog'ona oldingisidan `riseCm` yuqorida | unit |
| AC-ASM4-4 | Pogonlar soni = `stepCount` (aniq) | unit |
| AC-ASM4-5 | `stepCount × stepDepthCm` umumiy uzunlikka teng | unit |

### 3.4 Umumiy assembly acceptance

| ID | Mezon | Tekshirish |
|---|---|---|
| AC-ASM-0 | To'rtta assembly ham `buildAssembly()` orqali quriladi | unit |
| AC-ASM-1 | Har biri 0 NaN/Infinity qaytaradi | property test |
| AC-ASM-2 | Har biri `dispose()` dan keyin resurs qoldirmaydi | unit |
| AC-ASM-3 | Har biri BOM/BOM cut list yaratadi | integration |
| AC-ASM-4 | Assembly **export qilinmaydi** (D9) — `sceneExport` diffda o'zgarmaydi | regression (diff) |
| AC-ASM-5 | Qism ID'lari rebuild'da **bir xil** | snapshot |

---

## 4. W6 `RoomOpening` bilan takrorlanishni oldini olish

### 4.1 Mavjud holat (kod bilan)

| Element | Fayl | Xulosa |
|---|---|---|
| `RoomOpening` modeli | `src/scene/types.ts:41-56` | devordagi eshik/deraza **markeri** |
| Rendering | `src/geometry/buildRoom.ts:129-160` | faqat **ramka** chizadi, devor kesilmaydi |
| Chegara | `src/scene/types.ts:63` — `MAX_OPENINGS_PER_ROOM = 12` | 12 tagacha |
| Holat | **W6 da bajarilgan** | takrorlash kerak emas |

### 4.2 Qaror (D1 — yopilgan)

1. **`RoomOpening` o'zgartirilmaydi.** U mebel emas, xona atributi.
2. **Assembly eshik/deraza yaratmaydi.**
3. Roadmap'dagi "eshik/deraza" ni **W6 da bajarilgan** deb qayd etamiz; to'rtinchi
   assembly — `stair-straight` (3.2 jadval).
4. Kelajakda haqiqiy teshik kesish (CSG) kerak bo'lsa — **W20** doirasida, W14 da emas.

**Tekshirish:** W14 dan keyin `RoomOpening` fayli va `buildRoom` o'zgarishi
**bo'lmasligi** regressiya testida tasdiqlanadi (11.4).

---

## 5. Assembly ma'lumot modeli va TypeScript builder API

### 5.1 Ikki variant — taqqoslash

| Mezon | **A. Yangi `SceneObjectType`** | **B. Mavjud `SceneObject` ichida guruh** | **C. Alohida `SceneAssembly` massivi** |
|---|---|---|---|
| `SceneObjectType` o'zgarishi | `types.ts:29` (`= FurnitureType`) → union | o'zgarmaydi | o'zgarmaydi |
| `SceneData` o'zgarishi | yo'q | `objects[]` ichida yangi maydonlar | **yangi `assemblies[]`** |
| `sceneValidation` | 8 → 12 tur, katta o'zgarish | qismlar ro'yxati validatsiyasi | yangi validatsiya |
| `bom.ts` (`FurnitureType` oladi, `bom.ts:122`) | 4 yangi `case` | qismlarni jamlash kerak | alohida yo'l |
| `technicalDrawing.ts` (`FurnitureType` oladi, `:207`) | 4 yangi signature | qismlarni jamlash kerak | alohida |
| Export/GLB (`buildSceneObject.ts:36`) | yangi dispatch | **o'zgarishsiz** | yangi dispatch |
| `placement.ts` AABB | o'zgarishsiz | **o'zgarishsiz** | yangi |
| Backward compatibility | past (tur union kengayadi, eski sahnalar buzilmaydi) | **yuqori** | o'rta (yangi massiv, eski `undefined`) |
| Mavjud 471 testga ta'sir | ko'p | **kam** | kam |

### 5.2 Tavsiya (D2 — yopilgan): **B variant, additive**

**Sabab:** `SceneObject` allaqachon `{id, type, name, position, rotation, scale,
visible, params, material}` (`types.ts:82-94`). Assembly — bu **bir nechta
`SceneObject` ning guruh bog'lanishi**, alohida obyekt turi emas.

```ts
// src/scene/types.ts ga additive (mavjud maydonlar o'zgarmaydi)
export type AssemblyKind =
  | 'kitchen-base-run'
  | 'wall-cabinet'
  | 'wardrobe-section'
  | 'stair-straight';

/** W14: ixtiyoriy maydon. Eski sahnalarda `undefined` — to'liq backward compatible. */
export interface SceneAssembly {
  id: string;                       // guruh identifikatori
  kind: AssemblyKind;
  /**
   * Faqat `params` saqlanadi. A'zoobyektlar (memberIds) saqlanmaydi: ular
   * `buildAssembly()` tomonidan deterministik hosil qilinadi (7.4, D6).
   * Sabab: backend `MAX_OBJECTS = 500` (scene_payload.py:29).
   */
  params: AssemblyParams;
}

export interface SceneObject {
  // ... mavjud maydonlar o'zgarishsiz ...
  /** W14: qaysi assembly'ga tegishli (ixtiyoriy). */
  assemblyId?: string;
}

export interface SceneData {
  schemaVersion: number;
  room: RoomConfig;
  objects: SceneObject[];
  settings: SceneSettings;
  /** W14: ixtiyoriy. Yo'q bo'lsa — assembly yo'q (eski sahna). */
  assemblies?: SceneAssembly[];
}
```

**Nega `SceneObjectType` kengaytirilmaydi:** u `FurnitureType` ga bog'langan
(`types.ts:29`) va butun `params.ts`/`bom.ts`/`technicalDrawing.ts` zanjiri shu
turga tayanadi. Yangi tur qo'shish **sakkiz turdagi invariantlarni** buzadi.

### 5.3 Builder API

```ts
// src/geometry/assemblies/types.ts (yangi)
export interface AssemblyParamsByKind {
  'kitchen-base-run': KitchenBaseRunParams;
  'wall-cabinet': WallCabinetParams;
  'wardrobe-section': WardrobeSectionParams;
  'stair-straight': StairStraightParams;
}

export interface BuiltAssembly {
  /** Butun assembly uchun bitta Three.js guruh. */
  group: THREE.Group;
  /** Har bir a'zo obyekt uchun alohida guruh (viewer/selection uchun). */
  members: Array<{ objectId: string; group: THREE.Group }>;
  dispose: () => void;
}

// src/geometry/assemblies/index.ts (yangi)
export function buildAssembly<K extends AssemblyKind>(
  kind: K,
  params: AssemblyParamsByKind[K],
  material?: PartMaterialOptions,
): BuiltAssembly;

export function validateAssemblyParams<K extends AssemblyKind>(
  kind: K,
  raw: unknown,
): AssemblyParamsByKind[K] | null;

export function assemblyDefaults<K extends AssemblyKind>(
  kind: K,
): AssemblyParamsByKind[K];
```

**Naqsh mosligi:** mavjud `buildFurniture(type, params, material) → {group, dispose}`
(`buildFurniture.ts:25-30`) va `PartBuilder` (`parts.ts:39-77`) bilan bir xil;
`buildFurniture` **o'zgartirilmaydi**.

### 5.4 Integratsiya nuqtasi

`src/scene/buildSceneObject.ts:35-43` — `buildFurniture` chaqiriladi. Assembly uchun
**yangi funksiya**: `buildSceneAssembly(assembly, objects)` — `buildSceneObject` ni
**o'zgartirmaydi**, yonida turadi.

`src/viewer/SceneViewer.ts:187-196` — hozir har `SceneObject` uchun
`buildSceneObject` chaqiriladi. Assembly guruhlarini qurish uchun **qo'shimcha
pass** kerak (5.5 ga qarang).

### 5.5 Viewer integratsiyasi (eng nozik joy)

Mavjud viewer har obyektni alohida quradi va `paramsKey` bo'yicha inkremental
yangilaydi (`SceneViewer.ts:148-196`). Assembly uchun:

1. A'zo obyektlar **alohida quriladi** (selection, transform uchun) — mavjud yo'l.
2. Assembly guruhi — **faqat vizual** birlashtiruvchi (ixtiyoriy, LOD uchun).
3. **Muqobil (tavsiya):** assembly uchun alohida Three.js guruhi **yaratilmaydi**;
   faqat `assemblyId` metadata saqlanadi. Bu viewer'ni **umuman o'zgartirmaydi**.

**D4 (yopilgan):** W14 da viewer'ga assembly-specific renderer **qo'shilmaydi**.
Assembly — ma'lumot modeli + builder + BOM. Vizual guruhlash keyingi bosqich.

---

## 6. Qismlar bog'lanish grafigi, constraint turlari, yechish tartibi

### 6.1 "Solver" emas — deterministik tekshiruv

Roadmap `:71` "constraint solver" deydi. To'liq solver (iterativ, global
optimizatsiya) W14 uchun **ortiqcha** va deterministik test qilishni qiyinlashtiradi.

**D5 (yopilgan):** W14 da **deterministik constraint tekshiruvi** — har constraint
`(params) → OK | Error` sof funksiya. Parametrlar **kiritish**, qismlar **chiqish**.
Solver yo'q, chunki assembly parametrlari **bog'liq emas** (bir-birini talab qilmaydi).

### 6.2 Bog'lanish grafigi

```ts
// src/geometry/assemblies/graph.ts (yangi)
export interface PartNode {
  id: string;                 // "asm1-module-1-side-left"
  role: 'corpus' | 'shelf' | 'door' | 'plinth' | 'top' | 'step' | 'stringer';
  parentId: string | null;    // ierarxiya
  /** Ota-onaga nisbatan joylashuv (sm). */
  offset: [number, number, number];
  size: [number, number, number];
}

export function buildPartGraph(kind: AssemblyKind, params: unknown): PartNode[];
export function validateGraph(nodes: PartNode[]): ConstraintViolation[];
```

Graf — **qat'iy ierarxiya** (assembly → korpus → qism). Sikllar taqiqlanadi.

### 6.3 Constraint turlari (to'liq ro'yxat)

| Tur | Ta'rif | Misol |
|---|---|---|
| `containment` | Bola ota-ona ichida | tokcha korpus ichida |
| `adjacency` | Ikki qism teginadi, bo'shliq yo'q | modullar yonma-yon |
| `non-overlap` | Ikki qism kesishmaydi | ikki qo'shni modul |
| `axis-range` | Qiymat diapazonda | `riseCm ∈ [15,20]` |
| `derived-sum` | Yig'indi tenglik | `Σ moduleWidth = totalWidth` |
| `floor-contact` | Pastki tekislik Y = 0 | polga turadigan assembly |
| `wall-mount` | Pastki tekislik Y = mountHeight | osma shkaf |

**7 tur** — yetarli va deterministik. Har biri alohida sof funksiya + test.

### 6.4 Yechish tartibi (deterministik)

1. `validateAssemblyParams` — sxema + diapazon.
2. `buildPartGraph` — qismlar daraxti.
3. `validateGraph` — constraintlar **qat'iy tartibda** (containment → adjacency →
   non-overlap → axis-range → derived-sum → floor/wall).
4. Birinchi xato → qurish **to'xtatiladi**, `AssemblyBuildResult` xato bilan qaytadi.
5. Hech qanday qism "yarim qurilgan" holatda qolmaydi (`dispose` chaqiriladi).

### 6.5 Xatolarni boshqarish

```ts
export type AssemblyBuildResult =
  | { ok: true; built: BuiltAssembly; warnings: string[] }
  | { ok: false; reason: string; violations: ConstraintViolation[] };
```

Xato matni **foydalanuvchiga xavfsiz** (kod + o'zbekcha xabar). Traceback,
ichki tafsilot yo'q. Bu backenddagi `ApiError` naqshiga mos (lekin W14 frontend-only).

---

## 7. Cheksiz rekursiya va resurs chegaralari

### 7.1 Xavf

Agar assembly parametrlari ichida boshqa assembly'ga havola bo'lsa (yoki kelajakda
ichma-ich assembly ruxsat etilsa), rekursiya cheksiz bo'lishi mumkin. Hozirgi
modelda bunday havola yo'q (7.4), lekin himoya **kirish darajasida** bo'lishi shart.

### 7.2 Chegaralar (majburiy)

| Chegara | Qiymat | Fayl |
|---|---|---|
| `MAX_ASSEMBLY_DEPTH` | **2** (assembly → a'zo; ichma-ich assembly yo'q) | yangi `assemblies/limits.ts` |
| `MAX_MEMBERS_PER_ASSEMBLY` | **64** | yangi |
| `MAX_PARTS_PER_ASSEMBLY` | **500** | yangi |
| `MAX_ASSEMBLIES_PER_SCENE` | **20** | yangi |
| Backend `MAX_OBJECTS` (mavjud) | **500** | `scene_payload.py:29` |

**Nega `MAX_ASSEMBLIES_PER_SCENE = 20`:** 20 × 64 a'zo = 1280 obyekt — backend
`MAX_OBJECTS = 500` dan oshadi. Shuning uchun **assembly a'zolari backend'da
obyekt sifatida saqlanmaydi** — ular assembly parametridan **hosil qilinadi**.
Bu muhim arxitektura qarori (5.2 bilan bog'liq).

**D6 (yopilgan):** assembly'lar **saqlanadi**, a'zolari **hosil qilinadi**.
Ya'ni `SceneAssembly` faqat `{id, kind, params}` saqlaydi; a'zoobyektlar
runtime'da hosil qilinadi va `SceneObject.assemblyId` orqali bog'lanadi.

**Qayta ko'rib chiqish (D6):** 5.2 dagi model dastlab `memberIds` ni saqlashni
ko'zda tutgan edi. `MAX_OBJECTS = 500` cheklovi sababli a'zolar saqlanmaydi —
ular `buildAssembly()` tomonidan hosil qilinadi. 5.2 shu holatga moslashtirildi.

### 7.3 Rekursiya himoyasi (kod darajasida)

`SceneAssembly` ichma-ich assembly'ga ishora qila olmaydi (7.4), lekin uchta
himoya qatlami baribir qo'yiladi. Sabab: himoya **modelga emas, kirishga**
tayanishi kerak — buzilgan yoki qo'lda tahrirlangan JSON ham xavfsiz bo'lishi shart.

```ts
export function assertAssemblyDepth(assemblies: SceneAssembly[]): void {
  // 1) Assembly'lar orasida havola yo'q — faqat tekis ro'yxat.
  // 2) Chuqurlik hisoblagichi: agar kelajakda ichma-ich ruxsat berilsa, bu joy
  //    MAX_ASSEMBLY_DEPTH ni qo'llaydi.
  if (assemblies.length > MAX_ASSEMBLIES_PER_SCENE) {
    throw new AssemblyError('assembly_too_many', 'Sahnada assembly juda ko‘p.');
  }
}

export function assertNoSelfReference(assembly: SceneAssembly, all: SceneAssembly[]): void {
  // Parametrlar ichida boshqa assembly id'siga ishora bo'lsa — rad etiladi.
  assertNoNestedAssemblyRefs(assembly.params, MAX_ASSEMBLY_DEPTH);
}
```

**Testlar:**
- 21 assembly → `assembly_too_many`.
- Parametrlar ichida `assemblyId` havolasi → rad etiladi.
- `MAX_ASSEMBLY_DEPTH` dan chuqur obyekt → rad etiladi (himoya zaxirasi).
- To'g'ri assembly → o'tadi.

### 7.4 5.2 bilan moslik (D6 natijasi)

5.2 dagi model **allaqachon** shu qoidaga mos: `SceneAssembly` faqat `{id, kind,
params}` saqlaydi, `memberIds` **yo'q**. A'zo obyektlar `buildAssembly()` tomonidan
deterministik hosil qilinadi va runtime'da `SceneObject.assemblyId` orqali
bog'lanadi.

Sabab: backend `MAX_OBJECTS = 500` (`scene_payload.py:29`). Agar har assembly
a'zosi alohida obyekt sifatida saqlansa, 20 assembly × 64 a'zo = 1280 obyekt
limitdan oshadi.

---

## 8. Backward compatibility

### 8.1 Mavjud holat (kod bilan)

| Element | Fayl:satr | W14 ta'siri |
|---|---|---|
| `SceneData` | `types.ts:117-122` | `assemblies?` qo'shiladi (ixtiyoriy) |
| `SCENE_SCHEMA_VERSION = 3` | `types.ts:130` | **o'zgarmaydi** (8.3) |
| `validateSceneData` | `sceneValidation.ts:236-258` | `assemblies` validatsiyasi qo'shiladi |
| `schemaVersion` qayta yoziladi | `sceneValidation.ts:255` | **har yuklashda joriy versiya qo'yiladi** |
| `SceneObjectType = FurnitureType` | `types.ts:29` | **o'zgarmaydi** |
| Backend `MAX_OBJECTS = 500` | `scene_payload.py:29` | o'zgarmaydi |
| Backend `SUPPORTED_SCENE_JSON_VERSIONS = {1}` | `scene_payload.py:24` | **container versiyasi** — `schemaVersion` emas |

### 8.2 Backward compatibility kafolatlari

1. **Eski sahnalar ochiladi:** `assemblies` yo'q → `undefined` → hech qanday
   assembly ko'rsatilmaydi. Mavjud 471 test o'zgarishsiz o'tishi shart.
2. **Yangi sahna eski build'da:** `assemblies` noma'lum maydon sifatida
   **e'tiborsiz qoldiriladi** (`extra: "ignore"` naqshi, `spec.py:155`).
3. **`SceneObject.assemblyId` ixtiyoriy** — eski obyektlarda yo'q.
4. **`RoomOpening`, `params.ts`, `bom.ts`, `technicalDrawing.ts`** — **o'zgarmaydi**.

### 8.3 Schema versiyasi — **ko'tarilmaydi** (D7 — yopilgan)

**Sabab (kod bilan):** `validateSceneData` har yuklashda `schemaVersion` ni joriy
qiymatga **qayta yozadi** (`sceneValidation.ts:255`, `:272`). Ya'ni versiya
**informatsion**, migratsiya darvozasi emas. Qo'shimcha ixtiyoriy maydon qo'shish
uchun versiya ko'tarish **shart emas** va foydasiz.

**Qoida:** `SCENE_SCHEMA_VERSION = 3` **o'zgarmaydi**. Agar kelajakda **destruktiv**
o'zgarish kerak bo'lsa (maydon o'chirish/qayta nomlash), o'shanda 4 ga ko'tariladi
va migratsiya yoziladi.

### 8.4 Agar migratsiya kerak bo'lsa (kelajak uchun shablon)

Kelajakda kerak bo'lsa:
1. `sceneVersion.ts` da `migrateScene(raw): SceneData` — versiyalar zanjiri.
2. Eski fixture'lar: `src/scene/__fixtures__/scene-v1.json`, `-v2.json`, `-v3.json`.
3. Test: har eski fixture → joriy versiyaga ko'tariladi, obyekt soni saqlanadi.

**W14 da bu qadamlar bajarilmaydi** (D7), lekin shablon hujjatlashtirildi.

---

## 9. Manufacturing va export ta'siri

### 9.1 Mavjud zanjir (kod bilan)

```
buildFurniture(type, params)         geometry/furniture/buildFurniture.ts:25
   ↓ .group
measureParts(type, group)            manufacturing/parts.ts:122
   ↓ MeasuredPart[]
groupParts(parts)                    manufacturing/parts.ts:163
   ↓ PartGroup[]
buildBom(type, params)               manufacturing/bom.ts:122  ← FurnitureType oladi
   ↓ BomResult
buildCutList(bom)                    manufacturing/cutList.ts:66
```

### 9.2 Muammo

`buildBom(type: FurnitureType, params: FurnitureParams)` — **`FurnitureType`** talab
qiladi (`bom.ts:122`). Assembly `FurnitureType` emas.

### 9.3 Yechim (D8 — yopilgan): **yangi funksiya, mavjudini o'zgartirmaslik**

```ts
// src/manufacturing/assemblyBom.ts (yangi)
export function buildAssemblyBom(
  kind: AssemblyKind,
  params: AssemblyParams,
): AssemblyBomOutcome;
```

Ichida: `buildAssembly()` → har a'zo uchun `measureParts` → `groupParts` →
**birlashtirilgan** `BomResult`.

**Nega `buildBom` o'zgartirilmaydi:** 471 test va `ManufacturingPanel.tsx:41`
unga tayanadi. Yangi yo'l **yonma-yon** turadi.

### 9.4 Export ta'siri — **o'zgarishsiz**

`src/export/sceneExport.ts:46-50` — `data.objects` ni `buildSceneObject` orqali
quradi. Assembly a'zolari **obyekt emas** (D6) → eksport **o'zgarmaydi**.

**D9 (yopilgan):** W14 da assembly → GLB eksporti **qo'shilmaydi**. Sabab: a'zolar
obyekt sifatida mavjud emas. Agar assembly eksport qilinishi kerak bo'lsa, bu
**OPEN DECISION D9-a**: assembly'ni "virtual obyekt" sifatida eksport qilish
keyingi bosqichga qoldiriladi.

---

## 10. Test strategiyasi

### 10.1 Property-based — dependency qarori

| Variant | Afzallik | Kamchilik |
|---|---|---|
| **`fast-check`** (yangi dev-dep) | standart, yaxshi shrift, shrinking | yangi dependency (~1 MB), ruxsat kerak |
| **Qo'lda generator** (mavjud naqsh) | dependency yo'q | shrinking yo'q, kamroq qamrov |

**D10 (yopilgan):** W14 **`fast-check` qo'shmaydi**. Mavjud `inRangeMatrix(type)`
naqshi (`geometryQuality.test.ts:116`) kengaytiriladi — deterministik, tez,
dependency'siz. 500+ kombinatsiya qo'lda generatsiya qilinadi.

**Agar kelajakda** murakkabroq property kerak bo'lsa — alohida ruxsat bilan.

### 10.2 Test qatlamlari

| Qatlam | Vosita | Fayl |
|---|---|---|
| Unit — params | Vitest | `assemblies/params.test.ts` |
| Unit — constraintlar | Vitest | `assemblies/constraints.test.ts` |
| Unit — graph | Vitest | `assemblies/graph.test.ts` |
| Unit — builder | Vitest | `assemblies/buildAssembly.test.ts` |
| Snapshot — qism ID'lari | Vitest | `assemblies/snapshot.test.ts` |
| Property — 500+ kombinatsiya | Vitest (qo'lda) | `assemblies/property.test.ts` |
| Regression — mavjud 8 tur | Vitest | mavjud testlar **tegilmaydi** |
| Integration — BOM | Vitest | `manufacturing/assemblyBom.test.ts` |
| Security — rekursiya | Vitest | `assemblies/limits.test.ts` |

### 10.3 Regression kafolati

- Mavjud **471 frontend** testi **o'zgarishsiz** o'tishi shart.
- Mavjud **282 backend** testi **o'zgarishsiz** o'tishi shart.
- `RoomOpening`, `buildRoom`, `params.ts`, `bom.ts`, `technicalDrawing.ts`,
  `sceneExport.ts` — **diff'da bo'lmasligi** tekshiriladi (regressiya testi).

---

## 11. 60 FPS — haqiqiy o'lchash usuli

### 11.1 Muammo (kod bilan)

- Vitest `environment: 'node'` (`vite.config.ts:7`) — **WebGL yo'q**.
- `largeScene.test.ts:40-70` — validate/serialize/rebuild **millisekund**ini
  o'lchaydi, **FPS emas**.
- `SceneViewer.ts:488` da `requestAnimationFrame` bor, lekin **FPS hisoblagichi yo'q**.

**D11 (yopilgan): Node testidagi vaqt 60 FPS isboti EMAS.** Hech qanday testda
"60 FPS" deb da'vo qilinmaydi.

### 11.2 O'lchash usuli — brauzer benchmarki

**Yangi dev tool** (kod, lekin test emas): `scripts/fps-benchmark.md` + qo'lda skript.

| Element | Qiymat |
|---|---|
| Muhit | Chrome **stable**, `--use-gl=angle` (GPU), 1920×1080 |
| Qurilma | Minimal: **Intel Iris Xe / Apple M1 / 8 GB RAM** — aniq model hujjatda |
| Sahna | 500 qism: 20 assembly × 25 qism (yoki 12 ta katta assembly) |
| O'lchov | 10 soniya `requestAnimationFrame` loop, o'rtacha va p5 |
| Usul | DevTools Performance yoki kichik `fps-meter.ts` (faqat dev) |
| Takrorlash | 3 marta, o'rtacha olinadi |

**Qabul mezoni (AC-12):** 500 qismda **o'rtacha ≥ 60 FPS**, p5 ≥ 50 FPS.

**MUHIM:** bu **qo'lda brauzer o'lchovi**, CI'da **avtomatlashtirilmaydi**.
Natija `W14_PERF_REPORT.md` da (implementatsiya bosqichida) qayd etiladi.

### 11.3 CI'da o'lchanadigan bilvosita ko'rsatkichlar

| Ko'rsatkich | Mezon | Avtomatik |
|---|---|---|
| 500 qism qurish vaqti | < 8000 ms (Node) | ✅ Vitest |
| 500 qism dispose | < 500 ms | ✅ Vitest |
| Scene JSON hajmi (500 qism) | < 2 MB (backend limiti) | ✅ Vitest |
| Obyekt soni | ≤ 500 (`scene_payload.py:29`) | ✅ Vitest |

Bu **FPS emas** — faqat patologik sekinlashuvni ushlaydi.

---

## 12. Self-intersection va NaN — aniq doira

### 12.1 NaN (aniq)

**Doira:** har qurilgan qismning `position`/`scale`/`geometry` parametrlari
`Number.isFinite()` bo'lishi shart.

**Usul:** `BufferGeometry` `position` atributini o'qib, har komponentni tekshirish.
Mavjud `geometryQuality.test.ts:308` ("never throws and always yields finite,
positive geometry") shu naqshni ishlatadi — W14 da assembly'larga **kengaytiriladi**.

**Mezon:** 0 NaN/Infinity, 500+ kombinatsiyada.

### 12.2 Self-intersection (doira aniqlandi)

**MUHIM:** to'liq mesh-mesh intersection (uchburchak-uchburchak) W14 uchun
**ortiqcha** va sekin. O'rniga **AABB (axis-aligned bounding box)** tekshiruvi.

| Tekshiriladigan holat | Usul |
|---|---|
| Bir assembly ichidagi qismlar ustma-ust | AABB `non-overlap` constraint |
| **Ruxsat etilgan** ustma-ust | Ota-ona va bolasi (tokcha korpus ichida), eshik korpus oldida |
| Ikki **alohida** assembly orasida | `placement.ts:83` (`objectsOverlap`) — mavjud |
| Nishabli/aylantirilgan qism | `rotatedHalfExtents` (`placement.ts:35`) — mavjud |

**Mezon (AC-4):** bir assembly ichida **`non-overlap` juftliklarida** AABB
kesishuvi **0**, tolerantlik **0.1 sm** (qismlar tegishi mumkin).

**Cheklov (ochiq yoziladi):** bu **haqiqiy mesh intersection emas**. Egri
sirtlar (silindr, shar) uchun AABB yetarli emas — lekin W14 da barcha qismlar
**quti (BoxGeometry)** (`parts.ts:60-66`), shuning uchun AABB **aniq**.

### 12.3 Nima tekshirilmaydi (halol)

- Uchburchak-darajasidagi self-intersection.
- Bo'shliq (gap) vizual estetikasi.
- Material/tekstura ustma-ustligi.
- Manufacturing toleranslari.

---

## 13. Feature flag va rollback

### 13.1 Flag

```ts
// src/geometry/assemblies/flag.ts (yangi)
export function assembliesEnabled(): boolean {
  // Vite env yoki runtime config; default: false (W14 tugagach true)
  return import.meta.env?.VITE_ASSEMBLY_ENABLED === 'true';
}
```

**Default `false`** — W14 merge qilinganda assembly'lar **ko'rinmaydi**.
Flag `true` bo'lganda UI'da paydo bo'ladi.

### 13.2 Rollback darajalari

| Daraja | Amal | Ta'sir |
|---|---|---|
| **R1** | `VITE_ASSEMBLY_ENABLED=false` | Assembly UI yashiriladi; **kod qoladi**, mavjud funksiyalar ishlaydi |
| **R2** | W14 commit'larini revert | To'liq qaytarish; migratsiya yo'q (D7) |
| **R3** | `assemblies` maydonini saqlangan sahnalardan olib tashlash | Faqat ma'lumot; kod tegilmagan |

**R2 xavfsiz, chunki:** `SCENE_SCHEMA_VERSION` o'zgarmaydi (D7), `assemblies`
ixtiyoriy, `SceneObjectType` o'zgarmaydi.

---

## 14. Xavflar, acceptance criteria, yakuniy qabul

### 14.1 Xavflar

| ID | Xavf | E×T | Chora |
|---|---|---|---|
| W14-R1 | `SceneData` o'zgarishi eski sahnalarni buzadi | 2×3=**6** | `assemblies?` ixtiyoriy; 471 test regressiyasi |
| W14-R2 | `SceneObjectType` kengaytirilsa 8-tur invariantlari buziladi | 2×3=**6** | **D2: kengaytirilmaydi** |
| W14-R3 | 60 FPS o'lchanmaydi | 3×2=**6** | **D11: brauzer benchmark, CI'da emas** |
| W14-R4 | `RoomOpening` bilan takrorlash | 2×2=4 | **D1: qayta qilinmaydi** |
| W14-R5 | Rekursiya (assembly → assembly) | 2×3=**6** | `MAX_ASSEMBLY_DEPTH=2`, testlar |
| W14-R6 | Assembly a'zolari backend `MAX_OBJECTS=500` dan oshadi | 2×3=**6** | **D6: a'zolar hosil qilinadi, saqlanmaydi** |
| W14-R7 | BOM `FurnitureType` talab qiladi | 2×2=4 | **D8: yangi `buildAssemblyBom`** |
| W14-R8 | Snapshot testlar flaky (geometriya tartibi) | 2×2=4 | Deterministik tartiblash |
| W14-R9 | Viewer assembly'ni ko'rsatmaydi | 2×1=2 | **D4: W14 da vizual guruh yo'q** |
| W14-R10 | Export assembly'ni qo'llamaydi | 2×1=2 | **D9: keyingi bosqich** |

### 14.2 Acceptance criteria (yakuniy)

| ID | Mezon | Avtomatik? |
|---|---|---|
| AC-1 | 4 assembly quriladi (`buildAssembly`) | ✅ |
| AC-2 | Har biri `validateAssemblyParams` dan o'tadi | ✅ |
| AC-3 | Har birida 0 NaN/Infinity (500+ kombinatsiya) | ✅ |
| AC-4 | `non-overlap` buzilishi 0 (AABB, tol. 0.1 sm) | ✅ |
| AC-5 | Qism ID'lari rebuild'da barqaror | ✅ snapshot |
| AC-6 | Rekursiya `MAX_ASSEMBLY_DEPTH` da rad etiladi | ✅ |
| AC-7 | `MAX_PARTS_PER_ASSEMBLY=500` da rad etiladi | ✅ |
| AC-8 | Eski 471 + 282 test o'zgarmasdan o'tadi | ✅ |
| AC-9 | `RoomOpening`/`buildRoom` diffda **yo'q** | ✅ |
| AC-10 | `buildAssemblyBom` har assembly uchun BOM beradi | ✅ |
| AC-11 | 500 qism qurish < 8000 ms (Node) | ✅ |
| AC-12 | **500 qism ≥ 60 FPS (brauzer)** | ⚠️ **qo'lda** |
| AC-13 | `VITE_ASSEMBLY_ENABLED=false` da UI'da assembly yo'q | ✅ |
| AC-14 | Manufacturing-ready da'vosi UI/hujjatda yo'q | ✅ (matn tekshiruvi) |

### 14.3 Yakuniy qabul shartlari

1. AC-1…AC-11, AC-13, AC-14 — **barchasi PASS** (avtomatik).
2. AC-12 — **qo'lda o'lchangan**, natija hujjatlashtirilgan. **Agar bajarilmasa,
   W14 "to'liq" deb e'lon qilinmaydi** — "60 FPS maqsadi bajarilmadi" deb yoziladi.
3. Hech qanday mavjud test o'chirilmagan/kuchsizlantirilmagan.
4. `SCENE_SCHEMA_VERSION` **3** bo'lib qolgan.

---

## 15. Implementatsiya tartibi (kichik vazifalar + testlar)

Har qadam **mustaqil** bajariladi va **commit** qilinadi.

| # | Vazifa | Fayllar | Testlar | Bog'liq |
|---|---|---|---|---|
| **14.1** | Ma'lumot modeli | `scene/types.ts` (`SceneAssembly`, `SceneObject.assemblyId`, `SceneData.assemblies?`), `scene/sceneValidation.ts` | `sceneValidation.test.ts` (+6) | — |
| **14.2** | Flag va limitlar | `assemblies/flag.ts`, `assemblies/limits.ts` | `limits.test.ts` (+5) | 14.1 |
| **14.3** | Parametr sxemalari | `assemblies/params.ts` (4 tur) | `params.test.ts` (+20) | 14.2 |
| **14.4** | Constraintlar | `assemblies/constraints.ts` (7 tur) | `constraints.test.ts` (+21) | 14.3 |
| **14.5** | Grafik | `assemblies/graph.ts` | `graph.test.ts` (+10) | 14.4 |
| **14.6** | ASM-1 builder | `assemblies/buildKitchenBaseRun.ts` | `buildKitchen.test.ts` (+10) | 14.5 |
| **14.7** | ASM-2 builder | `assemblies/buildWallCabinet.ts` | `buildWallCabinet.test.ts` (+10) | 14.6 |
| **14.8** | ASM-3 builder | `assemblies/buildWardrobeSection.ts` | `buildWardrobeSection.test.ts` (+10) | 14.7 |
| **14.9** | ASM-4 builder | `assemblies/buildStairStraight.ts` | `buildStair.test.ts` (+12) | 14.8 |
| **14.10** | Dispatch + index | `assemblies/index.ts` | `buildAssembly.test.ts` (+8) | 14.9 |
| **14.11** | Assembly BOM | `manufacturing/assemblyBom.ts` | `assemblyBom.test.ts` (+8) | 14.10 |
| **14.12** | Property + snapshot + perf | `assemblies/property.test.ts`, `snapshot.test.ts` | +10 | 14.11 |
| **14.13** | UI (flag ostida) | `components/AssemblyPanel.tsx`, `App.tsx` | `AssemblyPanel.test.ts` (+6) | 14.12 |
| **14.14** | Brauzer benchmark | `docs/W14_PERF_REPORT.md` (qo'lda) | — | 14.13 |

**Jami:** ~14 qadam, **~146 yangi test** (471 → ~617).

Har qadamdan keyin: `npm test` + `oxlint` + `typecheck` + `build`; backend
o'zgarmasa ham `pytest` (regressiya).

---

## 16. Yopilgan qarorlar (D-ro'yxati)

| ID | Qaror | Sabab |
|---|---|---|
| **D1** | Eshik/deraza qayta qilinmaydi; 4-assembly = `stair-straight` | W6 da bor (`types.ts:41`, `buildRoom.ts:129`) |
| **D2** | `SceneObjectType` kengaytirilmaydi; `SceneAssembly` alohida | 8-tur invariantlari saqlanadi |
| **D3** | Ko'p xonali sahna W14 da **yo'q** | Scope creep; migration risk |
| **D4** | Viewer assembly-specific renderer **yo'q** | Mavjud viewer o'zgarmaydi |
| **D5** | "Solver" emas — deterministik constraint tekshiruvi | Test qilinadi, bashorat qilinadi |
| **D6** | Assembly a'zolari **hosil qilinadi**, saqlanmaydi | Backend `MAX_OBJECTS=500` |
| **D7** | `SCENE_SCHEMA_VERSION` **3** bo'lib qoladi | Versiya informatsion (`sceneValidation.ts:255`) |
| **D8** | Yangi `buildAssemblyBom`, `buildBom` o'zgarmaydi | 471 test + `ManufacturingPanel.tsx:41` |
| **D9** | GLB eksport assembly'ni qo'llamaydi | A'zolar obyekt emas (D6) |
| **D10** | `fast-check` qo'shilmaydi; qo'lda generator | Dependency xavfi |
| **D11** | 60 FPS faqat brauzer benchmarki; Node testi emas | `vite.config.ts:7` (node env) |

---

## 17. Ochiq masalalar (OPEN DECISION)

| ID | Savol | Ta'sir | Tavsiya |
|---|---|---|---|
| **OD-1** | Assembly'lar **backend'da** saqlanadimi? | Agar ha — `scene_payload.py` o'zgaradi, `assemblies` maydoni validatsiyasi kerak | **Ha**, lekin `MAX_ASSEMBLIES_PER_SCENE=20` bilan. `scene_payload.py` faqat struktura tekshiradi (mavjud naqsh) |
| **OD-2** | Assembly UI'da **qanday** ko'rinadi? Panelmi, obyekt ro'yxatida guruhmi? | UI qamrovi | W14 minimal: `AssemblyPanel` — faqat yaratish/o'chirish; tahrirlash keyingi |
| **OD-3** | Assembly'ni **AI** bilan yaratish (promptdan) | W15 ga tegishli | **W15** da |
| **OD-4** | Zinapoya **xavfsizlik** diapazoni qaysi standartga asoslanadi? | `riseCm ∈ [15,20]` — qayerdan? | **Tekshirilishi kerak**: mahalliy qurilish normalari. Hozircha "umumiy qabul qilingan" deb belgilanadi, sertifikat emas |
| **OD-5** | Assembly **narxi** (BOM + narx) | W20 ga tegishli | **W20** da |
| **OD-6** | 500 qism benchmark uchun **aniq qurilma** | AC-12 o'lchanadi | Implementatsiya boshlanganda sizning qurilmangizda; natija hujjatlashtiriladi |

---

## 18. Implementatsiyaga tayyorlik

| Bo'lim | Holat |
|---|---|
| Maqsad/scope | ✅ aniq |
| 4 assembly ta'rifi | ✅ aniq (D1) |
| Ma'lumot modeli | ✅ aniq (D2, D6) |
| Builder API | ✅ aniq (5.3) |
| Constraint turlari | ✅ aniq (6.3) |
| Rekursiya chegaralari | ✅ aniq (7.2) |
| Backward compatibility | ✅ aniq (8) |
| Schema migratsiyasi | ✅ **kerak emas** (D7) |
| Manufacturing/export | ✅ yondashuv aniq (D8, D9) |
| Test strategiyasi | ✅ aniq (10) |
| 60 FPS usuli | ✅ aniqlangan, lekin **qo'lda** (D11) |
| Self-intersection doirasi | ✅ aniq (12.2) |
| Feature flag/rollback | ✅ aniq (13) |
| Acceptance criteria | ✅ 14 ta, 13 avtomatik |
| Implementatsiya tartibi | ✅ 14 qadam |

### **Xulosa: W14 rejasi implementatsiyaga TAYYOR** — 6 ta OPEN DECISION bor,
lekin ularning barchasi **implementatsiya jarayonida** hal qilinishi mumkin
(OD-1 va OD-2 birinchi qadamda, OD-4 hujjatlashtirish bilan, OD-3/OD-5 keyingi
bosqichlarga tegishli).

**Tavsiya:** OD-1 (backend saqlash) va OD-2 (UI shakli) bo'yicha qarorni
**14.1 qadamidan oldin** olish kerak. Qolganlari yo'lni bloklamaydi.
