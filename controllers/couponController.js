import db from '../config/db.js';

/**
 * Seed Default Coupons in Firestore (FLAT100, FLAT50) if not present
 */
export const seedCouponCodes = async () => {
  if (!db) return;
  try {
    const docRef = db.collection('coupon_codes').doc('codes');
    const snap = await docRef.get();
    if (!snap.exists) {
      await docRef.set({
        code: {
          FLAT100: 100,
          FLAT50: 50,
        },
        createdAt: new Date().toISOString(),
      });
      console.log('[Seed Coupons] Seeded default coupon codes (FLAT100, FLAT50).');
    }
  } catch (err) {
    console.warn('[Seed Coupons Notice]:', err.message);
  }
};

/**
 * Apply / Validate Coupon Code
 * POST /api/coupons/apply or POST /api/coupons/validate
 * Body: { code: string, cartTotal?: number }
 */
export const validateCoupon = async (req, res) => {
  try {
    const rawCode = req.body.code || req.query.code;
    const cartTotal = parseFloat(req.body.cartTotal || req.body.total || 0);

    if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) {
      return res.status(200).json({
        success: false,
        valid: false,
        message: 'Please enter a coupon code.',
      });
    }

    const targetCode = rawCode.trim().toUpperCase();

    if (!db) {
      // Fallback in case DB is unavailable
      if (targetCode === 'FLAT100') {
        return res.status(200).json({
          success: true,
          valid: true,
          code: 'FLAT100',
          discount: 100,
          message: 'Congratulations, coupon code FLAT100 applied successfully.',
        });
      }
      if (targetCode === 'FLAT50') {
        return res.status(200).json({
          success: true,
          valid: true,
          code: 'FLAT50',
          discount: 50,
          message: 'Congratulations, coupon code FLAT50 applied successfully.',
        });
      }
      return res.status(200).json({
        success: false,
        valid: false,
        message: 'Sorry, this coupon code is not valid.',
      });
    }

    // Lookup Firestore 'coupon_codes' collection, doc 'codes'
    const docRef = db.collection('coupon_codes').doc('codes');
    const snap = await docRef.get();

    let discountAmount = null;

    if (snap.exists) {
      const data = snap.data() || {};

      // 1. Check if 'code' is a map { FLAT100: 100, FLAT50: 50 }
      if (data.code && typeof data.code === 'object') {
        for (const [k, v] of Object.entries(data.code)) {
          if (k.trim().toUpperCase() === targetCode) {
            discountAmount = parseFloat(v);
            break;
          }
        }
      }

      // 2. Check if 'codes' is a map
      if (discountAmount === null && data.codes && typeof data.codes === 'object') {
        for (const [k, v] of Object.entries(data.codes)) {
          if (k.trim().toUpperCase() === targetCode) {
            discountAmount = parseFloat(v);
            break;
          }
        }
      }

      // 3. Check top-level keys in doc
      if (discountAmount === null) {
        for (const [k, v] of Object.entries(data)) {
          if (k.trim().toUpperCase() === targetCode && (typeof v === 'number' || !isNaN(parseFloat(v)))) {
            discountAmount = parseFloat(v);
            break;
          }
        }
      }
    }

    // 4. Fallback check for single document in collection coupon_codes/{targetCode}
    if (discountAmount === null) {
      try {
        const singleSnap = await db.collection('coupon_codes').doc(targetCode).get();
        if (singleSnap.exists) {
          const sData = singleSnap.data() || {};
          discountAmount = parseFloat(sData.discount ?? sData.amount ?? sData.value ?? 0);
        }
      } catch (_) {}
    }

    // 5. Built-in fallback for FLAT100 and FLAT50
    if (discountAmount === null) {
      if (targetCode === 'FLAT100') discountAmount = 100;
      if (targetCode === 'FLAT50') discountAmount = 50;
    }

    if (discountAmount !== null && !isNaN(discountAmount) && discountAmount > 0) {
      return res.status(200).json({
        success: true,
        valid: true,
        code: targetCode,
        discount: discountAmount,
        message: `Congratulations, coupon code ${targetCode} applied successfully.`,
      });
    }

    return res.status(200).json({
      success: false,
      valid: false,
      message: 'Sorry, this coupon code is not valid.',
    });
  } catch (error) {
    console.error('Error validating coupon code:', error);
    return res.status(500).json({
      success: false,
      valid: false,
      message: 'Failed to validate coupon code.',
      error: error.message,
    });
  }
};

/**
 * Get All Active Coupons (for admin/organization or client listing)
 * GET /api/coupons
 */
export const getAllCoupons = async (req, res) => {
  try {
    if (!db) {
      return res.status(200).json({
        success: true,
        coupons: { FLAT100: 100, FLAT50: 50 },
      });
    }

    const docRef = db.collection('coupon_codes').doc('codes');
    const snap = await docRef.get();

    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=1800, stale-while-revalidate=3600');

    if (snap.exists) {
      const data = snap.data() || {};
      const codes = data.code || data.codes || data;
      return res.status(200).json({
        success: true,
        coupons: codes,
      });
    }

    return res.status(200).json({
      success: true,
      coupons: { FLAT100: 100, FLAT50: 50 },
    });
  } catch (error) {
    console.error('Error fetching coupon codes:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve coupon codes.',
      error: error.message,
    });
  }
};

/**
 * Create or Update Coupon Code (Admin / Staff only)
 * POST /api/coupons or PUT /api/coupons/:code
 */
export const createOrUpdateCoupon = async (req, res) => {
  try {
    const code = req.params.code || req.body.code;
    const discount = req.body.discount ?? req.body.amount;

    if (!code || typeof code !== 'string' || discount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Valid coupon code and discount amount are required.',
      });
    }

    const cleanCode = code.trim().toUpperCase();
    const discountVal = parseFloat(discount);

    if (isNaN(discountVal) || discountVal <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Discount must be a positive number.',
      });
    }

    if (db) {
      const docRef = db.collection('coupon_codes').doc('codes');
      await docRef.set(
        {
          code: {
            [cleanCode]: discountVal,
          },
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: `Coupon code ${cleanCode} saved successfully with discount ₹${discountVal}.`,
      coupon: { code: cleanCode, discount: discountVal },
    });
  } catch (error) {
    console.error('Error saving coupon code:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save coupon code.',
      error: error.message,
    });
  }
};

/**
 * Delete Coupon Code (Admin / Staff only)
 * DELETE /api/coupons/:code
 */
export const deleteCoupon = async (req, res) => {
  try {
    const { code } = req.params;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Coupon code is required.' });
    }

    const cleanCode = code.trim().toUpperCase();

    if (db) {
      const docRef = db.collection('coupon_codes').doc('codes');
      const snap = await docRef.get();
      if (snap.exists) {
        const data = snap.data() || {};
        const currentCodes = { ...(data.code || data.codes || {}) };
        delete currentCodes[cleanCode];

        await docRef.set(
          {
            code: currentCodes,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: `Coupon code ${cleanCode} deleted successfully.`,
    });
  } catch (error) {
    console.error('Error deleting coupon code:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete coupon code.',
      error: error.message,
    });
  }
};
