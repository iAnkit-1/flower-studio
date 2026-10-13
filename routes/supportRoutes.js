import express from 'express';
import {
  getTickets,
  createTicket,
  assignTicket,
  updateTicketStatus,
  sendChatMessage
} from '../controllers/supportController.js';
import {
  requireAuth,
  requireAdminOrStaff,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Support endpoints require authenticated user identity
router.use(requireAuth);

// Tickets listing (Staff sees all, Customer sees own)
router.get('/', getTickets);

// Create new ticket (Authenticated user)
router.post('/', createTicket);

// Operational ticket updates (Staff only)
router.put('/:id/assign', requireAdminOrStaff, assignTicket);
router.put('/:id/status', requireAdminOrStaff, updateTicketStatus);

// Send message in chat (Ticket owner or Staff)
router.post('/:id/messages', sendChatMessage);

export default router;
