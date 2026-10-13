import express from 'express';
import {
  requestAccountDeletion,
  getDeletionRequests,
  updateDeletionRequestStatus,
} from '../controllers/accountDeletionController.js';
import {
  optionalAuth,
  requireAdminOrStaff,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Deletion Request Submission (Used by web portal delete-account.html and Mobile App)
router.post('/', optionalAuth, requestAccountDeletion);
router.post('/deletion-request', optionalAuth, requestAccountDeletion);

// Admin Management Endpoints (Staff/Admin only)
router.get('/', requireAdminOrStaff, getDeletionRequests);
router.patch('/:requestId', requireAdminOrStaff, updateDeletionRequestStatus);

export default router;
