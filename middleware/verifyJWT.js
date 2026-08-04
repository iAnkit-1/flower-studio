import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[verifyJWT] FATAL: JWT_SECRET is not set in environment variables.');
}

/**
 * Middleware: Verify Custom JWT for Organization staff routes.
 * Attaches req.staff = { email, role, name } on success.
 */
export const verifyJWT = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authorization token is missing. Please log in.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.staff = {
      email: decoded.email,
      role:  decoded.role,
      name:  decoded.name,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid token. Please log in again.',
      code: 'TOKEN_INVALID'
    });
  }
};

/**
 * Middleware factory: Restrict access to specific roles.
 * Usage: requireRole('admin') or requireRole(['admin', 'orders'])
 */
export const requireRole = (allowedRoles) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.staff) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. No staff session found.'
      });
    }

    if (!roles.includes(req.staff.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.staff.role}`
      });
    }

    next();
  };
};
