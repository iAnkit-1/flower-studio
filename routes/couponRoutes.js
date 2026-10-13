import express from 'express';
import {
  validateCoupon,
  getAllCoupons,
  createOrUpdateCoupon,
  deleteCoupon,
} from '../controllers/couponController.js';
import { requireAdminOrStaff } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply / validate coupon code during checkout (Public)
router.post('/apply', validateCoupon);
router.post('/validate', validateCoupon);
router.get('/validate/:code', validateCoupon);

// Get available promotional coupon codes (Public)
router.get('/', getAllCoupons);

// Coupon management (Admin / Staff only)
router.post('/', requireAdminOrStaff, createOrUpdateCoupon);
router.put('/:code', requireAdminOrStaff, createOrUpdateCoupon);
router.delete('/:code', requireAdminOrStaff, deleteCoupon);

export default router;
