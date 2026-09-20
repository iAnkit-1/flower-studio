import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const accountId = process.env.R2_ACCOUNT_ID || '98402096d741cf32c4ce0d16403a7f34';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '66a4bc724a67d1daa53a93aaa74860df';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '3b53eccec397b8a55c965d2952fe8826ec6b0c8d074461ac9b3edd37c4684158';

export const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'flower-studio';
export const R2_FOLDER = process.env.R2_FOLDER || 'product-images';
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});
