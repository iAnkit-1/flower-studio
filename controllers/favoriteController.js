import db from '../config/db.js';

/**
 * Normalizes phone number to standard 10-digit format
 */
const normalizePhone = (phone) => {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '').slice(-10);
};

/**
 * Get Favorite Products / IDs for Authenticated User
 * GET /api/favorites?phone=...&userId=...
 */
export const getUserFavorites = async (req, res) => {
  try {
    const rawPhone = req.query.phone || req.query.userPhone || req.headers['x-user-phone'];
    const userId = req.query.userId || req.query.uid || req.headers['x-user-id'];

    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !userId) {
      return res.status(200).json({
        success: true,
        favorites: [],
        favoriteIds: [],
      });
    }

    if (!db) {
      return res.status(200).json({
        success: true,
        favorites: [],
        favoriteIds: [],
      });
    }

    const targetDocId = cleanPhone || userId;
    const favsRef = db.collection('users').doc(targetDocId).collection('favorites');
    const snap = await favsRef.orderBy('addedAt', 'desc').get();

    const favorites = [];
    const favoriteIds = [];

    snap.forEach((doc) => {
      const data = doc.data();
      favoriteIds.push(doc.id);
      favorites.push({
        id: doc.id,
        ...data,
      });
    });

    return res.status(200).json({
      success: true,
      favorites,
      favoriteIds,
    });
  } catch (error) {
    console.error('[getUserFavorites Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch favorites.',
      favorites: [],
      favoriteIds: [],
      error: error.message,
    });
  }
};

/**
 * Toggle or Add/Remove Favorite Product
 * POST /api/favorites/toggle
 * Body: { productId, isFavorite, product?, phone?, userId? }
 */
export const toggleFavorite = async (req, res) => {
  try {
    const { productId, isFavorite, product } = req.body;
    const rawPhone = req.body.phone || req.body.userPhone || req.headers['x-user-phone'];
    const userId = req.body.userId || req.body.uid || req.headers['x-user-id'];

    const cleanPhone = normalizePhone(rawPhone);

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required.',
      });
    }

    const targetDocId = cleanPhone || userId || 'guest_user';

    if (db) {
      const userRef = db.collection('users').doc(targetDocId);
      const favDocRef = userRef.collection('favorites').doc(productId.toString());

      if (isFavorite === false) {
        // Remove favorite
        await favDocRef.delete();
        return res.status(200).json({
          success: true,
          isFavorite: false,
          productId,
          message: 'Removed from favorites.',
        });
      } else {
        // Add favorite
        const favData = {
          productId: productId.toString(),
          addedAt: new Date().toISOString(),
          ...(product || {}),
        };
        await favDocRef.set(favData, { merge: true });
        return res.status(200).json({
          success: true,
          isFavorite: true,
          productId,
          message: 'Added to favorites ❤️',
        });
      }
    }

    return res.status(200).json({
      success: true,
      isFavorite: !!isFavorite,
      productId,
      message: isFavorite ? 'Added to favorites' : 'Removed from favorites',
    });
  } catch (error) {
    console.error('[toggleFavorite Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update favorite.',
      error: error.message,
    });
  }
};

/**
 * Delete Favorite by ID
 * DELETE /api/favorites/:id?phone=...&userId=...
 */
export const deleteFavorite = async (req, res) => {
  try {
    const { id } = req.params;
    const rawPhone = req.query.phone || req.query.userPhone || req.headers['x-user-phone'];
    const userId = req.query.userId || req.query.uid || req.headers['x-user-id'];

    const cleanPhone = normalizePhone(rawPhone);
    const targetDocId = cleanPhone || userId || 'guest_user';

    if (db && id) {
      await db.collection('users').doc(targetDocId).collection('favorites').doc(id).delete();
    }

    return res.status(200).json({
      success: true,
      message: 'Favorite removed successfully.',
    });
  } catch (error) {
    console.error('[deleteFavorite Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove favorite.',
      error: error.message,
    });
  }
};
