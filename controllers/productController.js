import { v2 as cloudinary } from 'cloudinary';
import * as db from '../config/db.js';

// Configure Cloudinary securely
cloudinary.config({
  cloud_name: 'dlczsmows',
  api_key: '849383372191414',
  api_secret: 'ac3y2X7_p5NhON6NsMrfbDPPQtw'
});

// Create a new product in the PostgreSQL database
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
    images
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

  const queryText = `
    INSERT INTO products (
      id, hsn_code, barcode, sku, title, description, mrp, sale_price, 
      discount_percentage, ratings, reviews_count, category, sub_category, 
      availability, stock, tags, addons, occasions, images
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING *;
  `;

  const values = [
    id,
    hsnCode || '',
    barcode || '',
    sku || '',
    title,
    description || '',
    mrp,
    salePrice,
    discountPercentage || 0.0,
    ratings || 4.5,
    reviewsCount || 0,
    category,
    subCategory,
    availability,
    stock,
    tags || [],
    addons || {},
    occasions || [],
    uploadedUrls
  ];

  try {
    const result = await db.query(queryText, values);
    return res.status(201).json({
      success: true,
      message: 'Product successfully added to the database!',
      product: result.rows[0]
    });
  } catch (err) {
    console.error('Error inserting product record:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to insert product record in database.',
      error: err.message
    });
  }
};

// Retrieve all products from the PostgreSQL database
export const getAllProducts = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products ORDER BY created_at DESC');
    
    // Map db camel_case columns to fit frontend class properties
    const productsMapped = result.rows.map(row => ({
      id: row.id,
      hsnCode: row.hsn_code,
      barcode: row.barcode,
      sku: row.sku,
      title: row.title,
      description: row.description,
      mrp: parseFloat(row.mrp),
      salePrice: parseFloat(row.sale_price),
      discountPercentage: parseFloat(row.discount_percentage || 0.0),
      ratings: parseFloat(row.ratings || 0.0),
      reviewsCount: row.reviews_count,
      category: row.category,
      subCategory: row.sub_category,
      availability: row.availability,
      stock: parseFloat(row.stock || 0.0),
      tags: row.tags || [],
      addons: row.addons || {},
      occasions: row.occasions || [],
      images: row.images || []
    }));

    return res.status(200).json({
      success: true,
      products: productsMapped
    });
  } catch (err) {
    console.error('Error fetching product records:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch product list.',
      error: err.message
    });
  }
};
