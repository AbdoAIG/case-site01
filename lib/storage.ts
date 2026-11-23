import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export type StorageDriverType = "local" | "s3";

export interface StoredFileResult {
  driver: StorageDriverType;
  storedName: string;
  storagePath: string;
  publicUrl: string;
  sha256Hash: string;
}

export interface CaseInfoData {
  id: string;
  title: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactPhone2: string;
  updatedAt: string;
}

export interface MediaRecordData {
  id: string;
  title: string;
  caption: string | null;
  kind: "image" | "video";
  url: string;
  mimeType: string;
  sizeBytes: number;
  storedName: string;
  storageDriver: string;
  createdAt: string;
}

interface FallbackState {
  caseInfo: CaseInfoData;
  media: MediaRecordData[];
}

export function getStorageDriver(): StorageDriverType {
  const driver = (process.env.STORAGE_DRIVER || "local").toLowerCase();
  return driver === "s3" ? "s3" : "local";
}

export function getLocalUploadDir(): string {
  if (process.env.VERCEL === "1" || process.env.VERCEL) {
    return "/tmp/case-site-uploads";
  }
  const customDir = process.env.LOCAL_UPLOAD_DIR || "./uploads";
  return path.resolve(process.cwd(), customDir);
}

function getFallbackStatePath(): string {
  return path.join(getLocalUploadDir(), "case-data.json");
}

export async function readFallbackState(
  defaultTitle: string,
  defaultDescription: string
): Promise<FallbackState> {
  try {
    const raw = await fs.readFile(getFallbackStatePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<FallbackState>;
    return {
      caseInfo: {
        id: "singleton",
        title: parsed.caseInfo?.title || defaultTitle,
        description: parsed.caseInfo?.description || defaultDescription,
        contactName: parsed.caseInfo?.contactName || "",
        contactPhone: parsed.caseInfo?.contactPhone || "",
        contactPhone2: parsed.caseInfo?.contactPhone2 || "",
        updatedAt: parsed.caseInfo?.updatedAt || new Date().toISOString(),
      },
      media: Array.isArray(parsed.media) ? parsed.media : [],
    };
  } catch {
    return {
      caseInfo: {
        id: "singleton",
        title: defaultTitle,
        description: defaultDescription,
        contactName: "",
        contactPhone: "",
        contactPhone2: "",
        updatedAt: new Date().toISOString(),
      },
      media: [],
    };
  }
}

export async function writeFallbackCaseInfo(
  title: string,
  description: string,
  contactName: string,
  contactPhone: string,
  contactPhone2: string
): Promise<CaseInfoData> {
  const updated: CaseInfoData = {
    id: "singleton",
    title,
    description,
    contactName,
    contactPhone,
    contactPhone2,
    updatedAt: new Date().toISOString(),
  };
  try {
    const uploadDir = getLocalUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });
    const current = await readFallbackState(title, description);
    current.caseInfo = updated;
    await fs.writeFile(
      getFallbackStatePath(),
      JSON.stringify(current, null, 2),
      "utf-8"
    );
  } catch {
    // في بيئة Cloudflare Workers لا يوجد قرص دائم، والاعتماد الكامل على Google Sheets
  }
  return updated;
}

export async function addFallbackMedia(
  item: MediaRecordData,
  defaultTitle: string,
  defaultDescription: string
): Promise<void> {
  try {
    const uploadDir = getLocalUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });
    const current = await readFallbackState(defaultTitle, defaultDescription);
    current.media = [item, ...current.media.filter((m) => m.id !== item.id)];
    await fs.writeFile(
      getFallbackStatePath(),
      JSON.stringify(current, null, 2),
      "utf-8"
    );
  } catch {
    // تجاهل على Cloudflare Workers
  }
}

export async function removeFallbackMedia(
  id: string,
  defaultTitle: string,
  defaultDescription: string
): Promise<MediaRecordData | null> {
  try {
    const uploadDir = getLocalUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });
    const current = await readFallbackState(defaultTitle, defaultDescription);
    const target = current.media.find((m) => m.id === id) || null;
    current.media = current.media.filter((m) => m.id !== id);
    await fs.writeFile(
      getFallbackStatePath(),
      JSON.stringify(current, null, 2),
      "utf-8"
    );
    return target;
  } catch {
    return null;
  }
}

export async function saveMediaBuffer(
  buffer: Buffer,
  storedName: string,
  _mimeType: string
): Promise<StoredFileResult> {
  const sha256Hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const safeBaseName = path.basename(storedName);

  try {
    const uploadDir = getLocalUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });
    const fullPath = path.join(uploadDir, safeBaseName);
    await fs.writeFile(fullPath, buffer, { mode: 0o600 });
    return {
      driver: "local",
      storedName: safeBaseName,
      storagePath: fullPath,
      publicUrl: `/api/media?file=${encodeURIComponent(safeBaseName)}`,
      sha256Hash,
    };
  } catch {
    return {
      driver: "local",
      storedName: safeBaseName,
      storagePath: safeBaseName,
      publicUrl: `/api/media?file=${encodeURIComponent(safeBaseName)}`,
      sha256Hash,
    };
  }
}

export async function deleteMediaFile(storedName: string, _driver: string): Promise<void> {
  const safeBaseName = path.basename(storedName);
  try {
    const fullPath = path.join(getLocalUploadDir(), safeBaseName);
    await fs.unlink(fullPath);
  } catch {
    // تجاهل إذا لم يكن على القرص
  }
}

export async function readLocalMediaFile(storedName: string): Promise<Buffer | null> {
  const safeBaseName = path.basename(storedName);
  if (safeBaseName !== storedName || safeBaseName.includes("..")) {
    return null;
  }
  try {
    const fullPath = path.join(getLocalUploadDir(), safeBaseName);
    return await fs.readFile(fullPath);
  } catch {
    return null;
  }
}
