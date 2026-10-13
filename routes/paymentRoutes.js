import express from 'express';
import {
  createOrder,
  verifyPayment,
  handleWebhook
} from '../controllers/orderController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Dedicated Payment Gateway Endpoints
// Customer order creation & verification require authentication
router.post('/create-order', requireAuth, createOrder);
router.post('/verify', requireAuth, verifyPayment);

// Webhook from Razorpay servers (verified via HMAC SHA-256 x-razorpay-signature header)
router.post('/webhook', handleWebhook);

export default router;
