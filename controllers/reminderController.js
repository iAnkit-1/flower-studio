import db from '../config/db.js';

/**
 * Normalizes phone number to standard 10-digit format
 */
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

/**
 * Resolves the Firestore document for the specific user in the `users` collection.
 * Matches by:
 * 1. Document ID matching userId or phone variants
 * 2. Field queries: phoneNumber == phone, uid == userId, userId == userId
 */
export const findUserDoc = async (userId, rawPhone) => {
  if (!db) return null;

  const validUserId = (userId && typeof userId === 'string' && userId !== 'null' && userId !== 'undefined') ? userId.trim() : null;
  const validPhone = (rawPhone && typeof rawPhone === 'string' && rawPhone !== 'null' && rawPhone !== 'undefined') ? rawPhone.trim() : null;
  const phone10 = validPhone ? normalizePhone(validPhone) : null;

  const candidates = [];
  if (validUserId) candidates.push(validUserId);
  if (validPhone) candidates.push(validPhone);
  if (phone10) {
    if (!candidates.includes(phone10)) candidates.push(phone10);
    if (!candidates.includes(`+91${phone10}`)) candidates.push(`+91${phone10}`);
  }

  // 1. Direct document ID lookup
  for (const cid of candidates) {
    if (!cid) continue;
    const docRef = db.collection('users').doc(cid);
    const snap = await docRef.get();
    if (snap.exists) {
      return { ref: docRef, snap, data: snap.data(), id: cid };
    }
  }

  // 2. Query lookup by phoneNumber field
  if (phone10) {
    const phoneVariants = [phone10, `+91${phone10}`, validPhone].filter(Boolean);
    for (const pv of phoneVariants) {
      const qSnap = await db.collection('users').where('phoneNumber', '==', pv).limit(1).get();
      if (!qSnap.empty) {
        const doc = qSnap.docs[0];
        return { ref: doc.ref, snap: doc, data: doc.data(), id: doc.id };
      }
    }
  }

  // 3. Query lookup by uid or userId field
  if (validUserId) {
    const uidSnap = await db.collection('users').where('uid', '==', validUserId).limit(1).get();
    if (!uidSnap.empty) {
      const doc = uidSnap.docs[0];
      return { ref: doc.ref, snap: doc, data: doc.data(), id: doc.id };
    }
    const userIdSnap = await db.collection('users').where('userId', '==', validUserId).limit(1).get();
    if (!userIdSnap.empty) {
      const doc = userIdSnap.docs[0];
      return { ref: doc.ref, snap: doc, data: doc.data(), id: doc.id };
    }
  }

  // 4. Return preferred document reference for new user creation
  const primaryId = (phone10 && phone10.length >= 10) ? `+91${phone10}` : (validUserId || validPhone || null);
  if (primaryId) {
    const newRef = db.collection('users').doc(primaryId);
    return { ref: newRef, snap: null, data: null, id: primaryId };
  }

  return null;
};

/**
 * Resolve target user identity based on verified auth token and caller role
 */
export const resolveReminderUserIdentity = (req) => {
  const isStaff = Boolean(req.user?.isStaff || req.user?.isAdmin);
  const callerPhone = normalizePhone(req.user?.phoneNumber || '');
  const callerUserId = (req.user?.userId || req.user?.uid || '').trim();

  if (isStaff) {
    const rawPhone = req.query?.phone || req.query?.userPhone || req.body?.phone || req.body?.userPhone;
    const targetUserId = req.query?.userId || req.query?.uid || req.body?.userId || req.body?.uid;
    return {
      userId: targetUserId || callerUserId,
      phone: rawPhone || callerPhone,
    };
  }

  // Authenticated customer is strictly bound to own verified identity
  return {
    userId: callerUserId,
    phone: callerPhone,
  };
};

/**
 * Get Reminders for Authenticated User
 * Reads reminders directly from the `reminders` array in the user's document in `users` collection.
 * GET /api/reminders
 */
export const getUserReminders = async (req, res) => {
  try {
    const { userId, phone: rawPhone } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && (!userId || userId === 'null' || userId === 'undefined')) {
      return res.status(200).json({
        success: true,
        message: 'No user authenticated.',
        reminders: [],
      });
    }

    if (!db) {
      return res.status(200).json({
        success: true,
        reminders: [],
      });
    }

    const userDocInfo = await findUserDoc(userId, rawPhone);
    if (!userDocInfo || !userDocInfo.data) {
      return res.status(200).json({
        success: true,
        reminders: [],
      });
    }

    let reminders = Array.isArray(userDocInfo.data.reminders) ? [...userDocInfo.data.reminders] : [];

    // Migration fallback: if reminders array in user doc is empty, check if legacy subcollection exists
    if (reminders.length === 0 && userDocInfo.ref) {
      try {
        const subSnap = await userDocInfo.ref.collection('reminders').get();
        if (!subSnap.empty) {
          const oldReminders = [];
          subSnap.forEach((d) => {
            oldReminders.push({ id: d.id, ...d.data() });
          });
          if (oldReminders.length > 0) {
            await userDocInfo.ref.set({ reminders: oldReminders }, { merge: true });
            reminders = oldReminders;
          }
        }
      } catch (migErr) {
        console.warn('[Reminders Migration Notice]:', migErr.message);
      }
    }

    // Sort newest first
    reminders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return res.status(200).json({
      success: true,
      reminders,
    });
  } catch (error) {
    console.error('[getUserReminders Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user reminders.',
      error: error.message,
      reminders: [],
    });
  }
};

/**
 * Add New Reminder for Authenticated User
 * Appends the reminder directly to the `reminders` array in the user's document in `users` collection.
 * POST /api/reminders
 * Body: { note, occasion, date, time }
 */
export const createReminder = async (req, res) => {
  try {
    const { note, occasion, date, time } = req.body;
    const { userId, phone: rawPhone } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && (!userId || userId === 'null' || userId === 'undefined')) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required to save reminders.',
      });
    }

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reminder note / name is required.',
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Reminder date is required.',
      });
    }

    const reminderId = `REM_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const newReminder = {
      id: reminderId,
      note: note.trim(),
      occasion: occasion || 'Special Day',
      date: date,
      time: time || '09:00 AM',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (db) {
      const userDocInfo = await findUserDoc(userId, rawPhone);
      let userRef;
      let currentReminders = [];

      if (userDocInfo && userDocInfo.ref) {
        userRef = userDocInfo.ref;
        if (userDocInfo.data && Array.isArray(userDocInfo.data.reminders)) {
          currentReminders = userDocInfo.data.reminders;
        }
      } else {
        const primaryDocId = (cleanPhone && cleanPhone.length >= 10) ? `+91${cleanPhone}` : (userId || `USR_${Date.now()}`);
        userRef = db.collection('users').doc(primaryDocId);
      }

      // Prepend the new reminder to the reminders array
      const updatedReminders = [newReminder, ...currentReminders];

      await userRef.set(
        {
          phoneNumber: rawPhone || '',
          uid: userId || '',
          userId: userId || '',
          reminders: updatedReminders,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return res.status(201).json({
      success: true,
      message: 'Reminder saved successfully! ❤️',
      reminder: newReminder,
    });
  } catch (error) {
    console.error('[createReminder Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create reminder.',
      error: error.message,
    });
  }
};

/**
 * Delete Reminder from User's Reminders Array
 * DELETE /api/reminders/:id?phone=...&userId=...
 */
export const deleteReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, phone: rawPhone } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && (!userId || userId === 'null' || userId === 'undefined')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to delete reminders.',
      });
    }

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Reminder ID is required.',
      });
    }

    if (db) {
      const userDocInfo = await findUserDoc(userId, rawPhone);
      if (userDocInfo && userDocInfo.ref && userDocInfo.data) {
        const currentReminders = Array.isArray(userDocInfo.data.reminders)
          ? userDocInfo.data.reminders
          : [];
        const updatedReminders = currentReminders.filter((r) => String(r.id) !== String(id));

        await userDocInfo.ref.set(
          {
            reminders: updatedReminders,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Reminder deleted successfully.',
    });
  } catch (error) {
    console.error('[deleteReminder Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete reminder.',
      error: error.message,
    });
  }
};

/**
 * Update Single Reminder in User's Reminders Array
 * PUT /api/reminders/:id
 */
export const updateReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const { note, occasion, date, time } = req.body;
    const { userId, phone: rawPhone } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && (!userId || userId === 'null' || userId === 'undefined')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to update reminder.',
      });
    }

    if (db) {
      const userDocInfo = await findUserDoc(userId, rawPhone);
      if (userDocInfo && userDocInfo.ref && userDocInfo.data) {
        const currentReminders = Array.isArray(userDocInfo.data.reminders)
          ? userDocInfo.data.reminders
          : [];
        const updatedReminders = currentReminders.map((r) => {
          if (String(r.id) === String(id)) {
            return {
              ...r,
              ...(note !== undefined ? { note: note.trim() } : {}),
              ...(occasion !== undefined ? { occasion } : {}),
              ...(date !== undefined ? { date } : {}),
              ...(time !== undefined ? { time } : {}),
              updatedAt: new Date().toISOString(),
            };
          }
          return r;
        });

        await userDocInfo.ref.set(
          {
            reminders: updatedReminders,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Reminder updated successfully.',
    });
  } catch (error) {
    console.error('[updateReminder Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update reminder.',
      error: error.message,
    });
  }
};

/**
 * Batch Sync Reminders Array for Authenticated User
 * PUT /api/reminders
 */
export const syncReminders = async (req, res) => {
  try {
    const { reminders } = req.body;
    const { userId, phone: rawPhone } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && (!userId || userId === 'null' || userId === 'undefined')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to sync reminders.',
      });
    }

    if (!Array.isArray(reminders)) {
      return res.status(400).json({
        success: false,
        message: 'reminders array is required.',
      });
    }

    if (db) {
      const userDocInfo = await findUserDoc(userId, rawPhone);
      if (userDocInfo && userDocInfo.ref) {
        await userDocInfo.ref.set(
          {
            reminders,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Reminders synchronized successfully.',
      reminders,
    });
  } catch (error) {
    console.error('[syncReminders Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync reminders.',
      error: error.message,
    });
  }
};
