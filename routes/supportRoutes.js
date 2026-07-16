import express from 'express';
import {
  getTickets,
  createTicket,
  assignTicket,
  updateTicketStatus,
  sendChatMessage
} from '../controllers/supportController.js';

const router = express.Router();

// Routes mapping for /api/support
router.get('/', getTickets);
router.post('/', createTicket);
router.put('/:id/assign', assignTicket);
router.put('/:id/status', updateTicketStatus);
router.post('/:id/messages', sendChatMessage);

export default router;
