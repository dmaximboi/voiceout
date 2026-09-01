import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DURATION_PROBE_SLACK_MS, type DurationCap } from '@voiceout/shared';

const exec = promisify(execFile);

export function assertFfprobePath(ffprobePath: string) {
  const norm = ffprobePath.replace(/\\/g, '/');
  if (norm.includes('..') || norm.includes('\0')) throw new Error('invalid ffprobe path');
  const base = (norm.split('/').pop() ?? '').toLowerCase();
  if (base !== 'ffprobe' && base !== 'ffprobe.exe') throw new Error('invalid ffprobe path');
  return ffprobePath;
}

export async function probeBuffer(buf: Buffer, ffprobePath: string): Promise<{ durationMs: number; sha256: string }> {
  const bin = assertFfprobePath(ffprobePath);
  const dir = await mkdtemp(join(tmpdir(), 'vo-probe-'));
  const file = join(dir, 'audio.bin');
  try {
    await writeFile(file, buf);
    const { stdout } = await exec(bin, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    const seconds = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('bad duration');
    return { durationMs: Math.round(seconds * 1000), sha256: createHash('sha256').update(buf).digest('hex') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function withinCap(durationMs: number, cap: DurationCap) {
  return durationMs <= cap * 1000 + DURATION_PROBE_SLACK_MS;
}
