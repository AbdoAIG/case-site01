import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  checkRateLimit,
  detectAllowedFileByMagicBytes,
  generateSafeStoredFilename,
  getServerSession,
  sanitizeDisplayFilename,
  verifyCsrfToken,
} from "@/lib/auth";
import { addFallbackMedia, saveMediaBuffer } from "@/lib/storage";
import {
  addMediaToGoogleSheets,
  isGoogleSheetsEnabled,
} from "@/lib/google-sheets";

export const dynamic = "force-dynamic";

const DEFAULT_TITLE =
  process.env.DEFAULT_CASE_TITLE ||
  "توضيح تفاصيل القضية والمرفقات المصورة";
const DEFAULT_DESCRIPTION =
  process.env.DEFAULT_CASE_DESCRIPTION ||
  "تحتوي هذه الصفحة على شرح كامل لتفاصيل القضية مع جميع الصور ومقاطع الفيديو التوضيحية المرتبطة بها.";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: "غير مصرح لك بالوصول. يرجى تسجيل الدخول أولاً." },
        { status: 401 }
      );
    }

    if (!verifyCsrfToken(req)) {
      return NextResponse.json(
        { error: "رمز الحماية (CSRF Token) غير صالح أو منتهي الصلاحية." },
        { status: 403 }
      );
    }

    const rate = checkRateLimit(req, "upload", 5, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: `تم تجاوز الحد المسموح للرفع (5 طلبات/دقيقة). يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSeconds) },
        }
      );
    }

    const formData = await req.formData();
    const fileEntry = formData.get("file");
    const rawTitle = String(formData.get("title") || "").trim();
    const rawCaption = String(formData.get("caption") || "").trim();

    if (!fileEntry || !(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: "لم يتم إرفاق ملف صالح للرفع." },
        { status: 400 }
      );
    }

    const maxUploadMb = Math.max(1, Number(process.env.MAX_UPLOAD_MB || "25"));
    const maxBytes = maxUploadMb * 1024 * 1024;

    if (fileEntry.size <= 0) {
      return NextResponse.json({ error: "الملف المرفق فارغ." }, { status: 400 });
    }

    if (fileEntry.size > maxBytes) {
      return NextResponse.json(
        {
          error: `حجم الملف يتجاوز الحد الأقصى المسموح به (${maxUploadMb} ميجابايت).`,
        },
        { status: 413 }
      );
    }

    const lowerOriginalName = (fileEntry.name || "").toLowerCase();
    if (
      lowerOriginalName.endsWith(".svg") ||
      lowerOriginalName.endsWith(".html") ||
      lowerOriginalName.endsWith(".htm") ||
      lowerOriginalName.endsWith(".xhtml") ||
      lowerOriginalName.endsWith(".xml") ||
      lowerOriginalName.endsWith(".js")
    ) {
      return NextResponse.json(
        { error: "يُمنع رفع ملفات HTML أو SVG أو النصوص البرمجية لأسباب أمنية." },
        { status: 415 }
      );
    }

    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const detected = detectAllowedFileByMagicBytes(buffer);
    if (!detected) {
      return NextResponse.json(
        {
          error:
            "نوع الملف الفعلي غير مدعوم. يُقبل فقط: الصور (JPG, PNG, WEBP) والفيديو (MP4, WEBM) بعد فحص البصمة الرقمية.",
        },
        { status: 415 }
      );
    }

    const cleanOriginalName = sanitizeDisplayFilename(fileEntry.name);
    const storedName = generateSafeStoredFilename(detected.ext);
    const safeTitle = (rawTitle || cleanOriginalName)
      .replace(/[<>]/g, "")
      .slice(0, 140);
    const safeCaption = rawCaption ? rawCaption.replace(/[<>]/g, "").slice(0, 500) : null;
    const itemId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // في Cloudflare Workers، يُرفع الملف إلى Google Drive ويُسجل في Google Sheets مباشرة
    if (isGoogleSheetsEnabled()) {
      const base64Data =
        buffer.length <= 12 * 1024 * 1024 ? buffer.toString("base64") : undefined;

      const sheetMedia = await addMediaToGoogleSheets({
        id: itemId,
        title: safeTitle,
        caption: safeCaption,
        kind: detected.kind,
        mimeType: detected.mime,
        sizeBytes: buffer.length,
        storedName,
        base64Data,
        createdAt,
      });

      if (sheetMedia) {
        await addFallbackMedia(sheetMedia, DEFAULT_TITLE, DEFAULT_DESCRIPTION);
        revalidatePath("/");
        revalidatePath("/admin");
        return NextResponse.json(
          {
            message: "تم رفع الملف إلى Google Drive وتسجيله في Google Sheets بنجاح.",
            media: sheetMedia,
          },
          { status: 201 }
        );
      }
    }

    const storedFile = await saveMediaBuffer(buffer, storedName, detected.mime);
    const localMediaRecord = {
      id: itemId,
      title: safeTitle,
      caption: safeCaption,
      kind: detected.kind,
      url: storedFile.publicUrl,
      mimeType: detected.mime,
      sizeBytes: buffer.length,
      storedName: storedFile.storedName,
      storageDriver: storedFile.driver,
      createdAt,
    };

    await addFallbackMedia(localMediaRecord, DEFAULT_TITLE, DEFAULT_DESCRIPTION);

    revalidatePath("/");
    revalidatePath("/admin");

    return NextResponse.json(
      {
        message: "تم رفع الملف وتوثيقه بنجاح.",
        media: localMediaRecord,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "حدث خطأ داخلي أثناء معالجة رفع الملف." },
      { status: 500 }
    );
  }
}
