import express from 'express';
import {
  createOrder,
  verifyPayment,
  handleWebhook
} from '../controllers/orderController.js';

const router = express.Router();

// Dedicated Payment Gateway Endpoints
router.post('/create-order', createOrder);
router.post('/verify', verifyPayment);
router.post('/webhook', handleWebhook);

export default router;
