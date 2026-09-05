export function Logo({ size = 40, wide = false }: { size?: number; wide?: boolean }) {
  const height = size;
  const width = wide ? Math.round(size * 1.35) : size;
  const radius = Math.round(Math.min(height, width) * 0.22);
  return (
    <img
      src="/logo.png"
      alt="VoiceOut"
      width={width}
      height={height}
      className={wide ? 'object-contain' : 'object-cover'}
      style={{ width, height, borderRadius: radius }}
    />
  );
}
