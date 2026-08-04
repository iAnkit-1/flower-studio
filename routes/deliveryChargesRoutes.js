import express from 'express';
import {
  getDeliveryCharges,
  updateDeliveryCharge,
} from '../controllers/deliveryChargesController.js';

const router = express.Router();

// GET all delivery charge options
router.get('/', getDeliveryCharges);

// PUT /api/delivery-charges/:id  — Update a specific charge (admin)
router.put('/:id', updateDeliveryCharge);

export default router;
