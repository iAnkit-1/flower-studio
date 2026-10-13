import express from 'express';
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
  getAllUsers,
} from '../controllers/userController.js';
import {
  requireAuth,
  requireAdmin,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/users/me -> Authenticated customer; own profile only
router.get('/me', requireAuth, getCurrentUserProfile);

// PATCH /api/users/me -> Authenticated customer; allowlisted fields only
router.patch('/me', requireAuth, updateCurrentUserProfile);

// PUT /api/users/me -> Also allow PUT for flexibility
router.put('/me', requireAuth, updateCurrentUserProfile);

// GET /api/users -> Admin only (returns 401 without token, 403 for non-admin)
router.get('/', requireAdmin, getAllUsers);

export default router;
