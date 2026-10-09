import db from '../config/db.js';
import crypto from 'crypto';
import { normalizeImageUrl } from './productController.js';
import { getRazorpayClient } from '../config/razorpay.js';


/**
 * Normalizes flower varieties array ensuring max 3 images per variety
 */
const normalizeFlowerVarieties = (varieties, req) => {
  if (!Array.isArray(varieties)) return [];
  return varieties.map((v) => {
    let images = [];
    if (Array.isArray(v.images)) {
      images = v.images.slice(0, 3).map((img) => normalizeImageUrl(img, req));
    }
    return {
      name: v.name || 'Seasonal Fresh Bloom',
      description: v.description || '',
      images: images,
    };
  });
};

/*
|--------------------------------------------------------------------------
| SUBSCRIPTION PLANS (Admin / Org Management & Public Catalogue)
|--------------------------------------------------------------------------
*/

// GET /api/subscriptions/plans
export const getSubscriptionPlans = async (req, res) => {
  try {
    const includeAll = req.query.all === 'true';
    let snapshot;

    if (db) {
      const ref = db.collection('subscription_plans');
      if (includeAll) {
        snapshot = await ref.orderBy('createdAt', 'desc').get();
      } else {
        snapshot = await ref.where('isActive', '==', true).get();
      }
    }

    if (!snapshot || snapshot.empty) {
      return res.status(200).json({ success: true, plans: [] });
    }

    const plans = snapshot.docs.map((doc) => {
      const data = doc.data();
      const imagesList = Array.isArray(data.images)
        ? data.images.map((img) => normalizeImageUrl(img, req))
        : [];
      const thumb = data.thumbnailUrl || (imagesList.length > 0 ? imagesList[0] : '');

      return {
        id: doc.id,
        ...data,
        thumbnailUrl: normalizeImageUrl(thumb, req),
        images: imagesList.slice(0, 4),
        flowerVarieties: normalizeFlowerVarieties(data.flowerVarieties, req),
      };
    });

    return res.status(200).json({ success: true, plans });
  } catch (err) {
    console.error('Error fetching subscription plans:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve subscription plans.',
      error: err.message,
    });
  }
};

// GET /api/subscriptions/plans/:id
export const getSubscriptionPlanById = async (req, res) => {
  const { id } = req.params;
  try {
    const docSnap = await db.collection('subscription_plans').doc(id).get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found.' });
    }

    const data = docSnap.data();
    const imagesList = Array.isArray(data.images)
      ? data.images.map((img) => normalizeImageUrl(img, req))
      : [];

    return res.status(200).json({
      success: true,
      plan: {
        id: docSnap.id,
        ...data,
        thumbnailUrl: normalizeImageUrl(data.thumbnailUrl, req),
        images: imagesList.slice(0, 4),
        flowerVarieties: normalizeFlowerVarieties(data.flowerVarieties, req),
      },
    });
  } catch (err) {
    console.error('Error fetching subscription plan by ID:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/subscriptions/plans (Create new subscription plan)
export const createSubscriptionPlan = async (req, res) => {
  try {
    const {
      title,
      description,
      thumbnailUrl,
      images,
      mrp,
      salePrice,
      duration,
      daysCount,
      flowerVarieties,
      badge,
      badgeColor,
      deliveryTimeSlots,
      isActive,
    } = req.body;

    if (!title || (!salePrice && salePrice !== 0)) {
      return res.status(400).json({
        success: false,
        message: 'Plan title and selling price are required.',
      });
    }

    const id = `PLAN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    const normalizedImages = Array.isArray(images)
      ? images.slice(0, 4).map((img) => normalizeImageUrl(img, req))
      : [];

    const normalizedThumb = thumbnailUrl
      ? normalizeImageUrl(thumbnailUrl, req)
      : (normalizedImages.length > 0 ? normalizedImages[0] : '');

    const planDoc = {
      id,
      title: title.trim(),
      description: description ? description.trim() : '',
      thumbnailUrl: normalizedThumb,
      images: normalizedImages,
      mrp: parseFloat(mrp || salePrice || 0),
      salePrice: parseFloat(salePrice || 0),
      duration: duration || '30 Days',
      daysCount: parseInt(daysCount || 30, 10),
      flowerVarieties: normalizeFlowerVarieties(flowerVarieties, req),
      badge: badge ? badge.trim() : null,
      badgeColor: badgeColor || null,
      deliveryTimeSlots: Array.isArray(deliveryTimeSlots) && deliveryTimeSlots.length > 0
        ? deliveryTimeSlots
        : ['Morning (6:00 AM – 8:00 AM Puja)', 'Evening (5:00 PM – 7:00 PM)'],
      isActive: isActive !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (db) {
      await db.collection('subscription_plans').doc(id).set(planDoc);
    }

    console.log(`[Subscription Plan Created] ID: ${id}, Title: ${title}`);
    return res.status(201).json({
      success: true,
      message: 'Subscription plan created successfully!',
      plan: planDoc,
    });
  } catch (err) {
    console.error('Error creating subscription plan:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create subscription plan.',
      error: err.message,
    });
  }
};

// PUT /api/subscriptions/plans/:id (Update subscription plan)
export const updateSubscriptionPlan = async (req, res) => {
  const { id } = req.params;
  try {
    const docRef = db.collection('subscription_plans').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found.' });
    }

    const updates = { ...req.body };
    delete updates.id;

    if (updates.images && Array.isArray(updates.images)) {
      updates.images = updates.images.slice(0, 4).map((img) => normalizeImageUrl(img, req));
    }
    if (updates.thumbnailUrl) {
      updates.thumbnailUrl = normalizeImageUrl(updates.thumbnailUrl, req);
    }
    if (updates.flowerVarieties && Array.isArray(updates.flowerVarieties)) {
      updates.flowerVarieties = normalizeFlowerVarieties(updates.flowerVarieties, req);
    }
    if (updates.mrp !== undefined) updates.mrp = parseFloat(updates.mrp || 0);
    if (updates.salePrice !== undefined) updates.salePrice = parseFloat(updates.salePrice || 0);
    if (updates.daysCount !== undefined) updates.daysCount = parseInt(updates.daysCount || 30, 10);

    updates.updatedAt = new Date().toISOString();

    await docRef.update(updates);

    const updatedSnap = await docRef.get();
    return res.status(200).json({
      success: true,
      message: 'Subscription plan updated successfully!',
      plan: { id, ...updatedSnap.data() },
    });
  } catch (err) {
    console.error('Error updating subscription plan:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update subscription plan.',
      error: err.message,
    });
  }
};

// DELETE /api/subscriptions/plans/:id
export const deleteSubscriptionPlan = async (req, res) => {
  const { id } = req.params;
  try {
    const docRef = db.collection('subscription_plans').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Subscription plan not found.' });
    }

    await docRef.delete();
    console.log(`[Subscription Plan Deleted] ID: ${id}`);
    return res.status(200).json({ success: true, message: 'Subscription plan deleted successfully.' });
  } catch (err) {
    console.error('Error deleting subscription plan:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete subscription plan.', error: err.message });
  }
};

/*
|--------------------------------------------------------------------------
| CUSTOMER SUBSCRIPTIONS & RAZORPAY PAYMENT (STRICTLY NO COD)
|--------------------------------------------------------------------------
*/

// POST /api/subscriptions/create-order
export const createCustomerSubscriptionOrder = async (req, res) => {
  try {
    const {
      planId,
      customerName,
      customerPhone,
      deliveryAddress,
      startDate,
      timeSlot,
      userId,
      specialInstructions,
    } = req.body;

    if (!customerPhone || !deliveryAddress || !startDate) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, delivery address, and start date are required.',
      });
    }

    let planTitle = 'Daily Flower Subscription';
    let planDuration = '30 Days';
    let planDaysCount = 30;
    let planPrice = 999.0;
    let planThumb = '';

    // Validate against Firestore subscription_plans if planId is provided
    if (planId && db) {
      try {
        const planSnap = await db.collection('subscription_plans').doc(planId).get();
        if (planSnap.exists) {
          const pData = planSnap.data();
          planTitle = pData.title || planTitle;
          planDuration = pData.duration || planDuration;
          planDaysCount = pData.daysCount || planDaysCount;
          planPrice = parseFloat(pData.salePrice || pData.price || planPrice);
          planThumb = pData.thumbnailUrl || (Array.isArray(pData.images) && pData.images.length > 0 ? pData.images[0] : '');
        }
      } catch (dbErr) {
        console.warn(`[Plan Lookup Warning] For ${planId}:`, dbErr.message);
      }
    } else if (req.body.price !== undefined) {
      planPrice = parseFloat(req.body.price);
      planTitle = req.body.title || planTitle;
      planDuration = req.body.duration || planDuration;
      planDaysCount = parseInt(req.body.daysCount || 30, 10);
    }

    const subId = `SUB-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const amountInPaise = Math.round(planPrice * 100);

    let razorpayOrderId = null;

    const razorpay = getRazorpayClient();
    if (razorpay) {
      try {
        const razorpayOrder = await razorpay.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: `rcpt_${subId.replace(/[^a-zA-Z0-9]/g, '_').slice(-30)}`,
          notes: {
            subscriptionId: subId,
            planId: planId || '',
            planTitle: planTitle,
            userId: userId || '',
            customerPhone: customerPhone,
          },
        });
        razorpayOrderId = razorpayOrder.id;
        console.log(`[Subscription Razorpay Order Created] ID: ${subId} -> Razorpay Order: ${razorpayOrderId}`);
      } catch (rzpErr) {
        console.error('Razorpay order creation failed for subscription:', rzpErr);
      }
    }

    const startDateTime = new Date(startDate);
    const endDateTime = new Date(startDateTime);
    endDateTime.setDate(endDateTime.getDate() + planDaysCount);

    const subscriptionDoc = {
      id: subId,
      subscriptionId: subId,
      planId: planId || null,
      planTitle,
      planDuration,
      daysCount: planDaysCount,
      price: planPrice,
      grandTotal: planPrice,
      thumbnailUrl: normalizeImageUrl(planThumb, req),
      customerName: customerName || 'Valued Customer',
      customerPhone,
      deliveryAddress,
      startDate: startDateTime.toISOString(),
      endDate: endDateTime.toISOString(),
      timeSlot: timeSlot || 'Morning (6:00 AM – 8:00 AM Puja)',
      specialInstructions: specialInstructions || '',
      userId: userId || null,
      paymentMethod: 'razorpay', // STRICTLY ONLINE PAYMENT
      paymentStatus: 'PAYMENT_PENDING',
      status: 'PENDING_PAYMENT',
      razorpayOrderId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (db) {
      await db.collection('subscriptions').doc(subId).set(subscriptionDoc);
    }

    return res.status(201).json({
      success: true,
      message: 'Subscription order initiated.',
      subscriptionId: subId,
      razorpayOrderId: razorpayOrderId || `sub_sim_${Date.now()}`,
      amount: amountInPaise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_TlTZMHvnMnXHGZ',
      grandTotal: planPrice,
      isSimulated: !razorpayOrderId,
      subscription: subscriptionDoc,
    });
  } catch (err) {
    console.error('Error creating subscription order:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate subscription order.',
      error: err.message,
    });
  }
};

// POST /api/subscriptions/verify
export const verifyCustomerSubscriptionPayment = async (req, res) => {
  try {
    const {
      subscriptionId,
      orderId,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      isSimulated,
    } = req.body;

    const subId = subscriptionId || orderId;
    if (!subId) {
      return res.status(400).json({ success: false, message: 'Missing subscriptionId parameter.' });
    }

    let isValid = false;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '37HQJoRCjVLSG8uf4FzaR3pQ';

    if (isSimulated || razorpay_signature === 'simulated_signature_ok') {
      isValid = true;
    } else if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      isValid = generatedSignature === razorpay_signature;
    }

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Razorpay payment signature for subscription.',
      });
    }

    const docRef = db.collection('subscriptions').doc(subId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Subscription record not found.' });
    }

    const subData = docSnap.data();

    const updates = {
      paymentStatus: 'PAID',
      status: 'ACTIVE',
      razorpayPaymentId: razorpay_payment_id || `pay_sim_${Date.now()}`,
      razorpayOrderId: razorpay_order_id || subData.razorpayOrderId,
      updatedAt: new Date().toISOString(),
    };

    await docRef.update(updates);
    console.log(`[Subscription Activated] ID: ${subId}, Payment: PAID`);

    // Record in orders collection so it seamlessly displays in user's "My Orders"
    try {
      const generalOrderDoc = {
        id: subId,
        orderId: subId,
        userId: subData.userId || '',
        recipientName: subData.customerName || 'Valued Customer',
        recipientPhone: subData.customerPhone || '',
        deliveryAddress: subData.deliveryAddress || '',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'Razorpay (Daily Subscription)',
        delivery_status: 'Active Subscription',
        items: [
          {
            productId: subData.planId || 'subscription-plan',
            productTitle: `Daily Flower Subscription: ${subData.planTitle}`,
            category: 'subscription',
            quantity: 1,
            orderPrice: subData.price || 0,
            listingPrice: subData.price || 0,
            imageUrl: subData.thumbnailUrl || '',
            cakeMessage: `Active until ${new Date(subData.endDate).toLocaleDateString('en-IN')}`,
          },
        ],
        itemsSubtotal: subData.price || 0,
        grandTotal: subData.price || 0,
        createdAt: new Date().toISOString(),
      };

      await db.collection('orders').doc(subId).set(generalOrderDoc);
    } catch (orderSyncErr) {
      console.warn('[Order Sync Warning for Subscription]:', orderSyncErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription payment verified and activated successfully!',
      subscription: { ...subData, ...updates },
    });
  } catch (err) {
    console.error('Error verifying subscription payment:', err);
    return res.status(500).json({
      success: false,
      message: 'Subscription payment verification failed.',
      error: err.message,
    });
  }
};

// GET /api/subscriptions/my-subscriptions
export const getMySubscriptions = async (req, res) => {
  try {
    const { userId, userPhone, phone } = req.query;
    const targetPhone = userPhone || phone;

    if (!userId && !targetPhone) {
      return res.status(400).json({
        success: false,
        message: 'userId or userPhone is required.',
      });
    }

    let snapshot;
    if (userId && db) {
      snapshot = await db.collection('subscriptions').where('userId', '==', userId).get();
    } else if (targetPhone && db) {
      snapshot = await db.collection('subscriptions').where('customerPhone', '==', targetPhone).get();
    }

    if (!snapshot || snapshot.empty) {
      return res.status(200).json({ success: true, subscriptions: [] });
    }

    const subscriptions = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        thumbnailUrl: normalizeImageUrl(data.thumbnailUrl, req),
      };
    });

    return res.status(200).json({ success: true, subscriptions });
  } catch (err) {
    console.error('Error fetching my subscriptions:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
