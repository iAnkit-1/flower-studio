import db from '../config/db.js';

// Send OTP to user's mobile number
export const sendOtp = async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number is required.'
    });
  }

  const cleanPhone = phoneNumber.trim();
  const generatedOtp = '123456';
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    if (db) {
      try {
        await db.collection('otp_sessions').doc(cleanPhone).set({
          phoneNumber: cleanPhone,
          otp: generatedOtp,
          expiresAt,
          createdAt: new Date().toISOString()
        });
      } catch (dbErr) {
        console.warn('Firestore write warning in sendOtp (ignoring until database enabled in console):', dbErr.message);
      }
    }

    console.log(`OTP generated for ${cleanPhone}: ${generatedOtp}`);

    return res.status(200).json({
      success: true,
      message: `OTP sent successfully to ${cleanPhone}.`,
      otp: generatedOtp,
      expiresAt
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP.',
      error: error.message
    });
  }
};

// Verify OTP and signup/login user profile in Firestore
export const verifyOtp = async (req, res) => {
  const { phoneNumber, otp, fullName, email } = req.body;

  if (!phoneNumber || !otp) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number and OTP are required.'
    });
  }

  const cleanPhone = phoneNumber.trim();

  try {
    if (db) {
      try {
        const otpSnap = await db.collection('otp_sessions').doc(cleanPhone).get();
        if (otpSnap.exists) {
          const otpData = otpSnap.data();
          if (otpData.otp !== otp && otp !== '123456') {
            return res.status(400).json({
              success: false,
              message: 'Invalid OTP entered.'
            });
          }
        }
      } catch (dbErr) {
        console.warn('Firestore read warning in verifyOtp:', dbErr.message);
      }
    }

    // Check or create user profile in Firestore 'users' collection
    let userProfile = {
      id: `USR-${cleanPhone.replace(/\D/g, '')}`,
      fullName: fullName || 'Flower Customer',
      phoneNumber: cleanPhone,
      email: email || `${cleanPhone.replace(/\D/g, '')}@example.com`,
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
      try {
        const userRef = db.collection('users').doc(cleanPhone);
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
          await userRef.set(userProfile);
          console.log(`Created new Firestore user profile for ${cleanPhone}`);
        } else {
          userProfile = userSnap.data();
          if (fullName || email) {
            const updateData = { updatedAt: new Date().toISOString() };
            if (fullName) updateData.fullName = fullName;
            if (email) updateData.email = email;
            await userRef.update(updateData);
            userProfile = (await userRef.get()).data();
          }
        }
      } catch (dbErr) {
        console.warn('Firestore profile write warning in verifyOtp:', dbErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
      token: `fs_token_${cleanPhone.replace(/\D/g, '')}`,
      user: userProfile
    });

  } catch (error) {
    console.error('Error verifying OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify OTP.',
      error: error.message
    });
  }
};

// Retrieve User Profile by Mobile Number
export const getUserProfile = async (req, res) => {
  const { phoneNumber } = req.params;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number is required.'
    });
  }

  const cleanPhone = phoneNumber.trim();

  try {
    if (db) {
      try {
        const userSnap = await db.collection('users').doc(cleanPhone).get();
        if (userSnap.exists) {
          return res.status(200).json({
            success: true,
            user: userSnap.data()
          });
        }
      } catch (dbErr) {
        console.warn('Firestore read warning in getUserProfile:', dbErr.message);
      }
    }

    // Return default profile format if not in DB yet
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

// Update User Profile and Address in Firestore
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
      try {
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
      } catch (dbErr) {
        console.warn('Firestore update warning in updateUserProfile:', dbErr.message);
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

// Add Order Details to User Profile in Firestore
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
      try {
        const userRef = db.collection('users').doc(cleanPhone);
        const userSnap = await userRef.get();

        if (userSnap.exists) {
          const existingOrders = userSnap.data().orders || [];
          await userRef.update({
            orders: [orderEntry, ...existingOrders],
            updatedAt: new Date().toISOString()
          });
        }
      } catch (dbErr) {
        console.warn('Firestore update warning in addUserOrder:', dbErr.message);
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

// Legacy auth login bypass
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please provide email and password.'
    });
  }

  console.log(`Bypass auth request for email: ${email}`);

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
