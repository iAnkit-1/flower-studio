import express from 'express';
import {
  getUserReminders,
  createReminder,
  deleteReminder,
  updateReminder,
  syncReminders,
} from '../controllers/reminderController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All reminder operations require authenticated customer/staff identity
router.use(requireAuth);

router.get('/', getUserReminders);
router.post('/', createReminder);
router.put('/', syncReminders);
router.put('/:id', updateReminder);
router.delete('/:id', deleteReminder);

export default router;

