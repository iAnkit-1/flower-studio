import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import db, { admin } from '../config/db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'fs_org_jwt_secret_change_in_prod_2024';

// Google JWKS for verifying Firebase ID Tokens on Edge / Node
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

/**
 * Normalizes phone number to standard 10-digit format
 */
export const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

/**
 * Verify Firebase ID Token via Firebase Admin or Edge JWKS
 */
export async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;

  // 1. Try Firebase Admin SDK if available
  try {
    if (admin && typeof admin.auth === 'function') {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (decoded && decoded.uid) return decoded;
    }
  } catch (err) {
    // Proceed to jose Edge JWKS fallback
  }

  // 2. Fall back to jose edge JWKS verification
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || 'flower-studio-37861';
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    if (payload && (payload.sub || payload.uid)) {
      return {
        uid: payload.sub || payload.uid,
        phone_number: payload.phone_number || '',
        email: payload.email || '',
        name: payload.name || '',
        ...payload
      };
    }
  } catch (edgeErr) {
    // Not a valid Firebase ID token
  }

  return null;
}

/**
 * Extract token from request (Bearer header, cookie, or custom header)
 */
export const extractToken = (req) => {
  // 1. Check Authorization header
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
  }

  // 2. Check HttpOnly cookie (org_jwt)
  if (req.cookies?.org_jwt) {
    return req.cookies.org_jwt;
  }

  // 3. Fallback headers
  if (req.headers['x-firebase-token']) {
    return req.headers['x-firebase-token'];
  }
  if (req.headers['x-auth-token']) {
    return req.headers['x-auth-token'];
  }

  // 4. Query parameter (useful for browser downloads e.g. invoices)
  if (req.query?.token) {
    return req.query.token;
  }

  return null;
};

/**
 * Verifies any token: custom backend JWT (staff or customer) or Firebase ID token
 * Returns normalized user session object or error object
 */
export const verifyAuthToken = async (token) => {
  if (!token) return null;

  // 1. Check if token is a custom backend JWT
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded) {
      const role = (decoded.role || '').toLowerCase();
      const staffRoles = ['admin', 'staff', 'manager', 'editor', 'finance', 'delivery'];
      const isStaff = staffRoles.includes(role);
      const isAdmin = role === 'admin';

      return {
        type: isStaff ? 'staff' : 'customer',
        role: role || (isStaff ? 'staff' : 'customer'),
        isStaff,
        isAdmin,
        uid: decoded.uid || decoded.userId || decoded.id || decoded.email,
        userId: decoded.userId || decoded.uid || decoded.id || '',
        phoneNumber: decoded.phoneNumber || decoded.phone || '',
        email: decoded.email || '',
        name: decoded.name || '',
      };
    }
  } catch (jwtErr) {
    // If it was signed with JWT_SECRET but is expired, reject immediately
    if (jwtErr.name === 'TokenExpiredError') {
      return { error: 'TOKEN_EXPIRED', message: 'Session expired. Please log in again.' };
    }
    // If signature mismatch, it might be a Google/Firebase ID token. Fall through.
  }

  // 2. Check if token is a Firebase ID Token
  try {
    const fbPayload = await verifyFirebaseIdToken(token);
    if (fbPayload) {
      return {
        type: 'customer',
        role: 'customer',
        isStaff: false,
        isAdmin: false,
        uid: fbPayload.uid,
        userId: fbPayload.uid,
        phoneNumber: fbPayload.phone_number || '',
        email: fbPayload.email || '',
        name: fbPayload.name || '',
      };
    }
  } catch (fbErr) {
    // Firebase verification failed
  }

  return { error: 'TOKEN_INVALID', message: 'Invalid authentication token.' };
};

/**
 * Middleware: Require Authentication
 * Returns 401 if token is missing, expired, or invalid.
 */
export const requireAuth = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Authorization token is missing.',
      code: 'UNAUTHORIZED'
    });
  }

  const session = await verifyAuthToken(token);
  if (!session || session.error) {
    return res.status(401).json({
      success: false,
      message: session?.message || 'Invalid or expired authentication token.',
      code: session?.error || 'TOKEN_INVALID'
    });
  }

  req.user = session;
  if (session.isStaff) {
    req.staff = session;
  }
  next();
};

/**
 * Middleware: Optional Authentication
 * Attaches req.user if valid token provided, but does NOT block unauthenticated requests.
 */
export const optionalAuth = async (req, res, next) => {
  const token = extractToken(req);
  if (token) {
    const session = await verifyAuthToken(token);
    if (session && !session.error) {
      req.user = session;
      if (session.isStaff) {
        req.staff = session;
      }
    }
  }
  next();
};

/**
 * Middleware: Require Admin or Staff Role
 * Returns 401 if unauthenticated.
 * Returns 403 if authenticated user is a normal customer.
 */
export const requireAdminOrStaff = async (req, res, next) => {
  if (!req.user) {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Authorization token is missing.',
        code: 'UNAUTHORIZED'
      });
    }

    const session = await verifyAuthToken(token);
    if (!session || session.error) {
      return res.status(401).json({
        success: false,
        message: session?.message || 'Invalid or expired authentication token.',
        code: session?.error || 'TOKEN_INVALID'
      });
    }

    req.user = session;
    if (session.isStaff) {
      req.staff = session;
    }
  }

  if (!req.user.isStaff && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Administrator or authorized staff access required.',
      code: 'FORBIDDEN'
    });
  }

  next();
};

/**
 * Middleware: Require Administrator Role specifically
 * Returns 401 if unauthenticated.
 * Returns 403 if not an administrator.
 */
export const requireAdmin = async (req, res, next) => {
  if (!req.user) {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Authorization token is missing.',
        code: 'UNAUTHORIZED'
      });
    }

    const session = await verifyAuthToken(token);
    if (!session || session.error) {
      return res.status(401).json({
        success: false,
        message: session?.message || 'Invalid or expired authentication token.',
        code: session?.error || 'TOKEN_INVALID'
      });
    }

    req.user = session;
    if (session.isStaff) {
      req.staff = session;
    }
  }

  if (!req.user.isAdmin && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Administrator privileges required.',
      code: 'FORBIDDEN'
    });
  }

  next();
};

/**
 * Legacy aliases for backwards compatibility with verifyJWT.js callers
 */
export const verifyJWT = requireAdminOrStaff;

export const requireRole = (allowedRoles) => {
  const roles = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]).map((r) => r.toLowerCase());

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. No active session found.'
      });
    }

    const userRole = (req.user.role || '').toLowerCase();
    if (!roles.includes(userRole) && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${userRole}`
      });
    }

    next();
  };
};
