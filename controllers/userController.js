import db from '../config/db.js';
import { findUserDoc } from './reminderController.js';
import { normalizePhone } from '../middleware/authMiddleware.js';

/**
 * GET /api/users/me
 * Authenticated customer: retrieves caller's own profile only
 */
export const getCurrentUserProfile = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.uid;
    const phone = req.user?.phoneNumber || '';

    if (!userId && !phone) {
      return res.status(401).json({
        success: false,
        message: 'Authentication session does not contain a valid user identity.'
      });
    }

    if (db) {
      const userDocInfo = await findUserDoc(userId, phone);
      if (userDocInfo && userDocInfo.data) {
        const data = userDocInfo.data;
        return res.status(200).json({
          success: true,
          user: {
            id: data.id || userDocInfo.id,
            userId: data.userId || userId,
            fullName: data.fullName || req.user?.name || '',
            phoneNumber: data.phoneNumber || phone,
            email: data.email || req.user?.email || '',
            alternateNumber: data.alternateNumber || '',
            address: data.address || {
              houseNo: '',
              streetName: '',
              district: '',
              state: '',
              pincode: '',
              addressType: 'Home'
            },
            addresses: Array.isArray(data.addresses) ? data.addresses : [],
            reminders: Array.isArray(data.reminders) ? data.reminders : [],
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
          }
        });
      }
    }

    // Default clean profile if record does not yet exist
    const cleanPhone = normalizePhone(phone);
    return res.status(200).json({
      success: true,
      user: {
        id: userId || (cleanPhone ? `USR-${cleanPhone}` : `USR-${Date.now()}`),
        userId: userId || '',
        fullName: req.user?.name || 'Flower Customer',
        phoneNumber: phone || '',
        email: req.user?.email || '',
        alternateNumber: '',
        address: {
          houseNo: '',
          streetName: '',
          district: '',
          state: '',
          pincode: '',
          addressType: 'Home'
        },
        addresses: [],
        reminders: [],
      }
    });

  } catch (error) {
    console.error('[getCurrentUserProfile Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile.',
      error: error.message
    });
  }
};

/**
 * PATCH /api/users/me (or PUT /api/users/me)
 * Authenticated customer: updates allowlisted profile fields only
 */
export const updateCurrentUserProfile = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.uid;
    const phone = req.user?.phoneNumber || '';

    if (!userId && !phone) {
      return res.status(401).json({
        success: false,
        message: 'Authentication session does not contain a valid user identity.'
      });
    }

    // Strict allowlist: prevent privilege escalation or tampering with internal fields
    const ALLOWLISTED_FIELDS = ['fullName', 'email', 'alternateNumber', 'address', 'addresses', 'reminders'];
    const updatePayload = {};

    for (const field of ALLOWLISTED_FIELDS) {
      if (req.body[field] !== undefined) {
        updatePayload[field] = req.body[field];
      }
    }

    updatePayload.updatedAt = new Date().toISOString();

    if (db) {
      const userDocInfo = await findUserDoc(userId, phone);
      let userRef;
      if (userDocInfo && userDocInfo.ref) {
        userRef = userDocInfo.ref;
        await userRef.set(updatePayload, { merge: true });
      } else {
        const cleanPhone = normalizePhone(phone);
        const docId = (cleanPhone && cleanPhone.length >= 10) ? `+91${cleanPhone}` : (userId || `USR_${Date.now()}`);
        userRef = db.collection('users').doc(docId);
        await userRef.set({
          id: userId || docId,
          userId: userId || '',
          phoneNumber: phone || '',
          email: req.user?.email || '',
          addresses: [],
          reminders: [],
          createdAt: new Date().toISOString(),
          ...updatePayload
        }, { merge: true });
      }

      const updatedSnap = await userRef.get();
      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        user: updatedSnap.data()
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: updatePayload
    });

  } catch (error) {
    console.error('[updateCurrentUserProfile Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update user profile.',
      error: error.message
    });
  }
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
