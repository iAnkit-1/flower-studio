import db, { FieldValue } from '../config/db.js';

/**
 * Normalizes phone number to standard 10-digit format
 */
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

/**
 * Resolves the Firestore document for a specific user in the `users` collection.
 * Efficient 1-read direct document lookups matching by:
 * 1. UID: users/{uid}
 * 2. Phone: users/+91XXXXXXXXXX
 * 3. Email: users/{email} (Google / Email Auth accounts where docId is email)
 * Followed by targeted fallback queries if needed.
 */
export const findUserDoc = async (userId, rawPhone, rawEmail) => {
  if (!db) return null;

  const validUserId = (userId && typeof userId === 'string' && userId !== 'null' && userId !== 'undefined') ? userId.trim() : null;
  const validPhone = (rawPhone && typeof rawPhone === 'string' && rawPhone !== 'null' && rawPhone !== 'undefined') ? rawPhone.trim() : null;
  const phone10 = validPhone ? normalizePhone(validPhone) : null;
  const validEmail = (rawEmail && typeof rawEmail === 'string' && rawEmail.includes('@'))
    ? rawEmail.trim().toLowerCase()
    : ((validUserId && validUserId.includes('@')) ? validUserId.toLowerCase() : null);

  // 1. Direct document lookups by ID (Standardized - exactly 1 read)
  // A. Direct document ID by UID
  if (validUserId && !validUserId.includes('@')) {
    try {
      const uidRef = db.collection('users').doc(validUserId);
      const snap = await uidRef.get();
      if (snap.exists) {
        return { ref: uidRef, snap, data: snap.data(), id: validUserId };
      }
    } catch (_) {}
  }

  // B. Direct document ID by normalized phone (+91XXXXXXXXXX)
  if (phone10) {
    try {
      const phoneDocId = `+91${phone10}`;
      const phoneRef = db.collection('users').doc(phoneDocId);
      const snap = await phoneRef.get();
      if (snap.exists) {
        return { ref: phoneRef, snap, data: snap.data(), id: phoneDocId };
      }
    } catch (_) {}
  }

  // C. Direct document ID by email (Google / Email Auth accounts)
  if (validEmail) {
    try {
      const emailRef = db.collection('users').doc(validEmail);
      const snap = await emailRef.get();
      if (snap.exists) {
        return { ref: emailRef, snap, data: snap.data(), id: validEmail };
      }
    } catch (_) {}
  }

  // 2. Targeted fallback queries (only executed if direct docId lookup misses)
  if (validUserId && !validUserId.includes('@')) {
    try {
      const uidSnap = await db.collection('users').where('uid', '==', validUserId).limit(1).get();
      if (!uidSnap.empty) {
        const doc = uidSnap.docs[0];
        return { ref: doc.ref, snap: doc, data: doc.data(), id: doc.id };
      }
    } catch (_) {}
  }

  if (phone10) {
    try {
      const phoneSnap = await db.collection('users')
        .where('phoneNumber', 'in', [`+91${phone10}`, phone10])
        .limit(1)
        .get();
      if (!phoneSnap.empty) {
        const doc = phoneSnap.docs[0];
        return { ref: doc.ref, snap: doc, data: doc.data(), id: doc.id };
      }
    } catch (_) {}
  }

  if (validEmail) {
    try {
      const emailSnap = await db.collection('users')
        .where('email', '==', validEmail)
        .limit(1)
        .get();
      if (!emailSnap.empty) {
        const doc = emailSnap.docs[0];
        return { ref: doc.ref, snap: doc, data: doc.data(), id: doc.id };
      }
    } catch (_) {}
  }

  // 3. Return standardized reference for new user doc creation
  const primaryId = (phone10 && phone10.length >= 10 ? `+91${phone10}` : null) || validEmail || validUserId;
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
  const callerEmail = (req.user?.email || '').trim().toLowerCase();

  if (isStaff) {
    const rawPhone = req.query?.phone || req.query?.userPhone || req.body?.phone || req.body?.userPhone;
    const targetUserId = req.query?.userId || req.query?.uid || req.body?.userId || req.body?.uid;
    const targetEmail = req.query?.email || req.body?.email;
    return {
      userId: targetUserId || callerUserId,
      phone: rawPhone || callerPhone,
      email: (targetEmail ? String(targetEmail).trim().toLowerCase() : callerEmail),
    };
  }

  // Authenticated customer is strictly bound to own verified identity
  return {
    userId: callerUserId,
    phone: callerPhone,
    email: callerEmail,
  };
};

/**
 * Get Reminders for Authenticated User
 * Reads reminders directly from the `reminders` array in the user's document in `users` collection.
 * GET /api/reminders
 */
export const getUserReminders = async (req, res) => {
  try {
    const { userId, phone: rawPhone, email: rawEmail } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !rawEmail && (!userId || userId === 'null' || userId === 'undefined')) {
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

    const userDocInfo = await findUserDoc(userId, rawPhone, rawEmail);
    if (!userDocInfo || !userDocInfo.data) {
      return res.status(200).json({
        success: true,
        reminders: [],
      });
    }

    let reminders = Array.isArray(userDocInfo.data.reminders) ? [...userDocInfo.data.reminders] : [];

    // Sort newest first
    reminders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Opportunistically prune obsolete 'orders' field if present on user document
    if (userDocInfo.data.orders !== undefined && userDocInfo.ref && FieldValue && typeof FieldValue.delete === 'function') {
      userDocInfo.ref.update({ orders: FieldValue.delete() }).catch(() => {});
    }

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
    const { userId, phone: rawPhone, email: rawEmail } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !rawEmail && (!userId || userId === 'null' || userId === 'undefined')) {
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
      const userDocInfo = await findUserDoc(userId, rawPhone, rawEmail);
      let userRef;
      let currentReminders = [];

      if (userDocInfo && userDocInfo.ref) {
        userRef = userDocInfo.ref;
        if (userDocInfo.data && Array.isArray(userDocInfo.data.reminders)) {
          currentReminders = userDocInfo.data.reminders;
        }
      } else {
        const primaryDocId = (cleanPhone && cleanPhone.length >= 10) ? `+91${cleanPhone}` : (rawEmail || userId || `USR_${Date.now()}`);
        userRef = db.collection('users').doc(primaryDocId);
      }

      // Prepend the new reminder to the reminders array
      const updatedReminders = [newReminder, ...currentReminders];

      const updatePayload = {
        phoneNumber: rawPhone || '',
        uid: userId || '',
        userId: userId || '',
        reminders: updatedReminders,
        updatedAt: new Date().toISOString(),
      };

      if (rawEmail) {
        updatePayload.email = rawEmail;
      }

      // Remove obsolete 'orders' field if present on user document
      if (userDocInfo?.data?.orders !== undefined && FieldValue && typeof FieldValue.delete === 'function') {
        updatePayload.orders = FieldValue.delete();
      }

      await userRef.set(updatePayload, { merge: true });
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
 * DELETE /api/reminders/:id
 */
export const deleteReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, phone: rawPhone, email: rawEmail } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !rawEmail && (!userId || userId === 'null' || userId === 'undefined')) {
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
      const userDocInfo = await findUserDoc(userId, rawPhone, rawEmail);
      if (userDocInfo && userDocInfo.ref && userDocInfo.data) {
        const currentReminders = Array.isArray(userDocInfo.data.reminders)
          ? userDocInfo.data.reminders
          : [];
        const updatedReminders = currentReminders.filter((r) => String(r.id) !== String(id));

        const updatePayload = {
          reminders: updatedReminders,
          updatedAt: new Date().toISOString(),
        };

        if (userDocInfo.data.orders !== undefined && FieldValue && typeof FieldValue.delete === 'function') {
          updatePayload.orders = FieldValue.delete();
        }

        await userDocInfo.ref.set(updatePayload, { merge: true });
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
    const { userId, phone: rawPhone, email: rawEmail } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !rawEmail && (!userId || userId === 'null' || userId === 'undefined')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to update reminder.',
      });
    }

    if (db) {
      const userDocInfo = await findUserDoc(userId, rawPhone, rawEmail);
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

        const updatePayload = {
          reminders: updatedReminders,
          updatedAt: new Date().toISOString(),
        };

        if (userDocInfo.data.orders !== undefined && FieldValue && typeof FieldValue.delete === 'function') {
          updatePayload.orders = FieldValue.delete();
        }

        await userDocInfo.ref.set(updatePayload, { merge: true });
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
    const { userId, phone: rawPhone, email: rawEmail } = resolveReminderUserIdentity(req);
    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !rawEmail && (!userId || userId === 'null' || userId === 'undefined')) {
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
      const userDocInfo = await findUserDoc(userId, rawPhone, rawEmail);
      if (userDocInfo && userDocInfo.ref) {
        const updatePayload = {
          reminders,
          updatedAt: new Date().toISOString(),
        };

        if (userDocInfo.data?.orders !== undefined && FieldValue && typeof FieldValue.delete === 'function') {
          updatePayload.orders = FieldValue.delete();
        }

        await userDocInfo.ref.set(updatePayload, { merge: true });
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
