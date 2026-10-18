import db from '../config/db.js';
import { sendBroadcastPush } from '../services/fcmService.js';

/**
 * GET /api/notifications
 * Fetch recent notifications for staff / Org Web
 */
export const getNotifications = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const snap = await db.collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const notifications = [];
    let unreadCount = 0;

    snap.forEach((doc) => {
      const data = doc.data();
      if (!data.isRead) unreadCount++;
      notifications.push({ id: doc.id, ...data });
    });

    return res.status(200).json({
      success: true,
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('[Notification Controller] getNotifications error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Mark single notification as read
 */
export const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('notifications').doc(id).update({
      isRead: true,
      updatedAt: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('[Notification Controller] markNotificationRead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
  }
};

/**
 * POST /api/notifications/mark-all-read
 * Mark all notifications as read
 */
export const markAllNotificationsRead = async (req, res) => {
  try {
    const snap = await db.collection('notifications')
      .where('isRead', '==', false)
      .limit(100)
      .get();

    const batch = db.batch();
    const now = new Date().toISOString();

    snap.forEach((doc) => {
      batch.update(doc.ref, { isRead: true, updatedAt: now });
    });

    await batch.commit();

    return res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('[Notification Controller] markAllNotificationsRead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to mark all as read' });
  }
};

/**
 * POST /api/notifications/broadcast
 * Send broadcast push notification (Admin / Authorized Staff)
 */
export const triggerBroadcast = async (req, res) => {
  try {
    const { title, body, imageUrl, deepLink, audience, targetPhones, targetUserIds } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required for broadcast notification',
      });
    }

    const result = await sendBroadcastPush({
      title,
      body,
      imageUrl,
      deepLink: deepLink || 'home',
      audience: audience || 'all',
      targetPhones: Array.isArray(targetPhones) ? targetPhones : [],
      targetUserIds: Array.isArray(targetUserIds) ? targetUserIds : [],
    });

    return res.status(200).json({
      success: true,
      message: 'Broadcast push notification sent successfully',
      result,
    });
  } catch (error) {
    console.error('[Notification Controller] triggerBroadcast error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to send broadcast' });
  }
};

/**
 * POST /api/notifications/register-token
 * Register device FCM token for customer or staff
 */
export const registerToken = async (req, res) => {
  try {
    const { fcmToken, role = 'customer', userId, phone, platform = 'web' } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ success: false, message: 'fcmToken is required' });
    }

    const now = new Date().toISOString();

    if (role === 'staff' || req.user?.isStaff) {
      // Save in staff_devices collection
      const staffDocRef = db.collection('staff_devices').doc(fcmToken.slice(-32));
      await staffDocRef.set({
        fcmToken,
        staffId: req.user?.staffId || req.user?.uid || userId || 'staff',
        role: req.user?.role || 'staff',
        platform,
        updatedAt: now,
      }, { merge: true });

      return res.status(200).json({ success: true, message: 'Staff device token registered' });
    }

    // Customer device token
    const customerId = userId || req.user?.uid;
    if (customerId) {
      const userRef = db.collection('users').doc(customerId);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const existingTokens = userDoc.data()?.fcmTokens || [];
        const updatedTokens = [...new Set([...existingTokens, fcmToken])];
        await userRef.update({
          fcmToken,
          fcmTokens: updatedTokens,
          updatedAt: now,
        });
      }
    }

    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const qSnap = await db.collection('users').where('phone', '==', cleanPhone).limit(1).get();
      if (!qSnap.empty) {
        const docRef = qSnap.docs[0].ref;
        const existingTokens = qSnap.docs[0].data()?.fcmTokens || [];
        await docRef.update({
          fcmToken,
          fcmTokens: [...new Set([...existingTokens, fcmToken])],
          updatedAt: now,
        });
      }
    }

    return res.status(200).json({ success: true, message: 'FCM Token registered successfully' });
  } catch (error) {
    console.error('[Notification Controller] registerToken error:', error);
    return res.status(500).json({ success: false, message: 'Failed to register token' });
  }
};
