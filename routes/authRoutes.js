import express from 'express';
import {
  getUserProfile,
  updateUserProfile,
  verifyFirebaseToken
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Customer Authentication & Profile Management
router.post('/verify-firebase-token', verifyFirebaseToken);
router.get('/profile/:phoneNumber', requireAuth, getUserProfile);
router.put('/profile', requireAuth, updateUserProfile);

export default router;
