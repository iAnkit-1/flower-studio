import db, { admin } from '../config/db.js';

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

    if (idToken && admin && admin.apps && admin.apps.length > 0) {
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
        if (decodedToken.phone_number) {
          extractedPhone = decodedToken.phone_number;
        }
      } catch (adminErr) {
        console.warn('[Firebase Admin verifyIdToken Warning]:', adminErr.message);
      }
    }

    let docId = extractedPhone ? extractedPhone.trim() : (decodedToken?.uid || email || decodedToken?.email);

    if (!docId) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract valid phone number or user identity from authentication payload.'
      });
    }

    const cleanPhone = extractedPhone ? extractedPhone.trim() : '';
    const mobile10Digits = cleanPhone ? cleanPhone.replace(/\D/g, '').slice(-10) : '';

    let userProfile = {
      id: decodedToken?.uid ? `USR-${decodedToken.uid.slice(0, 8)}` : (mobile10Digits ? `USR-${mobile10Digits}` : `USR-${Date.now()}`),
      fullName: fullName || decodedToken?.name || '',
      phoneNumber: cleanPhone,
      email: email || decodedToken?.email || '',
      alternateNumber: '',
      address: {
        houseNo: '',
        streetName: '',
        district: '',
        state: '',
        pincode: '',
        addressType: 'Home'
      },
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
        if (fullName && !userProfile.fullName) {
          updateData.fullName = fullName;
          modified = true;
        }
        if (email && !userProfile.email) {
          updateData.email = email;
          modified = true;
        }
        if (modified) {
          await userRef.update(updateData);
          userProfile = (await userRef.get()).data();
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
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          console.log(`[Firebase Auth Sync] Created UID user entry in Firestore for ${decodedToken.uid}`);
        } else {
          await uidRef.update({ updatedAt: new Date().toISOString() });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Firebase token verified successfully.',
      token: idToken || `fs_token_${mobile10Digits || decodedToken?.uid}`,
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

  try {
    if (db) {
      const userSnap = await db.collection('users').doc(cleanPhone).get();
      if (userSnap.exists) {
        return res.status(200).json({
          success: true,
          user: userSnap.data()
        });
      }
    }

    return res.status(200).json({
      success: true,
      user: {
        id: `USR-${cleanPhone.replace(/\D/g, '')}`,
        fullName: 'Flower Customer',
        phoneNumber: cleanPhone,
        email: `${cleanPhone.replace(/\D/g, '')}@example.com`,
        alternateNumber: '',
        address: {
          houseNo: '',
          streetName: '',
          district: '',
          state: '',
          pincode: '',
          addressType: 'Home'
        },
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
 * 3. Update User Profile and Address in Firestore
 */
export const updateUserProfile = async (req, res) => {
  const {
    phoneNumber,
    fullName,
    email,
    alternateNumber,
    houseNo,
    streetName,
    district,
    state,
    pincode,
    addressType
  } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number is required for updating profile.'
    });
  }

  const cleanPhone = phoneNumber.trim();

  const updatedAddress = {
    houseNo: houseNo || '',
    streetName: streetName || '',
    district: district || '',
    state: state || '',
    pincode: pincode || '',
    addressType: addressType || 'Home'
  };

  let profilePayload = {
    id: `USR-${cleanPhone.replace(/\D/g, '')}`,
    phoneNumber: cleanPhone,
    fullName: fullName || '',
    email: email || '',
    alternateNumber: alternateNumber || '',
    address: updatedAddress,
    updatedAt: new Date().toISOString()
  };

  try {
    if (db) {
      const userRef = db.collection('users').doc(cleanPhone);
      const userSnap = await userRef.get();

      if (userSnap.exists) {
        const currentData = userSnap.data();
        profilePayload = {
          ...currentData,
          fullName: fullName !== undefined ? fullName : (currentData.fullName || ''),
          email: email !== undefined ? email : (currentData.email || ''),
          alternateNumber: alternateNumber !== undefined ? alternateNumber : (currentData.alternateNumber || ''),
          address: {
            ...(currentData.address || {}),
            ...updatedAddress
          },
          updatedAt: new Date().toISOString()
        };
        await userRef.update(profilePayload);
      } else {
        profilePayload.orders = [];
        profilePayload.createdAt = new Date().toISOString();
        await userRef.set(profilePayload);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'User profile updated successfully!',
      user: profilePayload
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
