import type { MetadataRoute } from "next";

// منع أرشفة مسار الإدارة ومسارات الـ API دون كشف مسار الإدارة صراحةً للزوار
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/api/"],
      },
    ],
  };
}
