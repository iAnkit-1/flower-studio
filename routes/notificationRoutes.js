import express from 'express';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  triggerBroadcast,
  registerToken,
  notificationStream,
} from '../controllers/notificationController.js';
import {
  optionalAuth,
  requireAdminOrStaff,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Real-Time Server-Sent Events (SSE) stream for staff portals (Org Web) - Zero polling, 0 Firestore reads
router.get('/stream', notificationStream);

// Device token registration (both customer app and staff portal)
router.post('/register-token', optionalAuth, registerToken);

// Staff notification management (Org Web & Org App)
router.get('/', requireAdminOrStaff, getNotifications);
router.patch('/:id/read', requireAdminOrStaff, markNotificationRead);
router.post('/mark-all-read', requireAdminOrStaff, markAllNotificationsRead);

// Send broadcast push notification (Admin or Staff)
router.post('/broadcast', requireAdminOrStaff, triggerBroadcast);

export default router;
