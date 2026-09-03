const KB = 1024;
/** Leave files already under this alone. */
const LEAVE_UNDER = 200 * KB;
/** Compress larger images down toward this ceiling. */
const TARGET_MAX = 280 * KB;
const HARD_MAX = 3_000_000;

function allowedMime(type: string) {
  const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    base === 'image/jpeg' ||
    base === 'image/jpg' ||
    base === 'image/png' ||
    base === 'image/webp' ||
    base === '' ||
    base === 'application/octet-stream'
  );
}

export async function compressImage(file: File): Promise<File> {
  const type = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (file.size <= LEAVE_UNDER && (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp')) {
    return file;
  }
  if (!allowedMime(type) && type.startsWith('image/') === false && type !== '') {
    // Still try decode — phones often send HEIC / empty type.
  }

  const bitmap = await decode(file);
  if (!bitmap) {
    if (file.size <= HARD_MAX && (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp')) {
      return file;
    }
    throw new Error('Could not read that photo. Try a JPEG or PNG from your gallery.');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not compress photo');

  const target = Math.min(TARGET_MAX, Math.max(LEAVE_UNDER, file.size));
  let maxSide = Math.min(1600, Math.max(bitmap.width, bitmap.height));
  let best: Blob | null = null;

  for (let round = 0; round < 7; round++) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let lo = 0.42;
    let hi = 0.88;
    for (let i = 0; i < 8; i++) {
      const q = (lo + hi) / 2;
      const blob = await canvasToJpeg(canvas, q);
      if (!blob) break;
      best = blob;
      if (blob.size > TARGET_MAX) hi = q;
      else lo = q;
    }
    if (best && best.size <= TARGET_MAX) break;
    maxSide = Math.round(maxSide * 0.75);
    if (maxSide < 480) break;
  }

  try {
    bitmap.close();
  } catch {
    /* ImageBitmap.close is optional */
  }

  if (!best) throw new Error('Could not compress photo');
  if (file.size <= LEAVE_UNDER && best.size >= file.size && (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp')) {
    return file;
  }
  void target;
  return new File([best], 'photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

async function decode(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    /* fall through */
  }
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image'));
      el.src = url;
    });
    URL.revokeObjectURL(url);
    return await createImageBitmap(img);
  } catch {
    return null;
  }
}
