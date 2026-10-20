import express from 'express';

import {
  createProduct,
  getAllProducts,
  getProductById,
  getGreetingCards,
  getCelebrationProducts,
  updateProduct,
  deleteProduct,
  getR2UploadPresignedUrl,
  uploadDirectToR2,
  serveR2Image,
} from '../controllers/productController.js';
import {
  optionalAuth,
  requireAdminOrStaff,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Public image serving endpoint for Cloudflare R2
router.get('/images/*', serveR2Image);
router.get('/image/*', serveR2Image);

// R2 Pre-signed URL generation for direct upload (Customers and Staff)
router.post('/r2-presigned-url', optionalAuth, getR2UploadPresignedUrl);
router.post('/upload-signature', optionalAuth, getR2UploadPresignedUrl);

// R2 Direct backend upload fallback (Customers and Staff)
router.post('/upload-direct', optionalAuth, uploadDirectToR2);

// Dedicated endpoints (Public catalogue data)
router.get('/greeting-cards', optionalAuth, getGreetingCards);
router.get('/celebration', optionalAuth, getCelebrationProducts);
router.get('/celebration-items', optionalAuth, getCelebrationProducts);

// Product Catalogue & Management CRUD
// GET /api/products -> Public; returns only active catalogue data with intended public fields
router.get('/', optionalAuth, getAllProducts);
router.get('/:id', optionalAuth, getProductById);

// Mutations require Admin or Staff authorization
router.post('/', requireAdminOrStaff, createProduct);
router.put('/:id', requireAdminOrStaff, updateProduct);
router.delete('/:id', requireAdminOrStaff, deleteProduct);

export default router;