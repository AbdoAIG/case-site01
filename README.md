# موقع عرض القضية الآمن (Case Documentation Site)

تطبيق ويب آمن ومستقل مبني باستخدام **Next.js 14 (App Router)** و **TypeScript** و **Tailwind CSS** و **Prisma (SQLite / PostgreSQL)** لعرض ملف قضية واحدة للرأي العام عبر رابط مشترك متجاوب مع الموبايل والديسكتوب، مع لوحة إدارة محمية بكلمة مرور لرفع وحذف الصور والفيديوهات وتحديث بيانات القضية فورياً بدون تعديل الكود.

---

## 1. المزايا الأمنية المطبقة

- **مصادقة بكلمة مرور مُخزّنة كـ Hash**: يتم التحقق من كلمة المرور مقابل `ADMIN_PASSWORD_HASH` في متغيرات البيئة باستخدام `bcrypt` (أو `scrypt` بآلية `timingSafeEqual` لمنع هجمات التوقيت).
- **جلسات محمية بالكامل**: كوكي الجلسة (`case_admin_session`) موقّع رقمياً عبر `HMAC-SHA256` ومضبوط بخصائص `httpOnly + Secure + SameSite=Strict`.
- **حماية CSRF شاملة**: كل طلب `POST` أو `DELETE` يتطلب تطابق رمز `x-csrf-token` الموقّع مع كوكي `case_csrf_token`.
- **تحديد معدل الطلبات (Rate Limiting)**: مسار تسجيل الدخول ومسار رفع الوسائط مقيدان بحد أقصى **5 طلبات في الدقيقة** لكل عنوان IP مع إرجاع كود `429 Too Many Requests` وترويسة `Retry-After`.
- **فحص البصمة الرقمية للملفات (Magic Bytes)**: لا يعتمد النظام على امتداد الملف أو ترويسة المتصفح، بل يفحص البايتات الأولى الفعلية للملف ويقبل حصراً:
  - الصور: `JPG` (`FF D8 FF`), `PNG` (`89 50 4E 47`), `WEBP` (`RIFF....WEBP`)
  - الفيديو: `MP4` (`ftyp`), `WEBM` (`1A 45 DF A3`)
  - يرفض بشكل قاطع أي محتوى `HTML` أو `SVG` أو `XML` أو سكربتات.
- **تنقية الأسماء وعزل التخزين**: تُحفظ الملفات بأسماء عشوائية مولّدة (`timestamp-uuid.ext`) خارج مجلد `public/` داخل مجلد `uploads/`، وتُقدّم عبر مسار `/api/media?file=...` مع ترويسة `X-Content-Type-Options: nosniff`.
- **ترويسات أمان صارمة وعزل لوحة الإدارة**: تطبيق `Content-Security-Policy` و `X-Content-Type-Options` و `Referrer-Policy` و `X-Frame-Options: DENY`، ومنع أرشفة `/admin` في `robots.txt` و `X-Robots-Tag` مع عدم وجود أي رابط للوحة الإدارة في الصفحة العامة.

---

## 2. خطوات التشغيل محلياً (Local Development)

1. **الدخول إلى مجلد المشروع وتثبيت الحزم**:
   ```bash
   cd case-site
   npm install
   ```

2. **إعداد ملف متغيرات البيئة**:
   ```bash
   cp .env.example .env
   ```

3. **تهيئة قاعدة البيانات (SQLite افتراضياً للتطوير)**:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **تشغيل خادم التطوير**:
   ```bash
   npm run dev
   ```
   - الصفحة العامة للزوار: `http://localhost:3000/`
   - لوحة الإدارة المحمية: `http://localhost:3000/admin` (كلمة المرور التجريبية في `.env.example` هي `ChangeMeStrong!2026`).

---

## 3. كيفية تغيير كلمة المرور

لتغيير كلمة مرور المدير في أي وقت دون تعديل الكود:

1. ولّد هاش جديد لكلمة المرور المطلوبة عبر السكربت المرفق:
   ```bash
   npm run hash:password -- "كلمة_المرور_الجديدة_القوية"
   ```
   أو عبر سطر أوامر Node مباشرة:
   ```bash
   node -e 'const bcrypt = require("bcryptjs"); console.log(bcrypt.hashSync("MyNewPass!2026", 12));'
   ```

2. انسخ قيمة الهاش الناتجة وضعها في ملف `.env` في المتغير:
   ```env
   ADMIN_PASSWORD_HASH="$2a$12$..."
   ```

3. أعد تشغيل الخادم ليبدأ العمل بكلمة المرور الجديدة فوراً.

---

## 4. التحكم في حدود الحجم ومحرك التخزين (`MAX_UPLOAD_MB` و `STORAGE_DRIVER`)

- **تعديل الحد الأقصى لحجم الملف**:
  من داخل ملف `.env`، عدّل قيمة `MAX_UPLOAD_MB` (القيمة الافتراضية `25` ميجابايت):
  ```env
  MAX_UPLOAD_MB="50"
  ```
  يقوم مسار `/api/upload` بقراءة هذه القيمة تلقائياً ورفض أي ملف يتجاوزها بكود `413 Payload Too Large`.

- **التبديل بين التخزين المحلي (`local`) وتخزين `S3` المتوافق**:
  - للتخزين على القرص المحلي في مجلد `uploads/`:
    ```env
    STORAGE_DRIVER="local"
    LOCAL_UPLOAD_DIR="./uploads"
    ```
  - للتبديل لاحقاً إلى خدمة متوافقة مع S3 (مثل AWS S3 أو Cloudflare R2 أو MinIO) دون تعديل منطق الرفع في `/api/upload`:
    ```env
    STORAGE_DRIVER="s3"
    S3_ENDPOINT="https://..."
    S3_REGION="us-east-1"
    S3_BUCKET="case-site-media"
    S3_ACCESS_KEY_ID="..."
    S3_SECRET_ACCESS_KEY="..."
    S3_PUBLIC_URL_BASE="https://cdn.example.com"
    ```

---

## 5. خطوات النشر للإنتاج (Production Deployment)

1. **التحويل إلى PostgreSQL في الإنتاج (اختياري وموصى به)**:
   - في `prisma/schema.prisma` غيّر `provider = "sqlite"` إلى `provider = "postgresql"`.
   - اضبط `DATABASE_URL="postgresql://user:pass@host:5432/dbname?schema=public"` في بيئة الإنتاج.
2. **ضبط المتغيرات الأمنية الإلزامية**:
   - عيّن `NODE_ENV="production"` (ليتم تفعيل علم `Secure` على الكوكيز تلقائياً).
   - عيّن `SESSION_SECRET` عشوائياً بطول 64 حرفاً (`openssl rand -hex 32`).
   - عيّن `ADMIN_PASSWORD_HASH` الخاص بك.
3. **بناء وتشغيل التطبيق**:
   ```bash
   npx prisma db push
   npm run build
   npm run start
   ```
