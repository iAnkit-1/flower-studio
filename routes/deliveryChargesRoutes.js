import express from 'express';
import {
  getDeliveryCharges,
  updateDeliveryCharge,
  getDeliveryPincodes,
} from '../controllers/deliveryChargesController.js';

const router = express.Router();

// GET all delivery charge options
router.get('/', getDeliveryCharges);

// GET serviceable pincodes
router.get('/pincodes', getDeliveryPincodes);

// PUT /api/delivery-charges/:id  — Update a specific charge (admin)
router.put('/:id', updateDeliveryCharge);

export default router;
