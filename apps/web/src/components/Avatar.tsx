'use client';

export function nameInitial(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return (Array.from(trimmed)[0] ?? '?').toUpperCase();
}

export function Avatar({ name, src, size = 'sm' }: { name: string; src: string | null; size?: 'xs' | 'sm' | 'lg' }) {
  const box =
    size === 'lg' ? 'h-16 w-16 text-[1.7rem]' : size === 'xs' ? 'h-8 w-8 text-[0.82rem]' : 'h-9 w-9 text-[0.95rem]';
  const img = size === 'lg' ? 'h-16 w-16' : size === 'xs' ? 'h-8 w-8' : 'h-9 w-9';
  if (src) return <img src={src} alt="" className={`${img} rounded-full object-cover`} />;
  return (
    <span
      className={`grid ${box} place-items-center rounded-full bg-accent/15 text-accent font-avatar`}
      title={name}
      aria-hidden={!name}
    >
      {nameInitial(name)}
    </span>
  );
}
