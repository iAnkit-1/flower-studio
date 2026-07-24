import db from '../config/db.js';
import https from 'https';

// Helper to make HTTPS requests to Fast2SMS API
const makeFast2SMSRequest = (path, postData) => {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) {
      return resolve({ success: false, message: 'FAST2SMS_API_KEY is not configured in .env' });
    }

    const payload = JSON.stringify(postData);
    const req = https.request({
      hostname: 'www.fast2sms.com',
      path: path,
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          console.log(`[Fast2SMS Response] ${path}:`, parsed);
          resolve(parsed);
        } catch (e) {
          console.error('[Fast2SMS Parse Error]:', body);
          resolve({ return: false, message: 'Invalid response from Fast2SMS' });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Fast2SMS Request Error]:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
};

// 1. Send OTP (Fast2SMS /dev/otp/send + Firestore session sync)
export const sendOtp = async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number is required.'
    });
  }

  const cleanPhone = phoneNumber.trim();
  const mobile10Digits = cleanPhone.replace(/\D/g, '').slice(-10);

  if (mobile10Digits.length !== 10) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid 10-digit Indian mobile number.'
    });
  }

  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    // 1. Save session to Firestore otp_sessions
    if (db) {
      await db.collection('otp_sessions').doc(cleanPhone).set({
        phoneNumber: cleanPhone,
        mobile: mobile10Digits,
        otp: generatedOtp,
        expiresAt,
        createdAt: new Date().toISOString()
      });
    }

    console.log(`[SEND OTP] Mobile: ${mobile10Digits} | Code: ${generatedOtp}`);

    // 2. Trigger Fast2SMS /dev/otp/send if API Key & OTP ID present
    let smsResult = null;
    if (process.env.FAST2SMS_API_KEY) {
      const otpId = process.env.FAST2SMS_OTP_ID || 'flower_studio_otp';
      smsResult = await makeFast2SMSRequest('/dev/otp/send', {
        mobile: mobile10Digits,
        otp_id: otpId,
        otp: generatedOtp,
        otp_expiry: 10,
        otp_length: 6
      });
    }

    return res.status(200).json({
      success: true,
      message: smsResult?.message || `OTP generated and sent to +91 ${mobile10Digits}.`,
      otp: generatedOtp,
      expiresAt,
      fast2sms: smsResult
    });
  } catch (error) {
    console.error('Error in sendOtp:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP.',
      error: error.message
    });
  }
};

// 2. Verify OTP (Fast2SMS /dev/otp/verify + Firestore otp_sessions verification)
export const verifyOtp = async (req, res) => {
  const { phoneNumber, otp, fullName, email } = req.body;

  if (!phoneNumber || !otp) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number and OTP are required.'
    });
  }

  const cleanPhone = phoneNumber.trim();
  const mobile10Digits = cleanPhone.replace(/\D/g, '').slice(-10);
  const enteredOtp = otp.toString().trim();

  try {
    let isValidOtp = false;

    // A. Check Fast2SMS verify API first if configured
    if (process.env.FAST2SMS_API_KEY) {
      try {
        const smsVerifyRes = await makeFast2SMSRequest('/dev/otp/verify', {
          mobile: mobile10Digits,
          otp: enteredOtp
        });
        if (smsVerifyRes?.return === true || smsVerifyRes?.status_code === 200) {
          isValidOtp = true;
        }
      } catch (err) {
        console.warn('Fast2SMS verify check error, checking Firestore fallback:', err.message);
      }
    }

    // B. Check Firestore otp_sessions
    if (!isValidOtp && db) {
      const otpSnap = await db.collection('otp_sessions').doc(cleanPhone).get();
      if (otpSnap.exists) {
        const otpData = otpSnap.data();
        const now = new Date();
        const expiry = new Date(otpData.expiresAt);

        if (now <= expiry && otpData.otp === enteredOtp) {
          isValidOtp = true;
        }
      }
    }

    // C. Static fallback for 123456 demo testing
    if (!isValidOtp && enteredOtp === '123456') {
      isValidOtp = true;
    }

    if (!isValidOtp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP entered. Please check the 6-digit code and try again.'
      });
    }

    // OTP Verified! Fetch or create user profile in Firestore 'users' collection
    let userProfile = {
      id: `USR-${mobile10Digits}`,
      fullName: fullName || 'Flower Customer',
      phoneNumber: cleanPhone,
      email: email || `${mobile10Digits}@example.com`,
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
    }

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
      token: `fs_token_${mobile10Digits}`,
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

// 3. Resend OTP (Fast2SMS /dev/otp/resend + Firestore session extension)
export const resendOtp = async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number is required.'
    });
  }

  const cleanPhone = phoneNumber.trim();
  const mobile10Digits = cleanPhone.replace(/\D/g, '').slice(-10);

  try {
    let existingOtp = '123456';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    if (db) {
      const otpSnap = await db.collection('otp_sessions').doc(cleanPhone).get();
      if (otpSnap.exists) {
        existingOtp = otpSnap.data().otp || Math.floor(100000 + Math.random() * 900000).toString();
      } else {
        existingOtp = Math.floor(100000 + Math.random() * 900000).toString();
      }

      await db.collection('otp_sessions').doc(cleanPhone).set({
        phoneNumber: cleanPhone,
        mobile: mobile10Digits,
        otp: existingOtp,
        expiresAt,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }

    console.log(`[RESEND OTP] Mobile: ${mobile10Digits} | Code: ${existingOtp}`);

    let smsResult = null;
    if (process.env.FAST2SMS_API_KEY) {
      smsResult = await makeFast2SMSRequest('/dev/otp/resend', {
        mobile: mobile10Digits
      });
    }

    return res.status(200).json({
      success: true,
      message: smsResult?.message || `OTP resent successfully to +91 ${mobile10Digits}.`,
      otp: existingOtp,
      expiresAt,
      fast2sms: smsResult
    });
  } catch (error) {
    console.error('Error resending OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend OTP.',
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
