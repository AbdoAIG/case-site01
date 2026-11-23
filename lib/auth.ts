import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "case_admin_session";
export const CSRF_COOKIE_NAME = "case_csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 ساعات

const DEFAULT_FALLBACK_HASH =
  "scrypt:a1b2c3d4e5f60718293a4b5c6d7e8f90:4dc7bb8b9cc4777f7a0d602cd61010bcba21fcda7ed5821fb4a398b6605d30e8eaa2cce101ea0689bd9d25d9490b37e62c454b847cdff0aeac97b6f18e253e28";

function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

function getSecretKey(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    return "dev-fallback-secret-key-must-be-changed-in-production-32chars";
  }
  return secret;
}

export async function verifyAdminPassword(plainPassword: string): Promise<boolean> {
  if (!plainPassword) return false;

  let storedHash = (process.env.ADMIN_PASSWORD_HASH || "").trim();
  if (!storedHash || storedHash.length < 25) {
    storedHash = DEFAULT_FALLBACK_HASH;
  }

  if (storedHash.startsWith("scrypt:") || storedHash.startsWith("scrypt$")) {
    const separator = storedHash.startsWith("scrypt:") ? ":" : "$";
    const parts = storedHash.split(separator);
    if (parts.length !== 3) return false;
    const [, salt, keyHex] = parts;
    const derivedKey = crypto.scryptSync(plainPassword, salt, 64);
    const keyBuffer = Buffer.from(keyHex, "hex");
    return safeEqualBuffers(derivedKey, keyBuffer);
  }

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
  const bcryptHash = await bcrypt.hash(plainPassword, 12);
  return `bcrypt64:${Buffer.from(bcryptHash, "utf-8").toString("base64")}`;
}

export interface SessionPayload {
  sub: string;
  role: "ADMIN";
  iat: number;
  exp: number;
  jti: string;
}

function signData(data: string): string {
  return crypto
    .createHmac("sha256", getSecretKey())
    .update(data)
    .digest("base64url");
}

export function createSessionToken(username = "admin"): string {
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
  const signature = signData(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token?: string | null
): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signData(encodedPayload);
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

// في Next.js 15 أصبحت دالة cookies() غير متزامنة (async)
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

export function generateCsrfToken(): string {
  const nonce = crypto.randomBytes(24).toString("hex");
  const timestamp = Date.now().toString();
  const raw = `${nonce}.${timestamp}`;
  const sig = signData(raw);
  return `${raw}.${sig}`;
}

export function verifyCsrfToken(req: NextRequest): boolean {
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
  const expectedSig = signData(`${nonce}.${timestamp}`);

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
