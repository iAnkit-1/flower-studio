import express from 'express';
import {
  getUserFavorites,
  toggleFavorite,
  deleteFavorite,
} from '../controllers/favoriteController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All favorite operations require authenticated customer/staff identity
router.use(requireAuth);

router.get('/', getUserFavorites);
router.post('/toggle', toggleFavorite);
router.post('/', toggleFavorite);
router.delete('/:id', deleteFavorite);

export default router;
