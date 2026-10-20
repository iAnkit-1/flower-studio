import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import db from '../config/db.js';
import { r2Client, BUCKET_NAME, R2_FOLDER, R2_PUBLIC_URL } from '../config/r2.js';

const MAX_IMAGES = 5;

export const extractImageFileName = (url) => {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('data:image') || url.startsWith('blob:') || url.startsWith('data:application')) return '';
  const clean = url.split('?')[0].trim();
  const filename = clean.split('/').pop();
  return filename;
};

/**
 * Ensures any image input (pure filename, CDN URL, external URL, or base64 data URL)
 * is safely stored as a pure filename or valid external URL, uploading base64 data to R2.
 */
export const processImageToFileName = async (img, folder = 'product-images') => {
  if (!img || typeof img !== 'string') return '';
  const trimmed = img.trim();

  // 1. If it's a data URL / base64 string, upload directly to R2 and return the generated filename!
  if (trimmed.startsWith('data:image') || trimmed.startsWith('data:application')) {
    try {
      const cleanBase64 = trimmed.includes(',') ? trimmed.split(',')[1] : trimmed;
      const buffer = Buffer.from(cleanBase64, 'base64');
      const mimeMatch = trimmed.match(/^data:([^;]+);base64/);
      const contentType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const cleanExt = contentType.split('/')[1] === 'jpeg' ? 'jpg' : (contentType.split('/')[1] || 'jpg');

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const isSubFolder = folder === 'subscription-plans' || folder === 'subscription_plans';
      const isCustomFolder = folder === 'custom-orders' || folder === 'custom_orders';
      const targetFolder = isSubFolder
        ? 'subscription-plans'
        : (isCustomFolder ? 'custom-orders' : (R2_FOLDER || 'product-images'));
      const prefix = isSubFolder ? 'sub' : (isCustomFolder ? 'order' : 'prod');
      const filename = `${prefix}_${timestamp}_${randomSuffix}.${cleanExt}`;
      const key = `${targetFolder}/${filename}`;

      await r2Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }));

      return filename;
    } catch (uploadErr) {
      console.error('Failed to auto-upload base64 image to R2:', uploadErr);
      return '';
    }
  }

  // 2. If already a pure filename or relative path
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    const clean = trimmed.split('?')[0].trim();
    const filename = clean.split('/').pop();
    return filename;
  }

  // 3. If full CDN URL or R2 URL, extract pure filename
  const clean = trimmed.split('?')[0].trim();
  const filename = clean.split('/').pop();
  if (
    trimmed.includes('cdn.flowerstudiobypushpraj.com') ||
    trimmed.includes('.r2.cloudflarestorage.com') ||
    filename.startsWith('prod_') ||
    filename.startsWith('sub_') ||
    filename.startsWith('order_')
  ) {
    return filename;
  }

  // External link (like unsplash placeholder)
  return trimmed;
};

/**
 * Helper to generate public image URL dynamically from a filename or legacy URL
 */
export const normalizeImageUrl = (url, req) => {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('data:image') || url.startsWith('blob:')) return url;

  // Preserve full external web URLs (e.g. from floraindia, unsplash, fnp, etc.)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (!url.includes('.r2.cloudflarestorage.com') && !url.includes('.s3.') && !url.includes('amazonaws.com')) {
      return url;
    }
  }

  const filename = extractImageFileName(url);
  if (!filename) return '';

  const isSub = url.includes('subscription-plans') || url.includes('subscription_plans') || filename.startsWith('sub_');
  const isCustomOrder = url.includes('custom-orders') || url.includes('custom_orders') || filename.startsWith('order_');
  const folder = isSub ? 'subscription-plans' : (isCustomOrder ? 'custom-orders' : (R2_FOLDER || 'product-images'));

  const cdnBase = (R2_PUBLIC_URL && !R2_PUBLIC_URL.includes('.r2.cloudflarestorage.com'))
    ? R2_PUBLIC_URL
    : 'https://cdn.flowerstudiobypushpraj.com';

  return `${cdnBase}/${folder}/${filename}`;
};

export const getPublicImageUrl = (key, req) => {
  if (!key) return '';
  const cdnBase = (R2_PUBLIC_URL && !R2_PUBLIC_URL.includes('.r2.cloudflarestorage.com'))
    ? R2_PUBLIC_URL
    : 'https://cdn.flowerstudiobypushpraj.com';
  const cleanKey = key.replace(/^\/+/, '');
  return `${cdnBase}/${cleanKey}`;
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
    if (!key.startsWith('product-images') && !key.startsWith('custom-orders') && !key.startsWith(R2_FOLDER)) {
      if (key.includes('order_') || key.includes('custom')) {
        key = `custom-orders/${key}`;
      } else {
        key = `${R2_FOLDER || 'product-images'}/${key}`;
      }
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
    const { fileName, contentType, folder } = req.body || {};

    const cleanExt = fileName && fileName.includes('.')
      ? fileName.split('.').pop().toLowerCase()
      : 'jpg';

    const safeContentType = contentType || `image/${cleanExt === 'jpg' ? 'jpeg' : cleanExt}`;
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const isSubFolder = folder === 'subscription-plans' || folder === 'subscription_plans' || (typeof fileName === 'string' && fileName.startsWith('sub_'));
    const isCustomFolder = folder === 'custom-orders' || folder === 'custom_orders' || (typeof fileName === 'string' && fileName.startsWith('order_'));
    const targetFolder = isSubFolder
      ? 'subscription-plans'
      : (isCustomFolder ? 'custom-orders' : (R2_FOLDER || 'product-images'));
    const prefix = isSubFolder ? 'sub' : (isCustomFolder ? 'order' : 'prod');
    const key = `${targetFolder}/${prefix}_${timestamp}_${randomSuffix}.${cleanExt}`;

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
    const { base64, fileName, contentType, folder } = req.body || {};
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
    const isSubFolder = folder === 'subscription-plans' || folder === 'subscription_plans' || (typeof fileName === 'string' && fileName.startsWith('sub_'));
    const isCustomFolder = folder === 'custom-orders' || folder === 'custom_orders' || (typeof fileName === 'string' && fileName.startsWith('order_'));
    const targetFolder = isSubFolder
      ? 'subscription-plans'
      : (isCustomFolder ? 'custom-orders' : (R2_FOLDER || 'product-images'));
    const prefix = isSubFolder ? 'sub' : (isCustomFolder ? 'order' : 'prod');
    const key = `${targetFolder}/${prefix}_${timestamp}_${randomSuffix}.${cleanExt}`;

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

  const cleanImageNames = (
    await Promise.all(
      (images || []).map((img) => processImageToFileName(img, 'product-images'))
    )
  ).filter(Boolean);

  const productId =
    (id && typeof id === 'string' && id.startsWith('PROD-') && !id.startsWith('prod_'))
      ? id.trim()
      : `PROD-${Date.now()}`;

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
| Product Formatting for Caller Role
|--------------------------------------------------------------------------
*/
export const formatProductDocument = (doc, req) => {
  const data = doc.data();
  const isStaff = Boolean(req.user?.isStaff);

  const normalizedImages = (data.images || []).map((img) =>
    normalizeImageUrl(img, req)
  );

  const baseProduct = {
    id: data.id || doc.id,
    title: data.title || '',
    description: data.description || '',
    mrp: parseFloat(data.mrp || 0.0),
    salePrice: parseFloat(data.salePrice || 0.0),
    discountPercentage: parseFloat(data.discountPercentage || 0.0),
    ratings: parseFloat(data.ratings || 0.0),
    reviewsCount: data.reviewsCount || 0,
    category: data.category || '',
    subCategory: data.subCategory || '',
    availability: data.availability || 'available',
    stock: parseFloat(data.stock || 0.0),
    tags: normalizeStringArray(data.tags),
    addons: data.addons || {},
    occasions: normalizeStringArray(data.occasions),
    images: normalizedImages,
    createdAt: data.createdAt
      ? (typeof data.createdAt.toDate === 'function'
          ? data.createdAt.toDate().toISOString()
          : data.createdAt)
      : null,
    addOns: data.addOns || [],
    similarItems: data.similarItems || [],
    availableCombos: normalizeAvailableCombos(data.availableCombos || data.available_combos),
  };

  // Internal catalog/inventory metadata only accessible by authorized staff
  if (isStaff) {
    baseProduct.hsnCode = data.hsnCode || '';
    baseProduct.barcode = data.barcode || '';
    baseProduct.sku = data.sku || '';
    if (data.costPrice !== undefined) {
      baseProduct.costPrice = data.costPrice;
    }
  }

  return baseProduct;
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

    const isStaff = Boolean(req.user?.isStaff);

    let docsToProcess = snapshot.docs;

    // For public / customer users: only return active catalogue data
    if (!isStaff) {
      docsToProcess = docsToProcess.filter((doc) => {
        const data = doc.data();
        const availability = (data.availability || '').toLowerCase().trim();
        const status = (data.status || '').toLowerCase().trim();
        if (data.isActive === false) return false;
        if (['archived', 'hidden', 'inactive', 'draft', 'deleted'].includes(availability)) return false;
        if (['inactive', 'archived', 'deleted'].includes(status)) return false;
        return true;
      });
    }

    const productsMapped = docsToProcess.map((doc) => formatProductDocument(doc, req));

    const excludedCategories = [
      'cake accessories',
      'cake accessory',
      'cake topper',
      'cake toppers',
      'greeting card',
      'greeting cards',
    ];

    const includeAll =
      req.query.includeAll === 'true' ||
      req.query.includeAddons === 'true';

    const filteredProducts = includeAll
      ? productsMapped
      : productsMapped.filter((p) => {
          const cat = (p.category || '').toLowerCase().trim();
          return !excludedCategories.includes(cat);
        });

    if (isStaff) {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=1800, stale-while-revalidate=3600');
      res.setHeader('Vary', 'Accept-Encoding, Authorization');
    }

    return res.status(200).json({
      success: true,
      products: filteredProducts,
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
| Get Single Product By ID
|--------------------------------------------------------------------------
*/
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Missing product ID.' });
    }

    const doc = await db.collection('products').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const data = doc.data();
    const isStaff = Boolean(req.user?.isStaff);

    if (!isStaff) {
      const availability = (data.availability || '').toLowerCase().trim();
      const status = (data.status || '').toLowerCase().trim();
      if (
        data.isActive === false ||
        ['archived', 'hidden', 'inactive', 'draft', 'deleted'].includes(availability) ||
        ['inactive', 'archived', 'deleted'].includes(status)
      ) {
        return res.status(404).json({ success: false, message: 'Product not found or currently unavailable.' });
      }
    }

    const product = formatProductDocument(doc, req);

    if (isStaff) {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=1800, stale-while-revalidate=3600');
      res.setHeader('Vary', 'Accept-Encoding, Authorization');
    }

    return res.status(200).json({
      success: true,
      product,
    });
  } catch (err) {
    console.error('Error fetching product record by ID:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch product.',
      error: err.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Get Greeting Card Products
|--------------------------------------------------------------------------
*/
export const getGreetingCards = async (req, res) => {
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

    const isStaff = Boolean(req.user?.isStaff);
    let docsToProcess = snapshot.docs;

    if (!isStaff) {
      docsToProcess = docsToProcess.filter((doc) => {
        const data = doc.data();
        const availability = (data.availability || '').toLowerCase().trim();
        const status = (data.status || '').toLowerCase().trim();
        if (data.isActive === false) return false;
        if (['archived', 'hidden', 'inactive', 'draft', 'deleted'].includes(availability)) return false;
        if (['inactive', 'archived', 'deleted'].includes(status)) return false;
        return true;
      });
    }

    const allMapped = docsToProcess.map((doc) => formatProductDocument(doc, req));

    const greetingCards = allMapped.filter((p) => {
      const cat = (p.category || '').toLowerCase().trim();
      const subCat = (p.subCategory || '').toLowerCase().trim();
      const title = (p.title || '').toLowerCase().trim();
      const tags = (p.tags || []).map((t) => t.toLowerCase());

      return (
        cat === 'greeting card' ||
        cat === 'greeting cards' ||
        cat === 'card' ||
        cat === 'cards' ||
        subCat === 'greeting card' ||
        subCat === 'greeting cards' ||
        subCat === 'card' ||
        subCat === 'cards' ||
        tags.includes('greeting card') ||
        tags.includes('greeting cards') ||
        tags.includes('card') ||
        title.includes('greeting card') ||
        title.includes('card')
      );
    });

    if (isStaff) {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=1800, stale-while-revalidate=3600');
      res.setHeader('Vary', 'Accept-Encoding, Authorization');
    }

    return res.status(200).json({
      success: true,
      products: greetingCards,
    });
  } catch (err) {
    console.error('Error fetching greeting cards from Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch greeting cards.',
      error: err.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Get Celebration Items (Cake Toppers, Cake Accessories, Party Specials, Gifts)
|--------------------------------------------------------------------------
*/
export const getCelebrationProducts = async (req, res) => {
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

    const allMapped = snapshot.docs.map((doc) => {
      const data = doc.data();
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
        salePrice: parseFloat(data.salePrice || 0.0),
        discountPercentage: parseFloat(data.discountPercentage || 0.0),
        ratings: parseFloat(data.ratings || 0.0),
        reviewsCount: data.reviewsCount || 0,
        category: data.category || '',
        subCategory: data.subCategory || '',
        availability: data.availability || 'available',
        stock: parseFloat(data.stock || 0.0),
        tags: normalizeStringArray(data.tags),
        addons: data.addons || {},
        occasions: normalizeStringArray(data.occasions),
        images: normalizedImages,
        createdAt: data.createdAt
          ? (typeof data.createdAt.toDate === 'function'
              ? data.createdAt.toDate().toISOString()
              : data.createdAt)
          : null,
        addOns: data.addOns || [],
        similarItems: data.similarItems || [],
        availableCombos: normalizeAvailableCombos(data.availableCombos || data.available_combos),
      };
    });

    const celebrationProducts = allMapped.filter((p) => {
      const cat = (p.category || '').toLowerCase().trim();
      const subCat = (p.subCategory || '').toLowerCase().trim();
      const title = (p.title || '').toLowerCase().trim();
      const tags = (p.tags || []).map((t) => t.toLowerCase());

      const isTopper =
        cat === 'cake topper' ||
        cat === 'cake toppers' ||
        cat.includes('topper') ||
        subCat.includes('topper') ||
        tags.includes('cake topper') ||
        tags.includes('topper') ||
        title.includes('topper');

      const isAccessories =
        cat === 'cake accessories' ||
        cat === 'cake accessory' ||
        cat.includes('accessor') ||
        subCat.includes('accessor') ||
        cat.includes('candle') ||
        subCat.includes('candle') ||
        tags.includes('candle') ||
        tags.includes('cake accessories') ||
        title.includes('candle') ||
        title.includes('sparkle') ||
        title.includes('knife');

      const isPartySpecials =
        cat === 'party specials' ||
        cat === 'party special' ||
        cat.includes('party') ||
        subCat.includes('party') ||
        subCat.includes('popper') ||
        tags.includes('party specials') ||
        tags.includes('party') ||
        title.includes('popper') ||
        title.includes('balloon') ||
        title.includes('snow');

      const isGift =
        cat === 'gift' ||
        cat === 'gifts' ||
        subCat === 'gift' ||
        subCat === 'gifts' ||
        tags.includes('gift') ||
        tags.includes('gifts') ||
        (cat.includes('gift') && !cat.includes('hamper'));

      return isTopper || isAccessories || isPartySpecials || isGift;
    });

    if (isStaff) {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=1800, stale-while-revalidate=3600');
      res.setHeader('Vary', 'Accept-Encoding, Authorization');
    }

    return res.status(200).json({
      success: true,
      products: celebrationProducts,
    });
  } catch (err) {
    console.error('Error fetching celebration products from Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch celebration products.',
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

    const finalImages = (
      await Promise.all(
        rawImages.map((img) => processImageToFileName(img, 'product-images'))
      )
    ).filter(Boolean);

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