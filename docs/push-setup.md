# Push bildirishnomalarni yoqish

Kod tayyor. Bu hujjat faqat konsollarda va terminalda bajariladigan ishlarni
sanaydi. Hech qanday maxfiy kalit bu repozitoriyda saqlanmaydi va saqlanmasligi
kerak — repozitoriy ochiq.

Sozlanmagunicha ilova buzilmaydi: bildirishnomalar ilova ichidagi ro'yxatda
avvalgidek ko'rinadi, telefonga esa hech narsa yuborilmaydi. Navbatdagi push'lar
bazada kutib turadi, sozlangandan keyin esa faqat yangilari yuboriladi (eski
navbat bir haftada o'zi tozalanadi).

## Qanday ishlaydi (qisqacha)

1. Telefon kirganda Expo push token oladi va `push_token_register` orqali
   akkauntga bog'laydi. Chiqishda token o'chiriladi.
2. `notifications` jadvaliga tushgan har bir xabar va har bir chat xabari
   `push_outbox` navbatiga yoziladi (sukutga qo'yilgan suhbatdosh bundan mustasno;
   chat matni qabul qiluvchining tilida).
3. Baza pg_net orqali `push-dispatch` funksiyasini darhol uyg'otadi, zaxira
   sifatida pg_cron har daqiqa ham uyg'otadi.
4. `push-dispatch` navbatni oladi va Expo push xizmati orqali yuboradi — u o'zi
   APNs (iOS) va FCM (Android) bilan gaplashadi. O'chirilgan ilova tokenlari
   avtomatik unutiladi.

## 1. Firebase (Android uchun majburiy)

1. https://console.firebase.google.com da loyiha yarating (yoki mavjudini oching).
2. "Add app" → Android → package nomi: `uz.jaxongirman.app`.
3. `google-services.json` faylini yuklab oling. **Repozitoriyga qo'shmang** —
   `user/.gitignore` uni allaqachon chetlab o'tadi.
4. Faylni EAS'ga maxfiy fayl sifatida yuklang (`user/` papkasida):

   ```sh
   eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json \
     --environment production --environment preview --visibility secret
   ```

   `app.config.js` uni o'zi topadi. Lokal build uchun faylni `user/google-services.json`
   ga qo'yish ham yetarli.
5. FCM V1 kaliti: Firebase → Project settings → Service accounts → "Generate new
   private key" (JSON). Keyin:

   ```sh
   eas credentials
   ```

   → Android → production → "Google Service Account" → "Manage your Google Service
   Account Key for Push Notifications (FCM V1)" → yuklab olingan JSON'ni tanlang.
   Bu kalit Expo'da saqlanadi, repozitoriyga tushmaydi.

## 2. Apple (iOS uchun)

```sh
eas credentials
```

→ iOS → production → "Push Notifications: Manage your Apple Push Notifications
Key" → yangi kalit yaratishni tanlang (Apple akkauntingiz bilan kirasiz). EAS
kalitni o'zi saqlaydi va build'ga bog'laydi.

`ios/Jaxongirman/Jaxongirman.entitlements` ga `aps-environment` allaqachon
qo'shilgan. Apple Developer'da App ID uchun "Push Notifications" yoqilgan
bo'lishi kerak — EAS buni odatda o'zi qiladi; qilmasa, developer.apple.com →
Identifiers → `uz.jaxongirman.app` → Push Notifications'ni belgilang.

## 3. Supabase

1. Migratsiyalarni qo'llang (`202611150019_push_notifications.sql` pg_net va
   pg_cron'ni ishlatadi — ikkalasi Supabase'da bor).
2. Funksiyani joylang:

   ```sh
   npx supabase functions deploy push-dispatch --project-ref <PROJECT_REF>
   ```

3. Tasodifiy maxfiy so'z yarating (masalan `openssl rand -hex 32`) va uni
   **ikki joyga** bir xil qilib yozing:

   - Funksiya uchun: Supabase → Edge Functions → Secrets → `PUSH_DISPATCH_SECRET`.
   - Baza uchun: SQL Editor'da:

     ```sql
     select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url');
     select vault.create_secret('<MAXFIY_SO‘Z>', 'push_dispatch_secret');
     ```

4. Ixtiyoriy: Expo'da "Enhanced push security" yoqilgan bo'lsa, Expo access
   token'ni `EXPO_ACCESS_TOKEN` sifatida funksiya secret'lariga qo'shing.

## 4. Yangi build

`expo-notifications` native modul va iOS entitlement qo'shilgani uchun ikkala
platformaga ham **yangi build** kerak (OTA yangilanish yetmaydi):

```sh
eas build --platform ios --profile production
eas build --platform android --profile production
```

## 5. Tekshirish

1. Telefonda ilovaga kiring — bildirishnoma ruxsati so'raladi, "Ruxsat bering".
2. Ilovani yoping. Boshqa akkauntdan shu odamga chatda xabar yozing — telefonga
   push kelishi kerak; bosilganda suhbat ochiladi.
3. Admin panel → "Hammaga xabar" → o'zingiz tanlagan tilga test xabar yuboring.
4. Kelmasa: SQL Editor'da

   ```sql
   select status, attempts, error, created_at from public.push_outbox order by id desc limit 20;
   select status_code, content from net._http_response order by id desc limit 5;
   ```

   `pending` qolib ketsa — Vault secret'lari yoki `PUSH_DISPATCH_SECRET` mos emas;
   `failed` bo'lsa — `error` ustunida Expo'ning sababi yozilgan
   (masalan `InvalidCredentials` — FCM yoki APNs kaliti yuklanmagan).
