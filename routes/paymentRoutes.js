import express from 'express';
import { handleWebhook } from '../controllers/orderController.js';

const router = express.Router();

// Webhook from Razorpay servers (verified via HMAC SHA-256 x-razorpay-signature header)
router.post('/webhook', handleWebhook);

export default router;
