import express from 'express';
import {
  createOrder,
  verifyPayment,
  getOrdersByIds,
  getInvoice,
  getOrderStatus,
  getMockCheckout,
  paymentCallback
} from '../controllers/orderController.js';

const router = express.Router();

// Order creation
router.post('/', createOrder);

// Payment verification
router.post('/verify', verifyPayment);

// Fetch multiple orders (guest tracking using locally stored IDs)
router.post('/by-ids', getOrdersByIds);

// Invoice page retrieval
router.get('/:orderId/invoice', getInvoice);

// NEW ENDPOINTS FOR DYNAMIC HOSTED PAYMENTS
// Polling status
router.get('/:orderId/status', getOrderStatus);

// Render Mock Hosted Checkout Fallback page
router.get('/mock-checkout/:orderId', getMockCheckout);

// Razorpay standard checkout callback
router.get('/callback', paymentCallback);

export default router;
