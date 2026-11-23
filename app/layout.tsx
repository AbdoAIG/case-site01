import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "تفاصيل القضية والمرفقات",
  description: "عرض كامل لتفاصيل القضية والصور ومقاطع الفيديو التوضيحية.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col font-sans bg-[#F8FAFC] text-[#1E293B]">
        {children}
      </body>
    </html>
  );
}
