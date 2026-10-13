import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';

import { JWT_SECRET } from '../middleware/authMiddleware.js';
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

    const staffDoc = snapshot.docs[0];
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
      name: staffData.name,
      role: staffData.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    // 4. Set HttpOnly Secure Cookie for maximum security
    const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;
    res.cookie('org_jwt', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    // 5. Update last login timestamp
    await staffDoc.ref.update({ lastLoginAt: new Date().toISOString() });

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${staffData.name}!`,
      token,
      staff: {
        email: staffData.email,
        name: staffData.name,
        role: staffData.role,
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
 * POST /api/org/auth/logout
 * Clears the HttpOnly JWT cookie.
 */
export const orgLogout = async (req, res) => {
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL;
  res.clearCookie('org_jwt', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
  });

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully.'
  });
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
  const token = req.cookies?.org_jwt || req.body?.token;

  if (!token) {
    return res.status(400).json({ success: false, message: 'Token or cookie is required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.status(200).json({
      success: true,
      staff: {
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
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

/**
 * GET /api/org/staff
 * Admin only: retrieves all staff / admin users
 */
export const getAllStaff = async (req, res) => {
  try {
    const snapshot = await db.collection(STAFF_COLLECTION).get();
    const staffList = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || 'Staff User',
        email: data.email || '',
        role: data.role || 'staff',
        isActive: data.isActive !== false,
        createdAt: data.createdAt || null,
        lastLoginAt: data.lastLoginAt || null,
      };
    });

    staffList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return res.status(200).json({
      success: true,
      staff: staffList
    });
  } catch (error) {
    console.error('[getAllStaff] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve staff users.',
      error: error.message
    });
  }
};

/**
 * POST /api/org/staff
 * Admin only: creates a new staff user
 */
export const createStaff = async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, and password are required.'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long.'
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const validRole = (role || 'orders').trim().toLowerCase();
  const allowedRoles = ['admin', 'catalog', 'orders', 'delivery'];

  if (!allowedRoles.includes(validRole)) {
    return res.status(400).json({
      success: false,
      message: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
    });
  }

  try {
    const existing = await db
      .collection(STAFF_COLLECTION)
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.status(400).json({
        success: false,
        message: 'A staff member with this email already exists.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const docId = normalizedEmail.replace(/[@.]/g, '_');
    const now = new Date().toISOString();

    const staffDoc = {
      email: normalizedEmail,
      hashedPassword,
      name: name.trim(),
      role: validRole,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      createdBy: req.staff?.email || req.user?.email || 'admin'
    };

    await db.collection(STAFF_COLLECTION).doc(docId).set(staffDoc);

    return res.status(201).json({
      success: true,
      message: `Staff user '${name.trim()}' created successfully.`,
      staff: {
        id: docId,
        name: staffDoc.name,
        email: staffDoc.email,
        role: staffDoc.role,
        isActive: staffDoc.isActive,
        createdAt: staffDoc.createdAt,
      }
    });
  } catch (error) {
    console.error('[createStaff] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create staff member.',
      error: error.message
    });
  }
};

/**
 * PUT /api/org/staff/:id/password
 * Admin only: update/reset a staff member's password
 */
export const updateStaffPassword = async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'New password must be at least 6 characters long.'
    });
  }

  try {
    let docRef = db.collection(STAFF_COLLECTION).doc(id);
    let docSnap = await docRef.get();

    if (!docSnap.exists) {
      const qSnap = await db.collection(STAFF_COLLECTION).where('email', '==', id.trim().toLowerCase()).limit(1).get();
      if (!qSnap.empty) {
        docRef = qSnap.docs[0].ref;
        docSnap = qSnap.docs[0];
      } else {
        return res.status(404).json({
          success: false,
          message: 'Staff member not found.'
        });
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await docRef.update({
      hashedPassword,
      updatedAt: new Date().toISOString(),
      passwordChangedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully.'
    });
  } catch (error) {
    console.error('[updateStaffPassword] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update staff password.',
      error: error.message
    });
  }
};

/**
 * PUT /api/org/staff/:id
 * Admin only: update staff member details (name, role, isActive)
 */
export const updateStaff = async (req, res) => {
  const { id } = req.params;
  const { name, role, isActive } = req.body;

  try {
    let docRef = db.collection(STAFF_COLLECTION).doc(id);
    let docSnap = await docRef.get();

    if (!docSnap.exists) {
      const qSnap = await db.collection(STAFF_COLLECTION).where('email', '==', id.trim().toLowerCase()).limit(1).get();
      if (!qSnap.empty) {
        docRef = qSnap.docs[0].ref;
        docSnap = qSnap.docs[0];
      } else {
        return res.status(404).json({
          success: false,
          message: 'Staff member not found.'
        });
      }
    }

    const updates = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (role !== undefined) {
      const allowedRoles = ['admin', 'catalog', 'orders', 'delivery'];
      if (!allowedRoles.includes(role.toLowerCase())) {
        return res.status(400).json({ success: false, message: 'Invalid role specified.' });
      }
      updates.role = role.toLowerCase();
    }
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    await docRef.update(updates);

    const updatedSnap = await docRef.get();
    const data = updatedSnap.data();

    return res.status(200).json({
      success: true,
      message: 'Staff member updated successfully.',
      staff: {
        id: docRef.id,
        name: data.name,
        email: data.email,
        role: data.role,
        isActive: data.isActive,
        createdAt: data.createdAt,
        lastLoginAt: data.lastLoginAt,
      }
    });
  } catch (error) {
    console.error('[updateStaff] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update staff member.',
      error: error.message
    });
  }
};

/**
 * DELETE /api/org/staff/:id
 * Admin only: remove a staff member
 */
export const deleteStaff = async (req, res) => {
  const { id } = req.params;

  try {
    let docRef = db.collection(STAFF_COLLECTION).doc(id);
    let docSnap = await docRef.get();

    if (!docSnap.exists) {
      const qSnap = await db.collection(STAFF_COLLECTION).where('email', '==', id.trim().toLowerCase()).limit(1).get();
      if (!qSnap.empty) {
        docRef = qSnap.docs[0].ref;
        docSnap = qSnap.docs[0];
      } else {
        return res.status(404).json({
          success: false,
          message: 'Staff member not found.'
        });
      }
    }

    const data = docSnap.data();
    const callerEmail = req.staff?.email || req.user?.email;

    if (callerEmail && data.email && callerEmail.toLowerCase() === data.email.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own admin account.'
      });
    }

    await docRef.delete();

    return res.status(200).json({
      success: true,
      message: `Staff member '${data.name || data.email}' removed successfully.`
    });
  } catch (error) {
    console.error('[deleteStaff] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove staff member.',
      error: error.message
    });
  }
};

