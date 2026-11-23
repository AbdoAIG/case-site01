#!/usr/bin/env node
/**
 * أداة توليد هاش كلمة المرور للمدير بصيغة آمنة لملف .env في Next.js (بدون تعارض علامة $)
 * الاستخدام:
 *   npm run hash:password -- "YourStrongPassword"
 */
import crypto from "crypto";

const password = process.argv[2];

if (!password || password.length < 8) {
  console.error("❌ يرجى تمرير كلمة مرور لا تقل عن 8 أحرف:");
  console.error('   npm run hash:password -- "YourStrongPassword123!"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const derived = crypto.scryptSync(password, salt, 64).toString("hex");
console.log("\n✅ انسخ هذا السطر وضعه في ملف .env:");
console.log(`ADMIN_PASSWORD_HASH="scrypt:${salt}:${derived}"\n`);
