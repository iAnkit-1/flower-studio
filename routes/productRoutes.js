import express from 'express';

import {
  createProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  getR2UploadPresignedUrl,
  uploadDirectToR2,
} from '../controllers/productController.js';

const router = express.Router();

// R2 Pre-signed URL generation for direct upload
router.post('/r2-presigned-url', getR2UploadPresignedUrl);
router.post('/upload-signature', getR2UploadPresignedUrl);

// R2 Direct backend upload fallback
router.post('/upload-direct', uploadDirectToR2);

// Product CRUD
router.post('/', createProduct);
router.get('/', getAllProducts);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;