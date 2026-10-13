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
import {
  requireAuth,
  requireAdminOrStaff,
  optionalAuth,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// --- Subscription Plans (Public Catalogue & Admin Management) ---
router.get('/plans', optionalAuth, getSubscriptionPlans); // Public active plans
router.get('/plans/all', requireAdminOrStaff, getSubscriptionPlans); // Admin / Staff can view all (including inactive)
router.get('/plans/:id', optionalAuth, getSubscriptionPlanById);

// Plan modifications require Staff/Admin role
router.post('/plans', requireAdminOrStaff, createSubscriptionPlan);
router.put('/plans/:id', requireAdminOrStaff, updateSubscriptionPlan);
router.delete('/plans/:id', requireAdminOrStaff, deleteSubscriptionPlan);

// --- Customer Subscription Purchases & Tracking ---
router.post('/create-order', requireAuth, createCustomerSubscriptionOrder);
router.post('/verify', requireAuth, verifyCustomerSubscriptionPayment);
router.get('/my-subscriptions', requireAuth, getMySubscriptions);

export default router;
