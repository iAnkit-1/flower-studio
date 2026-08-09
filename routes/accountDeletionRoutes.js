import express from 'express';
import {
  requestAccountDeletion,
  getDeletionRequests,
  updateDeletionRequestStatus,
} from '../controllers/accountDeletionController.js';

const router = express.Router();

// Public Deletion Request Submission (Used by delete-account.html and Mobile App)
router.post('/', requestAccountDeletion);
router.post('/deletion-request', requestAccountDeletion);

// Admin Management Endpoints
router.get('/', getDeletionRequests);
router.patch('/:requestId', updateDeletionRequestStatus);

export default router;
