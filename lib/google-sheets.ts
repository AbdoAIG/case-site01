import { CaseInfoData, MediaRecordData } from "@/lib/storage";
import { getEnvVar } from "@/lib/env";

const GOOGLE_USER_AGENT =
  "Mozilla/5.0 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)";

async function getScriptConfig() {
  const [url, secret] = await Promise.all([
    getEnvVar("GOOGLE_SCRIPT_URL"),
    getEnvVar("GOOGLE_SCRIPT_SECRET"),
  ]);
  return { url, secret };
}

export async function isGoogleSheetsEnabled(): Promise<boolean> {
  const url = await getEnvVar("GOOGLE_SCRIPT_URL");
  return url.startsWith("https://script.google.com/");
}

async function postToGoogleScript(
  bodyObj: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const { url } = await getScriptConfig();
  if (!url) return null;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      "User-Agent": GOOGLE_USER_AGENT,
    },
    body: JSON.stringify(bodyObj),
    redirect: "manual",
    cache: "no-store",
  });

  if (
    res.status === 301 ||
    res.status === 302 ||
    res.status === 303 ||
    res.status === 307 ||
    res.status === 308
  ) {
    const redirectUrl = res.headers.get("location");
    if (!redirectUrl) return null;
    const redirectRes = await fetch(redirectUrl, {
      method: "GET",
      headers: {
        "User-Agent": GOOGLE_USER_AGENT,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await redirectRes.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractGoogleDriveId(rawUrl: string): string | null {
  const url = (rawUrl || "").trim();
  if (!url) return null;

  if (url.includes("drive.google.com") || url.includes("docs.google.com")) {
    const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch?.[1]) return fileMatch[1];

    const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idParamMatch?.[1]) return idParamMatch[1];
  }

  if (url.includes("googleusercontent.com")) {
    const lh3Match = url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if (lh3Match?.[1]) return lh3Match[1];
  }

  return null;
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const url = (rawUrl || "").trim();
  if (!url) return null;

  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch?.[1]) return shortMatch[1];

  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch?.[1]) return watchMatch[1];

  const embedOrShortsMatch = url.match(
    /youtube\.com\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{11})/
  );
  if (embedOrShortsMatch?.[1]) return embedOrShortsMatch[1];

  return null;
}

export function normalizeMediaUrl(
  rawInput: string,
  kind: "image" | "video",
  driveFileId?: string
): string {
  let url = (rawInput || "").trim();

  const imageFormulaMatch = url.match(/^=\s*IMAGE\s*\(\s*["']([^"']+)["']/i);
  if (imageFormulaMatch?.[1]) {
    url = imageFormulaMatch[1].trim();
  }

  url = url.replace(/^["']+|["']+$/g, "").trim();

  if (!url && driveFileId?.trim()) {
    return `/api/media?driveId=${encodeURIComponent(driveFileId.trim())}&kind=${kind}`;
  }

  if (url.startsWith("/api/media") || url.startsWith("data:")) {
    return url;
  }

  const extractedDriveId = driveFileId?.trim() || extractGoogleDriveId(url);
  if (extractedDriveId) {
    return `/api/media?driveId=${encodeURIComponent(extractedDriveId)}&kind=${kind}`;
  }

  return url;
}

export const normalizeGoogleDriveUrl = normalizeMediaUrl;

export async function fetchDriveFileViaAppsScript(fileId: string): Promise<{
  buffer: Buffer;
  mimeType: string;
} | null> {
  const { url, secret } = await getScriptConfig();
  if (!url.startsWith("https://script.google.com/")) return null;

  try {
    const targetUrl = new URL(url);
    targetUrl.searchParams.set("action", "getDriveFile");
    targetUrl.searchParams.set("fileId", fileId);
    if (secret) targetUrl.searchParams.set("secret", secret);

    const res = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": GOOGLE_USER_AGENT,
        Accept: "application/json",
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok || !data.base64Data) return null;

    return {
      buffer: Buffer.from(String(data.base64Data), "base64"),
      mimeType: String(data.mimeType || "image/jpeg"),
    };
  } catch {
    return null;
  }
}

export async function fetchFromGoogleSheets(): Promise<{
  caseInfo: CaseInfoData;
  media: MediaRecordData[];
} | null> {
  const { url, secret } = await getScriptConfig();
  if (!url.startsWith("https://script.google.com/")) return null;

  try {
    const targetUrl = new URL(url);
    targetUrl.searchParams.set("action", "getAll");
    if (secret) targetUrl.searchParams.set("secret", secret);

    const res = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": GOOGLE_USER_AGENT,
        Accept: "application/json",
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) return null;
    const text = await res.text();
    const data = JSON.parse(text);
    if (!data || !data.ok) return null;

    const media: MediaRecordData[] = Array.isArray(data.media)
      ? data.media
          .map((m: Record<string, unknown>, idx: number) => {
            const rawUrl = String(m.url || "").trim();
            const driveFileId = String(m.driveFileId || "").trim();
            const rawKind = String(m.kind || "").toLowerCase().trim();
            const isYouTube = Boolean(extractYouTubeVideoId(rawUrl));
            const kind: "image" | "video" =
              rawKind === "video" ||
              rawKind === "فيديو" ||
              isYouTube ||
              /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(rawUrl)
                ? "video"
                : "image";

            const normalizedUrl = normalizeMediaUrl(
              rawUrl,
              kind,
              driveFileId
            );

            return {
              id: String(m.id || `sheet-${idx}`),
              title: String(m.title || "صورة مرفقة"),
              caption: m.caption ? String(m.caption) : null,
              kind,
              url: normalizedUrl,
              mimeType: String(
                m.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg")
              ),
              sizeBytes: Number(m.sizeBytes || 0),
              storedName: String(m.storedName || m.id || `sheet-${idx}`),
              storageDriver: "google-sheets",
              createdAt: String(m.createdAt || new Date().toISOString()),
            };
          })
          .filter((item: MediaRecordData) => Boolean(item.url))
      : [];

    return {
      caseInfo: {
        id: "singleton",
        title: String(data.caseInfo?.title || ""),
        description: String(data.caseInfo?.description || ""),
        contactName: String(data.caseInfo?.contactName || ""),
        contactPhone: String(data.caseInfo?.contactPhone || ""),
        contactPhone2: String(data.caseInfo?.contactPhone2 || ""),
        updatedAt: String(data.caseInfo?.updatedAt || new Date().toISOString()),
      },
      media,
    };
  } catch (err) {
    console.error("Google Sheets fetch error:", err);
    return null;
  }
}

export async function updateCaseInGoogleSheets(payload: {
  title: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactPhone2: string;
}): Promise<CaseInfoData | null> {
  const { url, secret } = await getScriptConfig();
  if (!url.startsWith("https://script.google.com/")) return null;

  try {
    const data = await postToGoogleScript({
      action: "updateCase",
      secret,
      ...payload,
    });
    if (!data?.ok) return null;
    return data.caseInfo as CaseInfoData;
  } catch (err) {
    console.error("Google Sheets updateCase error:", err);
    return null;
  }
}

export async function addMediaToGoogleSheets(payload: {
  id: string;
  title: string;
  caption: string | null;
  kind: "image" | "video";
  url?: string;
  mimeType: string;
  sizeBytes: number;
  storedName?: string;
  base64Data?: string;
  createdAt: string;
}): Promise<MediaRecordData | null> {
  const { url, secret } = await getScriptConfig();
  if (!url.startsWith("https://script.google.com/")) return null;

  try {
    const data = await postToGoogleScript({
      action: "addMedia",
      secret,
      ...payload,
    });

    if (!data?.ok || !data.media) return null;
    const mediaObj = data.media as Record<string, unknown>;
    const kind = mediaObj.kind === "video" ? "video" : "image";
    const rawUrl = String(mediaObj.url || payload.url || "");
    const driveFileId = String(mediaObj.driveFileId || "");

    return {
      id: String(mediaObj.id),
      title: String(mediaObj.title),
      caption: mediaObj.caption ? String(mediaObj.caption) : null,
      kind,
      url: normalizeMediaUrl(rawUrl, kind, driveFileId),
      mimeType: String(mediaObj.mimeType || payload.mimeType),
      sizeBytes: Number(mediaObj.sizeBytes || payload.sizeBytes || 0),
      storedName: String(payload.storedName || mediaObj.id),
      storageDriver: "google-sheets",
      createdAt: String(mediaObj.createdAt || payload.createdAt),
    };
  } catch (err) {
    console.error("Google Sheets addMedia error:", err);
    return null;
  }
}

export async function deleteMediaFromGoogleSheets(id: string): Promise<boolean> {
  const { url, secret } = await getScriptConfig();
  if (!url.startsWith("https://script.google.com/")) return false;

  try {
    const data = await postToGoogleScript({
      action: "deleteMedia",
      secret,
      id,
    });
    return Boolean(data?.ok);
  } catch (err) {
    console.error("Google Sheets deleteMedia error:", err);
    return false;
  }
}
