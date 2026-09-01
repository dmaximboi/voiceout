import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../env.js';

export function createS3(env: Env) {
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: Boolean(env.S3_FORCE_PATH_STYLE),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  });
}

export async function signedPut(
  env: Env,
  s3: S3Client,
  key: string,
  mime: string,
  bytes: number,
) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: mime,
      ContentLength: bytes,
    }),
    { expiresIn: 60 * 5 },
  );
}

export function publicMediaUrl(mediaId: string) {
  return `/vo-api/media/${mediaId}/file`;
}

export async function signedGet(env: Env, s3: S3Client, key: string) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: 60 * 15 },
  );
}

export async function deleteObject(env: Env, s3: S3Client, key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}
