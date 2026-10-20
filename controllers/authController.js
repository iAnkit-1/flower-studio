import jwt from 'jsonwebtoken';
import db, { admin, FieldValue } from '../config/db.js';
import { findUserDoc } from './reminderController.js';
import { normalizePhone, verifyFirebaseIdToken, JWT_SECRET } from '../middleware/authMiddleware.js';

/**
 * 1. Verify Firebase ID Token
 * Used for both Firebase Phone Auth and Google Sign-In.
 * Decodes the Firebase ID token and syncs/merges the user profile into Firestore.
 */
export const verifyFirebaseToken = async (req, res) => {
  const { idToken, phoneNumber, fullName, email, uid } = req.body;

  if (!idToken && !phoneNumber && !email) {
    return res.status(400).json({
      success: false,
      message: 'Firebase ID Token, Mobile Number, or Email is required.'
    });
  }

  try {
    let decodedToken = null;
    let extractedPhone = phoneNumber ? phoneNumber.trim() : '';

    if (idToken) {
      try {
        decodedToken = await verifyFirebaseIdToken(idToken);
        if (decodedToken?.phone_number) {
          extractedPhone = decodedToken.phone_number;
        }
      } catch (authErr) {
        console.warn('[Firebase verifyIdToken Warning]:', authErr.message);
      }
    }

    let firebaseUid = decodedToken?.uid || (uid ? String(uid).trim() : '');

    // Fallback: If UID not found from token (e.g. client sent Google OAuth ID token or un-updated app),
    // look up the user record directly in Firebase Auth by email or phone
    if (!firebaseUid && admin && typeof admin.auth === 'function') {
      const cleanEmail = (email || decodedToken?.email || '').trim();
      if (cleanEmail) {
        try {
          const userRec = await admin.auth().getUserByEmail(cleanEmail);
          if (userRec?.uid) {
            firebaseUid = userRec.uid;
            console.log(`[Firebase Auth Sync] Recovered UID ${firebaseUid} for email ${cleanEmail}`);
          }
        } catch (_) {}
      }
      if (!firebaseUid && extractedPhone) {
        try {
          const userRec = await admin.auth().getUserByPhoneNumber(extractedPhone);
          if (userRec?.uid) {
            firebaseUid = userRec.uid;
            console.log(`[Firebase Auth Sync] Recovered UID ${firebaseUid} for phone ${extractedPhone}`);
          }
        } catch (_) {}
      }
    }

    const phone10 = normalizePhone(extractedPhone);
    const cleanPhone = phone10 ? `+91${phone10}` : '';
    const cleanEmail = (email || decodedToken?.email || '').trim().toLowerCase();

    // Document ID: Phone number for Phone Auth, Email for Google Auth, fallback to UID
    const docId = cleanPhone || cleanEmail || firebaseUid;

    if (!docId) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract valid phone number or user identity from authentication payload.'
      });
    }

    let userProfile = {
      uid: firebaseUid,
      fullName: fullName || decodedToken?.name || '',
      phoneNumber: cleanPhone,
      email: cleanEmail,
      alternateNumber: '',
      addresses: [],
      reminders: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (db) {
      const userRef = db.collection('users').doc(docId);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        await userRef.set(userProfile);
        console.log(`[Firebase Auth Sync] Created user profile for ${docId}`);
      } else {
        userProfile = userSnap.data();
        const updateData = { updatedAt: new Date().toISOString() };
        let modified = false;

        // Ensure uid field is populated
        if (firebaseUid && (!userProfile.uid || userProfile.uid !== firebaseUid)) {
          updateData.uid = firebaseUid;
          userProfile.uid = firebaseUid;
          modified = true;
        }

        // Clean out legacy obsolete 'id' and 'address' fields
        if (userProfile.id !== undefined || userProfile.address !== undefined) {
          if (FieldValue && typeof FieldValue.delete === 'function') {
            updateData.id = FieldValue.delete();
            updateData.address = FieldValue.delete();
            modified = true;
          }
          delete userProfile.id;
          delete userProfile.address;
        }

        if (cleanPhone && !userProfile.phoneNumber) {
          updateData.phoneNumber = cleanPhone;
          userProfile.phoneNumber = cleanPhone;
          modified = true;
        }
        if (cleanEmail && !userProfile.email) {
          updateData.email = cleanEmail;
          userProfile.email = cleanEmail;
          modified = true;
        }
        if (fullName && !userProfile.fullName) {
          updateData.fullName = fullName;
          userProfile.fullName = fullName;
          modified = true;
        }

        if (modified) {
          await userRef.update(updateData);
          userProfile = (await userRef.get()).data();
          delete userProfile.id;
          delete userProfile.address;
        }
      }
    }

    const customerPayload = {
      uid: firebaseUid || userProfile.uid || '',
      userId: firebaseUid || userProfile.uid || '',
      phoneNumber: cleanPhone,
      email: userProfile.email || '',
      role: 'customer'
    };
    const signedCustomerToken = jwt.sign(customerPayload, JWT_SECRET, { expiresIn: '30d' });

    // Ensure clean response payload without id or address
    delete userProfile.id;
    delete userProfile.address;

    return res.status(200).json({
      success: true,
      message: 'Firebase token verified successfully.',
      token: signedCustomerToken,
      user: userProfile
    });

  } catch (error) {
    console.error('Error in verifyFirebaseToken:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify Firebase authentication.',
      error: error.message
    });
  }
};

/**
 * 2. Retrieve User Profile by Mobile Number or User ID
 */
export const getUserProfile = async (req, res) => {
  const { phoneNumber } = req.params;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number or User ID is required.'
    });
  }

  const cleanPhone = phoneNumber.trim();

  // Enforce customer ownership: customer cannot inspect other users' profiles
  if (req.user && !req.user.isStaff && !req.user.isAdmin) {
    const callerPhone = normalizePhone(req.user.phoneNumber);
    const callerId = (req.user.userId || req.user.uid || '').trim();
    const targetDigits = normalizePhone(cleanPhone);

    const matches = (callerPhone && targetDigits && callerPhone === targetDigits) ||
                    (callerId && callerId === cleanPhone);

    if (!matches) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this profile.',
        code: 'FORBIDDEN'
      });
    }
  }

  try {
    if (db) {
      const userDocInfo = await findUserDoc(cleanPhone, cleanPhone);
      if (userDocInfo && userDocInfo.data) {
        const data = userDocInfo.data;
        const { address, id, ...cleanData } = data;
        return res.status(200).json({
          success: true,
          user: {
            uid: data.uid || req.user?.uid || '',
            ...cleanData,
            addresses: Array.isArray(data.addresses) ? data.addresses : [],
            reminders: Array.isArray(data.reminders) ? data.reminders : [],
          }
        });
      }
    }

    return res.status(404).json({
      success: false,
      message: 'User profile not found.',
      code: 'NOT_FOUND'
    });

  } catch (error) {
    console.error('Error getting user profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user profile.',
      error: error.message
    });
  }
};

/**
 * 3. Update User Profile, Address and Reminders in Firestore
 */
export const updateUserProfile = async (req, res) => {
  const {
    phoneNumber,
    userId,
    fullName,
    email,
    alternateNumber,
    addresses,
    reminders
  } = req.body;

  const cleanPhone = (phoneNumber || '').trim();
  const targetId = cleanPhone || (userId || '').trim();

  if (!targetId) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number or User ID is required for updating profile.'
    });
  }

  // Enforce customer ownership: cannot modify another user's profile
  if (req.user && !req.user.isStaff && !req.user.isAdmin) {
    const callerPhone = normalizePhone(req.user.phoneNumber);
    const callerId = (req.user.userId || req.user.uid || '').trim();
    const targetDigits = normalizePhone(cleanPhone);

    const matches = (callerPhone && targetDigits && callerPhone === targetDigits) ||
                    (callerId && (callerId === targetId || callerId === (userId || '').trim()));

    if (!matches) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to modify another user\'s profile.',
        code: 'FORBIDDEN'
      });
    }
  }

  const callerUid = (req.user?.userId || req.user?.uid || userId || '').trim();

  let profilePayload = {
    uid: callerUid,
    phoneNumber: cleanPhone,
    fullName: fullName || '',
    email: email || '',
    alternateNumber: alternateNumber || '',
    updatedAt: new Date().toISOString()
  };

  if (Array.isArray(addresses)) {
    profilePayload.addresses = addresses;
  }
  if (Array.isArray(reminders)) {
    profilePayload.reminders = reminders;
  }

  try {
    if (db) {
      const userDocInfo = await findUserDoc(userId, cleanPhone);
      const userRef = userDocInfo?.ref || db.collection('users').doc(targetId);
      const userSnap = userDocInfo?.snap || (await userRef.get());

      if (userSnap && userSnap.exists) {
        const currentData = userSnap.data();
        profilePayload = {
          ...currentData,
          uid: callerUid || currentData.uid || '',
          fullName: fullName !== undefined ? fullName : (currentData.fullName || ''),
          email: email !== undefined ? email : (currentData.email || ''),
          alternateNumber: alternateNumber !== undefined ? alternateNumber : (currentData.alternateNumber || ''),
          updatedAt: new Date().toISOString()
        };

        delete profilePayload.address;
        delete profilePayload.id;

        if (Array.isArray(addresses)) {
          profilePayload.addresses = addresses;
        }
        if (Array.isArray(reminders)) {
          profilePayload.reminders = reminders;
        }
        if (FieldValue && typeof FieldValue.delete === 'function') {
          profilePayload.address = FieldValue.delete();
          profilePayload.id = FieldValue.delete();
        }
        await userRef.update(profilePayload);
      } else {
        profilePayload.orders = [];
        profilePayload.addresses = Array.isArray(addresses) ? addresses : [];
        profilePayload.reminders = Array.isArray(reminders) ? reminders : [];
        profilePayload.createdAt = new Date().toISOString();
        await userRef.set(profilePayload);
      }
    }

    const { address: _rmA, id: _rmI, ...cleanResp } = profilePayload;
    return res.status(200).json({
      success: true,
      message: 'User profile updated successfully!',
      user: cleanResp
    });

  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update user profile.',
      error: error.message
    });
  }
};
