import express from 'express';

import {
  createProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  getR2UploadPresignedUrl,
} from '../controllers/productController.js';

const router = express.Router();

// R2 Pre-signed URL generation for direct upload
router.post('/r2-presigned-url', getR2UploadPresignedUrl);
router.post('/upload-signature', getR2UploadPresignedUrl);

// Product CRUD
router.post('/', createProduct);
router.get('/', getAllProducts);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;