import express from 'express';
import {
  getSubscriptionPlans,
  getSubscriptionPlanById,
  createSubscriptionPlan,
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  createCustomerSubscriptionOrder,
  verifyCustomerSubscriptionPayment,
  getMySubscriptions,
} from '../controllers/subscriptionController.js';

const router = express.Router();

// --- Subscription Plans ---
router.get('/plans', getSubscriptionPlans);
router.get('/plans/all', getSubscriptionPlans);
router.get('/plans/:id', getSubscriptionPlanById);
router.post('/plans', createSubscriptionPlan);
router.put('/plans/:id', updateSubscriptionPlan);
router.delete('/plans/:id', deleteSubscriptionPlan);

// --- Customer Subscription Purchases (Razorpay ONLY) ---
router.post('/create-order', createCustomerSubscriptionOrder);
router.post('/verify', verifyCustomerSubscriptionPayment);
router.get('/my-subscriptions', getMySubscriptions);

export default router;
