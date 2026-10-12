# AGENTS.md

Ushbu hujjat ushbu repozitoriyada ishlaydigan har qanday AI agent yoki dasturchi uchun
majburiy qoidalarni belgilaydi. Qoidalar `PROJECT_PLAN.md` bilan birga o'qiladi.

## 1. Kod sifati

- Kod o'qilishi oson, kichik funksiyalar va aniq modul chegaralariga ega bo'lsin.
- Har bir o'zgarish mavjud uslub va arxitekturaga mos bo'lsin (izchillik muhim).
- Izohlar faqat kod ifodalay olmagan niyatni tushuntirsin; kodni takrorlamasin.
- O'lik kod, ishlatilmaydigan import va keraksiz abstraksiya qoldirilmasin.
- Xatolar jim yutilmasin; aniq va xavfsiz tarzda qayta ishlansin.
- Sirli ma'lumotlar (token, kalit) kodga yoki logga hech qachon yozilmasin.

## 2. Kichik va tekshiriladigan o'zgarishlar

- Har bir commit bitta mantiqiy o'zgarishga bag'ishlansin.
- Katta ish kichik, mustaqil tekshiriladigan qadamlarga bo'linsin.
- Har bir qadam yakunida tizim ishlaydigan holatda qolsin (buzuq commit qoldirilmasin).
- O'zgarish hajmi tekshirib bo'ladigan darajada kichik bo'lsin.

## 3. Testlar

- Yangi funksiya yoki xatti-harakat uchun test yozilsin yoki mavjudi yangilansin.
- Hujjat (docs) yoki konfiguratsiya o'zgarishlari uchun test talab qilinmaydi.
- Testlar real kod yo'lini sinasin; mock faqat zarur holatda va asoslanib ishlatilsin.
- Testlar o'zgarishdan oldin va keyin ishga tushirilsin; muvaffaqiyatsiz test bilan
  commit qilinmasin.
- CI yashil bo'lishi shart.

## 4. Git xavfsizligi

- `main`/`master` branchga to'g'ridan-to'g'ri push qilinmasin (alohida ko'rsatma bo'lmasa).
- O'zgarishlar alohida branchda bajarilib, Pull Request orqali birlashtirilsin.
- `git push --force` yoki `--force-with-lease` ishlatilmasin.
- `git reset --hard`, tarixni qayta yozish (rebase/amend orqali umumiy tarixni o'zgartirish)
  va boshqa branchlarni o'chirish taqiqlanadi.
- Commit qilishdan oldin `git status` va `git diff` ko'rib chiqilsin.
- Sirli fayllar (`.env`, kalitlar) va keraksiz katta fayllar commit qilinmasin.
- Push qilishdan oldin remote tarix tekshirilsin; tasdiqlanmagan holda push qilinmasin.

## 5. Mavjud branch tarixini saqlash

- `main` (va boshqa umumiy branchlar) tarixi o'zgarmas hisoblanadi.
- Mavjud commitlar qayta yozilmaydi, o'chirilmaydi va birlashtirilmaydi.
- Yangi ish faqat tarixga qo'shiladi (additive), mavjud tarix almashtirilmaydi.
- Agar tarixni o'zgartirish zarur bo'lsa, avval foydalanuvchi bilan kelishilsin.

## 6. Ish jarayoni

1. Vazifani tushunish va tegishli fayllarni o'qish.
2. Rejani qisqa belgilash (kerak bo'lsa `PROJECT_PLAN.md` roadmap bosqichiga bog'lash).
3. Kichik o'zgarishni amalga oshirish + test.
4. `git diff` tekshirish.
5. Bitta tushunarli commit.
6. Natijani hisobot qilish.

## 7. Hujjatlar

- Arxitektura yoki jarayon o'zgarsa, `PROJECT_PLAN.md` va ushbu fayl yangilansin.
- Texnologiya tavsiyalari tasdiqlanmagan bo'lsa, "mavjud" deb da'vo qilinmasin.
- 3D geometriya yaratish, AI API va brauzerdagi 3D ko'rish qatlamlari alohida ko'rib
  chiqilsin va aralashtirilmasin.
