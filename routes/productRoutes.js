import express from 'express';

import {
  createProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  getCloudinaryUploadSignature,
} from '../controllers/productController.js';

const router = express.Router();

router.post('/upload-signature', getCloudinaryUploadSignature);

// Product CRUD
router.post('/', createProduct);
router.get('/', getAllProducts);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;