import { v2 as cloudinary } from 'cloudinary';
import db from '../config/db.js';


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


const MAX_IMAGES = 5;
const CLOUDINARY_FOLDER = 'flower_studio';


export const getCloudinaryUploadSignature = async (req, res) => {
  try {
    const timestamp = Math.floor(Date.now() / 1000);

    const paramsToSign = {
      timestamp,
      folder: CLOUDINARY_FOLDER,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    return res.status(200).json({
      success: true,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      folder: CLOUDINARY_FOLDER,
      signature,
    });
  } catch (error) {
    console.error(
      'Cloudinary signature generation failed:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to generate Cloudinary upload signature.',
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
  | Images should now ONLY contain Cloudinary URLs.
  |--------------------------------------------------------------------------
  */

  const uploadedUrls = images || [];

  const invalidImage = uploadedUrls.some(
    (image) =>
      typeof image !== 'string' ||
      !(
        image.startsWith('https://res.cloudinary.com/') ||
        image.startsWith('http://res.cloudinary.com/')
      )
  );

  if (invalidImage) {
    return res.status(400).json({
      success: false,
      message:
        'Invalid image URL. Images must be uploaded to Cloudinary first.',
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
    | Make sure all images are Cloudinary URLs.
    |--------------------------------------------------------------------------
    */

    const invalidImage = finalImages.some(
      (image) =>
        typeof image !== 'string' ||
        !(
          image.startsWith(
            'https://res.cloudinary.com/'
          ) ||
          image.startsWith(
            'http://res.cloudinary.com/'
          )
        )
    );

    if (invalidImage) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid image URL. Images must be Cloudinary URLs.',
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