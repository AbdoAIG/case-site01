"use client";

import React, { useState, useMemo, useEffect } from "react";

export interface PublicMediaItem {
  id: string;
  title: string;
  caption: string | null;
  kind: "image" | "video";
  url: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface PublicGalleryProps {
  items: PublicMediaItem[];
}

function formatArabicDate(isoDate: string): string {
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(isoDate));
  } catch {
    return isoDate.slice(0, 10);
  }
}

// استخراج معرف يوتيوب لعرض فيديوهات YouTube من الإنترنت مباشرة
function getYouTubeId(url: string): string | null {
  const u = (url || "").trim();
  const shortMatch = u.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch?.[1]) return shortMatch[1];
  const watchMatch = u.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch?.[1]) return watchMatch[1];
  const embedMatch = u.match(/youtube\.com\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch?.[1]) return embedMatch[1];
  return null;
}

/**
 * مكون ذكي لعرض الصور: يحمّل رابط الإنترنت مباشرة، وإذا كان الموقع الخارجي يمنع Hotlinking
 * يتحول تلقائياً في أجزاء من الثانية إلى البروكسي المحلي (/api/media?remoteUrl=...)
 */
function SmartImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [imgSrc, setImgSrc] = useState(src);
  const [triedProxy, setTriedProxy] = useState(false);

  useEffect(() => {
    setImgSrc(src);
    setTriedProxy(false);
  }, [src]);

  function handleError() {
    if (
      !triedProxy &&
      (src.startsWith("http://") || src.startsWith("https://"))
    ) {
      setTriedProxy(true);
      setImgSrc(`/api/media?remoteUrl=${encodeURIComponent(src)}&kind=image`);
    }
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imgSrc}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={handleError}
      className={className}
    />
  );
}

export default function PublicGallery({ items }: PublicGalleryProps) {
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesFilter = filter === "all" || item.kind === filter;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        (item.caption && item.caption.toLowerCase().includes(q));
      return matchesFilter && matchesQuery;
    });
  }, [items, filter, searchQuery]);

  const activeItem =
    activeIndex !== null ? filteredItems[activeIndex] || null : null;

  useEffect(() => {
    if (activeIndex === null) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setActiveIndex(null);
      if (e.key === "ArrowLeft") {
        setActiveIndex((prev) =>
          prev !== null ? (prev + 1) % filteredItems.length : null
        );
      }
      if (e.key === "ArrowRight") {
        setActiveIndex((prev) =>
          prev !== null
            ? (prev - 1 + filteredItems.length) % filteredItems.length
            : null
        );
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, filteredItems.length]);

  const imagesCount = items.filter((m) => m.kind === "image").length;
  const videosCount = items.filter((m) => m.kind === "video").length;

  return (
    <div className="space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl border border-slate-200/70 p-3.5 sm:p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setFilter("all");
              setActiveIndex(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              filter === "all"
                ? "bg-teal-700 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            الكل ({items.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setFilter("image");
              setActiveIndex(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              filter === "image"
                ? "bg-teal-700 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            الصور ({imagesCount})
          </button>
          <button
            type="button"
            onClick={() => {
              setFilter("video");
              setActiveIndex(null);
            }}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              filter === "video"
                ? "bg-teal-700 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            الفيديوهات ({videosCount})
          </button>
        </div>

        {items.length > 0 && (
          <div className="relative w-full sm:w-72">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setActiveIndex(null);
              }}
              placeholder="ابحث في الصور والفيديوهات..."
              className="w-full rounded-xl border border-slate-200 bg-[#F8FAFC] pr-9 pl-3.5 py-2 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-teal-600 focus:outline-none transition"
            />
            <svg
              className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        )}
      </div>

      {filteredItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-14 text-center shadow-sm">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-600 mb-3">
            <svg
              className="w-7 h-7"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 className="text-base font-bold text-slate-800">
            {items.length === 0
              ? "لا توجد صور أو فيديوهات مضافة حالياً"
              : "لا توجد نتائج مطابقة لبحثك"}
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {items.length === 0
              ? "ستظهر الصور ومقاطع الفيديو هنا فور إضافتها."
              : "جرّب البحث بكلمات أخرى أو اختيار (الكل)."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item, idx) => {
            const ytId = getYouTubeId(item.url);

            return (
              <article
                key={item.id}
                onClick={() => setActiveIndex(idx)}
                className="group cursor-pointer bg-white rounded-2xl border border-slate-200/75 overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col"
              >
                <div
                  className={`relative aspect-[16/10] w-full overflow-hidden flex items-center justify-center ${
                    item.kind === "video" ? "bg-slate-900" : "bg-slate-100"
                  }`}
                >
                  {item.kind === "video" ? (
                    ytId ? (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <SmartImage
                          src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`}
                          alt={item.title}
                          className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-slate-950/30 flex items-center justify-center">
                          <span className="w-14 h-14 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                            <svg
                              className="w-6 h-6 translate-x-0.5"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <video
                          preload="metadata"
                          playsInline
                          muted
                          className="w-full h-full object-cover opacity-95 group-hover:scale-105 transition-transform duration-500"
                        >
                          <source src={item.url} type={item.mimeType} />
                        </video>
                        <div className="absolute inset-0 bg-slate-950/25 group-hover:bg-slate-950/35 transition-colors flex items-center justify-center">
                          <span className="w-14 h-14 rounded-full bg-white/95 text-teal-800 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                            <svg
                              className="w-6 h-6 translate-x-0.5"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="relative w-full h-full flex items-center justify-center">
                      <SmartImage
                        src={item.url}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                  )}

                  <span
                    className={`absolute top-3 right-3 px-2.5 py-1 rounded-lg text-xs font-bold backdrop-blur-md shadow-sm ${
                      item.kind === "video"
                        ? "bg-teal-700/90 text-white"
                        : "bg-slate-800/80 text-white"
                    }`}
                  >
                    {item.kind === "video" ? "فيديو" : "صورة"}
                  </span>
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-base sm:text-lg leading-snug group-hover:text-teal-700 transition-colors">
                      {item.title}
                    </h3>
                    {item.caption && (
                      <p className="mt-2 text-sm text-slate-600 leading-relaxed whitespace-pre-line line-clamp-3">
                        {item.caption}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                    <span>{formatArabicDate(item.createdAt)}</span>
                    <span className="font-bold text-teal-700 group-hover:translate-x-[-2px] transition-transform">
                      عرض بالحجم الكامل ←
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {activeItem && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 overflow-y-auto"
          onClick={() => setActiveIndex(null)}
        >
          <div
            className="max-w-5xl w-full mx-auto flex items-center justify-between text-white py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-lg bg-white/10 text-xs font-mono">
                {(activeIndex ?? 0) + 1} / {filteredItems.length}
              </span>
              <h3 className="text-sm sm:text-base font-bold truncate max-w-xs sm:max-w-lg">
                {activeItem.title}
              </h3>
            </div>

            <button
              type="button"
              onClick={() => setActiveIndex(null)}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-rose-600 text-white flex items-center justify-center text-base font-bold transition"
              aria-label="إغلاق"
            >
              ✕
            </button>
          </div>

          <div
            className="my-auto max-w-5xl w-full mx-auto flex items-center justify-center relative py-4"
            onClick={(e) => e.stopPropagation()}
          >
            {filteredItems.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setActiveIndex(
                    ((activeIndex ?? 0) - 1 + filteredItems.length) %
                      filteredItems.length
                  )
                }
                className="hidden sm:flex absolute -right-14 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white items-center justify-center transition"
                aria-label="السابق"
              >
                →
              </button>
            )}

            <div className="w-full max-h-[75vh] rounded-2xl overflow-hidden bg-slate-900 border border-white/10 shadow-2xl flex items-center justify-center">
              {activeItem.kind === "video" ? (
                getYouTubeId(activeItem.url) ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${getYouTubeId(activeItem.url)}?autoplay=1`}
                    title={activeItem.title}
                    className="w-full aspect-video max-h-[75vh]"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <video
                    key={activeItem.url}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-[75vh] w-full object-contain"
                  >
                    <source src={activeItem.url} type={activeItem.mimeType} />
                  </video>
                )
              ) : (
                <SmartImage
                  src={activeItem.url}
                  alt={activeItem.title}
                  className="max-h-[75vh] w-auto object-contain mx-auto"
                />
              )}
            </div>

            {filteredItems.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setActiveIndex(((activeIndex ?? 0) + 1) % filteredItems.length)
                }
                className="hidden sm:flex absolute -left-14 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white items-center justify-center transition"
                aria-label="التالي"
              >
                ←
              </button>
            )}
          </div>

          {activeItem.caption && (
            <div
              className="max-w-3xl w-full mx-auto bg-white/10 border border-white/10 rounded-2xl p-4 text-slate-100 text-sm leading-relaxed text-center"
              onClick={(e) => e.stopPropagation()}
            >
              {activeItem.caption}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
