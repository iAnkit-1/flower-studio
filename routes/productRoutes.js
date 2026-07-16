import express from 'express';
import {
  createProduct,
  getAllProducts,
  updateProduct,
  deleteProduct
} from '../controllers/productController.js';

const router = express.Router();

// Routes mapping for /api/products
router.post('/', createProduct);
router.get('/', getAllProducts);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;
