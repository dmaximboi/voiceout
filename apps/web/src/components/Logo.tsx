export function Logo({ size = 40 }: { size?: number }) {
  const radius = Math.round(size * 0.22);
  return (
    <img
      src="/logo.png"
      alt="VoiceOut"
      width={size}
      height={size}
      className="object-cover"
      style={{ width: size, height: size, borderRadius: radius }}
    />
  );
}
