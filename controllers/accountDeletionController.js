import db from '../config/db.js';

/**
 * Handle Account Deletion Request
 * POST /api/account-deletion-request
 * Accepts registered phone or email, stores an auditable deletion record in Firestore,
 * looks up existing userId, and returns confirmation details.
 */
export const requestAccountDeletion = async (req, res) => {
  try {
    const { identifier, phone, email, reason, notes } = req.body;

    const rawInput = (identifier || phone || email || '').trim();
    if (!rawInput) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a registered mobile number or email address.',
      });
    }

    const isEmail = rawInput.includes('@');
    const isPhone = !isEmail && rawInput.replace(/\D/g, '').length >= 10;

    let targetPhone = phone || (isPhone ? rawInput : '');
    let targetEmail = email || (isEmail ? rawInput : '');

    // Format phone with +91 if 10 digits
    if (targetPhone) {
      const cleanDigits = targetPhone.replace(/\D/g, '');
      if (cleanDigits.length === 10) {
        targetPhone = `+91${cleanDigits}`;
      }
    }

    // Lookup matching user in Firestore 'users' collection
    let matchedUserId = null;
    let matchedUserName = null;
    let matchedUserEmail = null;
    let matchedUserPhone = null;

    try {
      if (targetPhone) {
        const phoneSnap = await db.collection('users')
          .where('phoneNumber', 'in', [targetPhone, targetPhone.replace('+91', ''), targetPhone.replace('+91', '+91 ')])
          .limit(1)
          .get();

        if (!phoneSnap.empty) {
          const doc = phoneSnap.docs[0];
          const data = doc.data();
          matchedUserId = data.uid || doc.id;
          matchedUserName = data.fullName || data.name || '';
          matchedUserEmail = data.email || '';
          matchedUserPhone = data.phoneNumber || targetPhone;
        }
      }

      if (!matchedUserId && targetEmail) {
        const emailSnap = await db.collection('users')
          .where('email', '==', targetEmail.toLowerCase())
          .limit(1)
          .get();

        if (!emailSnap.empty) {
          const doc = emailSnap.docs[0];
          const data = doc.data();
          matchedUserId = data.uid || doc.id;
          matchedUserName = data.fullName || data.name || '';
          matchedUserEmail = data.email || targetEmail;
          matchedUserPhone = data.phoneNumber || '';
        }
      }
    } catch (lookupErr) {
      console.warn('[Account Deletion] User lookup warning:', lookupErr.message);
    }

    const requestId = `DEL_REQ_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const requestedAt = new Date().toISOString();

    const deletionRecord = {
      requestId,
      identifier: rawInput,
      identifierType: isEmail ? 'email' : 'phone',
      phone: targetPhone || matchedUserPhone || '',
      email: targetEmail || matchedUserEmail || '',
      userId: matchedUserId || null,
      userName: matchedUserName || null,
      reason: reason || notes || 'User requested account deletion via web portal',
      status: 'PENDING', // PENDING -> VERIFIED -> PROCESSING -> COMPLETED
      requestedAt,
      processedAt: null,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || '',
      userAgent: req.headers['user-agent'] || '',
      createdAt: requestedAt,
      updatedAt: requestedAt,
    };

    // Store primarily in 'account_deletions' collection, and mirror in 'account_deletion_requests'
    await db.collection('account_deletions').doc(requestId).set(deletionRecord);
    await db.collection('account_deletion_requests').doc(requestId).set(deletionRecord);
    await db.collection('deletion_requests').doc(requestId).set(deletionRecord).catch(() => {});

    console.log(`[Account Deletion] Recorded deletion request ${requestId} in 'account_deletions' for identifier: ${rawInput} (User ID: ${matchedUserId || 'None'})`);

    return res.status(201).json({
      success: true,
      message: 'Your deletion request has been submitted. Our team will verify your request and process the deletion.',
      requestId,
      status: 'PENDING',
      requestedAt,
    });
  } catch (error) {
    console.error('[Account Deletion Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process account deletion request. Please try again or contact support.',
      error: error.message,
    });
  }
};

/**
 * List Account Deletion Requests (Admin / Management)
 * GET /api/account-deletion-requests
 */
export const getDeletionRequests = async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    let query = db.collection('account_deletions');

    if (status) {
      query = query.where('status', '==', status.toUpperCase());
    }

    const snapshot = await query.limit(parseInt(limit, 10)).get();
    const requests = [];

    snapshot.forEach((doc) => {
      requests.push({ id: doc.id, ...doc.data() });
    });

    requests.sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));

    return res.status(200).json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (error) {
    console.error('[Get Deletion Requests Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch deletion requests.',
      error: error.message,
    });
  }
};

/**
 * Update Deletion Request Status
 * PATCH /api/account-deletion-requests/:requestId
 * Statuses: PENDING -> VERIFIED -> PROCESSING -> COMPLETED -> REJECTED
 */
export const updateDeletionRequestStatus = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, notes } = req.body;

    const allowedStatuses = ['PENDING', 'VERIFIED', 'PROCESSING', 'COMPLETED', 'REJECTED'];
    if (!status || !allowedStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`,
      });
    }

    const newStatus = status.toUpperCase();
    const nowIso = new Date().toISOString();

    const updateData = {
      status: newStatus,
      updatedAt: nowIso,
      ...(notes ? { notes } : {}),
      ...(newStatus === 'COMPLETED' ? { processedAt: nowIso } : {}),
    };

    const docRef = db.collection('account_deletions').doc(requestId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Deletion request not found.',
      });
    }

    await docRef.update(updateData);
    await db.collection('account_deletion_requests').doc(requestId).update(updateData).catch(() => {});
    await db.collection('deletion_requests').doc(requestId).update(updateData).catch(() => {});

    // If completed and userId is known, mark user profile as deleted
    const reqData = docSnap.data();
    if (newStatus === 'COMPLETED' && reqData.userId) {
      try {
        await db.collection('users').doc(reqData.userId).update({
          isDeleted: true,
          deletedAt: nowIso,
          addresses: [],
        });
        console.log(`[Account Deletion] Marked user ${reqData.userId} as deleted in Firestore`);
      } catch (uErr) {
        console.warn(`[Account Deletion] Could not wipe user doc: ${uErr.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Deletion request ${requestId} updated to ${newStatus}.`,
      requestId,
      status: newStatus,
      updatedAt: nowIso,
    });
  } catch (error) {
    console.error('[Update Deletion Status Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update deletion request status.',
      error: error.message,
    });
  }
};
