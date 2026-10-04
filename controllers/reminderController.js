import db from '../config/db.js';

/**
 * Normalizes phone number to standard format
 */
const normalizePhone = (phone) => {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '').slice(-10);
};

/**
 * Get Reminders for Authenticated User
 * GET /api/reminders?phone=...&userId=...
 */
export const getUserReminders = async (req, res) => {
  try {
    const rawPhone = req.query.phone || req.query.userPhone || req.body.phone || req.headers['x-user-phone'];
    const userId = req.query.userId || req.query.uid || req.body.userId || req.headers['x-user-id'];

    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login to view reminders.',
        reminders: [],
      });
    }

    if (!db) {
      return res.status(200).json({
        success: true,
        reminders: [],
      });
    }

    // Lookup user in 'users' collection
    const targetDocId = cleanPhone ? cleanPhone : userId;
    const remindersRef = db.collection('users').doc(targetDocId).collection('reminders');
    const snap = await remindersRef.orderBy('createdAt', 'desc').get();

    const reminders = [];
    snap.forEach((doc) => {
      reminders.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    return res.status(200).json({
      success: true,
      reminders: reminders,
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
 * POST /api/reminders
 * Body: { note, occasion, date, time, phone?, userId? }
 */
export const createReminder = async (req, res) => {
  try {
    const { note, occasion, date, time } = req.body;
    const rawPhone = req.body.phone || req.body.userPhone || req.query.phone || req.headers['x-user-phone'];
    const userId = req.body.userId || req.body.uid || req.query.userId || req.headers['x-user-id'];

    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !userId) {
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
      userPhone: cleanPhone || '',
      userId: userId || cleanPhone || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (db) {
      const targetDocId = cleanPhone ? cleanPhone : userId;
      // Ensure user doc exists
      const userRef = db.collection('users').doc(targetDocId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        await userRef.set({
          phoneNumber: cleanPhone,
          userId: userId || cleanPhone,
          createdAt: new Date().toISOString(),
        }, { merge: true });
      }

      await userRef.collection('reminders').doc(reminderId).set(newReminder);
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
 * Delete Reminder
 * DELETE /api/reminders/:id?phone=...&userId=...
 */
export const deleteReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const rawPhone = req.query.phone || req.query.userPhone || req.body.phone || req.headers['x-user-phone'];
    const userId = req.query.userId || req.query.uid || req.body.userId || req.headers['x-user-id'];

    const cleanPhone = normalizePhone(rawPhone);

    if (!cleanPhone && !userId) {
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
      const targetDocId = cleanPhone ? cleanPhone : userId;
      await db.collection('users').doc(targetDocId).collection('reminders').doc(id).delete();
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
