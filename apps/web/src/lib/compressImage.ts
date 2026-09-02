const KB = 1024;
const UNDER = 400 * KB;
const MID = 700 * KB;
const HUGE = 4.5 * 1024 * KB;
const HARD_MAX = 3_000_000;

function targetBytes(size: number) {
  if (size <= UNDER) return size;
  if (size < MID) return Math.max(60 * KB, Math.round(size / 2.4));
  if (size <= HUGE) return 450 * KB;
  return Math.min(HARD_MAX, Math.round(size / 4));
}

function allowedMime(type: string) {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
}

export async function compressImage(file: File): Promise<File> {
  const type = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (file.size <= UNDER && allowedMime(type)) return file;
  const target = targetBytes(file.size);
  if (file.size <= target && allowedMime(type)) return file;

  const bitmap = await decode(file);
  if (!bitmap) {
    if (file.size <= HARD_MAX && allowedMime(type)) return file;
    throw new Error('Could not read that photo. Try a JPEG or PNG from your gallery.');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not compress photo');

  let maxSide = Math.min(2048, Math.max(bitmap.width, bitmap.height));
  let best: Blob | null = null;

  for (let round = 0; round < 6; round++) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let lo = 0.45;
    let hi = 0.92;
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2;
      const blob = await canvasToJpeg(canvas, q);
      if (!blob) break;
      best = blob;
      if (blob.size > target) hi = q;
      else lo = q;
    }
    if (best && best.size <= target) break;
    maxSide = Math.round(maxSide * 0.72);
    if (maxSide < 640) break;
  }

  try {
    bitmap.close();
  } catch {
    /* ImageBitmap.close is optional */
  }

  if (!best) throw new Error('Could not compress photo');
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
