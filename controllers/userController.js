import db from '../config/db.js';
import { getUserProfile, updateUserProfile } from './authController.js';

/**
 * GET /api/users/me
 * Authenticated customer: delegates to the unified getUserProfile in authController
 */
export const getCurrentUserProfile = async (req, res) => {
  if (!req.params.phoneNumber) {
    req.params.phoneNumber = req.user?.phoneNumber || req.user?.uid || req.user?.userId;
  }
  return getUserProfile(req, res);
};

/**
 * PATCH /api/users/me (or PUT /api/users/me)
 * Authenticated customer: delegates to the unified updateUserProfile in authController
 */
export const updateCurrentUserProfile = async (req, res) => {
  req.body = req.body || {};
  if (!req.body.phoneNumber && req.user?.phoneNumber) {
    req.body.phoneNumber = req.user.phoneNumber;
  }
  if (!req.body.userId && (req.user?.uid || req.user?.userId)) {
    req.body.userId = req.user.uid || req.user.userId;
  }
  return updateUserProfile(req, res);
};

/**
 * GET /api/users
 * Admin only: retrieves customer directory
 */
export const getAllUsers = async (req, res) => {
  try {
    if (!db) {
      return res.status(200).json({ success: true, users: [] });
    }

    const snapshot = await db.collection('users').limit(100).get();
    const users = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        fullName: data.fullName || '',
        phoneNumber: data.phoneNumber || '',
        email: data.email || '',
        createdAt: data.createdAt || null,
        addressesCount: Array.isArray(data.addresses) ? data.addresses.length : 0,
        remindersCount: Array.isArray(data.reminders) ? data.reminders.length : 0,
      };
    });

    return res.status(200).json({
      success: true,
      users
    });
  } catch (error) {
    console.error('[getAllUsers Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch users list.',
      error: error.message
    });
  }
};
