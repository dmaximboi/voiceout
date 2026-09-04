'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Post images: natural size while loading, click to expand, no inward crop. */
export function PostImages({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState<string | null>(null);

  if (!urls.length) return null;

  return (
    <>
      <div
        className={`mt-3 ${urls.length > 1 ? 'grid grid-cols-2 gap-1.5' : ''}`}
      >
        {urls.map((src) => (
          <PostImageThumb key={src} src={src} multi={urls.length > 1} onOpen={() => setOpen(src)} />
        ))}
      </div>
      {open ? <ImageLightbox src={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function PostImageThumb({
  src,
  multi,
  onOpen,
}: {
  src: string;
  multi: boolean;
  onOpen: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="View full image"
      className={`relative block w-full overflow-hidden rounded-xl bg-[var(--line)]/60 text-left active:opacity-95 ${
        multi ? 'min-h-36' : 'min-h-48'
      }`}
    >
      {!loaded && !failed ? (
        <span
          className={`absolute inset-0 animate-pulse bg-[var(--line)] ${multi ? 'min-h-36' : 'min-h-48'}`}
          aria-hidden
        />
      ) : null}
      {failed ? (
        <span className="grid min-h-36 place-items-center px-3 text-sm text-[var(--muted)]">Image unavailable</span>
      ) : (
        <img
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`relative z-[1] mx-auto max-h-[28rem] w-full object-contain transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </button>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full image"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-3"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close image"
        className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white"
        onClick={onClose}
      >
        <X size={22} strokeWidth={2} />
      </button>
      <img
        src={src}
        alt=""
        className="max-h-[min(92dvh,920px)] max-w-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
