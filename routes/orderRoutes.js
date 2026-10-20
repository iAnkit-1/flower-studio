import express from 'express';
import {
  createOrder,
  verifyPayment,
  handleWebhook,
  getOrdersByIds,
  getInvoice,
  getOrderStatus,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderPaymentStatus,
  updateOrderDeliveryStatus,
  getCustomOrders,
  getCustomOrdersForCaller,
  createCustomOrder,
  updateCustomOrder,
  getRequestedOrders,
  createRequestedOrder,
  updateRequestedOrder,
  cancelOrder
} from '../controllers/orderController.js';
import {
  requireAuth,
  requireAdminOrStaff,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// --- Regular Standard Orders & Payments ---
router.post('/', requireAuth, createOrder);
router.get('/', requireAuth, getAllOrders); // Authenticated customer (own orders) or staff (all orders)
router.post('/verify', requireAuth, verifyPayment);
router.post('/webhook', handleWebhook);
router.post('/by-ids', requireAuth, getOrdersByIds);

// --- Custom Orders ---
router.get('/custom/all', requireAdminOrStaff, getCustomOrders); // Admin / staff only (401 without token, 403 for customer)
router.get('/custom', requireAuth, getCustomOrdersForCaller); // Authenticated owner (own custom orders) or staff (all)
router.post('/custom', requireAuth, createCustomOrder); // Authenticated customer creation
router.put('/custom/:id', requireAdminOrStaff, updateCustomOrder); // Staff update quote/status

// --- Requested Orders ---
router.get('/requested/all', requireAdminOrStaff, getRequestedOrders); // Admin / staff only
router.post('/requested', requireAuth, createRequestedOrder); // Authenticated request submission
router.put('/requested/:id', requireAdminOrStaff, updateRequestedOrder); // Staff update

// --- Operational updates (Admin & Authorized Staff only) ---
router.put('/:orderId/status', requireAdminOrStaff, updateOrderStatus);
router.put('/:orderId/payment', requireAdminOrStaff, updateOrderPaymentStatus);
router.put('/:orderId/delivery', requireAdminOrStaff, updateOrderDeliveryStatus);

// --- Single Order details, invoice & status (Owner or authorized staff) ---
router.put('/:orderId/cancel', requireAuth, cancelOrder);
router.post('/:orderId/cancel', requireAuth, cancelOrder);
router.get('/:orderId/invoice', requireAuth, getInvoice);
router.get('/:orderId/status', requireAuth, getOrderStatus);
router.get('/:orderId', requireAuth, getOrderById);

export default router;
