function at(buf: Uint8Array, offset: number, bytes: number[] | string) {
  const sig = typeof bytes === 'string' ? [...bytes].map((c) => c.charCodeAt(0)) : bytes;
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

export function matchesUploadMagic(mime: string, buf: Uint8Array): boolean {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (buf.length < 12) return false;
  if (base === 'audio/ogg') return at(buf, 0, 'OggS');
  if (base === 'audio/webm') return at(buf, 0, [0x1a, 0x45, 0xdf, 0xa3]);
  if (base === 'audio/mp4') return at(buf, 4, 'ftyp');
  if (base === 'audio/mpeg') {
    const id3 = at(buf, 0, 'ID3');
    const frame = buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0;
    return id3 || frame;
  }
  if (base === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (base === 'image/png') return at(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (base === 'image/webp') return at(buf, 0, 'RIFF') && at(buf, 8, 'WEBP');
  return false;
}
