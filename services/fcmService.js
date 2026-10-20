import { importPKCS8, SignJWT } from 'jose';
import db from '../config/db.js';
import { broadcastStaffSse } from '../controllers/notificationController.js';
import { findUserDoc } from '../controllers/reminderController.js';

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Safely format and clean RSA Private Key for OpenSSL / jose compatibility
 */
function cleanPrivateKey(key) {
  if (!key || typeof key !== 'string') return '';
  let str = key.trim();

  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    str = str.slice(1, -1).trim();
  }

  str = str.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  let base64Only = str
    .replace(/-----BEGIN[ A-Z0-9_-]+-----/g, '')
    .replace(/-----END[ A-Z0-9_-]+-----/g, '')
    .replace(/\s+/g, '')
    .trim();

  return `-----BEGIN PRIVATE KEY-----\n${base64Only}\n-----END PRIVATE KEY-----`;
}

/**
 * Resolve service account credentials across Edge variables, Env vars, or local file
 */
function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if (
        (rawEnv.startsWith("'") && rawEnv.endsWith("'")) ||
        (rawEnv.startsWith('"') && rawEnv.endsWith('"'))
      ) {
        rawEnv = rawEnv.slice(1, -1);
      }
      if (!rawEnv.startsWith('{')) {
        try {
          const decoded = Buffer.from(rawEnv, 'base64').toString('utf8');
          if (decoded.startsWith('{')) rawEnv = decoded;
        } catch (_) {}
      }
      const sa = typeof rawEnv === 'string' ? JSON.parse(rawEnv) : rawEnv;
      if (sa.private_key) sa.private_key = cleanPrivateKey(sa.private_key);
      return sa;
    } catch (e) {
      console.warn('[FCM Service] Parse FIREBASE_SERVICE_ACCOUNT warning:', e.message);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail.trim(),
      private_key: cleanPrivateKey(privateKey),
    };
  }

  try {
    const fs = globalThis.process?.getBuiltinModule?.('fs') || null;
    const path = globalThis.process?.getBuiltinModule?.('path') || null;
    if (fs && path) {
      const candidates = [
        path.join(process.cwd(), 'config', 'serviceAccountKey.json'),
        path.join(process.cwd(), 'Backend', 'config', 'serviceAccountKey.json'),
        path.join(process.cwd(), 'serviceAccountKey.json'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const sa = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (sa.private_key) sa.private_key = cleanPrivateKey(sa.private_key);
          return sa;
        }
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Obtain or reuse cached Google OAuth2 Access Token for Firebase Cloud Messaging v1
 */
async function getFcmAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && tokenExpiresAt > now + 60000) {
    return cachedAccessToken;
  }

  const sa = getServiceAccount();
  if (!sa || !sa.private_key || !sa.client_email) {
    throw new Error('Firebase Service Account credentials not found for FCM');
  }

  const projectId = sa.project_id || sa.projectId || process.env.FIREBASE_PROJECT_ID || 'flower-studio-37861';
  const privateKey = await importPKCS8(sa.private_key, 'RS256');

  const iat = Math.floor(now / 1000);
  const jwt = await new SignJWT({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    exp: iat + 3600,
    iat,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Failed to obtain Google OAuth token: ${JSON.stringify(data)}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    projectId,
  };
  tokenExpiresAt = now + ((data.expires_in || 3600) - 300) * 1000;
  return cachedAccessToken;
}

/**
 * Send an FCM v1 HTTP message to Google FCM servers
 */
export async function sendFcmMessage(message) {
  const { token, projectId } = await getFcmAccessToken();
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
  });

  const data = await res.json();
  if (res.ok) {
    return { success: true, messageId: data.name };
  } else {
    console.warn('[FCM Send Warning]:', data.error?.message || data);
    return { success: false, error: data.error?.message || 'FCM send failed' };
  }
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
    await db.collection('notifications').doc(`notif_${orderId}`).set({
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

  // Real-Time SSE to connected Org Web staff tabs (Instant <10ms buzzer, 0 Firestore reads)
  try {
    broadcastStaffSse('NEW_ORDER', {
      orderId: String(orderId),
      title,
      body,
      customerName,
      customerPhone,
      grandTotal: Number(grandTotal),
      paymentMethod,
      itemsCount: Number(itemsCount),
      soundType: 'buzzer',
    });
  } catch (sseErr) {
    console.warn('[FCM Service] Notice broadcasting staff SSE:', sseErr.message);
  }

  // 1. Send to topic 'organization_alerts'
  try {
    await sendFcmMessage({
      topic: 'organization_alerts',
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
          channel_id: 'flower_studio_buzzer_channel',
          sound: 'buzzer',
          default_vibrate_timings: true,
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
    });
    console.log(`[FCM Service] Staff Order Alert sent to topic 'organization_alerts'`);
  } catch (fcmErr) {
    console.warn('[FCM Service] Notice sending to topic organization_alerts:', fcmErr.message);
  }

  // 2. Also send directly to any staff tokens stored in staff_devices
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
      await Promise.allSettled(
        uniqueTokens.map((t) =>
          sendFcmMessage({
            token: t,
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
                channel_id: 'flower_studio_buzzer_channel',
                sound: 'buzzer',
              },
            },
          })
        )
      );
      console.log(`[FCM Service] Sent staff direct messages to ${uniqueTokens.length} device(s)`);
    }
  } catch (multiErr) {
    console.warn('[FCM Service] Notice sending staff multicast:', multiErr.message);
  }
}

/**
 * Send Staff Support Ticket Alert (Org Web and Organization App)
 */
export async function sendStaffSupportAlert({
  ticketId,
  customerName = 'Valued Customer',
  customerPhone = '',
  orderId = '',
  category = 'Support Request',
  message = '',
  priority = 'MID',
}) {
  const title = `🎧 NEW SUPPORT TICKET: #${ticketId}`;
  const orderSnippet = orderId ? ` (Order #${orderId})` : '';
  const body = `${customerName}${orderSnippet}: [${category}] ${message.slice(0, 100)}`;
  const now = new Date().toISOString();

  // Save to notifications collection in Firestore so Org Web displays it in real-time
  try {
    await db.collection('notifications').doc(`notif_tkt_${ticketId}`).set({
      type: 'SUPPORT_TICKET',
      ticketId: String(ticketId),
      orderId: orderId ? String(orderId) : null,
      title,
      body,
      customerName,
      customerPhone,
      category,
      priority,
      isRead: false,
      soundType: 'ding',
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[Notification Service] Saved new support ticket notification in Firestore: #${ticketId}`);
  } catch (fsErr) {
    console.error('[Notification Service] Error saving ticket notification to Firestore:', fsErr.message);
  }

  // Real-Time SSE to connected Org Web staff tabs (Instant <10ms, 0 Firestore reads)
  try {
    broadcastStaffSse('SUPPORT_TICKET', {
      ticketId: String(ticketId),
      orderId: orderId ? String(orderId) : '',
      title,
      body,
      customerName,
      customerPhone,
      category,
      priority,
    });
  } catch (sseErr) {
    console.warn('[FCM Service] Notice broadcasting staff ticket SSE:', sseErr.message);
  }

  // 1. Send to topic 'organization_alerts'
  try {
    await sendFcmMessage({
      topic: 'organization_alerts',
      notification: { title, body },
      data: {
        ticketId: String(ticketId),
        orderId: orderId ? String(orderId) : '',
        type: 'SUPPORT_TICKET',
        category: String(category),
        priority: String(priority),
        click_action: '/support',
      },
      android: {
        priority: 'high',
        notification: {
          channel_id: 'flower_studio_support_channel',
          default_vibrate_timings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: 'default',
          },
        },
      },
    });
    console.log(`[FCM Service] Staff Support Alert sent to topic 'organization_alerts'`);
  } catch (fcmErr) {
    console.warn('[FCM Service] Notice sending to topic organization_alerts for support ticket:', fcmErr.message);
  }

  // 2. Also send directly to active staff tokens in staff_devices
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
      await Promise.allSettled(
        uniqueTokens.map((t) =>
          sendFcmMessage({
            token: t,
            notification: { title, body },
            data: {
              ticketId: String(ticketId),
              orderId: orderId ? String(orderId) : '',
              type: 'SUPPORT_TICKET',
              category: String(category),
              priority: String(priority),
              click_action: '/support',
            },
          })
        )
      );
    }
  } catch (multiErr) {
    console.warn('[FCM Service] Notice sending direct staff notifications for ticket:', multiErr.message);
  }
}

/**
 * 2. Send Customer Order Status Update Push Notification
 * CRITICAL RULE: Targets ONLY the specific order owner who placed the order!
 */
export async function sendCustomerOrderStatusAlert({
  orderId,
  customerUserId,
  customerPhone,
  status,
  customMessage,
}) {
  const normStatus = (status || '').toUpperCase().replace(/[\s-]+/g, '_').trim();
  let title = `Order #${orderId} Update`;
  let body = customMessage;

  if (!body) {
    switch (normStatus) {
      case 'ORDER_CONFIRMED':
      case 'CONFIRMED':
        title = `Order Confirmed! 🌸`;
        body = `Your order #${orderId} has been confirmed! Our floral designers are preparing your fresh arrangement.`;
        break;
      case 'DISPATCHED':
      case 'SHIPPED':
        title = `Order Dispatched! 🚀`;
        body = `Your order #${orderId} has been dispatched from our studio and is on its way!`;
        break;
      case 'OUT_FOR_DELIVERY':
        title = `Out for Delivery! 🚚`;
        body = `Your order #${orderId} is out for delivery! Our delivery partner will arrive soon.`;
        break;
      case 'OUT_FOR_PICKUP':
      case 'READY_FOR_PICKUP':
        title = `Ready for Pickup! 🎁`;
        body = `Your order #${orderId} is packed and ready for pickup at Flower Studio!`;
        break;
      case 'CANCELLED':
      case 'CANCELED':
        title = `Order Cancelled`;
        body = `Your order #${orderId} has been cancelled. Any eligible refund is being processed.`;
        break;
      case 'DELIVERED':
        title = `Order Delivered! 🎉`;
        body = `Delivered! 🎉 Your order #${orderId} has arrived. Thank you for choosing Flower Studio!`;
        break;
      default:
        body = `Your order #${orderId} status is now: ${status}`;
    }
  }

  const now = new Date().toISOString();

  // Save to notification history specifically for THIS customer
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

  // Retrieve customer FCM device tokens for THIS user ONLY using robust findUserDoc
  const targetTokens = [];
  try {
    const userDocInfo = await findUserDoc(customerUserId, customerPhone);
    if (userDocInfo && userDocInfo.data) {
      const uData = userDocInfo.data;
      if (uData.fcmToken) targetTokens.push(uData.fcmToken);
      if (Array.isArray(uData.fcmTokens)) targetTokens.push(...uData.fcmTokens);
      console.log(`[FCM Service] Found ${targetTokens.length} token(s) for customer user: ${userDocInfo.id}`);
    } else {
      console.log(`[FCM Service] findUserDoc found no user profile for ${customerUserId || customerPhone}`);
    }
  } catch (tokErr) {
    console.warn('[FCM Service] Error fetching customer tokens:', tokErr.message);
  }

  const uniqueTokens = [...new Set(targetTokens)].filter(Boolean);
  if (uniqueTokens.length === 0) {
    console.log(`[FCM Service] No registered tokens found for user ${customerUserId || customerPhone}`);
    return;
  }

  // Send ONLY to the order owner's devices
  try {
    await Promise.allSettled(
      uniqueTokens.map((t) =>
        sendFcmMessage({
          token: t,
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
              channel_id: 'flower_studio_customer_channel',
              default_sound: true,
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
        })
      )
    );
    console.log(`[FCM Service] Customer Order Status Push sent to ${uniqueTokens.length} device(s) of order owner`);
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
  const now = new Date().toISOString();

  // Save broadcast campaign record
  try {
    await db.collection('broadcast_campaigns').add({
      title,
      body,
      imageUrl: imageUrl || null,
      deepLink,
      audience,
      targetCount: audience === 'all' ? 'All Customers' : targetUserIds.length + targetPhones.length,
      createdAt: now,
    });
  } catch (_) {}

  if (audience === 'all') {
    // Send to topic 'all_customers' via FCM v1
    const message = {
      topic: 'all_customers',
      notification: {
        title,
        body,
        ...(imageUrl ? { image: imageUrl } : {}),
      },
      data: {
        type: 'BROADCAST',
        screen: deepLink || 'home',
        ...(imageUrl ? { imageUrl } : {}),
      },
      android: {
        priority: 'high',
        notification: {
          channel_id: 'flower_studio_promotions_channel',
          default_sound: true,
          ...(imageUrl ? { image: imageUrl } : {}),
        },
      },
    };

    const res = await sendFcmMessage(message);
    if (!res.success) {
      throw new Error(res.error || 'Failed to send broadcast to topic all_customers');
    }
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

    const results = await Promise.allSettled(
      uniqueTokens.map((t) =>
        sendFcmMessage({
          token: t,
          notification: {
            title,
            body,
            ...(imageUrl ? { image: imageUrl } : {}),
          },
          data: {
            type: 'BROADCAST',
            screen: deepLink || 'home',
            ...(imageUrl ? { imageUrl } : {}),
          },
        })
      )
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
    const failureCount = results.length - successCount;

    return {
      success: true,
      mode: 'multicast',
      totalTokens: uniqueTokens.length,
      successCount,
      failureCount,
    };
  }
}
