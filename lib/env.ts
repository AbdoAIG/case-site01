import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * قراءة متغيرات البيئة مباشرة من سياق Cloudflare Workers (Variables and Secrets)
 * مع الرجوع تلقائياً إلى process.env في بيئة التطوير المحلية
 */
export async function getEnvVar(name: string): Promise<string> {
  try {
    const ctx = await getCloudflareContext({ async: true });
    const envObj = ctx?.env as Record<string, unknown> | undefined;
    const val = envObj?.[name];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  } catch {
    // في وضع التطوير المحلي next dev نعود إلى process.env
  }

  return (process.env[name] || "").trim();
}
