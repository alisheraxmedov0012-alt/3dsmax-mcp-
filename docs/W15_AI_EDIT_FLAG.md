# W15 — AI tahrirlash feature flag va rollback

> **Holat: qo'llanma.** Bu hujjat hech qanday hosting sozlamasini o'zgartirmaydi va
> production deploy haqida gapirmaydi.

## 1. Flag

| Element | Qiymat |
|---|---|
| Nomi | `VITE_AI_EDIT_ENABLED` |
| Standart | **o'chiq** (o'zgaruvchi yo'q bo'lsa ham o'chiq) |
| Yoqadi | faqat aniq `true` (bo'sh joy va registr e'tiborga olinmaydi) |
| O'chiq qoldiradi | `false`, `0`, `1`, `yes`, `on`, `''`, bo'sh joy, o'rnatilmagan |

Parsing `src/ai/editFlag.ts` da markazlashgan (`parseFlagValue`). `Boolean(...)`
ataylab ishlatilmaydi: `Boolean('false') === true` bo'lardi, ya'ni rollback
uchun yozilgan qiymat funksiyani **yoqib** yuborardi.

```ts
parseFlagValue('true')  // true
parseFlagValue('false') // false
parseFlagValue('')      // false
parseFlagValue(undefined) // false
```

## 2. Nima boshqariladi

| Flag | Xatti-harakat |
|---|---|
| o'chiq | `AiEditPanel` DOM'ga **umuman** chiqmaydi (`return null`), ya'ni taklif yaratish, tasdiqlash va undo/redo tugmalari foydalanuvchiga ko'rinmaydi |
| yoqiq | W15.9 paneli to'liq ishlaydi: `buildDiff` → `applyDiff` → revision → `useSceneHistory` |

Flag **faqat UI** ni boshqaradi. Sahna, saqlangan loyihalar, eksport, viewer,
klaviatura shortcut'lari va history mexanizmi flag'dan qat'i nazar bir xil
ishlaydi. Flag **xavfsizlik chegarasi emas**: `applyDiff`ning validatsiya va
atomiklik tekshiruvlari flag holatiga bog'liq emas.

## 3. Local development

```bash
# Yoqish
VITE_AI_EDIT_ENABLED=true npm run dev
# yoki .env.local faylida:  VITE_AI_EDIT_ENABLED=true

# O'chirish
VITE_AI_EDIT_ENABLED=false npm run dev
# yoki .env.local dan qatorni olib tashlash
```

Dev server `VITE_*` qiymatlarini ishga tushishda o'qiydi; qiymatni o'zgartirgach
serverni qayta ishga tushirish kerak.

## 4. Preview / build

```bash
VITE_AI_EDIT_ENABLED=true npm run build     # flag yoqilgan bundle
VITE_AI_EDIT_ENABLED=false npm run build    # flag o'chirilgan bundle
npm run preview                              # hosil bo'lgan bundle'ni ko'rish
```

## 5. Rollback (production deploy qilmasdan tekshirish)

`VITE_*` qiymatlari **build vaqtida** bundle ichiga yoziladi. Runtime'da
o'zgartirish avtomatik ishlamaydi — yangi build kerak.

| Daraja | Amal | Natija |
|---|---|---|
| **R0** | `VITE_AI_EDIT_ENABLED=false` bilan qayta build | Panel butunlay yo'qoladi; kod qoladi |
| **R1** | `App.tsx` dan `<AiEditPanel>` ni olib tashlash | Faqat UI yo'qoladi |
| **R2** | Commit'ni revert qilish | To'liq qaytarish |

Rollbackni deploy qilmasdan tekshirish:

```bash
VITE_AI_EDIT_ENABLED=false npm run build
npx vite preview --port 4173
# brauzerda: panel ko'rinmasligi kerak
```

Bu **lokal preview** — hech qanday hosting yoki production muhit
o'zgartirilmaydi.

## 6. Mavjud foydalanuvchi ma'lumotlariga ta'sir

Flag o'chirilishi:

- sahnani o'zgartirmaydi;
- saqlangan loyihalarni o'zgartirmaydi (`SceneData` sxemasi tegilmagan);
- history'ni tozalamaydi yoki o'zgartirmaydi;
- undo/redo klaviatura shortcut'larini o'chirmaydi.

Ya'ni foydalanuvchi flag yoqilganda qilgan AI tahrirlari saqlangan loyihada
qolaveradi; faqat panel ko'rinmaydi.
