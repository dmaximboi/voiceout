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

/**
 * Reject clear executables / server payloads.
 * Valid jpeg/png/webp/audio magic skips the latin1 polyglot scan — binary images
 * often contain accidental byte sequences like "<script" and were false-rejecting.
 */
export function looksLikeHostileUpload(buf: Uint8Array): boolean {
  if (buf.length < 2) return true;
  // Windows PE / DOS MZ
  if (buf[0] === 0x4d && buf[1] === 0x5a) return true;
  // ELF
  if (buf[0] === 0x7f && at(buf, 1, 'ELF')) return true;

  const sniffed = sniffUploadMime(buf);
  if (sniffed) {
    // Trusted container types: only reject if PE/ELF already matched above.
    return false;
  }

  // Bare ZIP/JAR/APK when not a known media type
  if (at(buf, 0, 'PK')) return true;

  // Non-media: scan a small prefix for obvious server/script payloads
  const sampleLen = Math.min(buf.length, 8_192);
  const text = new TextDecoder('latin1').decode(buf.subarray(0, sampleLen)).toLowerCase();
  const markers = ['<?php', '<%=', '<jsp:', '#!/bin/', 'powershell -', 'cmd.exe', 'application/x-msdownload'];
  return markers.some((m) => text.includes(m));
}
