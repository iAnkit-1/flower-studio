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

// Public — no JWT needed
router.post('/login',             orgLogin);
router.post('/auth/login',        orgLogin);
router.post('/logout',            orgLogout);
router.post('/auth/logout',       orgLogout);
router.post('/verify-token',      verifyOrgToken);
router.post('/auth/verify-token', verifyOrgToken);

// Protected — requires valid JWT
router.get('/me',                  verifyJWT, getStaffMe);
router.get('/auth/me',             verifyJWT, getStaffMe);
router.get('/firebase-token',      verifyJWT, getStaffFirebaseToken);
router.get('/auth/firebase-token', verifyJWT, getStaffFirebaseToken);

// Admin-only Staff Management
router.get('/staff',              requireAdmin, getAllStaff);
router.post('/staff',             requireAdmin, createStaff);
router.put('/staff/:id/password', requireAdmin, updateStaffPassword);
router.put('/staff/:id',          requireAdmin, updateStaff);
router.delete('/staff/:id',       requireAdmin, deleteStaff);

export default router;

