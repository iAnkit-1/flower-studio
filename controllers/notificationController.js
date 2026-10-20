import db from '../config/db.js';
import { sendBroadcastPush } from '../services/fcmService.js';
import { findUserDoc } from './reminderController.js';

// Connected Server-Sent Events (SSE) clients for real-time staff alerts (Org Web)
const sseClients = new Set();

/**
 * GET /api/notifications/stream
 * Server-Sent Events (SSE) stream for real-time staff alerts (Org Web)
 * Zero polling, 0 Firestore reads, immediate delivery (<10ms).
 */
export const notificationStream = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true',
  });

  // Flush initial connection comment to establish stream immediately
  res.write(': connected\n\n');

  sseClients.add(res);

  // Send keepalive comment every 25 seconds
  const intervalId = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (_) {
      clearInterval(intervalId);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(intervalId);
    sseClients.delete(res);
  });
};

/**
 * Push an event to all connected staff SSE clients immediately (0 Firestore reads)
 */
export const broadcastStaffSse = (eventType, payload) => {
  if (sseClients.size === 0) return;

  const dataStr = JSON.stringify({ type: eventType, ...payload });
  const message = `event: ${eventType}\ndata: ${dataStr}\n\n`;

  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (_) {
      sseClients.delete(client);
    }
  }
};

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
    const existingOrderIds = new Set();

    snap.forEach((doc) => {
      const data = doc.data();
      if (!data.isRead) unreadCount++;
      if (data.orderId) existingOrderIds.add(String(data.orderId));
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

    // Customer device token registration
    const customerId = userId || req.user?.uid;
    const callerEmail = req.user?.email || req.body?.email || '';
    const userDocInfo = await findUserDoc(customerId, phone, callerEmail);
    if (userDocInfo && userDocInfo.ref) {
      const existingTokens = userDocInfo.data?.fcmTokens || [];
      const updatedTokens = [...new Set([...existingTokens, fcmToken])];
      await userDocInfo.ref.set({
        fcmToken,
        fcmTokens: updatedTokens,
        updatedAt: now,
      }, { merge: true });
      console.log(`[Notification Controller] Successfully attached FCM token to customer user: ${userDocInfo.id}`);
    } else {
      const cleanPhone = phone ? phone.replace(/\D/g, '').slice(-10) : '';
      const docId = (cleanPhone && cleanPhone.length >= 10) ? `+91${cleanPhone}` : (callerEmail || customerId || fcmToken.slice(-32));
      await db.collection('users').doc(docId).set({
        uid: customerId || '',
        fcmToken,
        fcmTokens: [fcmToken],
        phoneNumber: cleanPhone ? `+91${cleanPhone}` : '',
        updatedAt: now,
      }, { merge: true });
      console.log(`[Notification Controller] Created user doc with FCM token: ${docId}`);
    }

    return res.status(200).json({ success: true, message: 'FCM Token registered successfully' });
  } catch (error) {
    console.error('[Notification Controller] registerToken error:', error);
    return res.status(500).json({ success: false, message: 'Failed to register token' });
  }
};
