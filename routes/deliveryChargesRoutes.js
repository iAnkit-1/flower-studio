import express from 'express';
import {
  getDeliveryCharges,
  updateDeliveryCharge,
  getDeliveryPincodes,
} from '../controllers/deliveryChargesController.js';
import { requireAdminOrStaff } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET all delivery charge options (Public)
router.get('/', getDeliveryCharges);

// GET serviceable pincodes (Public)
router.get('/pincodes', getDeliveryPincodes);

// PUT /api/delivery-charges/:id — Update a specific charge (Admin / Staff only)
router.put('/:id', requireAdminOrStaff, updateDeliveryCharge);

export default router;
