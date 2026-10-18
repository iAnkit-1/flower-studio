import db from '../config/db.js';
import { normalizePhone } from '../middleware/authMiddleware.js';

/**
 * Normalizes email address
 */
const normalizeEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
};

/**
 * POST /api/notify-items
 * Customer submits a "Notify Me" request for an out-of-stock / request-order product.
 * Enforces data security, prevents duplicate spam requests, and stores contact details.
 */
export const createNotifyRequest = async (req, res) => {
  try {
    const {
      productId,
      customerName,
      customerPhone,
      customerEmail,
      pincode,
      productTitle,
      productImage,
      category,
      subCategory,
      price,
      mrp,
    } = req.body;

    if (!productId || typeof productId !== 'string' || !productId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required.',
      });
    }

    const cleanProductId = productId.trim();
    const cleanPhone = normalizePhone(customerPhone || req.user?.phoneNumber || '');
    const cleanEmail = normalizeEmail(customerEmail || req.user?.email || '');
    const cleanName = (customerName || req.user?.name || 'Valued Customer').trim();
    const userId = req.user?.uid || req.body.userId || null;

    // Contact security check: customer must provide either a valid 10-digit phone or email
    if (!cleanPhone && !cleanEmail && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number or email so we can notify you.',
      });
    }

    // 1. Fetch current product details from database
    let productData = null;
    try {
      const prodDoc = await db.collection('products').doc(cleanProductId).get();
      if (prodDoc.exists) {
        productData = prodDoc.data();
      }
    } catch (prodErr) {
      console.warn('[Notify Controller] Product lookup error:', prodErr.message);
    }

    // 2. Duplicate request check (Idempotency)
    // Check if user (by userId or phone) already requested notification for this product
    try {
      let existingQuery = db.collection('notify_items').where('productId', '==', cleanProductId);
      const snapshot = await existingQuery.get();

      if (!snapshot.empty) {
        const alreadyExists = snapshot.docs.some((doc) => {
          const data = doc.data();
          const matchesUser = userId && data.userId === userId;
          const matchesPhone = cleanPhone && data.customerPhone === cleanPhone;
          const matchesEmail = cleanEmail && data.customerEmail === cleanEmail;
          const isActive = data.status === 'pending' || data.status === 'requested';
          return (matchesUser || matchesPhone || matchesEmail) && isActive;
        });

        if (alreadyExists) {
          return res.status(200).json({
            success: true,
            alreadyRequested: true,
            message: 'Notification request already received! We will notify you when back in stock.',
          });
        }
      }
    } catch (checkErr) {
      console.warn('[Notify Controller] Duplicate check error (proceeding to save):', checkErr.message);
    }

    // 3. Create new notify_items document
    const docRef = db.collection('notify_items').doc();
    const resolvedTitle = productData?.title || productTitle || 'Flower Studio Product';
    const resolvedImage = (Array.isArray(productData?.images) && productData.images[0]) ||
      productData?.imageUrl ||
      productImage ||
      '';
    const resolvedCategory = productData?.category || category || '';
    const resolvedSubCategory = productData?.subCategory || subCategory || '';
    const resolvedPrice = parseFloat(productData?.salePrice || productData?.price || price || 0);
    const resolvedMrp = parseFloat(productData?.mrp || productData?.originalPrice || mrp || resolvedPrice);
    const resolvedStock = parseFloat(productData?.stock !== undefined ? productData.stock : 0);
    const resolvedAvailability = productData?.availability || 'out of stock';

    const notifyItem = {
      id: docRef.id,
      productId: cleanProductId,
      userId: userId || null,
      productTitle: resolvedTitle,
      productImage: resolvedImage,
      category: resolvedCategory,
      subCategory: resolvedSubCategory,
      price: resolvedPrice,
      mrp: resolvedMrp,
      stock: resolvedStock,
      availability: resolvedAvailability,
      customerName: cleanName,
      customerPhone: cleanPhone,
      customerEmail: cleanEmail,
      pincode: (pincode || '').toString().trim(),
      status: 'pending', // 'pending' | 'notified' | 'fulfilled' | 'cancelled'
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docRef.set(notifyItem);

    console.log(`[Notify Controller] New notification request created: ${docRef.id} for product ${cleanProductId} (${cleanName})`);

    return res.status(201).json({
      success: true,
      alreadyRequested: false,
      message: 'Notification request saved successfully! We will notify you when available.',
      notifyItem,
    });
  } catch (err) {
    console.error('[Notify Controller] Error creating notify request:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to record notification request.',
      error: err.message,
    });
  }
};

/**
 * GET /api/notify-items/check
 * Check if the customer has already submitted a notify request for a product.
 */
export const checkNotifyStatus = async (req, res) => {
  try {
    const { productId, phone } = req.query;
    const userId = req.user?.uid || req.query.userId || null;
    const cleanPhone = normalizePhone(phone || req.user?.phoneNumber || '');

    if (!productId) {
      return res.status(400).json({ success: false, message: 'Missing productId.' });
    }

    if (!userId && !cleanPhone) {
      return res.status(200).json({ success: true, requested: false });
    }

    const snapshot = await db.collection('notify_items')
      .where('productId', '==', productId.toString().trim())
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ success: true, requested: false });
    }

    const hasRequested = snapshot.docs.some((doc) => {
      const data = doc.data();
      const matchesUser = userId && data.userId === userId;
      const matchesPhone = cleanPhone && data.customerPhone === cleanPhone;
      return (matchesUser || matchesPhone) && data.status !== 'cancelled';
    });

    return res.status(200).json({
      success: true,
      requested: hasRequested,
    });
  } catch (err) {
    console.error('[Notify Controller] Error checking notify status:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to check notification status.',
      error: err.message,
    });
  }
};

/**
 * GET /api/notify-items
 * Admin / Staff endpoint to list all customer notify requests.
 * Supports filtering by status and searching by product or customer.
 */
export const getAllNotifyItems = async (req, res) => {
  try {
    const { status, search } = req.query;

    let snapshot;
    try {
      snapshot = await db.collection('notify_items').orderBy('createdAt', 'desc').get();
    } catch (_) {
      snapshot = await db.collection('notify_items').get();
    }

    let items = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: data.id || doc.id,
        ...data,
      };
    });

    // Filter by status if provided
    if (status && status !== 'all') {
      const targetStatus = status.toLowerCase().trim();
      items = items.filter((item) => (item.status || 'pending').toLowerCase() === targetStatus);
    }

    // Filter by search query if provided
    if (search && search.trim()) {
      const query = search.trim().toLowerCase();
      items = items.filter((item) => {
        const title = (item.productTitle || '').toLowerCase();
        const name = (item.customerName || '').toLowerCase();
        const phone = (item.customerPhone || '').toLowerCase();
        const email = (item.customerEmail || '').toLowerCase();
        return title.includes(query) || name.includes(query) || phone.includes(query) || email.includes(query);
      });
    }

    return res.status(200).json({
      success: true,
      count: items.length,
      notifyItems: items,
    });
  } catch (err) {
    console.error('[Notify Controller] Error fetching notify items:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch notify items.',
      error: err.message,
    });
  }
};

/**
 * PATCH /api/notify-items/:id
 * Admin / Staff endpoint to update the status of a notify request (e.g., mark as 'notified' or 'fulfilled').
 */
export const updateNotifyItemStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Missing notify item ID.' });
    }

    const docRef = db.collection('notify_items').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Notify request not found.' });
    }

    const updatePayload = {
      updatedAt: new Date().toISOString(),
    };

    if (status) {
      updatePayload.status = status;
      if (status === 'notified') {
        updatePayload.notifiedAt = new Date().toISOString();
        updatePayload.notifiedBy = req.user?.name || req.user?.email || 'Staff';
      }
    }

    if (notes !== undefined) {
      updatePayload.staffNotes = notes;
    }

    await docRef.update(updatePayload);

    const updatedDoc = await docRef.get();

    return res.status(200).json({
      success: true,
      message: 'Notify request updated successfully.',
      notifyItem: { id: docRef.id, ...updatedDoc.data() },
    });
  } catch (err) {
    console.error('[Notify Controller] Error updating notify item:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update notify request.',
      error: err.message,
    });
  }
};

/**
 * DELETE /api/notify-items/:id
 * Admin / Staff endpoint to delete a notify request.
 */
export const deleteNotifyItem = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Missing notify item ID.' });
    }

    const docRef = db.collection('notify_items').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Notify request not found.' });
    }

    await docRef.delete();

    return res.status(200).json({
      success: true,
      message: 'Notify request deleted successfully.',
    });
  } catch (err) {
    console.error('[Notify Controller] Error deleting notify item:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete notify request.',
      error: err.message,
    });
  }
};
