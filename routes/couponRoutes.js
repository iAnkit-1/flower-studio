import express from 'express';
import { validateCoupon, getAllCoupons } from '../controllers/couponController.js';

const router = express.Router();

// Apply / validate coupon code
router.post('/apply', validateCoupon);
router.post('/validate', validateCoupon);
router.get('/validate/:code', validateCoupon);

// Get available coupon codes
router.get('/', getAllCoupons);

export default router;
