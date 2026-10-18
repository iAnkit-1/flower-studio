import express from 'express';
import {
  getTickets,
  getTicketCounts,
  createTicket,
  assignTicket,
  updateTicketStatus,
  updateTicketPriority,
  updateTicket,
  sendChatMessage,
} from '../controllers/supportController.js';
import {
  optionalAuth,
  requireAdminOrStaff,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Live ticket counts for badges on Org Web and Organization App
router.get('/counts', optionalAuth, getTicketCounts);

// Tickets listing (Staff sees all, Customer sees own)
router.get('/', optionalAuth, getTickets);

// Create new support ticket (Customer from order details or Org Web)
router.post('/', optionalAuth, createTicket);

// Operational ticket updates (Staff only)
router.put('/:id/status', requireAdminOrStaff, updateTicketStatus);
router.put('/:id/priority', requireAdminOrStaff, updateTicketPriority);
router.put('/:id/assign', requireAdminOrStaff, assignTicket);
router.patch('/:id', requireAdminOrStaff, updateTicket);

// Send message in ticket chat (Ticket owner or Staff)
router.post('/:id/messages', optionalAuth, sendChatMessage);

export default router;
