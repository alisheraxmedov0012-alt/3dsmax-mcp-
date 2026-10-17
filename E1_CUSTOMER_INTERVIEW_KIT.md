# E1 — Customer Interview Kit (furniture workshops, Uzbekistan)

> **Holat: TAYYORGARLIK. Hech qanday intervyu hali o'tkazilmagan.**
> Bu hujjat faqat tadqiqot vositasini belgilaydi. Unda ishtirokchilar, javoblar,
> iqtiboslar yoki natijalar **yo'q** — ular faqat haqiqiy suhbatlardan keyin
> to'ldiriladi (9-bo'limdagi jadval).
>
> **Bog'liq hujjatlar:** `MARKET_VALIDATION_V1_V6.md` (§7 E1, §10 darvozalar),
> `MASTER_PRODUCT_SPEC.md` (§2 personajlar, §7 validatsiya rejasi),
> `RISK_REGISTER.md` (R-13 bozor talabi, R-16 AI xarajati, R-17 to'lov).
>
> **Repository holati:** `integration/w1-w12` @ `01f22dc97277f99002546fce6cdc49bc95a4aea7`.

---

## 1. Tadqiqot maqsadi

**Asosiy savol:** O'zbekistondagi mebel ustaxonalari o'z ish oqimida *haqiqatan*
sezilarli muammoga duch keladimi — va bu muammo taklif etilayotgan mahsulot
hal qila oladigan turdagi muammomi?

**Nima o'lchanadi (kuzatiladigan xatti-harakat, fikr emas):**

1. Oxirgi haqiqiy buyurtma boshidan oxirigacha qanday bajarilgan.
2. Qaysi vositalar ishlatilgan (qog'oz, Excel, SketchUp/AutoCAD, telefon, hech narsa).
3. Qaysi bosqich eng ko'p vaqt olgan (daqiqa/soat bilan).
4. Oxirgi 3 oyda qanday xatolar va qayta ishlashlar bo'lgan.
5. Material miqdori va kesish o'lchamlari qanday hisoblangan.
6. Chizma va o'zgarishlar ishlab chiqarishga qanday yetkazilgan.
7. Muammoning narxi: vaqt, material, yo'qotilgan buyurtma.
8. Allaqachon sinalgan yechimlar.
9. Dasturiy ta'minot xaridi bo'yicha qaror kimda va byudjet qanday tasdiqlanadi.

**Nima o'lchanmaydi (bu intervyuning maqsadi emas):**

- AI yoqadimi-yo'qmi degan fikr.
- "Agar shunday mahsulot bo'lsa, sotib olasizmi?" degan gipotetik savol.
- Umumiy bozor hajmi yoki daromad prognozi.

**Muvaffaqiyat mezoni (bu tadqiqot uchun):** 10–12 suhbatdan keyin biz
**dalilga asoslangan** javob bera olamiz: muammo bormi, qanchalik qimmatga tushadi
va ustaxona buni hal qilish uchun pul sarflaydimi.

> **Muhim:** bu 10–12 suhbat **statistik reprezentativ namuna emas**. Bu sifatli
> tadqiqot (qualitative discovery). Natijalar "bozorning X%" deb umumlashtirilmaydi.

---

## 2. Ishtirokchilarni tanlash

### 2.1 Maqsadli profillar

| Profil | Tavsif | Nima uchun kerak | Tavsiya etilgan son |
|---|---|---|---|
| **P1 — Ustaxona egasi** | 1–20 xodimli xususiy ustaxona; qarorni o'zi qabul qiladi | Xarid qarori va byudjet egasi | 4–5 |
| **P2 — Boshqaruvchi / sex mudiri** | Egasi emas, lekin ishlab chiqarishni boshqaradi | Haqiqiy ish oqimini biladi, eganing fikrini takrorlamaydi | 2–3 |
| **P3 — Dizayner / konstruktor** | Chizma va o'lchamlarni tayyorlaydi | Eng ko'p vaqt sarflanadigan bosqichni ko'rsatadi | 3–4 |
| **P4 — Tajribali usta (stanok/kantselyariya)** | Chizmani qog'ozdan o'qiydi, kesadi | Chizma amalda ishlaydimi-yo'qmi, faqat shu odam aytadi | 2–3 |

**O'lcham bo'yicha taqsimot (tavsiya):**

| Ustaxona hajmi | Tavsiya etilgan son |
|---|---|
| Kichik (1–5 xodim) | 4–5 |
| O'rta (6–20 xodim) | 4–5 |
| Kattaroq (20+ xodim) | 2–3 |

**Geografiya (tavsiya):** Toshkent — 6–7, bitta viloyat markazi — 4–5
(masalan Samarqand yoki Namangan). Bir shaharda qolib ketish natijalarni
buzadi.

### 2.2 Screening savollari (telefon yoki Telegram orqali, 2–3 daqiqa)

Suhbatga taklif qilishdan oldin quyidagilarni aniqlang. **Mahsulot haqida gapirmang.**

1. Ustaxonangizda nechta odam ishlaydi?
2. Sizning rolingiz nima — egasimisiz, boshqaruvchimisiz, dizaynermisiz, ustamisiz?
3. Oxirgi 30 kunda nechta buyurtma bajarildi?
4. Buyurtma bo'yicha chizma yoki o'lchamlar kim tomonidan tayyorlanadi?
5. Mebel **buyurtma asosida** (individual o'lcham) tayyorlanadimi yoki tayyor
   modellarmi?
6. Kesish ro'yxati (qaysi detal qanday o'lchamda kesiladi) kim tomonidan
   tayyorlanadi?

**Skrining mezonlari:**

- **Qabul:** individual o'lchamdagi buyurtmalar bilan ishlaydi **va**
  chizma/kesish ro'yxati jarayoni mavjud.
- **Rad etish:** faqat tayyor standart mebel sotadi (individual o'lcham yo'q).
- **Rad etish:** 30 kunda 0 buyurtma (tajriba yo'q).

### 2.3 Rekrutment rejasi (10–12 suhbat uchun)

| Manba | Usul | Kutilgan natija |
|---|---|---|
| Shaxsiy tarmoq | Tanish orqali kirish — **lekin** 2 tadan oshmasin | 2 |
| Mebel bozorlari / ko'rgazmalar | Jismoniy tashrif, qisqa suhbat, vizitka | 3–4 |
| Telegram biznes guruhlari | Ehtiyotkor e'lon + shaxsiy xabar | 2–3 |
| Instagram / Facebook orqali ustaxonalar | Profil orqali to'g'ridan-to'g'ri xabar | 2–3 |
| Tanish orqali tavsiya (referral) | Har bir ishtirokchidan 1 ta tavsiya so'rash | 2–3 |

**Reja:** 25–30 ta odam bilan bog'lanish → 10–12 tasi bilan suhbat (taxminan
40% javob darajasi kutiladi — bu **taxmin**, tasdiqlangan ko'rsatkich emas).

### 2.4 Tanlab olish tarafkashligini qanday kamaytirish

| Xavf | Chora |
|---|---|
| Faqat do'stlar bilan suhbat | Shaxsiy tarmoqdan maksimum **2 ta**; qolganlari sovuq outreach |
| Faqat AI ga qiziqqanlar | Suhbat boshida AI yoki mahsulot **umuman tilga olinmaydi**; taklif matni "tadqiqot" deb yozilgan |
| Faqat katta ustaxonalar | Kamida 4 ta kichik (1–5 xodim) ustaxona |
| Faqat Toshkent | Kamida 4 ta viloyatdan |
| Faqat muvaffaqiyatli ustaxonalar | Kamida 2 ta "qiyin davr"dagi ustaxona (agar topilsa) |
| Faqat egalar | Kamida 4 ta suhbat egasi bo'lmagan rol bilan (P2/P3/P4) |

**Qayd etish:** har bir ishtirokchi uchun **qanday topilgani** yoziladi
(shaxsiy tarmoq / sovuq / referral). Tahlil paytida bu omil hisobga olinadi.

---

## 3. Intervyu skripti (o'zbek tilida, 15–25 daqiqa)

> **Muhim qoidalar tadqiqotchiga:**
> 1. **Mahsulotni birinchi 12–15 daqiqada tilga olmang.** Bu eng muhim qoida.
> 2. **Gipotetik savol bermang** ("agar shunday dastur bo'lsa..."). Faqat
>    **o'tmishdagi haqiqiy xatti-harakat** haqida so'rang.
> 3. **Yo'naltiruvchi savol bermang** ("chizma tayyorlash qiyin, to'g'rimi?").
>    Buning o'rniga: "oxirgi marta qanday bo'ldi?".
> 4. **Jim turing.** Javobdan keyin 3–4 soniya kuting — odam ko'pincha eng
>    muhim narsani o'sha paytda aytadi.
> 5. **Yozib olishga ruxsat so'rang.** Ruxsat bo'lmasa — faqat qo'lda qayd.
> 6. **Maslahat bermang, mahsulotni sotmang.** Siz o'rganyapsiz, sotyapsiz emas.

### 3.0 Kirish (1–2 daqiqa)

> "Assalomu alaykum, vaqtingiz uchun rahmat. Men [ism], mebel sohasida ishlab
> chiqarish jarayonini o'rganyapman — ya'ni ustaxonalar buyurtmani qanday
> bajarishini tushunishga harakat qilyapman. Bu **tadqiqot**, mahsulot sotish
> emas. Savollar oxirgi ishlaringiz haqida bo'ladi.
>
> Suhbat 15–25 daqiqa oladi. Javoblaringiz **anonim** — hisobotda ismingiz va
> ustaxona nomi ko'rsatilmaydi. Yozib olsam maylimi? Xohlamasangiz, faqat
> qo'lda yozaman.
>
> Boshlashdan oldin: sizga qanday murojaat qilsam bo'ladi, va ustaxonada
> qanday rolni bajarasiz?"

### 3.1 Ishlash konteksti (2 daqiqa)

1. Ustaxonangizda nechta odam ishlaydi va ular qanday rollarda?
2. Asosan qanday mebel tayyorlaysiz — oshxona, shkaf, yumshoq mebel, ofis?
3. Buyurtmalar asosan individual o'lchamdami yoki tayyor modellarmi?
4. Bir oyda taxminan nechta buyurtma bajarasiz?

### 3.2 Oxirgi haqiqiy buyurtma — batafsil yurish (6–8 daqiqa) **[eng muhim qism]**

> "Endi oxirgi bajargan buyurtmangizni boshidan oxirigacha birga ko'zdan
> kechiramiz. Iltimos, aniq bitta buyurtmani tanlang — yaxshisi yaqinda
> bo'lgani."

5. Bu buyurtma nima edi? Kim buyurtma qildi?
6. Mijoz bilan birinchi gaplashganda o'lchamlar qanday olindi?
7. O'lchamlar qayerda yozildi — daftar, telefon, Excel, chizma?
8. Keyin nima bo'ldi? Keyingi qadam nima edi?
9. Chizma kerak bo'ldimi? Kim chizdi?
10. Chizma qanday tayyorlandi — qo'lda, qog'ozda, dasturda? Qaysi dasturda?
11. Material kerak bo'lgan miqdor qanday hisoblandi?
12. Kesish o'lchamlari (qaysi detal qanday o'lchamda) qanday aniqlandi?
13. Bu ma'lumot ustaga qanday yetkazildi — qog'oz, og'zaki, telefon, boshqa?
14. Usta chizmani qanday tushundi? Savollar bo'ldimi?
15. Buyurtma davomida o'zgarish bo'ldimi? Nima o'zgardi va nima uchun?
16. O'zgarish ishlab chiqarishga qanday yetkazildi?

**Kuzatish uchun (yozib oling):** har bir qadamda **vaqt**, **kim bajaradi**,
**qaysi vosita**, **qayerda uzilish bo'ladi**.

### 3.3 Vaqt va xatolar (3–4 daqiqa)

17. Shu buyurtmada eng ko'p vaqt nimaga ketdi? Taxminan qancha?
18. Oxirgi 3 oyda qanday xato bo'ldi — noto'g'ri o'lcham, noto'g'ri kesim,
    material yetishmasligi?
19. Eng oxirgi xato qanday bo'ldi? Nima bo'ldi?
20. Uni tuzatish uchun nima qilindi va qancha vaqt/material ketdi?
21. Bunday xatolar qanchalik tez-tez bo'ladi — har buyurtmada, oyda bir marta,
    kamdan-kam?
22. Xato mijozga yetib borgan holat bo'lganmi? Nima bo'ldi?

### 3.4 Pul va vositalar (2–3 daqiqa)

23. Hozir qanday dasturlar ishlatasiz? Qaysi biri pullik?
24. Pullik dasturga oyiga/yiliga qancha to'laysiz? (Agar to'lasangiz.)
25. Dastur uchun to'lovni kim tasdiqlaydi? Qanday qaror qabul qilinadi?
26. Agar biror ishni autsors qilsangiz (chizma, dizayn) — kimga va qancha?
27. Yangi dastur xarid qilishda nima muhim — narx, o'zbek tili, osonligi,
    kimdir tavsiya qilganmi?

### 3.5 Sinalgan yechimlar (1–2 daqiqa)

28. Bu ishlarni osonlashtirish uchun nima sinab ko'rgansiz?
29. Nima uchun u ishlamadi yoki tashlab yubordingiz?

### 3.6 Yakunlash (1 daqiqa)

30. Agar bu jarayonda bitta narsani o'zgartira olsangiz, nima bo'lardi?
31. Bu haqda boshqa kim bilan gaplashishim kerak deb o'ylaysiz?
    (referral)

> **Keyin** 4-bo'limga (konsept testi) o'ting — **faqat** yuqoridagi ish oqimi
> to'liq yozib olingandan keyin.

---

## 4. Konsept testi (faqat ish oqimi yozilgandan keyin, 4–6 daqiqa)

> **Ogohlantirish tadqiqotchiga:** quyidagi konsept **hali to'liq ishlamaydi**.
> Buni ochiq ayting. Tayyor mahsulot yoki mavjud mijozlar borligini aytmang.

### 4.1 Konseptni taqdim etish (so'zma-so'z o'qish mumkin)

> "Endi bitta g'oyani ko'rsataman — bu hali mahsulot emas, faqat konsept.
> Ba'zi qismlari hali ishlamaydi.
>
> G'oya shunday: siz o'lchamlarni kiritasiz yoki mebelni o'zbek yoki rus tilida
> tasvirlaysiz — masalan «180 sm keng, 3 eshikli shkaf». Tizim tahrirlanadigan
> parametrik model yaratadi. Siz o'lchamlarni o'zgartirsangiz, model ham
> o'zgaradi. Keyin tizim kesish ro'yxati va chizma chiqaradi — ustaga berish
> uchun. Natijani fayl sifatida yuklab olsa bo'ladi.
>
> Bu sizning ishingizga qanday mos keladi yoki mos kelmaydi — shuni bilmoqchiman."

### 4.2 Reaksiya savollari

32. Bu tasvirda sizning ishingizdagi qaysi qadamga to'g'ri keladi?
33. Qaysi qadam **yo'q** yoki noto'g'ri tasvirlangan?
34. Sizning ishingizda bu **ishlamaydigan** narsa nima bo'lardi?
35. Chizma va kesish ro'yxati qanday ko'rinishda bo'lishi kerak —
    qanday format, qanday til, qanday o'lchov birligi?
36. Ustangiz buni qabul qilishi uchun nima kerak?
37. Bunga o'tish uchun sizdan nima talab qilinadi — o'qish, vaqt, boshqa narsa?
38. Buni ishlatmaslik uchun eng katta sabab nima bo'lardi?

### 4.3 Nima uchun bu savollar muhim

Biz **"yoqdi/yoqmadi"** ni emas, **"qaysi talab yetishmaydi"** ni qidiramiz.
Masalan: o'lchov birligi (mm yoki sm), chizma tili (o'zbek/rus), qog'ozga
chiqarish zarurati, telefon ekranida ko'rish, material navi (DSP/MDF massiv),
kromka (qirra) hisobi — bularning barchasi mahsulot talabiga aylanadi.

---

## 5. To'lovga tayyorlikni o'rganish

> **Qoida:** bu bo'limda **hech qanday narx taklif qilinmaydi**. Narx keyingi
> bosqichda (E3) alohida sinovdan o'tadi. Bu yerda faqat **hozirgi xarajat** va
> **qaror mexanizmi** o'rganiladi.

### 5.1 Hozirgi xarajat (fakt)

39. Oxirgi 12 oyda dasturiy ta'minotga qancha sarfladingiz? (aniq raqam so'rang,
    taxmin emas)
40. Chizma/dizayn uchun autsorsga qancha to'lagansiz?
41. Xatolar tufayli yo'qotilgan material yoki qayta ishlash qancha turdi?
    (oxirgi aniq holat bo'yicha)

### 5.2 Qaror mexanizmi (fakt)

42. Yangi dastur sotib olish qarorini kim qabul qiladi?
43. Qaror qabul qilish uchun kim bilan maslahatlashasiz?
44. Byudjet qanday tasdiqlanadi — o'zingiz, sherik, buxgalter, boshqa?
45. Yillik to'lovmi yoki oylikmi — qaysi biri qulayroq va nima uchun?
46. To'lov qanday amalga oshiriladi — naqd, karta, bank o'tkazmasi, Payme/Click?
47. Hisob-faktura (invoice) kerakmi? Soliq hisobi uchun hujjat kerakmi?

### 5.3 Dalil kuchi (stated interest ≠ evidence)

Javoblarni quyidagi shkalada baholang. **Faqat 3–4-daraja haqiqiy dalil:**

| Daraja | Turi | Nima degani |
|---|---|---|
| **0** | Umumiy fikr | "Yaxshi g'oya ko'rinadi" — **dalil emas** |
| **1** | Shartli qiziqish | "Agar ishlasa, qiziqarli bo'lardi" — **dalil emas** |
| **2** | Aniq ehtiyoj bayoni | "Menga shu kerak, hozir qiyin" — **zaif dalil** |
| **3** | Harakat va'dasi | "Pilotda qatnashaman", "keyingi hafta qo'ng'iroq qiling" — **o'rtacha dalil** |
| **4** | Haqiqiy majburiyat | Qaror qabul qiluvchini tanishtirdi, sinov uchun vaqt ajratdi, real to'lov qildi — **kuchli dalil** |

> **Diqqat:** 0–1 daraja javoblar ko'p bo'lishi normal. Ular "bozor bor" degani
> emas. Faqat 3–4 darajadagi harakatlar hisobga olinadi.

---

## 6. Dalil yig'ish shabloni (har bir intervyu uchun)

> Bitta intervyu = bitta nusxa. Shaxsiy ma'lumot (telefon, aniq manzil, pasport)
> **yozilmaydi**. Faqat tadqiqot uchun zarur ma'lumot.

```markdown
### Intervyu: P__ (anonim ID)

**Sana:** ____-____-______
**Usul:** yuzma-yuz / telefon / videо
**Davomiyligi:** ____ daqiqa
**Til:** o'zbek / rus / aralash
**Yozib olindi:** ha (ruxsat bilan) / yo'q (qo'lda qayd)
**Qanday topildi:** shaxsiy tarmoq / sovuq outreach / referral

#### A. Ustaxona profili
- Xodimlar soni: ____
- Asosiy mahsulot: ______________________
- Oylik buyurtma (taxminiy): ____
- Shahar/hudud: ______________________
- Individual o'lcham ulushi: ____ %

#### B. Ishtirokchi roli
- Rol: ega / boshqaruvchi / dizayner / usta / boshqa: ______
- Tajriba (yil): ____

#### C. Hozirgi ish oqimi va vositalar
| Qadam | Kim bajaradi | Vosita | Vaqt (taxminiy) |
|---|---|---|---|
| O'lcham olish | | | |
| Chizma | | | |
| Material hisobi | | | |
| Kesish ro'yxati | | | |
| Ishlab chiqarishga uzatish | | | |
| Nazorat | | | |

- Ishlatiladigan dasturlar: ______________________
- Pullik dasturlar va taxminiy xarajat: ______________________

#### D. Aniq yaqin muammolar (oxirgi 3 oy)
| # | Nima bo'ldi | Qachon | Ta'sir (vaqt/material/pul) |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

#### E. Muammoning chastotasi va ta'siri
- Chastota: har buyurtmada / oyda ____ marta / kamdan-kam
- Oxirgi holatda yo'qotilgan vaqt: ____ soat
- Oxirgi holatda yo'qotilgan material: ____ (miqdor/pul)
- Yo'qotilgan buyurtma bo'lganmi: ha / yo'q — izoh: ______

#### F. Hozirgi yechimlar va sarf
- Sinalgan yechimlar: ______________________
- Nima uchun tashlandi: ______________________
- Chizma/dizayn autsorsi: ha / yo'q — summa: ______
- Dasturiy ta'minotga yillik sarf: ______

#### G. Iqtiboslar (faqat haqiqatan yozib olingan bo'lsa)
> "________________________________________" — [kim, kontekst]

> "________________________________________" — [kim, kontekst]

*Agar yozib olinmagan bo'lsa: "Iqtibos yozib olinmagan."*

#### H. Konseptga reaksiya
- Mos keladigan qadam: ______________________
- Yetishmayotgan talab: ______________________
- Ishlamaydigan joy: ______________________
- Ustaga qabul qilish uchun kerak: ______________________

#### I. Qabul qilishdagi to'siqlar
| To'siq | Jiddiyligi (1–5) | Izoh |
|---|---|---|
| | | |

#### J. Xarid qilish vakolati va to'lov dalili
- Qaror qiluvchi: ______________________
- Byudjet tasdiqlash: ______________________
- To'lov usuli: naqd / karta / o'tkazma / Payme-Click / boshqa
- Invoice kerakmi: ha / yo'q
- **Dalil darajasi (0–4):** ____
- Dalil izohi: ______________________

#### K. Follow-up ruxsati
- Keyin bog'lanish mumkinmi: ha / yo'q
- Qaysi bosqichda: pilot / narx testi / MVP demo
- Kim bilan bog'lanish (rol): ______________________

#### L. Ishonch va ochiq savollar
- Ishonch darajasi (1–5): ____
  (past = ishtirokchi ehtiyotkor javob berdi yoki savollarni tushunmadi)
- Ochiq savollar / keyingi safar so'rash kerak:
  1. ______________________
  2. ______________________

#### M. Tadqiqotchi izohi (interpretatsiya — fakt emas)
________________________________________________
```

---

## 7. Tahlil va qaror mezonlari

### 7.1 Dalil turlarini ajratish (majburiy)

Har bir topilma **albatta** quyidagi toifalardan biriga kiritiladi:

| Toifa | Ta'rif | Misol |
|---|---|---|
| **E1 — Kuzatilgan fakt** | Ishtirokchi aniq raqam yoki aniq hodisa aytdi | "Oxirgi shkafda 2 soat chizma, 1 soat kesish ro'yxati" |
| **E2 — Ishtirokchi fikri** | Fikr, baho, umumlashtirish | "Chizma qilish zerikarli ish" |
| **E3 — Tadqiqotchi izohi** | Tadqiqotchining talqini | "Bu ustaxonada chizma jarayoni asosan og'zaki" |
| **E4 — Tekshirilmagan gipoteza** | Hali dalil yo'q | "Katta ustaxonalar ko'proq to'laydi" |

**Qoida:** hisobotda E3 va E4 **hech qachon** E1 kabi taqdim etilmaydi.

### 7.2 Takrorlanuvchi naqshlarni aniqlash

Har bir intervyudan keyin quyidagi jadval to'ldiriladi (kodlash jadvali):

| Kod | Topilma | Intervyu ID'lari | Chastota | Dalil turi |
|---|---|---|---|---|
| T1 | Chizma qo'lda/qog'ozda tayyorlanadi | | __/__ | E1 |
| T2 | Kesish ro'yxati Excel yoki daftarda | | __/__ | E1 |
| T3 | O'lcham xatosi tufayli qayta ishlash | | __/__ | E1 |
| T4 | O'zgarish og'zaki yetkaziladi | | __/__ | E1 |
| T5 | Dasturiy ta'minotga pul sarflanmaydi | | __/__ | E1 |
| T6 | Chizma autsors qilinadi | | __/__ | E1 |
| T7 | Til to'sig'i (rus/ingliz dasturlar) | | __/__ | E1 |
| T8 | Telefon ekranida ishlash zarurati | | __/__ | E1 |

**Naqsh mezoni:** bir topilma **kamida 6 ta intervyuda** mustaqil ravishda
takrorlansa — "takrorlanuvchi naqsh" deb hisoblanadi. Bu **taklif etilgan
qoida**, sanoat standarti emas.

### 7.3 Dastlabki qaror chegaralari (TAKLIF ETILGAN qoidalar)

> **Diqqat:** quyidagi raqamlar `MARKET_VALIDATION_V1_V6.md` §7 E1 bilan mos.
> Ular **taklif etilgan qaror qoidalari**, tasdiqlangan benchmark emas.
> Intervyu soni o'zi GO uchun asos bo'lmaydi.

| Qaror | Shart (taklif) |
|---|---|
| **DAVOM ETISH (GO signal)** | 10 ta intervyudan ≥6 tasi chizma/kesish ro'yxatini **top-3 xarajat** deb ataydi **VA** ≥5 tasi hozir dastur yoki autsorsga pul sarflaydi **VA** ≥5 tasi pilotga rozi bo'ladi |
| **QAYTA KO'RIB CHIQISH (CONDITIONAL)** | Muammo tan olinadi (≥6), lekin to'lov dalili zaif (<3 ta 3–4-daraja) → segment yoki taklifni o'zgartirish |
| **RAD ETISH (NO-GO signal)** | ≤3 ta intervyu muammoni jiddiy deb ataydi **YOKI** ish oqimi allaqachon to'liq avtomatlashtirilgan |
| **TO'XTATISH (metodologik)** | 5 tadan keyin bir xil javoblar takrorlanmayapti → savolnoma yoki segmentni qayta ko'rib chiqish |

**Qo'shimcha himoya:** agar 10 ta intervyuning **4 tadan ko'pi** shaxsiy tarmoqdan
topilgan bo'lsa, natija **ishonchsiz** deb belgilanadi va sovuq outreach bilan
qo'shimcha 3–5 suhbat talab qilinadi.

### 7.4 Nima GO hisoblanmaydi

- "Ko'pchilikka g'oya yoqdi" — fikr, dalil emas.
- "10 kishi intervyu berdi" — bu faqat namuna hajmi.
- "Hamma AI haqida eshitgan" — mahsulot bilan bog'liq emas.
- "Raqobatchilar bor" — bozor borligini ko'rsatadi, bizning o'rin borligini emas.

---

## 8. Outreach xabari (o'zbek tilida)

> Quyidagi matn **hech qanday mavjud mahsulot, mijoz yoki hamkorlikni**
> ko'rsatmaydi. Faqat tadqiqot taklifi.

### 8.1 Telegram / WhatsApp uchun (qisqa)

```
Assalomu alaykum, [Ism] aka/opa!

Men [Ism Familiya], mebel ishlab chiqarish jarayonini o'rganyapman —
xususan ustaxonalar buyurtmani qabul qilishdan tortib tayyorlashgacha
qanday ishlashini tushunmoqchiman.

Bu tijoriy taklif emas, sotuv emas — oddiy tadqiqot. 15–25 daqiqa
vaqtingizni so'ramoqchiman: oxirgi buyurtmalaringiz qanday bajarilgani
haqida gaplashsak.

Ismingiz va ustaxona nomingiz hech qayerda ko'rsatilmaydi.
Qulay vaqtni aytsangiz, men moslashaman.

Rahmat!
```

### 8.2 Instagram / Facebook Direct uchun

```
Assalomu alaykum! Ustaxonangiz ishlarini ko'rib qoldim.

Men mebel ishlab chiqarish jarayoni bo'yicha tadqiqot o'tkazyapman —
sotuv emas, mahsulot taklif qilmayapman. Maqsad: ustaxonalar buyurtmani
qanday bajarishini, qayerda qiyinchilik bo'lishini tushunish.

15–25 daqiqa suhbatga vaqt topa olasizmi? Qulay kun va vaqtni aytsangiz
bo'ladi. Javoblaringiz anonim.

Rahmat!
```

### 8.3 Tanish orqali (referral) uchun

```
Assalomu alaykum, [Ism] aka!

[Kim] sizni tavsiya qildi. Men mebel ustaxonalari qanday ishlashini
o'rganyapman — bu tadqiqot, sotuv emas.

Agar 15–25 daqiqa vaqtingiz bo'lsa, oxirgi buyurtmalaringiz haqida
gaplashsak juda foydali bo'lardi. Ismingiz hisobotda ko'rsatilmaydi.

Rahmat!
```

### 8.4 Nima qilish mumkin emas (outreach'da)

- ❌ "Biz AI platforma yaratyapmiz" — mahsulot borligini bildiradi.
- ❌ "Mijozlarimiz allaqachon ishlatyapti" — yolg'on.
- ❌ "Hamkorlik taklif qilamiz" — noto'g'ri kutish yaratadi.
- ❌ Narx yoki chegirma va'da qilish.
- ❌ "Faqat 5 daqiqa" deb aytib, keyin 40 daqiqa ushlab qolish.

---

## 9. Intervyu bajarilishini kuzatish jadvali

> **Holat: barcha kataklar bo'sh — hech qanday intervyu o'tkazilmagan.**
> Har bir suhbatdan keyin to'ldiriladi. Bo'sh katak = o'tkazilmagan.

| # | ID | Sana | Rol | Ustaxona hajmi | Hudud | Manba | Davomiylik | Dalil darajasi (0–4) | Holat | Izoh |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | P01 | | | | | | | | ☐ o'tkazilmagan | |
| 2 | P02 | | | | | | | | ☐ o'tkazilmagan | |
| 3 | P03 | | | | | | | | ☐ o'tkazilmagan | |
| 4 | P04 | | | | | | | | ☐ o'tkazilmagan | |
| 5 | P05 | | | | | | | | ☐ o'tkazilmagan | |
| 6 | P06 | | | | | | | | ☐ o'tkazilmagan | |
| 7 | P07 | | | | | | | | ☐ o'tkazilmagan | |
| 8 | P08 | | | | | | | | ☐ o'tkazilmagan | |
| 9 | P09 | | | | | | | | ☐ o'tkazilmagan | |
| 10 | P10 | | | | | | | | ☐ o'tkazilmagan | |
| 11 | P11 | | | | | | | | ☐ o'tkazilmagan | |
| 12 | P12 | | | | | | | | ☐ o'tkazilmagan | |

**Jami o'tkazilgan:** 0 / 12

**Manba bo'yicha taqsimot (to'ldiriladi):**
- Shaxsiy tarmoq: 0 (maksimum 2 bo'lishi kerak)
- Sovuq outreach: 0
- Referral: 0

**Profil bo'yicha taqsimot (to'ldiriladi):**
- P1 (ega): 0
- P2 (boshqaruvchi): 0
- P3 (dizayner): 0
- P4 (usta): 0

---

## 10. Metodologik eslatmalar va cheklovlar

### 10.1 Davomiylik haqida izoh

`MARKET_VALIDATION_V1_V6.md` §7 E1 da 30–40 daqiqa taklif qilingan edi. Bu
to'plamda **15–25 daqiqali asosiy skript** berilgan, chunki ustaxona egalari
uchun uzoq suhbatga vaqt topish qiyin va rad etish darajasi yuqori bo'ladi.

**Yechim:** 3.1–3.5 bo'limlari 15–25 daqiqaga sig'adi. Agar ishtirokchi tayyor
bo'lsa va vaqt bo'lsa, 4-bo'lim (konsept) bilan birga **30–40 daqiqaga**
cho'ziladi. Bu ikki hujjat o'rtasidagi farq emas — bitta skriptning qisqa va
to'liq variantlari.

### 10.2 Bu tadqiqot nima bermaydi

| Cheklov | Sabab |
|---|---|
| Statistik reprezentativlik | 10–12 sifatli intervyu; bu kichik namuna |
| Bozor hajmi | Intervyu bozor hajmini o'lchamaydi |
| Narx validatsiyasi | Narx E3 da alohida sinovdan o'tadi |
| Konversiya darajasi | Intervyu sotib olishni o'lchamaydi |
| Raqobatchi tahlili | Bu E1 emas, `MARKET_VALIDATION_V1_V6.md` §4 |
| Mahsulot-fitness | Faqat E4 (prototip piloti) ko'rsatadi |

### 10.3 Axloqiy qoidalar

1. **Rozilik:** yozib olishdan oldin og'zaki ruxsat; xohlasa — yozmaslik.
2. **Anonimlik:** hisobotda faqat P01–P12 ID; ism, telefon, manzil yo'q.
3. **Bosim yo'q:** javob bermaslik yoki suhbatni to'xtatish huquqi.
4. **Sotuv yo'q:** suhbat davomida hech narsa sotilmaydi.
5. **Pul yo'q:** ishtirokchiga to'lov taklif qilinmaydi (aniq kelishuv bo'lmasa).
6. **Ma'lumot saqlash:** yozuvlar shifrlangan joyda; tadqiqot tugagach o'chiriladi.

### 10.4 Keyingi qadam

Barcha 10–12 intervyu tugagach:
1. 7.2 kodlash jadvali to'ldiriladi.
2. 7.3 qaror chegaralari qo'llaniladi.
3. Natija `MARKET_VALIDATION_V1_V6.md` §10 dagi darvozalar bilan solishtiriladi.
4. Qaror (GO / CONDITIONAL / NO-GO) **faqat haqiqiy dalil** asosida yoziladi.

**Hozircha:** 0 ta intervyu o'tkazilgan. Hech qanday xulosa chiqarilmagan.
