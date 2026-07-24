import { v2 as cloudinary } from 'cloudinary';
import db from '../config/db.js';

// Configure Cloudinary securely
cloudinary.config({
  cloud_name: 'dlczsmows',
  api_key: '849383372191414',
  api_secret: 'ac3y2X7_p5NhON6NsMrfbDPPQtw'
});

// Create a new product in the Firestore database
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
    similarItems
  } = req.body;

  if (!title || mrp === undefined || salePrice === undefined || !category || !subCategory || !availability || stock === undefined) {
    return res.status(400).json({
      success: false,
      message: 'Missing required product parameters.'
    });
  }

  // Handle Cloudinary Image Uploads for Base64 Strings
  const uploadedUrls = [];
  try {
    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (img.startsWith('data:image') || img.length > 1000) {
          console.log('Uploading base64 image to Cloudinary...');
          const uploadResult = await cloudinary.uploader.upload(img, {
            folder: 'flower_studio'
          });
          console.log(`Cloudinary upload success: ${uploadResult.secure_url}`);
          uploadedUrls.push(uploadResult.secure_url);
        } else {
          // Keep as is if it's already a web URL
          uploadedUrls.push(img);
        }
      }
    }
  } catch (uploadError) {
    console.error('Cloudinary upload failure:', uploadError);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload images to Cloudinary.',
      error: uploadError.message
    });
  }

  const productId = id || `PROD-${Math.floor(1000 + Math.random() * 9000)}`;

  const productData = {
    id: productId,
    hsnCode: hsnCode || '',
    barcode: barcode || '',
    sku: sku || '',
    title,
    description: description || '',
    mrp: parseFloat(mrp),
    salePrice: parseFloat(salePrice),
    discountPercentage: parseFloat(discountPercentage || 0.0),
    ratings: parseFloat(ratings || 4.5),
    reviewsCount: parseInt(reviewsCount || 0, 10),
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
    createdAt: new Date().toISOString()
  };

  try {
    await db.collection('products').doc(productId).set(productData, { merge: true });
    return res.status(201).json({
      success: true,
      message: 'Product successfully added to the database!',
      product: productData
    });
  } catch (err) {
    console.error('Error inserting product record into Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to insert product record in database.',
      error: err.message
    });
  }
};

// Retrieve all products from the Firestore database
export const getAllProducts = async (req, res) => {
  try {
    let snapshot;
    try {
      snapshot = await db.collection('products').orderBy('createdAt', 'desc').get();
    } catch (orderErr) {
      snapshot = await db.collection('products').get();
    }

    const productsMapped = snapshot.docs.map(doc => {
      const data = doc.data();
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
        tags: data.tags || [],
        addons: data.addons || {},
        occasions: data.occasions || [],
        images: data.images || [],
        addOns: data.addOns || [],
        similarItems: data.similarItems || []
      };
    });

    return res.status(200).json({
      success: true,
      products: productsMapped
    });
  } catch (err) {
    console.error('Error fetching product records from Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch product list.',
      error: err.message
    });
  }
};

// Update an existing product in Firestore
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
    similarItems
  } = req.body;

  if (!title || mrp === undefined || salePrice === undefined || !category || !subCategory || !availability || stock === undefined) {
    return res.status(400).json({
      success: false,
      message: 'Missing required product parameters for update.'
    });
  }

  // Handle Cloudinary Image Uploads for Base64 Strings
  const uploadedUrls = [];
  try {
    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (img.startsWith('data:image') || img.length > 1000) {
          console.log('Uploading base64 image to Cloudinary...');
          const uploadResult = await cloudinary.uploader.upload(img, {
            folder: 'flower_studio'
          });
          uploadedUrls.push(uploadResult.secure_url);
        } else {
          uploadedUrls.push(img);
        }
      }
    }
  } catch (uploadError) {
    console.error('Cloudinary upload failure:', uploadError);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload images to Cloudinary for update.',
      error: uploadError.message
    });
  }

  try {
    const docRef = db.collection('products').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.'
      });
    }

    const updatedData = {
      hsnCode: hsnCode !== undefined ? hsnCode : (docSnap.data().hsnCode || ''),
      barcode: barcode !== undefined ? barcode : (docSnap.data().barcode || ''),
      sku: sku !== undefined ? sku : (docSnap.data().sku || ''),
      title,
      description: description !== undefined ? description : (docSnap.data().description || ''),
      mrp: parseFloat(mrp),
      salePrice: parseFloat(salePrice),
      discountPercentage: parseFloat(discountPercentage || 0.0),
      ratings: parseFloat(ratings || 4.5),
      reviewsCount: parseInt(reviewsCount || 0, 10),
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
      updatedAt: new Date().toISOString()
    };

    await docRef.update(updatedData);

    const finalDoc = await docRef.get();
    return res.status(200).json({
      success: true,
      message: 'Product successfully updated!',
      product: { id, ...finalDoc.data() }
    });
  } catch (err) {
    console.error('Error updating product record in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update product record in database.',
      error: err.message
    });
  }
};

// Delete a product from Firestore
export const deleteProduct = async (req, res) => {
  const { id } = req.params;

  try {
    const docRef = db.collection('products').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.'
      });
    }

    await docRef.delete();
    return res.status(200).json({
      success: true,
      message: 'Product successfully deleted from database!'
    });
  } catch (err) {
    console.error('Error deleting product record from Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete product from database.',
      error: err.message
    });
  }
};

// Upload base64 image directly to Cloudinary
export const uploadImage = async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({
      success: false,
      message: 'No image data provided.'
    });
  }

  try {
    console.log('Uploading base64 image directly to Cloudinary...');
    const uploadResult = await cloudinary.uploader.upload(image, {
      folder: 'flower_studio'
    });
    console.log(`Cloudinary direct upload success: ${uploadResult.secure_url}`);
    return res.json({
      success: true,
      url: uploadResult.secure_url
    });
  } catch (error) {
    console.error('Cloudinary direct upload failure:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload image directly to Cloudinary.',
      error: error.message
    });
  }
};
