import express from 'express';
import {
  getUserReminders,
  createReminder,
  deleteReminder,
} from '../controllers/reminderController.js';

const router = express.Router();

router.get('/', getUserReminders);
router.post('/', createReminder);
router.delete('/:id', deleteReminder);

export default router;
