import express from 'express';
import {
  sendOtp,
  verifyOtp,
  resendOtp,
  getUserProfile,
  updateUserProfile,
  addUserOrder,
  login
} from '../controllers/authController.js';

const router = express.Router();

// Routes mapping for /api/auth
router.post('/login', login);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.get('/profile/:phoneNumber', getUserProfile);
router.put('/profile', updateUserProfile);
router.post('/profile/add-order', addUserOrder);

export default router;
