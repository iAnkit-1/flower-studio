import express from 'express';

import {
  createProduct,
  getAllProducts,
  getGreetingCards,
  getCelebrationProducts,
  updateProduct,
  deleteProduct,
  getR2UploadPresignedUrl,
  uploadDirectToR2,
  serveR2Image,
} from '../controllers/productController.js';

const router = express.Router();

// Public image serving endpoint for Cloudflare R2
router.get('/images/*', serveR2Image);
router.get('/image/*', serveR2Image);

// R2 Pre-signed URL generation for direct upload
router.post('/r2-presigned-url', getR2UploadPresignedUrl);
router.post('/upload-signature', getR2UploadPresignedUrl);

// R2 Direct backend upload fallback
router.post('/upload-direct', uploadDirectToR2);

// Greeting cards dedicated endpoint
router.get('/greeting-cards', getGreetingCards);

// Celebration products dedicated endpoint
router.get('/celebration', getCelebrationProducts);
router.get('/celebration-items', getCelebrationProducts);

// Product CRUD
router.post('/', createProduct);
router.get('/', getAllProducts);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;