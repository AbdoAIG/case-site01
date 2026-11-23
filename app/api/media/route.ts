import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  checkRateLimit,
  clearSessionCookie,
  createSessionToken,
  CSRF_COOKIE_NAME,
  generateCsrfToken,
  getServerSession,
  setCsrfCookie,
  setSessionCookie,
  verifyAdminPassword,
  verifyCsrfToken,
} from "@/lib/auth";
import { getEnvVar } from "@/lib/env";
import {
  addFallbackMedia,
  deleteMediaFile,
  MediaRecordData,
  readFallbackState,
  readLocalMediaFile,
  removeFallbackMedia,
  writeFallbackCaseInfo,
} from "@/lib/storage";
import {
  addMediaToGoogleSheets,
  deleteMediaFromGoogleSheets,
  fetchDriveFileViaAppsScript,
  fetchFromGoogleSheets,
  isGoogleSheetsEnabled,
  normalizeGoogleDriveUrl,
  updateCaseInGoogleSheets,
} from "@/lib/google-sheets";

export const dynamic = "force-dynamic";

const DEFAULT_TITLE =
  process.env.DEFAULT_CASE_TITLE ||
  "توضيح تفاصيل القضية والمرفقات المصورة";
const DEFAULT_DESCRIPTION =
  process.env.DEFAULT_CASE_DESCRIPTION ||
  "تحتوي هذه الصفحة على شرح كامل لتفاصيل القضية مع جميع الصور ومقاطع الفيديو التوضيحية المرتبطة بها.";

const GOOGLE_USER_AGENT =
  "Mozilla/5.0 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)";

export async function getMergedCaseAndMediaState() {
  const fallback = await readFallbackState(DEFAULT_TITLE, DEFAULT_DESCRIPTION);
  const localMediaList = fallback.media;
  const localMap = new Map<string, MediaRecordData>();
  for (const item of localMediaList) {
    localMap.set(item.id, item);
  }

  if (await isGoogleSheetsEnabled()) {
    const sheetData = await fetchFromGoogleSheets();
    if (sheetData) {
      const mergedMedia: MediaRecordData[] = [];
      const seenIds = new Set<string>();

      for (const sheetItem of sheetData.media) {
        seenIds.add(sheetItem.id);
        const localMatch = localMap.get(sheetItem.id);
        if (localMatch && localMatch.url.startsWith("/api/media?file=")) {
          mergedMedia.push({
            ...sheetItem,
            url: localMatch.url,
          });
        } else {
          mergedMedia.push(sheetItem);
        }
      }

      for (const localItem of localMediaList) {
        if (!seenIds.has(localItem.id)) {
          mergedMedia.push(localItem);
        }
      }

      return {
        caseInfo: {
          id: "singleton",
          title:
            sheetData.caseInfo.title ||
            fallback.caseInfo.title ||
            DEFAULT_TITLE,
          description:
            sheetData.caseInfo.description ||
            fallback.caseInfo.description ||
            DEFAULT_DESCRIPTION,
          contactName:
            sheetData.caseInfo.contactName ||
            fallback.caseInfo.contactName ||
            "",
          contactPhone:
            sheetData.caseInfo.contactPhone ||
            fallback.caseInfo.contactPhone ||
            "",
          contactPhone2:
            sheetData.caseInfo.contactPhone2 ||
            fallback.caseInfo.contactPhone2 ||
            "",
          updatedAt:
            sheetData.caseInfo.updatedAt || fallback.caseInfo.updatedAt,
        },
        media: mergedMedia,
        googleSheetsConnected: true,
      };
    }
  }

  return {
    caseInfo: fallback.caseInfo,
    media: localMediaList,
    googleSheetsConnected: false,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fileParam = searchParams.get("file");
  const driveIdParam = searchParams.get("driveId");
  const remoteUrlParam = searchParams.get("remoteUrl");
  const kindParam = searchParams.get("kind") === "video" ? "video" : "image";

  if (driveIdParam && /^[a-zA-Z0-9_-]+$/.test(driveIdParam)) {
    const candidateUrls =
      kindParam === "video"
        ? [
            `https://drive.usercontent.google.com/download?id=${driveIdParam}&export=download&confirm=t`,
            `https://drive.google.com/uc?export=download&id=${driveIdParam}`,
          ]
        : [
            `https://drive.google.com/thumbnail?id=${driveIdParam}&sz=w1600`,
            `https://lh3.googleusercontent.com/d/${driveIdParam}=w1600`,
            `https://drive.google.com/uc?export=view&id=${driveIdParam}`,
          ];

    for (const remoteUrl of candidateUrls) {
      try {
        const remoteRes = await fetch(remoteUrl, {
          headers: { "User-Agent": GOOGLE_USER_AGENT },
          redirect: "follow",
        });
        const contentType = remoteRes.headers.get("content-type") || "";
        if (remoteRes.ok && !contentType.includes("text/html")) {
          const arrayBuf = await remoteRes.arrayBuffer();
          if (arrayBuf.byteLength > 100) {
            return new NextResponse(Buffer.from(arrayBuf), {
              status: 200,
              headers: {
                "Content-Type":
                  contentType || (kindParam === "video" ? "video/mp4" : "image/jpeg"),
                "Cache-Control": "public, max-age=86400",
                "X-Content-Type-Options": "nosniff",
              },
            });
          }
        }
      } catch {
        // تجربة الرابط التالي
      }
    }

    const scriptFile = await fetchDriveFileViaAppsScript(driveIdParam);
    if (scriptFile) {
      return new NextResponse(new Uint8Array(scriptFile.buffer), {
        status: 200,
        headers: {
          "Content-Type": scriptFile.mimeType,
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return NextResponse.json(
      { error: "تعذر جلب الملف من Google Drive." },
      { status: 404 }
    );
  }

  if (
    remoteUrlParam &&
    (remoteUrlParam.startsWith("http://") || remoteUrlParam.startsWith("https://"))
  ) {
    try {
      const remoteRes = await fetch(remoteUrlParam, {
        headers: { "User-Agent": GOOGLE_USER_AGENT },
        redirect: "follow",
      });
      if (remoteRes.ok) {
        const contentType =
          remoteRes.headers.get("content-type") ||
          (kindParam === "video" ? "video/mp4" : "image/jpeg");
        const arrayBuf = await remoteRes.arrayBuffer();
        return new NextResponse(Buffer.from(arrayBuf), {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    } catch {
      // ignore
    }
    return NextResponse.json({ error: "تعذر تحميل الرابط الخارجي." }, { status: 404 });
  }

  if (fileParam) {
    let mimeType = "application/octet-stream";
    if (fileParam.endsWith(".jpg") || fileParam.endsWith(".jpeg")) mimeType = "image/jpeg";
    else if (fileParam.endsWith(".png")) mimeType = "image/png";
    else if (fileParam.endsWith(".webp")) mimeType = "image/webp";
    else if (fileParam.endsWith(".mp4")) mimeType = "video/mp4";
    else if (fileParam.endsWith(".webm")) mimeType = "video/webm";

    const fileBuffer = await readLocalMediaFile(fileParam);
    if (!fileBuffer) {
      return NextResponse.json({ error: "الملف غير موجود." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(fileBuffer.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${fileParam}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const session = await getServerSession();
  const existingCsrf = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfToken = existingCsrf || (await generateCsrfToken());

  const { caseInfo, media, googleSheetsConnected } =
    await getMergedCaseAndMediaState();

  const maxUploadRaw = await getEnvVar("MAX_UPLOAD_MB");
  const maxUploadMb = Math.max(1, Number(maxUploadRaw || "25"));

  const res = NextResponse.json({
    caseInfo,
    media,
    authenticated: Boolean(session),
    csrfToken,
    maxUploadMb,
    googleSheetsConnected,
  });

  setCsrfCookie(res, csrfToken);
  return res;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await verifyCsrfToken(req))) {
      return NextResponse.json(
        { error: "رمز الحماية (CSRF Token) غير صالح أو منتهي. يرجى تحديث الصفحة (F5) والمحاولة مجدداً." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "login") {
      const rate = checkRateLimit(req, "login", 5, 60_000);
      if (!rate.allowed) {
        return NextResponse.json(
          {
            error: `تم تجاوز عدد محاولات الدخول المسموحة (5 محاولات/دقيقة). يرجى المحاولة بعد ${rate.retryAfterSeconds} ثانية.`,
          },
          {
            status: 429,
            headers: { "Retry-After": String(rate.retryAfterSeconds) },
          }
        );
      }

      const password = String(body.password || "");
      const isValid = await verifyAdminPassword(password);

      if (!isValid) {
        return NextResponse.json(
          { error: "كلمة المرور غير صحيحة." },
          { status: 401 }
        );
      }

      const adminUsername = (await getEnvVar("ADMIN_USERNAME")) || "admin";
      const sessionToken = await createSessionToken(adminUsername);
      const newCsrfToken = await generateCsrfToken();

      const res = NextResponse.json({
        message: "تم تسجيل الدخول بنجاح.",
        authenticated: true,
        csrfToken: newCsrfToken,
      });

      setSessionCookie(res, sessionToken);
      setCsrfCookie(res, newCsrfToken);
      return res;
    }

    if (action === "logout") {
      const newCsrfToken = await generateCsrfToken();
      const res = NextResponse.json({
        message: "تم تسجيل الخروج بنجاح.",
        authenticated: false,
        csrfToken: newCsrfToken,
      });
      clearSessionCookie(res);
      setCsrfCookie(res, newCsrfToken);
      return res;
    }

    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: "انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى." },
        { status: 401 }
      );
    }

    if (action === "updateCase") {
      const title = String(body.title || "")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 200);
      const description = String(body.description || "")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 5000);
      const contactName = String(body.contactName || "")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 120);
      const contactPhone = String(body.contactPhone || "")
        .replace(/[<>"'`]/g, "")
        .trim()
        .slice(0, 40);
      const contactPhone2 = String(body.contactPhone2 || "")
        .replace(/[<>"'`]/g, "")
        .trim()
        .slice(0, 40);

      if (!title || !description) {
        return NextResponse.json(
          { error: "عنوان القضية والوصف حقول مطلوبة." },
          { status: 400 }
        );
      }

      if (await isGoogleSheetsEnabled()) {
        await updateCaseInGoogleSheets({
          title,
          description,
          contactName,
          contactPhone,
          contactPhone2,
        });
      }

      const fallbackSaved = await writeFallbackCaseInfo(
        title,
        description,
        contactName,
        contactPhone,
        contactPhone2
      );

      revalidatePath("/");
      revalidatePath("/admin");

      return NextResponse.json({
        message: "تم حفظ بيانات القضية وأرقام التواصل وتحديث الصفحة العامة فوراً.",
        caseInfo: fallbackSaved,
      });
    }

    if (action === "addExternalMedia") {
      const rawUrl = String(body.url || "").trim();
      const kind: "image" | "video" = body.kind === "video" ? "video" : "image";
      const safeTitle = String(body.title || "مرفق توثيقي")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 140);
      const safeCaption = body.caption
        ? String(body.caption).replace(/[<>]/g, "").trim().slice(0, 500)
        : null;

      if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
        return NextResponse.json(
          { error: "يرجى إدخال رابط صحيح يبدأ بـ https://" },
          { status: 400 }
        );
      }

      const normalizedUrl = normalizeGoogleDriveUrl(rawUrl, kind);
      const id = crypto.randomUUID();
      const mimeType = kind === "video" ? "video/mp4" : "image/jpeg";
      const createdAt = new Date().toISOString();

      if (await isGoogleSheetsEnabled()) {
        await addMediaToGoogleSheets({
          id,
          title: safeTitle,
          caption: safeCaption,
          kind,
          url: rawUrl,
          mimeType,
          sizeBytes: 0,
          createdAt,
        });
      }

      await addFallbackMedia(
        {
          id,
          title: safeTitle,
          caption: safeCaption,
          kind,
          url: normalizedUrl,
          mimeType,
          sizeBytes: 0,
          storedName: id,
          storageDriver: "external-url",
          createdAt,
        },
        DEFAULT_TITLE,
        DEFAULT_DESCRIPTION
      );

      revalidatePath("/");
      revalidatePath("/admin");

      return NextResponse.json({
        message: "تمت إضافة الرابط بنجاح ونشره في الصفحة العامة.",
      });
    }

    if (action === "deleteMedia") {
      const id = String(body.id || "");
      return handleDeleteMediaById(id);
    }

    return NextResponse.json({ error: "إجراء غير معروف." }, { status: 400 });
  } catch (error) {
    console.error("POST /api/media error:", error);
    return NextResponse.json(
      { error: "حدث خطأ أثناء تنفيذ الطلب." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح." }, { status: 401 });
  }

  if (!(await verifyCsrfToken(req))) {
    return NextResponse.json(
      { error: "رمز الحماية (CSRF Token) غير صالح." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") || "";
  return handleDeleteMediaById(id);
}

async function handleDeleteMediaById(id: string) {
  if (!id) {
    return NextResponse.json({ error: "معرّف الوسيط مطلوب." }, { status: 400 });
  }

  if (await isGoogleSheetsEnabled()) {
    await deleteMediaFromGoogleSheets(id);
  }

  const removedFallback = await removeFallbackMedia(
    id,
    DEFAULT_TITLE,
    DEFAULT_DESCRIPTION
  );

  if (removedFallback && removedFallback.storageDriver === "local") {
    await deleteMediaFile(removedFallback.storedName, removedFallback.storageDriver);
  }

  revalidatePath("/");
  revalidatePath("/admin");

  return NextResponse.json({
    message: "تم حذف العنصر بنجاح وتحديث الصفحة العامة فوراً.",
    deletedId: id,
  });
}
