"use client";

import React, { useEffect, useState, useCallback } from "react";

interface MediaItem {
  id: string;
  title: string;
  caption: string | null;
  kind: "image" | "video";
  url: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface CaseInfo {
  title: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactPhone2: string;
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");
  const [maxUploadMb, setMaxUploadMb] = useState(25);
  const [googleSheetsConnected, setGoogleSheetsConnected] = useState(false);

  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [caseInfo, setCaseInfo] = useState<CaseInfo>({
    title: "",
    description: "",
    contactName: "",
    contactPhone: "",
    contactPhone2: "",
  });
  const [caseSaving, setCaseSaving] = useState(false);

  // التبديل بين رفع ملف من الجهاز أو إضافة رابط مباشر (مثل Google Drive)
  const [addMode, setAddMode] = useState<"file" | "link">("file");

  // حالة رفع ملف من الجهاز
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [uploading, setUploading] = useState(false);

  // حالة إضافة رابط مباشر (Google Drive أو رابط خارجي)
  const [externalUrl, setExternalUrl] = useState("");
  const [externalKind, setExternalKind] = useState<"image" | "video">("image");
  const [externalTitle, setExternalTitle] = useState("");
  const [externalCaption, setExternalCaption] = useState("");
  const [addingLink, setAddingLink] = useState(false);

  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/media", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        setAuthenticated(Boolean(data.authenticated));
        setCsrfToken(data.csrfToken || "");
        setMaxUploadMb(data.maxUploadMb || 25);
        setGoogleSheetsConnected(Boolean(data.googleSheetsConnected));
        if (data.caseInfo) {
          setCaseInfo({
            title: data.caseInfo.title || "",
            description: data.caseInfo.description || "",
            contactName: data.caseInfo.contactName || "",
            contactPhone: data.caseInfo.contactPhone || "",
            contactPhone2: data.caseInfo.contactPhone2 || "",
          });
        }
        setMediaList(Array.isArray(data.media) ? data.media : []);
      }
    } catch {
      setStatusBanner({
        type: "error",
        text: "تعذر الاتصال بالخادم لجلب البيانات.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);

    try {
      const res = await fetch("/api/media", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          action: "login",
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "فشل تسجيل الدخول.");
        return;
      }

      setPassword("");
      setCsrfToken(data.csrfToken || csrfToken);
      setAuthenticated(true);
      await fetchDashboardData();
    } catch {
      setAuthError("حدث خطأ في الاتصال بالخادم.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      const res = await fetch("/api/media", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ action: "logout" }),
      });
      const data = await res.json();
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      setAuthenticated(false);
    } catch {
      setAuthenticated(false);
    }
  }

  async function handleSaveCaseInfo(e: React.FormEvent) {
    e.preventDefault();
    setCaseSaving(true);
    setStatusBanner(null);

    try {
      const res = await fetch("/api/media", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          action: "updateCase",
          title: caseInfo.title,
          description: caseInfo.description,
          contactName: caseInfo.contactName,
          contactPhone: caseInfo.contactPhone,
          contactPhone2: caseInfo.contactPhone2,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: "error",
          text: data.error || "تعذر حفظ بيانات القضية.",
        });
        return;
      }

      setStatusBanner({
        type: "success",
        text: "تم حفظ التعديلات وأرقام التواصل في Google Sheets والصفحة العامة فوراً.",
      });
    } catch {
      setStatusBanner({
        type: "error",
        text: "حدث خطأ أثناء حفظ بيانات القضية.",
      });
    } finally {
      setCaseSaving(false);
    }
  }

  async function handleUploadMedia(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      setStatusBanner({
        type: "error",
        text: "يرجى اختيار ملف صورة أو فيديو أولاً.",
      });
      return;
    }

    setUploading(true);
    setStatusBanner(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", mediaTitle);
      formData.append("caption", mediaCaption);

      const res = await fetch("/api/upload", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-csrf-token": csrfToken,
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: "error",
          text: data.error || "فشل رفع الملف.",
        });
        return;
      }

      setSelectedFile(null);
      setMediaTitle("");
      setMediaCaption("");
      const fileInput = document.getElementById(
        "media-file-input"
      ) as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";

      setStatusBanner({
        type: "success",
        text: data.message || "تم رفع الملف ونشره في الصفحة العامة فوراً.",
      });

      await fetchDashboardData();
    } catch {
      setStatusBanner({
        type: "error",
        text: "حدث خطأ في الشبكة أثناء رفع الملف.",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleAddExternalLink(e: React.FormEvent) {
    e.preventDefault();
    if (!externalUrl.trim()) {
      setStatusBanner({
        type: "error",
        text: "يرجى إدخال رابط الصورة أو الفيديو أولاً.",
      });
      return;
    }

    setAddingLink(true);
    setStatusBanner(null);

    try {
      const res = await fetch("/api/media", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          action: "addExternalMedia",
          url: externalUrl,
          kind: externalKind,
          title: externalTitle || "مرفق توثيقي",
          caption: externalCaption,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: "error",
          text: data.error || "تعذر إضافة الرابط.",
        });
        return;
      }

      setExternalUrl("");
      setExternalTitle("");
      setExternalCaption("");
      setStatusBanner({
        type: "success",
        text: "تمت إضافة الرابط وتسجيله في Google Sheets والصفحة العامة فوراً.",
      });

      await fetchDashboardData();
    } catch {
      setStatusBanner({
        type: "error",
        text: "حدث خطأ أثناء إضافة الرابط.",
      });
    } finally {
      setAddingLink(false);
    }
  }

  async function handleDeleteMedia(id: string, title: string) {
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف "${title}" نهائياً من العرض العام؟`
    );
    if (!confirmed) return;

    setStatusBanner(null);
    try {
      const res = await fetch("/api/media", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          action: "deleteMedia",
          id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: "error",
          text: data.error || "تعذر حذف العنصر.",
        });
        return;
      }

      setMediaList((prev) => prev.filter((item) => item.id !== id));
      setStatusBanner({
        type: "success",
        text: "تم حذف العنصر وإزالته من Google Sheets والصفحة العامة فوراً.",
      });
    } catch {
      setStatusBanner({
        type: "error",
        text: "حدث خطأ أثناء حذف العنصر.",
      });
    }
  }

  function handleDropFile(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F7F9] p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-teal-600 border-t-transparent animate-spin" />
          <div className="text-slate-600 text-sm font-bold">
            جاري تحميل لوحة الإدارة...
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F7F9] px-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200/80 p-8 sm:p-10">
          <div className="mb-7 text-center">
            <div className="mx-auto inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-700 text-white shadow-md mb-4">
              🔒
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900">
              تسجيل دخول الإدارة
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
              أدخل كلمة المرور لإدارة محتوى الصفحة وأرقام التواصل والوسائط
            </p>
          </div>

          {authError && (
            <div className="mb-5 rounded-2xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-700 font-semibold">
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                htmlFor="admin-password"
                className="block text-xs font-bold text-slate-700 mb-2"
              >
                كلمة المرور
              </label>
              <input
                id="admin-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm focus:bg-white focus:border-teal-600 focus:outline-none transition"
              />
            </div>

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full rounded-xl bg-teal-700 text-white py-3 text-sm font-bold hover:bg-teal-600 disabled:opacity-50 transition shadow-sm"
            >
              {authSubmitting ? "جاري الدخول..." : "تسجيل الدخول"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7F9] pb-16">
      <header className="bg-[#0F172A] text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-teal-400" />
            <div>
              <h1 className="text-base sm:text-lg font-extrabold">
                لوحة إدارة المحتوى وأرقام التواصل
              </h1>
              <p className="text-[11px] text-slate-400">
                {googleSheetsConnected
                  ? "✅ متصل مباشرة بقاعدة بيانات Google Sheets"
                  : "يعمل على التخزين المحلي (أضف GOOGLE_SCRIPT_URL في .env للربط مع Google Sheets)"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-600 text-xs font-bold text-white transition"
            >
              فتح الصفحة العامة ↗
            </a>
            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-rose-600 text-xs font-bold text-white transition"
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-8">
        {statusBanner && (
          <div
            className={`rounded-2xl p-4 text-sm font-bold border flex items-center justify-between ${
              statusBanner.type === "success"
                ? "bg-teal-50 border-teal-200 text-teal-900"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            <span>{statusBanner.text}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-xs opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 space-y-8">
            {/* 1. بطاقة تعديل العنوان والوصف والاسم ورقمي التواصل والواتساب */}
            <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm">
              <h2 className="text-base font-extrabold text-slate-900 mb-1">
                بيانات القضية وأرقام التواصل والواتساب
              </h2>
              <p className="text-xs text-slate-500 mb-5">
                أي رقم تضيفه هنا سيظهر له تلقائياً زر اتصال مباشر وزر محادثة واتساب في الصفحة العامة.
              </p>

              <form onSubmit={handleSaveCaseInfo} className="space-y-4">
                <div>
                  <label
                    htmlFor="case-title"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    عنوان القضية *
                  </label>
                  <input
                    id="case-title"
                    type="text"
                    required
                    maxLength={200}
                    value={caseInfo.title}
                    onChange={(e) =>
                      setCaseInfo((prev) => ({ ...prev, title: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="case-description"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    تفاصيل ووصف القضية *
                  </label>
                  <textarea
                    id="case-description"
                    rows={5}
                    required
                    maxLength={5000}
                    value={caseInfo.description}
                    onChange={(e) =>
                      setCaseInfo((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-3">
                  <div>
                    <label
                      htmlFor="contact-name"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      الاسم الشخصي (للتواصل)
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      maxLength={120}
                      value={caseInfo.contactName}
                      onChange={(e) =>
                        setCaseInfo((prev) => ({
                          ...prev,
                          contactName: e.target.value,
                        }))
                      }
                      placeholder="مثال: عبدالرحمن إبراهيم"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="contact-phone"
                        className="block text-xs font-bold text-slate-700 mb-1.5"
                      >
                        رقم التواصل الأول (هاتف / واتساب)
                      </label>
                      <input
                        id="contact-phone"
                        type="text"
                        maxLength={40}
                        dir="ltr"
                        value={caseInfo.contactPhone}
                        onChange={(e) =>
                          setCaseInfo((prev) => ({
                            ...prev,
                            contactPhone: e.target.value,
                          }))
                        }
                        placeholder="010xxxxxxxx"
                        className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="contact-phone-2"
                        className="block text-xs font-bold text-slate-700 mb-1.5"
                      >
                        رقم التواصل الثاني الإضافي (اختياري)
                      </label>
                      <input
                        id="contact-phone-2"
                        type="text"
                        maxLength={40}
                        dir="ltr"
                        value={caseInfo.contactPhone2}
                        onChange={(e) =>
                          setCaseInfo((prev) => ({
                            ...prev,
                            contactPhone2: e.target.value,
                          }))
                        }
                        placeholder="011xxxxxxxx"
                        className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={caseSaving}
                  className="w-full rounded-xl bg-teal-700 hover:bg-teal-600 text-white py-3 text-sm font-bold disabled:opacity-50 transition shadow-sm"
                >
                  {caseSaving ? "جاري الحفظ..." : "حفظ التعديلات وأرقام التواصل"}
                </button>
              </form>
            </section>

            {/* 2. بطاقة إضافة صورة أو فيديو (إما برفع ملف أو بلصق رابط Google Drive / مباشر) */}
            <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-extrabold text-slate-900">
                  إضافة صورة أو فيديو
                </h2>

                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setAddMode("file")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      addMode === "file"
                        ? "bg-white text-teal-800 shadow-sm"
                        : "text-slate-600"
                    }`}
                  >
                    رفع من الجهاز
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddMode("link")}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      addMode === "link"
                        ? "bg-white text-teal-800 shadow-sm"
                        : "text-slate-600"
                    }`}
                  >
                    رابط Google Drive / مباشر
                  </button>
                </div>
              </div>

              {addMode === "file" ? (
                <form onSubmit={handleUploadMedia} className="space-y-4">
                  <label
                    htmlFor="media-file-input"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDropFile}
                    className={`block cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition ${
                      isDragging
                        ? "border-teal-500 bg-teal-50/50"
                        : "border-slate-300 hover:border-slate-400 bg-slate-50/60"
                    }`}
                  >
                    <input
                      id="media-file-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                      onChange={(e) =>
                        setSelectedFile(e.target.files?.[0] || null)
                      }
                      className="sr-only"
                    />

                    {selectedFile && previewUrl ? (
                      <div className="space-y-3">
                        <div className="w-full aspect-video rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center">
                          {selectedFile.type.startsWith("video/") ? (
                            <video
                              src={previewUrl}
                              className="w-full h-full object-contain"
                              controls
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewUrl}
                              alt="معاينة الملف"
                              className="w-full h-full object-contain"
                            />
                          )}
                        </div>
                        <div className="text-xs font-bold text-slate-800 truncate">
                          {selectedFile.name}
                        </div>
                      </div>
                    ) : (
                      <div className="py-4">
                        <div className="mx-auto w-11 h-11 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center mb-2.5">
                          ⬆️
                        </div>
                        <div className="text-xs font-bold text-slate-800">
                          اسحب وأفلت الصورة أو الفيديو هنا، أو اضغط للاختيار
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          يتم حفظها وتسجيلها تلقائياً في Google Sheets
                        </div>
                      </div>
                    )}
                  </label>

                  <div>
                    <label
                      htmlFor="media-title"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      عنوان الصورة أو الفيديو
                    </label>
                    <input
                      id="media-title"
                      type="text"
                      maxLength={140}
                      value={mediaTitle}
                      onChange={(e) => setMediaTitle(e.target.value)}
                      placeholder="اكتب عنواناً توضيحياً..."
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="media-caption"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      شرح إضافي (اختياري)
                    </label>
                    <textarea
                      id="media-caption"
                      rows={3}
                      maxLength={500}
                      value={mediaCaption}
                      onChange={(e) => setMediaCaption(e.target.value)}
                      placeholder="اكتب أي تفاصيل إضافية تحت الصورة أو الفيديو..."
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={uploading}
                    className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white py-3 text-sm font-bold disabled:opacity-50 transition shadow-sm"
                  >
                    {uploading ? "جاري الرفع والتسجيل في الشيت..." : "رفع ونشر في الصفحة العامة"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleAddExternalLink} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      نوع المرفق
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setExternalKind("image")}
                        className={`py-2 rounded-xl text-xs font-bold border transition ${
                          externalKind === "image"
                            ? "bg-teal-50 border-teal-600 text-teal-800"
                            : "border-slate-200 text-slate-600"
                        }`}
                      >
                        صورة
                      </button>
                      <button
                        type="button"
                        onClick={() => setExternalKind("video")}
                        className={`py-2 rounded-xl text-xs font-bold border transition ${
                          externalKind === "video"
                            ? "bg-teal-50 border-teal-600 text-teal-800"
                            : "border-slate-200 text-slate-600"
                        }`}
                      >
                        فيديو
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="external-url"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      رابط الصورة أو الفيديو (يدعم روابط مشاركة Google Drive) *
                    </label>
                    <input
                      id="external-url"
                      type="url"
                      required
                      dir="ltr"
                      value={externalUrl}
                      onChange={(e) => setExternalUrl(e.target.value)}
                      placeholder="https://drive.google.com/file/d/.../view"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="external-title"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      عنوان الصورة أو الفيديو *
                    </label>
                    <input
                      id="external-title"
                      type="text"
                      required
                      maxLength={140}
                      value={externalTitle}
                      onChange={(e) => setExternalTitle(e.target.value)}
                      placeholder="اكتب عنواناً توضيحياً..."
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="external-caption"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      شرح إضافي (اختياري)
                    </label>
                    <textarea
                      id="external-caption"
                      rows={3}
                      maxLength={500}
                      value={externalCaption}
                      onChange={(e) => setExternalCaption(e.target.value)}
                      placeholder="اكتب أي تفاصيل إضافية..."
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={addingLink}
                    className="w-full rounded-xl bg-teal-700 hover:bg-teal-600 text-white py-3 text-sm font-bold disabled:opacity-50 transition shadow-sm"
                  >
                    {addingLink ? "جاري الإضافة للشيت..." : "إضافة الرابط إلى Google Sheets والموقع"}
                  </button>
                </form>
              )}
            </section>
          </div>

          <div className="lg:col-span-7">
            <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">
                    الصور والفيديوهات المنشورة ({mediaList.length})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    يمكنك معاينة أو حذف أي عنصر ليختفي فوراً من Google Sheets والصفحة العامة.
                  </p>
                </div>
              </div>

              {mediaList.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-12 text-center text-sm text-slate-500">
                  لا توجد ملفات مرفوعة حتى الآن.
                </div>
              ) : (
                <div className="space-y-4">
                  {mediaList.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-2xl border border-slate-200 hover:border-slate-300 transition bg-slate-50/40"
                    >
                      <div className="w-full sm:w-36 aspect-video rounded-xl bg-slate-950 overflow-hidden shrink-0 flex items-center justify-center">
                        {item.kind === "video" ? (
                          <video
                            src={item.url}
                            className="w-full h-full object-cover"
                            muted
                            preload="metadata"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.url}
                            alt={item.title}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                              item.kind === "video"
                                ? "bg-teal-100 text-teal-800"
                                : "bg-slate-200 text-slate-800"
                            }`}
                          >
                            {item.kind === "video" ? "فيديو" : "صورة"}
                          </span>
                          <h3 className="text-sm font-bold text-slate-900 truncate">
                            {item.title}
                          </h3>
                        </div>
                        {item.caption && (
                          <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                            {item.caption}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition"
                        >
                          عرض
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDeleteMedia(item.id, item.title)}
                          className="px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-700 text-xs font-bold border border-rose-200 transition"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
