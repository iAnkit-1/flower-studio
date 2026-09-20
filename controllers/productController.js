import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import db from '../config/db.js';
import { r2Client, BUCKET_NAME, R2_FOLDER, R2_PUBLIC_URL } from '../config/r2.js';

const MAX_IMAGES = 5;

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

    const publicUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL}/${key}`
      : `https://${process.env.R2_ACCOUNT_ID || '98402096d741cf32c4ce0d16403a7f34'}.r2.cloudflarestorage.com/${BUCKET_NAME}/${key}`;

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

    const publicUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL}/${key}`
      : `https://${process.env.R2_ACCOUNT_ID || '98402096d741cf32c4ce0d16403a7f34'}.r2.cloudflarestorage.com/${BUCKET_NAME}/${key}`;

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
  } = req.body;

  /*
  |--------------------------------------------------------------------------
  | Validate required fields
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | Validate images
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | Validate image URLs
  |--------------------------------------------------------------------------
  */

  const uploadedUrls = images || [];

  const invalidImage = uploadedUrls.some(
    (image) =>
      typeof image !== 'string' ||
      !(
        image.startsWith('https://') ||
        image.startsWith('http://')
      )
  );

  if (invalidImage) {
    return res.status(400).json({
      success: false,
      message: 'Invalid image URL. Images must be valid HTTP/HTTPS URLs.',
    });
  }

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

    tags: tags || [],
    addons: addons || {},
    occasions: occasions || [],

    images: uploadedUrls,

    addOns: addOns || [],
    similarItems: similarItems || [],

    createdAt: new Date().toISOString(),
  };

  /*
  |--------------------------------------------------------------------------
  | Save to Firestore
  |--------------------------------------------------------------------------
  */

  try {
    await db
      .collection('products')
      .doc(productId)
      .set(productData, { merge: true });

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

        tags: data.tags || [],
        addons: data.addons || {},
        occasions: data.occasions || [],

        images: data.images || [],

        addOns: data.addOns || [],
        similarItems: data.similarItems || [],
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
  } = req.body;

  /*
  |--------------------------------------------------------------------------
  | Validate required fields
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | Validate images
  |--------------------------------------------------------------------------
  */

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

    /*
    |--------------------------------------------------------------------------
    | If images aren't supplied, preserve old images.
    |--------------------------------------------------------------------------
    */

    const finalImages =
      images !== undefined
        ? images
        : existingData.images || [];

    /*
    |--------------------------------------------------------------------------
    | Make sure all images are valid URLs.
    |--------------------------------------------------------------------------
    */

    const invalidImage = finalImages.some(
      (image) =>
        typeof image !== 'string' ||
        !(
          image.startsWith('https://') ||
          image.startsWith('http://')
        )
    );

    if (invalidImage) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image URL. Images must be valid HTTP/HTTPS URLs.',
      });
    }

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

      tags: tags || [],
      addons: addons || {},
      occasions: occasions || [],

      images: finalImages,

      addOns: addOns || [],
      similarItems: similarItems || [],

      updatedAt: new Date().toISOString(),
    };

    await docRef.update(updatedData);

    const finalDoc = await docRef.get();

    return res.status(200).json({
      success: true,
      message: 'Product successfully updated!',

      product: {
        id,
        ...finalDoc.data(),
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

    // Optionally delete images from R2 if they exist and are from our bucket
    if (Array.isArray(productData?.images)) {
      for (const imgUrl of productData.images) {
        try {
          if (typeof imgUrl === 'string' && imgUrl.includes(R2_FOLDER)) {
            const keyIndex = imgUrl.indexOf(R2_FOLDER);
            const key = imgUrl.substring(keyIndex).split('?')[0];
            if (key) {
              await r2Client.send(new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
              }));
            }
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