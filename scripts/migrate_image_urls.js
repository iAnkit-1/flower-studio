import db from '../config/db.js';

/**
 * Extracts ONLY the image filename with extension (e.g. prod_1790498832730_311y7c.jpg)
 */
function extractFileName(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('data:image') || url.startsWith('blob:')) return url;

  const clean = url.split('?')[0].trim();
  const filename = clean.split('/').pop();
  return filename;
}

async function migrateProducts() {
  console.log('==================================================');
  console.log('Starting Firestore Image Migration to Pure Filenames');
  console.log('Target format in Firestore: ["prod_xxx.jpg", ...]');
  console.log('==================================================');

  try {
    const snapshot = await db.collection('products').get();
    console.log(`Found ${snapshot.docs.length} products in Firestore.`);

    let updatedCount = 0;
    let totalImagesConverted = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      let hasChanges = false;
      const updates = {};

      // 1. Clean images array
      if (Array.isArray(data.images)) {
        const cleanImages = data.images
          .map((img) => {
            const filename = extractFileName(img);
            if (filename && filename !== img) {
              hasChanges = true;
              totalImagesConverted++;
            }
            return filename;
          })
          .filter(Boolean);

        if (hasChanges) {
          updates.images = cleanImages;
        }
      }

      // 2. Clean single image / imageUrl field if present
      if (data.image && typeof data.image === 'string') {
        const cleaned = extractFileName(data.image);
        if (cleaned && cleaned !== data.image) {
          updates.image = cleaned;
          hasChanges = true;
        }
      }

      if (data.imageUrl && typeof data.imageUrl === 'string') {
        const cleaned = extractFileName(data.imageUrl);
        if (cleaned && cleaned !== data.imageUrl) {
          updates.imageUrl = cleaned;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await doc.ref.update(updates);
        updatedCount++;
        console.log(`[UPDATED] ${doc.id} (${data.title || data.name || 'Untitled'}) -> Images:`, updates.images || updates.image);
      }
    }

    console.log('==================================================');
    console.log('Migration Completed Successfully!');
    console.log(`Products Updated: ${updatedCount} / ${snapshot.docs.length}`);
    console.log(`Total Images Converted to Filenames: ${totalImagesConverted}`);
    console.log('==================================================');

  } catch (error) {
    console.error('Migration failed:', error);
  }
}

migrateProducts().then(() => process.exit(0));
