function at(buf: Uint8Array, offset: number, bytes: number[] | string) {
  const sig = typeof bytes === 'string' ? [...bytes].map((c) => c.charCodeAt(0)) : bytes;
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

/** Infer a declared MIME from file magic when the browser sends a blank/wrong type. */
export function sniffUploadMime(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (at(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(buf, 0, 'RIFF') && at(buf, 8, 'WEBP')) return 'image/webp';
  if (at(buf, 0, 'OggS')) return 'audio/ogg';
  if (at(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  if (at(buf, 4, 'ftyp')) return 'audio/mp4';
  if (at(buf, 0, 'ID3') || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

export function matchesUploadMagic(mime: string, buf: Uint8Array): boolean {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (buf.length < 12) return false;
  if (base === 'audio/ogg' || base === 'application/ogg') return at(buf, 0, 'OggS');
  if (base === 'audio/webm' || base === 'video/webm') return at(buf, 0, [0x1a, 0x45, 0xdf, 0xa3]);
  if (base === 'audio/mp4' || base === 'video/mp4' || base === 'audio/m4a' || base === 'audio/x-m4a') {
    return at(buf, 4, 'ftyp');
  }
  if (base === 'audio/mpeg' || base === 'audio/mp3') {
    const id3 = at(buf, 0, 'ID3');
    const frame = buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0;
    return id3 || frame;
  }
  if (base === 'image/jpeg' || base === 'image/jpg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (base === 'image/png') return at(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (base === 'image/webp') return at(buf, 0, 'RIFF') && at(buf, 8, 'WEBP');
  // Unknown declared type — accept if magic sniffs to anything we support.
  return sniffUploadMime(buf) !== null;
}
