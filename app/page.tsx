"use client";

import React, { useEffect, useState } from "react";
import PublicGallery, { PublicMediaItem } from "@/components/PublicGallery";

interface CaseInfoState {
  title: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactPhone2: string;
}

function formatWhatsAppNumber(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("01") && digits.length === 11) {
    digits = `2${digits}`;
  } else if (digits.startsWith("0") && digits.length >= 9) {
    digits = `20${digits.slice(1)}`;
  }
  return digits;
}

export default function PublicCasePage() {
  const [loading, setLoading] = useState(true);
  const [caseInfo, setCaseInfo] = useState<CaseInfoState>({
    title: "توضيح تفاصيل القضية والمرفقات المصورة",
    description: "جاري تحميل التفاصيل...",
    contactName: "",
    contactPhone: "",
    contactPhone2: "",
  });
  const [media, setMedia] = useState<PublicMediaItem[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/media?public=1", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        if (data.caseInfo) {
          setCaseInfo({
            title: data.caseInfo.title || "توضيح تفاصيل القضية والمرفقات المصورة",
            description: data.caseInfo.description || "",
            contactName: String(data.caseInfo.contactName || "").trim(),
            contactPhone: String(data.caseInfo.contactPhone || "").trim(),
            contactPhone2: String(data.caseInfo.contactPhone2 || "").trim(),
          });
        }
        if (Array.isArray(data.media)) {
          setMedia(data.media);
        }
      } catch {
        // تجاهل خطأ الشبكة المؤقت
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const phoneList = [caseInfo.contactPhone, caseInfo.contactPhone2].filter(Boolean);

  return (
    <main className="flex-1 flex flex-col bg-[#F4F7F9]">
      <section className="bg-gradient-to-b from-[#FFFFFF] to-[#F8FAFC] border-b border-slate-200/75">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-9 bg-slate-200 rounded-xl w-3/4" />
              <div className="h-32 bg-slate-100 rounded-2xl w-full" />
            </div>
          ) : (
            <>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-[#0F172A] leading-snug tracking-tight">
                {caseInfo.title}
              </h1>

              <div className="mt-6 text-[#334155] text-base sm:text-lg leading-[1.9] whitespace-pre-line bg-[#FCFDFE] rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm">
                {caseInfo.description}
              </div>

              {(caseInfo.contactName || phoneList.length > 0) && (
                <div className="mt-7 rounded-2xl bg-white border border-teal-100 p-5 sm:p-6 shadow-sm">
                  <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200/60 flex items-center justify-center shrink-0 text-teal-700">
                        <svg
                          className="w-6 h-6"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-teal-700">
                          معلومات التواصل المباشر
                        </div>
                        {caseInfo.contactName && (
                          <div className="text-lg sm:text-xl font-extrabold text-slate-900 mt-0.5">
                            {caseInfo.contactName}
                          </div>
                        )}
                      </div>
                    </div>

                    {phoneList.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                        {phoneList.map((phone, idx) => {
                          const cleanTel = phone.replace(/[^\d+]/g, "");
                          const waNumber = formatWhatsAppNumber(phone);
                          const waLink = `https://wa.me/${waNumber}`;

                          return (
                            <div
                              key={idx}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-[#F8FAFC] border border-slate-200/75 p-3.5"
                            >
                              <div>
                                <div className="text-[11px] font-semibold text-slate-400">
                                  {idx === 0
                                    ? "رقم التواصل الأساسي"
                                    : "رقم التواصل الإضافي"}
                                </div>
                                <div
                                  className="text-base font-extrabold text-slate-800 mt-0.5 tracking-wide"
                                  dir="ltr"
                                >
                                  {phone}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {cleanTel && (
                                  <a
                                    href={`tel:${cleanTel}`}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-600 text-white text-xs font-bold transition shadow-sm"
                                  >
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                                      />
                                    </svg>
                                    <span>اتصال</span>
                                  </a>
                                )}

                                {waNumber && (
                                  <a
                                    href={waLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white text-xs font-bold transition shadow-sm"
                                  >
                                    <svg
                                      className="w-4 h-4 fill-current"
                                      viewBox="0 0 24 24"
                                    >
                                      <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86s.274.072.376-.043c.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.1.824zm-3.423-14.416c-6.627 0-12 5.373-12 12 0 2.126.556 4.122 1.534 5.855l-1.534 5.603 5.747-1.508c1.693.924 3.635 1.45 5.699 1.45 6.627 0 12-5.373 12-12s-5.373-12-11.446-11.4z" />
                                    </svg>
                                    <span>واتساب</span>
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0F172A]">
              الصور والفيديوهات المرفقة
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              اضغط على أي صورة أو فيديو لعرضه بحجمه الكامل.
            </p>
          </div>
        </div>

        <PublicGallery items={media} />
      </section>

      <footer className="mt-auto border-t border-slate-200/80 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p className="font-bold text-slate-700">{caseInfo.title}</p>
          {caseInfo.contactName || phoneList.length > 0 ? (
            <p className="font-semibold text-slate-600">
              {caseInfo.contactName}{" "}
              {caseInfo.contactName && phoneList.length > 0 ? "•" : ""}{" "}
              <span dir="ltr">{phoneList.join(" | ")}</span>
            </p>
          ) : (
            <p>جميع الحقوق محفوظة</p>
          )}
        </div>
      </footer>
    </main>
  );
}
