<div dir="rtl">

# دليل التشغيل النهائي (Production): مُرسِل رسائل واتساب عبر Blueticks

تطبيق ويب يرسل رسائل واتساب عبر **Blueticks API**:
- **رقم واحد** أو **مجموعة أرقام** أو **كل الأرقام**.
- نص، وصورة/فيديو/ملف من رابط، ورسائل **مجدولة**.
- **سجل كامل** لكل رسالة مع **تقرير التسليم** (أُرسلت / فشلت).
- محمي بكلمة مرور، وجاهز للنشر على سيرفر عبر **Docker** أو **PM2**.

---

## ١. لماذا بقيت رسالتك «pending» ولم تصل؟

| السبب | الشرح | الحل |
|---|---|---|
| **مفتاح Staging** | المفتاح `BT8W…` يعمل على `stg-api.blueticks.co` فقط، وهو سيرفر اختبار. إضافة Blueticks في كروم مربوطة بسيرفر الإنتاج، فلا ترى رسائل سيرفر الاختبار ولا ترسلها. | استخدم **مفتاح الإنتاج** من حسابك العادي مع `https://api.blueticks.co` |
| **واتساب ويب مغلق** | مع REST API، الإرسال الفعلي تقوم به **إضافة Blueticks في كروم** وليس السيرفر. | افتح `web.whatsapp.com` في كروم مع إضافة Blueticks، وسجّل الدخول بنفس الحساب صاحب المفتاح. أو اشترك في باقة **Campaigner** للإرسال بدون فتح واتساب ويب |
| **الإرسال لنفسك** | إذا أرسلت إلى رقمك نفسه، تظهر الرسالة في محادثة «مراسلة نفسك» (Message yourself). | ابحث عنها هناك |

> **ملاحظة:** «Message queued successfuly» تعني أن Blueticks استلم الرسالة ووضعها في الطابور، ولا تعني أنها وصلت. التسليم الفعلي يظهر في تبويب **السجل والتسليم** عند تفعيل تقارير التسليم (القسم ٦).

---

## ٢. المتطلبات

1. حساب **Blueticks** (إنتاج) و**مفتاح API** من الإضافة أو التطبيق ← API.
2. **واتساب مربوط**: كروم + `web.whatsapp.com` + إضافة Blueticks تبقى مفتوحة، **أو** باقة Campaigner.
3. سيرفر Linux (مثلاً Ubuntu 22/24) عليه **Node.js 18+** أو **Docker**.
4. **دومين** (مثلاً `wa.example.com`) يشير إلى السيرفر، لتفعيل HTTPS وتقارير التسليم.

---

## ٣. اختبار المفتاح قبل كل شيء

```bash
cp .env.example .env
# عدّل .env وضع: BLUETICKS_API_KEY=مفتاح_الإنتاج
./test-key.sh +9647716113081 "اختبار"
```

| النتيجة | المعنى |
|---|---|
| `HTTP 201` + `Message queued successfuly` | ✅ المفتاح صحيح |
| `401 Invalid API key` | المفتاح خطأ، أو مفتاح Staging تستخدمه على سيرفر الإنتاج (أو العكس) |
| `401 Not authenticated` | لم يُرسل حقل `apiKey` في جسم الطلب |

---

## ٤. ملف الإعدادات `.env`

| المتغير | القيمة | الشرح |
|---|---|---|
| `BLUETICKS_REST_URL` | `https://api.blueticks.co` | سيرفر **الإنتاج**. لا تستخدم `stg-api` في الإنتاج |
| `BLUETICKS_API_KEY` | مفتاحك | مفتاح الإنتاج |
| `NODE_ENV` | `production` | يفعّل وضع الإنتاج (فحص الإعدادات، كلمة المرور إجبارية) |
| `APP_USERNAME` / `APP_PASSWORD` | `admin` / كلمة قوية | **إجباري**: دخول واجهة التطبيق، ١٠ أحرف على الأقل |
| `PUBLIC_URL` | `https://wa.example.com` | عنوان موقعك العام (HTTPS) لتقارير التسليم |
| `CALLBACK_SECRET` | نص عشوائي طويل | سرّ في رابط التقارير حتى لا يزوّرها أحد |
| `MAX_RECIPIENTS_PER_SEND` | `500` | أقصى عدد أرقام في الإرسالة الواحدة |
| `MIN_DELAY_SECONDS` | `2` | أقل فاصل بين رسالة وأخرى، لحماية رقمك من الحظر |
| `SEND_REQUESTS_PER_MINUTE` | `10` | حد طلبات الإرسال في الدقيقة |
| `HOST` | `127.0.0.1` | التطبيق لا يُفتح مباشرة، فقط من خلال Nginx |

توليد `CALLBACK_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

> إذا كانت الإعدادات ناقصة في وضع الإنتاج (مثلاً بدون كلمة مرور)، **يرفض التطبيق التشغيل** ويطبع ما يجب إصلاحه.

---

## ٥. النشر على السيرفر

### الطريقة (أ): Docker (الأسهل)

```bash
git clone <المستودع> && cd whatsapp-blueticks-ui
cp .env.example .env && nano .env      # ضع المفتاح وكلمة المرور و PUBLIC_URL و CALLBACK_SECRET
docker compose up -d --build
docker compose logs -f                 # تأكد من ظهور: password: on · delivery callbacks: on
```
السجل يُحفظ في مجلد `data/` ويبقى بعد إعادة التشغيل.

### الطريقة (ب): Node.js + PM2

```bash
npm ci --omit=dev
cp .env.example .env && nano .env
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup                # التشغيل التلقائي بعد إعادة تشغيل السيرفر
pm2 logs whatsapp-sender
```

### HTTPS عبر Nginx (للطريقتين)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/whatsapp-sender
sudo nano /etc/nginx/sites-available/whatsapp-sender      # غيّر wa.example.com إلى دومينك
sudo ln -s /etc/nginx/sites-available/whatsapp-sender /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d wa.example.com                     # شهادة HTTPS مجانية
```

افتح `https://wa.example.com` وسجّل الدخول باسم المستخدم وكلمة المرور.

فحص الحالة:
```bash
curl https://wa.example.com/healthz
```

---

## ٦. تقارير التسليم (أُرسلت / فشلت)

عند ضبط `PUBLIC_URL` و`CALLBACK_SECRET`، يضيف التطبيق تلقائياً `callbackUrl` لكل رسالة:
```
https://wa.example.com/api/callback/<CALLBACK_SECRET>
```
عندما تُرسل Blueticks الرسالة أو تفشل، تستدعي هذا الرابط، فتتغيّر الحالة في تبويب **③ السجل والتسليم** من `pending` إلى `sent` أو `failed`. الصفحة تتحدّث كل ١٠ ثوانٍ، ويمكن تنزيل السجل CSV.

> لا يمكن قراءة حالة الرسالة عبر GET باستخدام مفتاح API. Blueticks تسمح بذلك فقط بتوكن مستخدم مسجّل (JWT). الطريقة الرسمية هي `callbackUrl`.

---

## ٧. استخدام الواجهة

### ① الاختيار والتصدير
- في وضع REST: الصق الأرقام في «paste phone numbers manually»، رقماً في كل سطر أو مفصولة بفواصل، مع رمز الدولة (`+964…`).
- فلترة حسب رمز الدولة أو البادئة (مثل `96477`) أو بنمط Regex، ثم «تحديد الكل».
- نسخ الأرقام المختارة أو تنزيلها CSV.

### ② إرسال رسالة
- **المستلمون:**
  - **رقم واحد**: اكتب الرقم مع رمز الدولة.
  - **المختارون**: الأرقام المحددة في التبويب الأول.
  - **كل المفلترين**: كل الأرقام المطابقة للفلاتر.
  - **كل المحمّلين**: كل الأرقام في القائمة.
- **نوع الرسالة:** نص، أو صورة/فيديو/ملف من **رابط عام https**.
- **متغيرات:** `{name}` و`{phone}` تُستبدل لكل شخص.
- **جدولة:** اختر وقتاً. يُرسل لـ Blueticks بتوقيت UTC تلقائياً.
- **فاصل زمني** بين الرسائل، و**شريط تقدّم مباشر**، وزر **إيقاف**.

### ③ السجل والتسليم
كل رسالة مع: الوقت، والرقم، والنص، والحالة، ووقت تقرير التسليم، ورقم الرسالة (id).

---

## ٨. الأمان

| الحماية | التفاصيل |
|---|---|
| كلمة مرور | إجبارية في الإنتاج على الواجهة والـ API |
| مفتاح Blueticks | يبقى في `.env` على السيرفر فقط ولا يصل للمتصفح أبداً |
| حدود الإرسال | حد لعدد الطلبات في الدقيقة، وأقصى عدد مستلمين، وأقل فاصل بين الرسائل |
| رابط التقارير | محمي بسرّ عشوائي، والرابط الخاطئ يرجع 404 |
| ترويسات أمان | CSP و X-Frame-Options وغيرها |
| شبكة | التطبيق يستمع على `127.0.0.1`، والوصول فقط عبر Nginx + HTTPS |
| تنزيل الكود | معطّل في الإنتاج |

**مهم:**
- **غيّر المفاتيح** التي نُشرت في المحادثة (`BTFS…` و`BT8W…`) من حسابك في Blueticks.
- لا ترفع ملف `.env` إلى GitHub. هو مستثنى في `.gitignore`.
- أرسل فقط لمن وافق على استلام رسائلك، واترك فاصلاً كافياً (٣ ثوانٍ أو أكثر)، حتى لا يحظر واتساب رقمك.

---

## ٩. حل المشاكل

| المشكلة | الحل |
|---|---|
| `Invalid API key` | المفتاح لا يطابق السيرفر: مفتاح الإنتاج مع `api.blueticks.co`، ومفتاح الاختبار مع `stg-api.blueticks.co` |
| الحالة `pending` ولا تصل | افتح واتساب ويب + إضافة Blueticks بنفس الحساب، أو فعّل Campaigner. وتأكد أنك لا تستخدم Staging |
| لا تصل تقارير التسليم | تأكد أن `PUBLIC_URL` يفتح من الإنترنت عبر HTTPS، وأن `CALLBACK_SECRET` مضبوط. راقب السجل: `[callback] … → sent` |
| التطبيق لا يعمل ويطبع `Configuration problems` | أكمل المتغيرات الناقصة المذكورة في الرسالة |
| `429 Too many requests` | تجاوزت حد الطلبات. انتظر دقيقة أو ارفع `SEND_REQUESTS_PER_MINUTE` |
| زر «Load from WhatsApp» معطّل | طبيعي مع مفتاح REST. تحميل المحادثات يحتاج مفتاح MCP (`bt_live_`). الصق الأرقام يدوياً |

---

## ١٠. هيكل المشروع

```
server.js              الخادم: API، الإرسال، التقارير، السجل، الأمان
src/restClient.js      Blueticks REST: POST /messages (apiKey داخل الجسم)
src/mcpClient.js       Blueticks MCP (لمفاتيح bt_live_)
src/history.js         سجل الرسائل وتقارير التسليم (data/messages.jsonl)
src/security.js        كلمة المرور، حد الطلبات، ترويسات الأمان
src/normalize.js       توحيد شكل البيانات
public/                الواجهة (index.html, app.js, styles.css)
Dockerfile, docker-compose.yml   النشر عبر Docker
ecosystem.config.cjs   النشر عبر PM2
deploy/nginx.conf      إعداد Nginx + HTTPS
test-key.sh            اختبار المفتاح بـ curl
mock-mcp.mjs           سيرفر وهمي للاختبار المحلي فقط
```

</div>
