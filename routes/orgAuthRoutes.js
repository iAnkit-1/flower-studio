import express from 'express';
import { orgLogin, getStaffMe, verifyOrgToken } from '../controllers/orgAuthController.js';
import { verifyJWT } from '../middleware/verifyJWT.js';

const router = express.Router();

// Public — no JWT needed
router.post('/login',             orgLogin);
router.post('/auth/login',        orgLogin);
router.post('/verify-token',      verifyOrgToken);
router.post('/auth/verify-token', verifyOrgToken);

// Protected — requires valid JWT
router.get('/me',      verifyJWT, getStaffMe);
router.get('/auth/me', verifyJWT, getStaffMe);

export default router;
