import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getEnvVar } from "@/lib/env";

export const SESSION_COOKIE_NAME = "case_admin_session";
export const CSRF_COOKIE_NAME = "case_csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 ساعات

const DEFAULT_FALLBACK_HASH =
  "sha256:dev2026a1b2c3d4e5:4c615f4e8e4a8c3c2a8c3c9f5b7e3e4d8c9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c";

function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

async function getSecretKey(): Promise<string> {
  const secret = await getEnvVar("SESSION_SECRET");
  if (!secret || secret.length < 32) {
    return "dev-fallback-secret-key-must-be-changed-in-production-32chars";
  }
  return secret;
}

export async function verifyAdminPassword(plainPassword: string): Promise<boolean> {
  if (!plainPassword) return false;

  let storedHash = await getEnvVar("ADMIN_PASSWORD_HASH");
  if (!storedHash || storedHash.length < 25) {
    storedHash = DEFAULT_FALLBACK_HASH;
  }

  // 1. صيغة sha256:salt:hash (تعمل في أقل من 0.2 ملي ثانية لتناسب حد الـ 10ms في Cloudflare Free)
  if (storedHash.startsWith("sha256:")) {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    const computedHex = crypto
      .createHash("sha256")
      .update(`${salt}:${plainPassword}`)
      .digest("hex");
    return safeEqualBuffers(
      Buffer.from(computedHex, "hex"),
      Buffer.from(expectedHex, "hex")
    );
  }

  // 2. دعم scrypt للتشغيل المحلي أو الخطط المدفوعة
  if (storedHash.startsWith("scrypt:") || storedHash.startsWith("scrypt$")) {
    const separator = storedHash.startsWith("scrypt:") ? ":" : "$";
    const parts = storedHash.split(separator);
    if (parts.length !== 3) return false;
    const [, salt, keyHex] = parts;
    const derivedKey = crypto.scryptSync(plainPassword, salt, 64);
    const keyBuffer = Buffer.from(keyHex, "hex");
    return safeEqualBuffers(derivedKey, keyBuffer);
  }

  // 3. دعم bcrypt
  if (storedHash.startsWith("bcrypt64:")) {
    const decodedHash = Buffer.from(
      storedHash.slice("bcrypt64:".length),
      "base64"
    ).toString("utf-8");
    return bcrypt.compare(plainPassword, decodedHash);
  }

  if (
    storedHash.startsWith("$2a$") ||
    storedHash.startsWith("$2b$") ||
    storedHash.startsWith("$2y$")
  ) {
    return bcrypt.compare(plainPassword, storedHash);
  }

  return false;
}

export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = crypto.randomBytes(8).toString("hex");
  const hex = crypto
    .createHash("sha256")
    .update(`${salt}:${plainPassword}`)
    .digest("hex");
  return `sha256:${salt}:${hex}`;
}

export interface SessionPayload {
  sub: string;
  role: "ADMIN";
  iat: number;
  exp: number;
  jti: string;
}

function signDataWithKey(data: string, secretKey: string): string {
  return crypto
    .createHmac("sha256", secretKey)
    .update(data)
    .digest("base64url");
}

export async function createSessionToken(username = "admin"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: username,
    role: "ADMIN",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: crypto.randomBytes(16).toString("hex"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const secretKey = await getSecretKey();
  const signature = signDataWithKey(encodedPayload, secretKey);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(
  token?: string | null
): Promise<SessionPayload | null> {
  if (!token || !token.includes(".")) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const secretKey = await getSecretKey();
  const expectedSignature = signDataWithKey(encodedPayload, secretKey);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (!safeEqualBuffers(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8")
    ) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now || payload.role !== "ADMIN") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getServerSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export function setSessionCookie(res: NextResponse, token: string): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function generateCsrfToken(): Promise<string> {
  const nonce = crypto.randomBytes(24).toString("hex");
  const timestamp = Date.now().toString();
  const raw = `${nonce}.${timestamp}`;
  const secretKey = await getSecretKey();
  const sig = signDataWithKey(raw, secretKey);
  return `${raw}.${sig}`;
}

export async function verifyCsrfToken(req: NextRequest): Promise<boolean> {
  const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  const headerToken = req.headers.get(CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken) return false;

  const cookieBuf = Buffer.from(cookieToken);
  const headerBuf = Buffer.from(headerToken);
  if (!safeEqualBuffers(cookieBuf, headerBuf)) {
    return false;
  }

  const parts = headerToken.split(".");
  if (parts.length !== 3) return false;
  const [nonce, timestamp, sig] = parts;
  const secretKey = await getSecretKey();
  const expectedSig = signDataWithKey(`${nonce}.${timestamp}`, secretKey);

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (!safeEqualBuffers(sigBuf, expectedBuf)) {
    return false;
  }

  const ageMs = Date.now() - Number(timestamp);
  if (Number.isNaN(ageMs) || ageMs < 0 || ageMs > 1000 * 60 * 60 * 12) {
    return false;
  }

  return true;
}

export function setCsrfCookie(res: NextResponse, token: string): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

interface RateBucket {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateBucket>();

export function checkRateLimit(
  req: NextRequest,
  scope: "login" | "upload" | "admin-action",
  maxRequests = 5,
  windowMs = 60_000
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0].trim()
    : req.headers.get("x-real-ip") || "127.0.0.1";
  const key = `${scope}:${ip}`;
  const now = Date.now();

  const bucket = rateLimitStore.get(key) || { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < windowMs);

  if (bucket.timestamps.length >= maxRequests) {
    const oldest = bucket.timestamps[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowMs - (now - oldest)) / 1000)
    );
    rateLimitStore.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  rateLimitStore.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - bucket.timestamps.length),
    retryAfterSeconds: 0,
  };
}

export interface DetectedFileType {
  ext: "jpg" | "png" | "webp" | "mp4" | "webm";
  mime: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm";
  kind: "image" | "video";
}

export function detectAllowedFileByMagicBytes(
  buffer: Buffer
): DetectedFileType | null {
  if (!buffer || buffer.length < 16) return null;

  const headText = buffer
    .subarray(0, Math.min(buffer.length, 512))
    .toString("utf-8")
    .toLowerCase();
  if (
    headText.includes("<svg") ||
    headText.includes("<!doctype html") ||
    headText.includes("<html") ||
    headText.includes("<script") ||
    headText.includes("<?xml")
  ) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg", kind: "image" };
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png", kind: "image" };
  }

  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { ext: "webp", mime: "image/webp", kind: "image" };
  }

  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    const brand = buffer.subarray(8, 12).toString("ascii");
    const allowedMp4Brands = [
      "isom",
      "iso2",
      "mp41",
      "mp42",
      "avc1",
      "M4V ",
      "dash",
      "mmp4",
    ];
    if (
      allowedMp4Brands.includes(brand) ||
      brand.startsWith("mp4") ||
      brand.startsWith("iso")
    ) {
      return { ext: "mp4", mime: "video/mp4", kind: "video" };
    }
  }

  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    const headerSlice = buffer
      .subarray(0, Math.min(buffer.length, 128))
      .toString("ascii")
      .toLowerCase();
    if (headerSlice.includes("webm")) {
      return { ext: "webm", mime: "video/webm", kind: "video" };
    }
  }

  return null;
}

export function sanitizeDisplayFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "media";
  const cleaned = base
    .replace(/[<>"'`&;$/\\?%*:|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120) || "media-item";
}

export function generateSafeStoredFilename(
  ext: DetectedFileType["ext"]
): string {
  const uuid = crypto.randomUUID();
  return `${Date.now()}-${uuid}.${ext}`;
}
