import express from 'express';
import {
  getUserReminders,
  createReminder,
  deleteReminder,
  updateReminder,
  syncReminders,
} from '../controllers/reminderController.js';

const router = express.Router();

router.get('/', getUserReminders);
router.post('/', createReminder);
router.put('/', syncReminders);
router.put('/:id', updateReminder);
router.delete('/:id', deleteReminder);

export default router;

