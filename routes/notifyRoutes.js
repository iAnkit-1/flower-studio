import express from 'express';
import {
  createNotifyRequest,
  checkNotifyStatus,
  getAllNotifyItems,
  updateNotifyItemStatus,
  deleteNotifyItem,
} from '../controllers/notifyController.js';
import {
  optionalAuth,
  requireAdminOrStaff,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Customer notification endpoints
router.post('/', optionalAuth, createNotifyRequest);
router.get('/check', optionalAuth, checkNotifyStatus);

// Admin / Staff portal management endpoints
router.get('/', requireAdminOrStaff, getAllNotifyItems);
router.patch('/:id', requireAdminOrStaff, updateNotifyItemStatus);
router.delete('/:id', requireAdminOrStaff, deleteNotifyItem);

export default router;
