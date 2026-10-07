import express from 'express';
import {
  getUserFavorites,
  toggleFavorite,
  deleteFavorite,
} from '../controllers/favoriteController.js';

const router = express.Router();

router.get('/', getUserFavorites);
router.post('/toggle', toggleFavorite);
router.post('/', toggleFavorite);
router.delete('/:id', deleteFavorite);

export default router;
