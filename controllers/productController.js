import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import db from '../config/db.js';
import { r2Client, BUCKET_NAME, R2_FOLDER, R2_PUBLIC_URL } from '../config/r2.js';

const MAX_IMAGES = 5;

export const extractImageFileName = (url) => {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('data:image') || url.startsWith('blob:')) return url;
  const clean = url.split('?')[0].trim();
  const filename = clean.split('/').pop();
  return filename;
};

/**
 * Helper to generate public image URL dynamically from a filename or legacy URL
 */
export const normalizeImageUrl = (url, req) => {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('data:image') || url.startsWith('blob:')) return url;

  const filename = extractImageFileName(url);
  if (!filename) return url;

  const folder = R2_FOLDER || 'product-images';

  const cdnBase = (R2_PUBLIC_URL && !R2_PUBLIC_URL.includes('.r2.cloudflarestorage.com'))
    ? R2_PUBLIC_URL
    : 'https://cdn.flowerstudiobypushpraj.com';

  return `${cdnBase}/${folder}/${filename}`;
};

export const getPublicImageUrl = (key, req) => {
  return normalizeImageUrl(key, req);
};

export const normalizeStringArray = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .map((item) => (typeof item === 'string' ? item.trim() : String(item).trim()))
          .filter((item) => item.length > 0)
      )
    );
  }
  if (typeof input === 'string') {
    return Array.from(
      new Set(
        input
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      )
    );
  }
  return [];
};

export const normalizeAvailableCombos = (combos) => {
  if (!combos) return [];
  const merged = {};

  if (Array.isArray(combos)) {
    for (const item of combos) {
      if (typeof item === 'object' && item !== null) {
        if (item.weight !== undefined && item.price !== undefined) {
          const w = String(item.weight).trim();
          const p = typeof item.price === 'number' ? item.price : parseFloat(String(item.price).replace(/[^0-9.]/g, '')) || 0;
          if (w) merged[w] = p;
        } else {
          for (const [k, v] of Object.entries(item)) {
            const numVal = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
            if (k && k.trim()) merged[k.trim()] = numVal;
          }
        }
      }
    }
  } else if (typeof combos === 'object' && combos !== null) {
    for (const [k, v] of Object.entries(combos)) {
      const numVal = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
      if (k && k.trim()) merged[k.trim()] = numVal;
    }
  }

  if (Object.keys(merged).length > 0) {
    return [merged];
  }
  return [];
};

/*
|--------------------------------------------------------------------------
| Serve R2 Image (Public Image Proxy Stream)
|--------------------------------------------------------------------------
*/

export const serveR2Image = async (req, res) => {
  try {
    let key = req.params[0] || req.params.key || req.query.key;
    if (!key) {
      return res.status(400).send('Missing image key');
    }

    key = key.replace(/^\/+/, '');
    if (!key.startsWith(R2_FOLDER)) {
      key = `${R2_FOLDER}/${key}`;
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const s3Response = await r2Client.send(command);

    res.setHeader('Content-Type', s3Response.ContentType || 'image/jpeg');
    if (s3Response.ContentLength) {
      res.setHeader('Content-Length', s3Response.ContentLength);
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    if (s3Response.Body && typeof s3Response.Body.pipe === 'function') {
      return s3Response.Body.pipe(res);
    } else if (s3Response.Body && typeof s3Response.Body.transformToByteArray === 'function') {
      const byteArray = await s3Response.Body.transformToByteArray();
      return res.send(Buffer.from(byteArray));
    } else {
      const buffer = await s3Response.Body.transformToString('base64');
      return res.send(Buffer.from(buffer, 'base64'));
    }
  } catch (error) {
    console.error('Error serving image from R2:', error);
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return res.status(404).send('Image not found');
    }
    return res.status(500).send('Failed to fetch image');
  }
};

/*
|--------------------------------------------------------------------------
| Get R2 Upload Pre-signed URL
|--------------------------------------------------------------------------
*/

export const getR2UploadPresignedUrl = async (req, res) => {
  try {
    const { fileName, contentType } = req.body || {};

    const cleanExt = fileName && fileName.includes('.')
      ? fileName.split('.').pop().toLowerCase()
      : 'jpg';

    const safeContentType = contentType || `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}`;
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const key = `${R2_FOLDER}/prod_${timestamp}_${randomSuffix}.${cleanExt}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: safeContentType,
    });

    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
    const publicUrl = getPublicImageUrl(key, req);

    return res.status(200).json({
      success: true,
      uploadUrl,
      publicUrl,
      key,
      contentType: safeContentType,
    });
  } catch (error) {
    console.error('R2 pre-signed URL generation failed:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to generate R2 upload URL.',
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Direct Backend Upload to R2 (Fallback / Direct)
|--------------------------------------------------------------------------
*/

export const uploadDirectToR2 = async (req, res) => {
  try {
    const { base64, fileName, contentType } = req.body || {};
    if (!base64) {
      return res.status(400).json({ success: false, message: 'Missing base64 image data.' });
    }

    const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
    const buffer = Buffer.from(cleanBase64, 'base64');

    const cleanExt = fileName && fileName.includes('.')
      ? fileName.split('.').pop().toLowerCase()
      : 'jpg';

    const safeContentType = contentType || `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}`;
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const key = `${R2_FOLDER}/prod_${timestamp}_${randomSuffix}.${cleanExt}`;

    await r2Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: safeContentType,
    }));

    const publicUrl = getPublicImageUrl(key, req);

    return res.status(200).json({
      success: true,
      publicUrl,
      key,
    });
  } catch (error) {
    console.error('Direct R2 upload failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload image to R2 directly.',
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Create Product
|--------------------------------------------------------------------------
*/

export const createProduct = async (req, res) => {
  const {
    id,
    hsnCode,
    barcode,
    sku,
    title,
    description,
    mrp,
    salePrice,
    discountPercentage,
    ratings,
    reviewsCount,
    category,
    subCategory,
    availability,
    stock,
    tags,
    addons,
    occasions,
    images,
    addOns,
    similarItems,
    availableCombos,
    available_combos,
  } = req.body;

  if (
    !title ||
    mrp === undefined ||
    salePrice === undefined ||
    !category ||
    !subCategory ||
    !availability ||
    stock === undefined
  ) {
    return res.status(400).json({
      success: false,
      message: 'Missing required product parameters.',
    });
  }

  if (images !== undefined && !Array.isArray(images)) {
    return res.status(400).json({
      success: false,
      message: 'Images must be an array.',
    });
  }

  if (images && images.length > MAX_IMAGES) {
    return res.status(400).json({
      success: false,
      message: `Maximum ${MAX_IMAGES} images are allowed.`,
    });
  }

  const cleanImageNames = (images || [])
    .map(extractImageFileName)
    .filter(Boolean);

  const productId =
    id ||
    `PROD-${Math.floor(1000 + Math.random() * 9000)}`;

  const productData = {
    id: productId,

    hsnCode: hsnCode || '',
    barcode: barcode || '',
    sku: sku || '',

    title,
    description: description || '',

    mrp: parseFloat(mrp),
    salePrice: parseFloat(salePrice),

    discountPercentage: parseFloat(
      discountPercentage || 0.0
    ),

    ratings: parseFloat(ratings || 4.5),

    reviewsCount: parseInt(
      reviewsCount || 0,
      10
    ),

    category,
    subCategory,
    availability,

    stock: parseFloat(stock),

    tags: normalizeStringArray(tags),
    addons: addons || {},
    occasions: normalizeStringArray(occasions),

    images: cleanImageNames,

    addOns: addOns || [],
    similarItems: similarItems || [],
    availableCombos: normalizeAvailableCombos(availableCombos || available_combos),

    createdAt: new Date().toISOString(),
  };

  try {
    await db
      .collection('products')
      .doc(productId)
      .set(productData);

    return res.status(201).json({
      success: true,
      message: 'Product successfully added to the database!',
      product: productData,
    });
  } catch (err) {
    console.error(
      'Error inserting product record into Firestore:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Failed to insert product record in database.',
      error: err.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Get All Products
|--------------------------------------------------------------------------
*/

export const getAllProducts = async (req, res) => {
  try {
    let snapshot;

    try {
      snapshot = await db
        .collection('products')
        .orderBy('createdAt', 'desc')
        .get();
    } catch (orderErr) {
      snapshot = await db
        .collection('products')
        .get();
    }

    const productsMapped = snapshot.docs.map((doc) => {
      const data = doc.data();

      // Normalize images so any legacy or raw S3 URLs render publicly
      const normalizedImages = (data.images || []).map((img) =>
        normalizeImageUrl(img, req)
      );

      return {
        id: data.id || doc.id,

        hsnCode: data.hsnCode || '',
        barcode: data.barcode || '',
        sku: data.sku || '',

        title: data.title || '',
        description: data.description || '',

        mrp: parseFloat(data.mrp || 0.0),
        salePrice: parseFloat(
          data.salePrice || 0.0
        ),

        discountPercentage: parseFloat(
          data.discountPercentage || 0.0
        ),

        ratings: parseFloat(
          data.ratings || 0.0
        ),

        reviewsCount: data.reviewsCount || 0,

        category: data.category || '',
        subCategory: data.subCategory || '',

        availability:
          data.availability || 'available',

        stock: parseFloat(data.stock || 0.0),

        tags: normalizeStringArray(data.tags),
        addons: data.addons || {},
        occasions: normalizeStringArray(data.occasions),

        images: normalizedImages,

        addOns: data.addOns || [],
        similarItems: data.similarItems || [],
        availableCombos: normalizeAvailableCombos(data.availableCombos || data.available_combos),
      };
    });

    return res.status(200).json({
      success: true,
      products: productsMapped,
    });
  } catch (err) {
    console.error(
      'Error fetching product records from Firestore:',
      err
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch product list.',
      error: err.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Update Product
|--------------------------------------------------------------------------
*/

export const updateProduct = async (req, res) => {
  const { id } = req.params;

  const {
    hsnCode,
    barcode,
    sku,
    title,
    description,
    mrp,
    salePrice,
    discountPercentage,
    ratings,
    reviewsCount,
    category,
    subCategory,
    availability,
    stock,
    tags,
    addons,
    occasions,
    images,
    addOns,
    similarItems,
    availableCombos,
    available_combos,
  } = req.body;

  if (
    !title ||
    mrp === undefined ||
    salePrice === undefined ||
    !category ||
    !subCategory ||
    !availability ||
    stock === undefined
  ) {
    return res.status(400).json({
      success: false,
      message:
        'Missing required product parameters for update.',
    });
  }

  if (images !== undefined && !Array.isArray(images)) {
    return res.status(400).json({
      success: false,
      message: 'Images must be an array.',
    });
  }

  if (images && images.length > MAX_IMAGES) {
    return res.status(400).json({
      success: false,
      message: `Maximum ${MAX_IMAGES} images are allowed.`,
    });
  }

  try {
    const docRef = db
      .collection('products')
      .doc(id);

    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    const existingData = docSnap.data();

    const rawImages =
      images !== undefined
        ? images
        : existingData.images || [];

    const finalImages = rawImages
      .map(extractImageFileName)
      .filter(Boolean);

    const updatedData = {
      hsnCode:
        hsnCode !== undefined
          ? hsnCode
          : existingData.hsnCode || '',

      barcode:
        barcode !== undefined
          ? barcode
          : existingData.barcode || '',

      sku:
        sku !== undefined
          ? sku
          : existingData.sku || '',

      title,

      description:
        description !== undefined
          ? description
          : existingData.description || '',

      mrp: parseFloat(mrp),

      salePrice: parseFloat(salePrice),

      discountPercentage: parseFloat(
        discountPercentage || 0.0
      ),

      ratings: parseFloat(
        ratings || 4.5
      ),

      reviewsCount: parseInt(
        reviewsCount || 0,
        10
      ),

      category,
      subCategory,
      availability,

      stock: parseFloat(stock),

      tags: tags !== undefined ? normalizeStringArray(tags) : normalizeStringArray(existingData.tags),
      addons: addons !== undefined ? addons : existingData.addons || {},
      occasions: occasions !== undefined ? normalizeStringArray(occasions) : normalizeStringArray(existingData.occasions),

      images: finalImages,

      addOns: addOns || [],
      similarItems: similarItems || [],
      availableCombos: (availableCombos !== undefined || available_combos !== undefined)
        ? normalizeAvailableCombos(availableCombos || available_combos)
        : normalizeAvailableCombos(existingData.availableCombos || existingData.available_combos),

      updatedAt: new Date().toISOString(),
    };

    const mergedData = {
      ...existingData,
      ...updatedData,
    };

    await docRef.set(mergedData);

    const finalDoc = await docRef.get();
    const finalData = finalDoc.data();

    return res.status(200).json({
      success: true,
      message: 'Product successfully updated!',

      product: {
        id,
        ...finalData,
        images: (finalData.images || []).map((img) => normalizeImageUrl(img, req)),
      },
    });
  } catch (err) {
    console.error(
      'Error updating product record in Firestore:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Failed to update product record in database.',
      error: err.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Delete Product
|--------------------------------------------------------------------------
*/

export const deleteProduct = async (req, res) => {
  const { id } = req.params;

  try {
    const docRef = db
      .collection('products')
      .doc(id);

    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    const productData = docSnap.data();

    // Delete images from R2 if they exist
    if (Array.isArray(productData?.images)) {
      for (const imgUrl of productData.images) {
        try {
          const filename = extractImageFileName(imgUrl);
          if (filename) {
            await r2Client.send(new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: `${R2_FOLDER}/${filename}`,
            }));
          }
        } catch (delErr) {
          console.warn(`Could not delete image from R2 (${imgUrl}):`, delErr.message);
        }
      }
    }

    await docRef.delete();

    return res.status(200).json({
      success: true,
      message:
        'Product successfully deleted from database!',
    });
  } catch (err) {
    console.error(
      'Error deleting product from Firestore:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Failed to delete product from database.',
      error: err.message,
    });
  }
};