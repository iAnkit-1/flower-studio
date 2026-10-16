import { PutObjectCommand } from '@aws-sdk/client-s3';
import db from '../config/db.js';
import { r2Client, BUCKET_NAME, R2_FOLDER } from '../config/r2.js';

async function uploadBase64ToR2(dataUrl, folder = 'product-images') {
  const cleanBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const buffer = Buffer.from(cleanBase64, 'base64');
  const mimeMatch = dataUrl.match(/^data:([^;]+);base64/);
  const contentType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const cleanExt = contentType.split('/')[1] === 'jpeg' ? 'jpg' : (contentType.split('/')[1] || 'jpg');

  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const filename = `prod_${timestamp}_${randomSuffix}.${cleanExt}`;
  const key = `${folder}/${filename}`;

  await r2Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  return filename;
}

function cleanToPureFilename(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('data:image') || url.startsWith('blob:')) return url; // handled separately
  const clean = url.split('?')[0].trim();
  const filename = clean.split('/').pop();
  return filename;
}

async function migrateBase64Images() {
  console.log('====================================================');
  console.log('Starting Migration: Upload base64 images in DB to R2');
  console.log('====================================================');

  try {
    const snapshot = await db.collection('products').get();
    console.log(`Found ${snapshot.docs.length} products in Firestore.`);

    let updatedDocsCount = 0;
    let uploadedImagesCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      let hasChanges = false;
      const updates = {};

      if (Array.isArray(data.images) && data.images.length > 0) {
        const newImages = [];
        for (const img of data.images) {
          if (typeof img === 'string' && (img.startsWith('data:image') || img.startsWith('data:application'))) {
            console.log(`Uploading base64 image for product ${doc.id} ("${data.title}")...`);
            const filename = await uploadBase64ToR2(img, R2_FOLDER || 'product-images');
            newImages.push(filename);
            uploadedImagesCount++;
            hasChanges = true;
          } else if (typeof img === 'string' && img.trim()) {
            const pure = cleanToPureFilename(img);
            if (pure !== img) {
              hasChanges = true;
            }
            newImages.push(pure || img);
          }
        }

        if (hasChanges) {
          updates.images = newImages;
        }
      }

      // Also clean single image/imageUrl if base64
      if (typeof data.image === 'string') {
        if (data.image.startsWith('data:image')) {
          const fn = await uploadBase64ToR2(data.image, R2_FOLDER || 'product-images');
          updates.image = fn;
          hasChanges = true;
        } else {
          const pure = cleanToPureFilename(data.image);
          if (pure !== data.image) {
            updates.image = pure;
            hasChanges = true;
          }
        }
      }

      if (typeof data.imageUrl === 'string') {
        if (data.imageUrl.startsWith('data:image')) {
          const fn = await uploadBase64ToR2(data.imageUrl, R2_FOLDER || 'product-images');
          updates.imageUrl = fn;
          hasChanges = true;
        } else {
          const pure = cleanToPureFilename(data.imageUrl);
          if (pure !== data.imageUrl) {
            updates.imageUrl = pure;
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        await doc.ref.update(updates);
        updatedDocsCount++;
        console.log(`[UPDATED] ${doc.id} (${data.title}) -> Images:`, updates.images || updates.image);
      }
    }

    console.log('====================================================');
    console.log(`Migration Complete!`);
    console.log(`Products updated: ${updatedDocsCount} / ${snapshot.docs.length}`);
    console.log(`Base64 images uploaded to R2: ${uploadedImagesCount}`);
    console.log('====================================================');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

migrateBase64Images().then(() => process.exit(0));
