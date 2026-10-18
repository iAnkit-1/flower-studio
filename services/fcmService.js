import admin from 'firebase-admin';
import db from '../config/db.js';

let messaging = null;

function getMessaging() {
  if (!messaging) {
    try {
      if (admin.apps.length > 0) {
        messaging = admin.messaging();
      }
    } catch (e) {
      console.warn('[FCM Service] Could not initialize Firebase Admin Messaging:', e.message);
    }
  }
  return messaging;
}

/**
 * 1. Send Order Alert to Organization Staff with Buzzer Sound & Save to Notifications History
 */
export async function sendStaffOrderAlert({
  orderId,
  customerName = 'Valued Customer',
  customerPhone = '',
  grandTotal = 0,
  paymentMethod = 'COD',
  itemsCount = 1,
}) {
  const title = '🚨 NEW ORDER RECEIVED!';
  const body = `Order #${orderId} • ₹${grandTotal} (${paymentMethod.toUpperCase()}) • ${customerName}`;
  const now = new Date().toISOString();

  // Save to notifications collection in Firestore so Org Web displays it immediately
  try {
    await db.collection('notifications').add({
      type: 'NEW_ORDER',
      orderId: String(orderId),
      title,
      body,
      customerName,
      customerPhone,
      grandTotal: Number(grandTotal),
      paymentMethod,
      itemsCount: Number(itemsCount),
      isRead: false,
      soundType: 'buzzer',
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[Notification Service] Saved new order notification in Firestore: #${orderId}`);
  } catch (fsErr) {
    console.error('[Notification Service] Error saving notification to Firestore:', fsErr.message);
  }

  // Send FCM Push to organization staff devices (Topic + direct staff tokens)
  const fcm = getMessaging();
  if (!fcm) {
    console.warn('[FCM Service] Messaging service not available.');
    return;
  }

  const payload = {
    topic: 'organization_alerts',
    notification: {
      title,
      body,
    },
    data: {
      orderId: String(orderId),
      type: 'NEW_ORDER',
      soundType: 'buzzer',
      click_action: '/orders',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'flower_studio_buzzer_channel',
        sound: 'buzzer',
        priority: 'max',
        defaultVibrateTimings: true,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'buzzer.caf',
          badge: 1,
        },
      },
    },
  };

  try {
    const fcmRes = await fcm.send(payload);
    console.log(`[FCM Service] Staff Order Alert sent to topic 'organization_alerts': ${fcmRes}`);
  } catch (fcmErr) {
    console.warn('[FCM Service] Notice sending to topic organization_alerts:', fcmErr.message);
  }

  // Also send directly to any staff tokens stored in staff_devices
  try {
    const staffSnaps = await db.collection('staff_devices').limit(50).get();
    const staffTokens = [];
    staffSnaps.forEach((doc) => {
      const d = doc.data();
      if (d.fcmToken) staffTokens.push(d.fcmToken);
      if (Array.isArray(d.fcmTokens)) staffTokens.push(...d.fcmTokens);
    });

    const uniqueTokens = [...new Set(staffTokens)].filter(Boolean);
    if (uniqueTokens.length > 0) {
      await fcm.sendEachForMulticast({
        tokens: uniqueTokens,
        notification: { title, body },
        data: {
          orderId: String(orderId),
          type: 'NEW_ORDER',
          soundType: 'buzzer',
          click_action: '/orders',
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'flower_studio_buzzer_channel',
            sound: 'buzzer',
            priority: 'max',
          },
        },
      });
      console.log(`[FCM Service] Sent staff multicast to ${uniqueTokens.length} device(s)`);
    }
  } catch (multiErr) {
    console.warn('[FCM Service] Notice sending staff multicast:', multiErr.message);
  }
}

/**
 * 2. Send Customer Order Status Update Push Notification
 */
export async function sendCustomerOrderStatusAlert({
  orderId,
  customerUserId,
  customerPhone,
  status,
  customMessage,
}) {
  const normStatus = (status || '').toUpperCase();
  let title = `Order #${orderId} Update`;
  let body = customMessage;

  if (!body) {
    switch (normStatus) {
      case 'CONFIRMED':
        body = 'Your order has been confirmed! Our floral designers are getting started 🌸';
        break;
      case 'HANDCRAFTING':
        body = 'Your handcrafted bouquet is being fresh-picked and beautifully arranged 💐';
        break;
      case 'OUT_FOR_DELIVERY':
        body = 'Out for delivery! Your fresh flowers are on the way to your door 🚚';
        break;
      case 'DELIVERED':
        body = 'Delivered! 🎉 Your order has arrived. Thank you for choosing Flower Studio!';
        break;
      case 'CANCELLED':
        body = 'Your order has been cancelled. Any eligible refund is being processed.';
        break;
      default:
        body = `Your order status is now: ${status}`;
    }
  }

  const now = new Date().toISOString();

  // Save to notification history for customer
  try {
    await db.collection('customer_notifications').add({
      orderId: String(orderId),
      userId: customerUserId || '',
      phone: customerPhone || '',
      title,
      body,
      status: normStatus,
      isRead: false,
      createdAt: now,
    });
  } catch (_) {}

  const fcm = getMessaging();
  if (!fcm) return;

  // Retrieve customer FCM device tokens
  const targetTokens = [];
  try {
    if (customerUserId) {
      const userDoc = await db.collection('users').doc(customerUserId).get();
      if (userDoc.exists) {
        const uData = userDoc.data();
        if (uData.fcmToken) targetTokens.push(uData.fcmToken);
        if (Array.isArray(uData.fcmTokens)) targetTokens.push(...uData.fcmTokens);
      }
    }

    if (targetTokens.length === 0 && customerPhone) {
      const cleanPhone = customerPhone.replace(/\D/g, '').slice(-10);
      const qSnap = await db.collection('users').where('phone', '==', cleanPhone).limit(1).get();
      if (!qSnap.empty) {
        const uData = qSnap.docs[0].data();
        if (uData.fcmToken) targetTokens.push(uData.fcmToken);
        if (Array.isArray(uData.fcmTokens)) targetTokens.push(...uData.fcmTokens);
      }
    }
  } catch (tokErr) {
    console.warn('[FCM Service] Error fetching customer tokens:', tokErr.message);
  }

  const uniqueTokens = [...new Set(targetTokens)].filter(Boolean);
  if (uniqueTokens.length === 0) {
    console.log(`[FCM Service] No registered tokens found for user ${customerUserId || customerPhone}`);
    return;
  }

  try {
    await fcm.sendEachForMulticast({
      tokens: uniqueTokens,
      notification: { title, body },
      data: {
        orderId: String(orderId),
        type: 'ORDER_STATUS_UPDATE',
        status: normStatus,
        screen: 'order_detail',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'flower_studio_customer_channel',
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    });
    console.log(`[FCM Service] Customer Order Status Push sent to ${uniqueTokens.length} device(s)`);
  } catch (err) {
    console.error('[FCM Service] Error sending customer status push:', err.message);
  }
}

/**
 * 3. Send Broadcast Push Notification (All Users or Selected Users)
 */
export async function sendBroadcastPush({
  title,
  body,
  imageUrl,
  deepLink = 'home',
  audience = 'all', // 'all' or 'selected'
  targetUserIds = [],
  targetPhones = [],
}) {
  const fcm = getMessaging();
  if (!fcm) {
    throw new Error('FCM messaging service is not initialized');
  }

  const now = new Date().toISOString();

  // Save broadcast campaign record
  await db.collection('broadcast_campaigns').add({
    title,
    body,
    imageUrl: imageUrl || null,
    deepLink,
    audience,
    targetCount: audience === 'all' ? 'All Customers' : (targetUserIds.length + targetPhones.length),
    createdAt: now,
  });

  if (audience === 'all') {
    // Send to topic 'all_customers'
    const message = {
      topic: 'all_customers',
      notification: {
        title,
        body,
        ...(imageUrl ? { imageUrl } : {}),
      },
      data: {
        type: 'BROADCAST',
        screen: deepLink || 'home',
        ...(imageUrl ? { imageUrl } : {}),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'flower_studio_promotions_channel',
          defaultSound: true,
          ...(imageUrl ? { imageUrl } : {}),
        },
      },
    };

    const res = await fcm.send(message);
    return { success: true, mode: 'topic', topic: 'all_customers', result: res };
  } else {
    // Collect tokens for selected users/phones
    const tokens = [];

    for (const uid of targetUserIds) {
      if (!uid) continue;
      const uDoc = await db.collection('users').doc(uid).get();
      if (uDoc.exists) {
        const u = uDoc.data();
        if (u.fcmToken) tokens.push(u.fcmToken);
        if (Array.isArray(u.fcmTokens)) tokens.push(...u.fcmTokens);
      }
    }

    for (const phone of targetPhones) {
      if (!phone) continue;
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const q = await db.collection('users').where('phone', '==', cleanPhone).limit(1).get();
      if (!q.empty) {
        const u = q.docs[0].data();
        if (u.fcmToken) tokens.push(u.fcmToken);
        if (Array.isArray(u.fcmTokens)) tokens.push(...u.fcmTokens);
      }
    }

    const uniqueTokens = [...new Set(tokens)].filter(Boolean);
    if (uniqueTokens.length === 0) {
      return { success: false, message: 'No registered device tokens found for selected users' };
    }

    const multiRes = await fcm.sendEachForMulticast({
      tokens: uniqueTokens,
      notification: {
        title,
        body,
        ...(imageUrl ? { imageUrl } : {}),
      },
      data: {
        type: 'BROADCAST',
        screen: deepLink || 'home',
      },
    });

    return {
      success: true,
      mode: 'multicast',
      successCount: multiRes.successCount,
      failureCount: multiRes.failureCount,
    };
  }
}
