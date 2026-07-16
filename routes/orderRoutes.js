import express from 'express';
import {
  createOrder,
  verifyPayment,
  getOrdersByIds,
  getInvoice,
  getOrderStatus,
  getMockCheckout,
  paymentCallback,
  getAllOrders,
  updateOrderStatus,
  updateOrderPaymentStatus,
  updateOrderDeliveryStatus,
  getCustomOrders,
  createCustomOrder,
  updateCustomOrder,
  getRequestedOrders,
  createRequestedOrder,
  updateRequestedOrder
} from '../controllers/orderController.js';

const router = express.Router();

// --- Regular Standard Orders ---
router.post('/', createOrder);
router.get('/', getAllOrders); // Fetch all standard orders
router.post('/verify', verifyPayment);
router.post('/by-ids', getOrdersByIds);
router.get('/:orderId/invoice', getInvoice);
router.get('/:orderId/status', getOrderStatus);
router.get('/mock-checkout/:orderId', getMockCheckout);
router.get('/callback', paymentCallback);

// --- Operational updates ---
router.put('/:orderId/status', updateOrderStatus); // Update order confirmed/cancelled status
router.put('/:orderId/payment', updateOrderPaymentStatus); // Update payment pending/success/cash
router.put('/:orderId/delivery', updateOrderDeliveryStatus); // Update delivery checkpoint status

// --- Custom Orders ---
router.get('/custom/all', getCustomOrders); // Fetch all custom orders
router.post('/custom', createCustomOrder); // Create new custom order request
router.put('/custom/:id', updateCustomOrder); // Update quote/status

// --- Requested Orders ---
router.get('/requested/all', getRequestedOrders); // Fetch all out-of-stock requested orders
router.post('/requested', createRequestedOrder); // Submit new out-of-stock request
router.put('/requested/:id', updateRequestedOrder); // Update status (Confirmed/Cancelled)

export default router;
