import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import db, { admin, FieldValue } from '../config/db.js';
import { findUserDoc } from './reminderController.js';
import { normalizePhone } from '../middleware/authMiddleware.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fs_org_jwt_secret_change_in_prod_2024';

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

async function verifyEdgeFirebaseIdToken(token) {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'flower-studio-37861';
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  return payload;
}

/**
 * 1. Verify Firebase ID Token
 * Used for both Firebase Phone Auth and Google Sign-In.
 * Decodes the Firebase ID token and syncs/merges the user profile into Firestore.
 */
export const verifyFirebaseToken = async (req, res) => {
  const { idToken, phoneNumber, fullName, email } = req.body;

  if (!idToken && !phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Firebase ID Token or Mobile Number is required.'
    });
  }

  try {
    let decodedToken = null;
    let extractedPhone = phoneNumber ? phoneNumber.trim() : '';

    if (idToken) {
      try {
        if (admin && typeof admin.auth === 'function') {
          decodedToken = await admin.auth().verifyIdToken(idToken);
        } else {
          decodedToken = await verifyEdgeFirebaseIdToken(idToken);
        }
        if (decodedToken?.phone_number) {
          extractedPhone = decodedToken.phone_number;
        }
      } catch (authErr) {
        console.warn('[Firebase verifyIdToken Warning]:', authErr.message);
      }
    }

    const firebaseUid = decodedToken?.uid || '';
    let docId = extractedPhone ? extractedPhone.trim() : (firebaseUid || email || decodedToken?.email);

    if (!docId) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract valid phone number or user identity from authentication payload.'
      });
    }

    const cleanPhone = extractedPhone ? extractedPhone.trim() : '';

    let userProfile = {
      uid: firebaseUid,
      fullName: fullName || decodedToken?.name || '',
      phoneNumber: cleanPhone,
      email: email || decodedToken?.email || '',
      alternateNumber: '',
      addresses: [],
      reminders: [],
      orders: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (db) {
      const userRef = db.collection('users').doc(docId);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        await userRef.set(userProfile);
        console.log(`[Firebase Auth Sync] Created user profile in Firestore for ${docId}`);
      } else {
        userProfile = userSnap.data();
        const updateData = { updatedAt: new Date().toISOString() };
        let modified = false;

        // Ensure uid is stored and updated
        if (firebaseUid && (!userProfile.uid || userProfile.uid !== firebaseUid)) {
          updateData.uid = firebaseUid;
          userProfile.uid = firebaseUid;
          modified = true;
        }

        // Clean out obsolete 'id' and 'address' fields from existing Firestore documents
        if (userProfile.id !== undefined || userProfile.address !== undefined) {
          if (FieldValue && typeof FieldValue.delete === 'function') {
            updateData.id = FieldValue.delete();
            updateData.address = FieldValue.delete();
            modified = true;
          }
          delete userProfile.id;
          delete userProfile.address;
        }

        if (fullName && !userProfile.fullName) {
          updateData.fullName = fullName;
          userProfile.fullName = fullName;
          modified = true;
        }
        if (email && !userProfile.email) {
          updateData.email = email;
          userProfile.email = email;
          modified = true;
        }
        if (modified) {
          await userRef.update(updateData);
          userProfile = (await userRef.get()).data();
          delete userProfile.id;
          delete userProfile.address;
        }
      }

      // If Firebase User UID is decoded, merge entry indexed by User UID
      if (decodedToken && decodedToken.uid && docId !== decodedToken.uid) {
        const uidRef = db.collection('users').doc(decodedToken.uid);
        const uidSnap = await uidRef.get();
        if (!uidSnap.exists) {
          await uidRef.set({
            uid: decodedToken.uid,
            phoneNumber: cleanPhone,
            provider: cleanPhone ? 'phone' : 'google',
            fullName: userProfile.fullName || '',
            email: userProfile.email || '',
            alternateNumber: '',
            addresses: [],
            reminders: [],
            orders: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          console.log(`[Firebase Auth Sync] Created UID user entry in Firestore for ${decodedToken.uid}`);
        } else {
          const uidUpdate = { updatedAt: new Date().toISOString() };
          if (FieldValue && typeof FieldValue.delete === 'function') {
            uidUpdate.id = FieldValue.delete();
            uidUpdate.address = FieldValue.delete();
          }
          await uidRef.update(uidUpdate);
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

    return res.status(200).json({
      success: true,
      user: {
        uid: req.user?.uid || '',
        fullName: 'Flower Customer',
        phoneNumber: cleanPhone,
        email: `${cleanPhone.replace(/\D/g, '')}@example.com`,
        alternateNumber: '',
        addresses: [],
        reminders: [],
        orders: []
      }
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

/**
 * 4. Add Order Details to User Profile in Firestore
 */
export const addUserOrder = async (req, res) => {
  const {
    phoneNumber,
    orderId,
    productId,
    quantity,
    addons,
    address,
    paymentDetails,
    recipientNumber,
    messageOnCard,
    messageOnCake,
    orderStatus
  } = req.body;

  if (!phoneNumber || !orderId || !productId) {
    return res.status(400).json({
      success: false,
      message: 'phoneNumber, orderId, and productId are required.'
    });
  }

  const cleanPhone = phoneNumber.trim();

  const formattedAddons = Array.isArray(addons)
    ? addons.map(item => ({
        productId: item.productId || item.product_id || '',
        quantity: parseInt(item.quantity || 1, 10)
      }))
    : [];

  const addonProductIds = formattedAddons.map(a => a.productId).filter(Boolean);

  const orderEntry = {
    orderId,
    productId,
    quantity: parseInt(quantity || 1, 10),
    addons: formattedAddons,
    addonProductIds: addonProductIds,
    address: {
      houseNo: address?.houseNo || '',
      streetName: address?.streetName || '',
      district: address?.district || '',
      state: address?.state || '',
      pincode: address?.pincode || '',
      addressType: address?.addressType || 'Home'
    },
    paymentDetails: {
      method: paymentDetails?.method || 'ONLINE',
      status: paymentDetails?.status || 'pending',
      transactionId: paymentDetails?.transactionId || null,
      amount: parseFloat(paymentDetails?.amount || 0.0)
    },
    recipientNumber: recipientNumber || cleanPhone,
    messageOnCard: messageOnCard || '',
    messageOnCake: messageOnCake || '',
    orderStatus: orderStatus || 'pending',
    createdAt: new Date().toISOString()
  };

  try {
    if (db) {
      const userRef = db.collection('users').doc(cleanPhone);
      const userSnap = await userRef.get();

      if (userSnap.exists) {
        const existingOrders = userSnap.data().orders || [];
        await userRef.update({
          orders: [orderEntry, ...existingOrders],
          updatedAt: new Date().toISOString()
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Order details successfully saved to user profile.',
      order: orderEntry
    });

  } catch (error) {
    console.error('Error adding order details to user profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add order to user profile.',
      error: error.message
    });
  }
};

/**
 * 5. Legacy Auth Login Bypass
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please provide email and password.'
    });
  }

  return res.status(200).json({
    success: true,
    token: 'simulated-jwt-token-bypass-key',
    user: {
      email: email,
      name: email.split('@')[0],
      role: 'admin'
    }
  });
};

/**
 * Legacy OTP Stubs (Maintained for backwards compatibility)
 */
export const sendOtp = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Firebase Phone Authentication is active. Please authenticate via Firebase Auth.'
  });
};

export const verifyOtp = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Firebase Phone Authentication is active. Please send Firebase ID Token to /api/auth/verify-firebase-token.'
  });
};

export const resendOtp = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Firebase Phone Authentication is active.'
  });
};
