import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';

const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const STAFF_COLLECTION = 'staff_users';

/**
 * POST /api/org/auth/login
 * Body: { email, password }
 * Returns: { success, token, staff: { email, name, role } }
 */
export const orgLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required.'
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // 1. Look up staff member in Firestore
    const snapshot = await db
      .collection(STAFF_COLLECTION)
      .where('email', '==', normalizedEmail)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const staffDoc  = snapshot.docs[0];
    const staffData = staffDoc.data();

    // 2. Verify password
    const passwordMatch = await bcrypt.compare(password, staffData.hashedPassword);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    // 3. Sign JWT with role embedded
    const payload = {
      email: staffData.email,
      name:  staffData.name,
      role:  staffData.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // 4. Update last login timestamp
    await staffDoc.ref.update({ lastLoginAt: new Date().toISOString() });

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${staffData.name}!`,
      token,
      staff: {
        email: staffData.email,
        name:  staffData.name,
        role:  staffData.role,
      }
    });

  } catch (error) {
    console.error('[orgLogin] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.',
      error: error.message
    });
  }
};

/**
 * GET /api/org/auth/me
 * Requires: verifyJWT middleware (sets req.staff)
 * Returns current staff profile from Firestore.
 */
export const getStaffMe = async (req, res) => {
  const { email } = req.staff;

  try {
    const snapshot = await db
      .collection(STAFF_COLLECTION)
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({
        success: false,
        message: 'Staff profile not found.'
      });
    }

    const staffData = snapshot.docs[0].data();

    // Never return the hashed password
    const { hashedPassword, ...safeProfile } = staffData;

    return res.status(200).json({
      success: true,
      staff: safeProfile
    });

  } catch (error) {
    console.error('[getStaffMe] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch staff profile.',
      error: error.message
    });
  }
};

/**
 * POST /api/org/auth/verify-token
 * Body: { token }
 * Lightweight endpoint for the Flutter app to validate a stored JWT on startup.
 */
export const verifyOrgToken = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: 'Token is required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.status(200).json({
      success: true,
      staff: {
        email: decoded.email,
        name:  decoded.name,
        role:  decoded.role,
      }
    });
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError' ? 'Session expired.' : 'Invalid token.',
      code
    });
  }
};
