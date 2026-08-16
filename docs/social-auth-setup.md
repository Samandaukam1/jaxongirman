# Google va Apple bilan kirishni yoqish

Kod tayyor va ishlaydi. Bu hujjat faqat konsollarda qilinadigan ishlarni
sanaydi — hech qanday maxfiy kalit bu repozitoriyda saqlanmaydi va saqlanmasligi
kerak.

Sozlanmagunicha ilova buzilmaydi: Apple tugmasi iOS'da ko'rinadi, Google tugmasi
ikkala platformada ko'rinadi, va bosilganda "hozircha sozlanmagan" deb aytadi.

Tartib muhim: Google Cloud va Apple Developer'da narsalar yaratiladi, keyin
ularning qiymatlari Supabase'ga va EAS'ga kiritiladi, keyin bitta build.

---

## 1. Google Cloud Console

`console.cloud.google.com` → loyihangiz → **APIs & Services → Credentials**.

Avval **OAuth consent screen** to'ldirilgan bo'lishi kerak (ilova nomi, logo,
qo'llab-quvvatlash emaili). Aks holda client yaratib bo'lmaydi.

Uchta OAuth client kerak. **Uchalasi ham.**

### Web application

Bu eng muhimi — Supabase identity token'ni aynan shu client'ga qarab tekshiradi.

- **Authorized redirect URIs** ga qo'shing:
  `https://<supabase-project-ref>.supabase.co/auth/v1/callback`

Yaratilgach ikkita qiymat chiqadi:
- **Client ID** → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` va Supabase'ga
- **Client secret** → **faqat Supabase'ga**. Ilovaga hech qachon kiritilmaydi.

### iOS

- **Bundle ID:** `uz.jaxongirman.app`
- Client ID → `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`

### Android

- **Package name:** `uz.jaxongirman.app`
- **SHA-1 certificate fingerprint** — bu yerda ehtiyot bo'ling.

Har bir EAS build profili boshqa kalit bilan imzolanadi, ya'ni **uchta har xil
SHA-1** bor. Uchalasini ham shu bitta Android client'ga qo'shish kerak, aks
holda Google faqat bitta build turida ishlaydi va qolganlarida `DEVELOPER_ERROR`
qaytaradi — bu xato sababini aytmaydi.

SHA-1 larni olish:

```bash
cd user
npx eas credentials --platform android
# har bir profil uchun: development, preview, production
```

Client ID → `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

---

## 2. Apple Developer

`developer.apple.com` → **Certificates, Identifiers & Profiles**.

### App ID

- **Identifiers** → `uz.jaxongirman.app` ni oching
- **Sign in with Apple** capability'ni yoqing → Save

### Service ID

Supabase serverdan Apple bilan gaplashishi uchun kerak.

- **Identifiers → +  → Services IDs**
- Masalan: `uz.jaxongirman.web`
- **Sign in with Apple** → Configure:
  - Primary App ID: `uz.jaxongirman.app`
  - **Return URLs:** `https://<supabase-project-ref>.supabase.co/auth/v1/callback`

### Key

- **Keys → + → Sign in with Apple** → Configure → Primary App ID tanlang
- `.p8` faylini yuklab oling — **u faqat bir marta beriladi**
- **Key ID** va **Team ID** ni yozib qo'ying

`.p8` fayl faqat Supabase dashboard'ga kiritiladi. Repozitoriyaga ham, ilovaga
ham hech qachon qo'yilmaydi.

---

## 3. Supabase Dashboard

**Authentication → Providers**

### Google

- Enable
- **Client ID:** yuqoridagi *Web* client ID
- **Client Secret:** yuqoridagi *Web* client secret
- **Authorized Client IDs** maydoniga iOS va Android client ID larini ham
  qo'shing (vergul bilan). Native sign-in token'ni platforma client'i bilan
  imzolaydi, shuning uchun bu maydonsiz mobil kirish rad etiladi.

### Apple

- Enable
- **Client IDs:** `uz.jaxongirman.app` (App ID) va `uz.jaxongirman.web`
  (Service ID) — vergul bilan. Birinchisi mobil native kirish uchun.
- **Secret Key (for OAuth):** `.p8` faylining ichidagi matn
- **Team ID** va **Key ID**

### Redirect URLs

**Authentication → URL Configuration → Redirect URLs** — mavjudlarini
o'zgartirmang. Native kirishda brauzer ochilmaydi, shuning uchun yangi redirect
URL kerak emas. Bu ro'yxat email tasdiqlash uchun ishlaydi va o'sha holicha
qolishi kerak.

---

## 4. EAS environment variables

`expo.dev` → loyiha → **Environment variables**. Har bir muhitga
(development / preview / production) uchtasini ham qo'shing:

```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
```

Bular maxfiy emas — client ID lar ilova ichida ko'rinadi va shunday bo'lishi
kerak. Maxfiy bo'lgani faqat *client secret*, u esa Supabase'da qoladi.

Mahalliy ishlash uchun `user/.env` fayliga ham o'shalarni yozing
(`user/.env.example` dan nusxa oling).

---

## 5. iOS Info.plist — bitta qo'lda qadam

Bu loyihada `user/ios/` papkasi git'da saqlanadi. Shuning uchun EAS Build
`app.config.js` dagi `ios` bloki va plaginlarni **iOS uchun qo'llamaydi** —
native loyihaning o'zi haqiqat manbasi. (Android'da native papka yo'q, u
`app.config.js` dan generatsiya qilinadi, ya'ni Android uchun qo'shimcha ish
kerak emas.)

Ikki narsa kerak, biri allaqachon qilingan:

- ✅ **Sign in with Apple entitlement** — `Jaxongirman.entitlements` ga
  qo'shilgan. Hech narsa qilish shart emas.
- ⬜ **Google URL scheme** — client ID hali yo'qligi uchun yozib bo'lmadi.

iOS client ID ni olganingizdan keyin `user/ios/Jaxongirman/Info.plist`
faylidagi `CFBundleURLTypes` massiviga yangi `dict` qo'shing:

```xml
<dict>
  <key>CFBundleURLSchemes</key>
  <array>
    <!-- iOS client ID ning teskarisi:
         123-abc.apps.googleusercontent.com
         → com.googleusercontent.apps.123-abc -->
    <string>com.googleusercontent.apps.SIZNING-IOS-CLIENT-ID</string>
  </array>
</dict>
```

Muqobil yo'l: env o'rnatilgandan keyin `npx expo prebuild --platform ios` ni
ishga tushirish — u `app.config.js` dan shu scheme'ni o'zi yozadi. Lekin bu
`ios/` papkasini qayta yaratadi, ya'ni undagi qo'lda kiritilgan o'zgarishlar
ustidan yozilishi mumkin. Bitta `dict` qo'shish xavfsizroq.

---

## 6. Build

Native modullar qo'shilgani uchun mavjud build'lar buni ko'rmaydi — OTA
yangilanish yetarli emas.

```bash
cd user
npx expo install --fix
npx pod-install          # faqat macOS'da, iOS uchun
npx expo-doctor

eas build --profile development --platform all
```

**Android:** `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` build vaqtida o'qiladi va undan
URL scheme avtomatik yasaladi. Bo'sh bo'lsa plagin qo'shilmaydi — build o'tadi,
tugma "sozlanmagan" deydi.

**iOS:** yuqoridagi 5-bo'lim (Info.plist) bajarilgan bo'lishi kerak — `ios/`
papkasi git'da bo'lgani uchun bu avtomatik bo'lmaydi.

Ikkala holatda ham: env o'zgarsa, yangi build kerak. URL scheme binarga
kiritiladi, uni runtime'da o'zgartirib bo'lmaydi.

---

## 7. Tekshirish

Qurilmada:

1. Apple tugmasi iOS'da ko'rinadi, Android'da ko'rinmaydi
2. Birinchi Apple kirishi — ismni saqlaydi (`profiles.full_name`)
3. Ikkinchi Apple kirishi — Apple ism qaytarmaydi, saqlangan ism **o'chmaydi**
4. Google kirishi — ism va avatar token'dan keladi
5. Mavjud email/parol bilan kirish avvalgidek ishlaydi
6. Kirgandan keyin orqaga bosilsa, login ekrani qaytmaydi

Agar bir email allaqachon email/parol bilan ro'yxatdan o'tgan bo'lsa, Supabase
identity'ni bog'lash yoki rad etish qarorini o'zi qabul qiladi. Rad etilsa,
foydalanuvchi bitta jumla ko'radi: *"Bu email boshqa kirish usuli bilan
allaqachon ishlatilgan."* — provayderning xom xabari hech qachon ko'rsatilmaydi.
