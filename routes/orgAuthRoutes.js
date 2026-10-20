import express from 'express';
import {
  orgLogin,
  orgLogout,
  getStaffMe,
  verifyOrgToken,
  getStaffFirebaseToken,
  getAllStaff,
  createStaff,
  updateStaff,
  updateStaffPassword,
  deleteStaff,
} from '../controllers/orgAuthController.js';
import { verifyJWT, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public Authentication — /api/org/auth/...
router.post('/auth/login',        orgLogin);
router.post('/auth/logout',       orgLogout);
router.post('/auth/verify-token', verifyOrgToken);

// Protected Staff Session — /api/org/auth/...
router.get('/auth/me',             verifyJWT, getStaffMe);
router.get('/auth/firebase-token', verifyJWT, getStaffFirebaseToken);

// Admin-only Staff Management — /api/org/staff
router.get('/staff',              requireAdmin, getAllStaff);
router.post('/staff',             requireAdmin, createStaff);
router.put('/staff/:id/password', requireAdmin, updateStaffPassword);
router.put('/staff/:id',          requireAdmin, updateStaff);
router.delete('/staff/:id',       requireAdmin, deleteStaff);

export default router;

