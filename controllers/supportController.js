import db from '../config/db.js';
import { normalizePhone } from '../middleware/authMiddleware.js';
import { sendStaffSupportAlert } from '../services/fcmService.js';

export const VALID_STATUSES = ['OPEN', 'IN PROGRESS', 'AWAITING CUSTOMER', 'RESOLVED'];
export const VALID_PRIORITIES = ['LOW', 'MID', 'HIGH'];

/**
 * Normalize status string to one of the 4 standard uppercase statuses
 */
export const normalizeStatus = (status) => {
  if (!status || typeof status !== 'string') return 'OPEN';
  const clean = status.trim().toUpperCase();
  if (clean === 'CLOSED') return 'RESOLVED';
  if (clean === 'IN_PROGRESS' || clean === 'IN-PROGRESS') return 'IN PROGRESS';
  if (clean === 'AWAITING_CUSTOMER' || clean === 'AWAITING-CUSTOMER') return 'AWAITING CUSTOMER';
  if (VALID_STATUSES.includes(clean)) return clean;
  return 'OPEN';
};

/**
 * Normalize priority string to one of the 3 standard uppercase priorities
 */
export const normalizePriority = (priority) => {
  if (!priority || typeof priority !== 'string') return 'MID';
  const clean = priority.trim().toUpperCase();
  if (clean === 'MEDIUM') return 'MID';
  if (clean === 'URGENT') return 'HIGH';
  if (VALID_PRIORITIES.includes(clean)) return clean;
  return 'MID';
};

/**
 * Retrieve support tickets from Firestore
 * - Staff sees all (with filters ?status=, ?priority=, ?search=)
 * - Customer sees own tickets
 */
export const getTickets = async (req, res) => {
  try {
    const isStaff = Boolean(req.user?.isStaff || req.user?.isAdmin);
    const callerUserId = (req.user?.userId || req.user?.uid || '').trim();
    const callerPhone = normalizePhone(req.user?.phoneNumber || '');

    let snapshot;
    try {
      snapshot = await db.collection('support_tickets').orderBy('createdAt', 'desc').get();
    } catch (e) {
      snapshot = await db.collection('support_tickets').get();
    }

    let docs = snapshot.docs;

    // Isolate regular customers to their own tickets only
    if (!isStaff) {
      docs = docs.filter((doc) => {
        const d = doc.data();
        const tUser = (d.userId || '').trim();
        const tPhone = normalizePhone(d.customerPhone || '');
        return (
          (callerUserId && tUser && callerUserId === tUser) ||
          (callerPhone && tPhone && callerPhone === tPhone)
        );
      });
    }

    let tickets = docs.map((doc) => {
      const data = doc.data();
      const status = normalizeStatus(data.status);
      const priority = normalizePriority(data.priority);

      return {
        id: data.id || doc.id,
        orderId: data.orderId || null,
        userId: data.userId || '',
        customerName: data.customerName || 'Customer',
        customerPhone: isStaff ? (data.customerPhone || '') : undefined,
        customerEmail: data.customerEmail || '',
        orderDate: data.orderDate || null,
        totalAmount: data.totalAmount != null ? Number(data.totalAmount) : null,
        orderStatus: data.orderStatus || null,
        paymentMethod: data.paymentMethod || null,
        paymentStatus: data.paymentStatus || null,
        deliveryAddress: data.deliveryAddress || null,
        deliverySlot: data.deliverySlot || null,
        deliveryDate: data.deliveryDate || null,
        category: data.category || 'General Issue',
        priority,
        status,
        assignedAgent: data.assignedAgent || null,
        internalNotes: data.internalNotes || '',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || data.createdAt || new Date().toISOString(),
        chatHistory: Array.isArray(data.chatHistory) ? data.chatHistory : [],
        // Convenience message accessor
        message:
          data.message ||
          (Array.isArray(data.chatHistory) && data.chatHistory.length > 0
            ? data.chatHistory[0].message
            : ''),
      };
    });

    // Query filters
    const { status, priority, search } = req.query;

    if (status && status.trim().toUpperCase() !== 'ALL') {
      const targetStatus = normalizeStatus(status);
      tickets = tickets.filter((t) => t.status === targetStatus);
    }

    if (priority && priority.trim().toUpperCase() !== 'ALL') {
      const targetPriority = normalizePriority(priority);
      tickets = tickets.filter((t) => t.priority === targetPriority);
    }

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      tickets = tickets.filter(
        (t) =>
          t.id.toLowerCase().includes(term) ||
          (t.orderId && t.orderId.toLowerCase().includes(term)) ||
          t.customerName.toLowerCase().includes(term) ||
          (t.customerPhone && t.customerPhone.toLowerCase().includes(term)) ||
          t.category.toLowerCase().includes(term) ||
          (t.message && t.message.toLowerCase().includes(term))
      );
    }

    return res.status(200).json({
      success: true,
      tickets,
      count: tickets.length,
    });
  } catch (err) {
    console.error('Error fetching support tickets from Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve support tickets.',
      error: err.message,
    });
  }
};

/**
 * Get ticket counts by status (for live count badges on Org Web & Organization App)
 */
export const getTicketCounts = async (req, res) => {
  try {
    const isStaff = Boolean(req.user?.isStaff || req.user?.isAdmin);
    const callerUserId = (req.user?.userId || req.user?.uid || '').trim();
    const callerPhone = normalizePhone(req.user?.phoneNumber || '');

    const snapshot = await db.collection('support_tickets').get();
    let docs = snapshot.docs;

    if (!isStaff) {
      docs = docs.filter((doc) => {
        const d = doc.data();
        const tUser = (d.userId || '').trim();
        const tPhone = normalizePhone(d.customerPhone || '');
        return (
          (callerUserId && tUser && callerUserId === tUser) ||
          (callerPhone && tPhone && callerPhone === tPhone)
        );
      });
    }

    let open = 0;
    let inProgress = 0;
    let awaitingCustomer = 0;
    let resolved = 0;

    docs.forEach((doc) => {
      const norm = normalizeStatus(doc.data().status);
      if (norm === 'OPEN') open++;
      else if (norm === 'IN PROGRESS') inProgress++;
      else if (norm === 'AWAITING CUSTOMER') awaitingCustomer++;
      else if (norm === 'RESOLVED') resolved++;
    });

    const total = docs.length;
    const activeCount = open + inProgress + awaitingCustomer;

    return res.status(200).json({
      success: true,
      counts: {
        total,
        open,
        inProgress,
        awaitingCustomer,
        resolved,
        activeCount,
      },
    });
  } catch (err) {
    console.error('Error fetching ticket counts:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket counts.',
      error: err.message,
    });
  }
};

/**
 * Create a new support ticket in Firestore
 * Autofills order metadata, initializes status to [OPEN], sets priority,
 * and notifies staff on Org Web and Organization App.
 */
export const createTicket = async (req, res) => {
  try {
    const {
      orderId,
      userId,
      customerName,
      customerPhone,
      customerEmail,
      orderDate,
      totalAmount,
      orderStatus,
      paymentMethod,
      paymentStatus,
      deliveryAddress,
      deliverySlot,
      deliveryDate,
      category,
      message,
      priority,
    } = req.body;

    const issueMessage = (message || req.body.description || '').trim();
    const issueCategory = (category || req.body.subject || 'Order Support').trim();

    if (!issueMessage) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a description of your issue (message is required).',
      });
    }

    const callerUserId = (req.user?.userId || req.user?.uid || userId || '').trim();
    const callerPhone = normalizePhone(req.user?.phoneNumber || customerPhone || '');
    const callerName = req.user?.name || customerName || 'Customer';
    const callerEmail = req.user?.email || customerEmail || '';

    // If orderId is provided, optionally complement missing fields directly from order doc
    let autofilledOrder = {};
    if (orderId) {
      try {
        const orderSnap = await db.collection('orders').doc(orderId).get();
        if (orderSnap.exists) {
          const od = orderSnap.data();
          autofilledOrder = {
            orderDate: od.createdAt || od.created_at || od.orderDate,
            totalAmount: od.grandTotal ?? od.grand_total,
            orderStatus: od.orderStatus || od.status || od.delivery_status,
            paymentMethod: od.paymentMethod || od.payment_method,
            paymentStatus: od.paymentStatus || od.payment_status,
            deliveryAddress: od.deliveryDetails?.fullAddress || od.deliveryAddress || od.delivery_address,
            deliverySlot: od.deliveryDetails?.deliverySlot || od.deliverySlot || od.delivery_slot,
            deliveryDate: od.deliveryDetails?.deliveryDate || od.deliveryDate || od.delivery_date,
            customerName: od.recipientName || od.recipient_name || callerName,
            customerPhone: od.recipientPhone || od.recipient_phone || callerPhone,
            userId: od.userId || callerUserId,
          };
        }
      } catch (err) {
        console.warn(`[Support] Notice looking up order #${orderId}:`, err.message);
      }
    }

    const ticketId = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
    const now = new Date().toISOString();

    const newTicket = {
      id: ticketId,
      orderId: orderId || null,
      userId: callerUserId || autofilledOrder.userId || '',
      customerName: callerName || autofilledOrder.customerName || 'Customer',
      customerPhone: callerPhone || autofilledOrder.customerPhone || '',
      customerEmail: callerEmail || '',
      orderDate: orderDate || autofilledOrder.orderDate || null,
      totalAmount:
        totalAmount != null
          ? Number(totalAmount)
          : autofilledOrder.totalAmount != null
          ? Number(autofilledOrder.totalAmount)
          : null,
      orderStatus: orderStatus || autofilledOrder.orderStatus || null,
      paymentMethod: paymentMethod || autofilledOrder.paymentMethod || null,
      paymentStatus: paymentStatus || autofilledOrder.paymentStatus || null,
      deliveryAddress: deliveryAddress || autofilledOrder.deliveryAddress || null,
      deliverySlot: deliverySlot || autofilledOrder.deliverySlot || null,
      deliveryDate: deliveryDate || autofilledOrder.deliveryDate || null,
      category: issueCategory,
      priority: normalizePriority(priority),
      status: 'OPEN',
      assignedAgent: null,
      internalNotes: '',
      message: issueMessage,
      createdAt: now,
      updatedAt: now,
      chatHistory: [
        {
          sender: 'Customer',
          message: issueMessage,
          timestamp: now,
        },
      ],
    };

    await db.collection('support_tickets').doc(ticketId).set(newTicket);
    console.log(`[Support Service] Created ticket #${ticketId} with status [OPEN] for order #${orderId || 'N/A'}`);

    // Trigger Staff Notification with Ding / Push Alert on Org Web and Organization App
    sendStaffSupportAlert({
      ticketId,
      customerName: newTicket.customerName,
      customerPhone: newTicket.customerPhone,
      orderId: newTicket.orderId,
      category: newTicket.category,
      message: issueMessage,
      priority: newTicket.priority,
    }).catch((err) => console.warn('[createTicket Staff Alert Notice]:', err.message));

    return res.status(201).json({
      success: true,
      message: 'Support ticket successfully generated.',
      ticket: newTicket,
    });
  } catch (err) {
    console.error('Error creating support ticket in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create support ticket.',
      error: err.message,
    });
  }
};

/**
 * Assign ticket to agent in Firestore (Staff only)
 */
export const assignTicket = async (req, res) => {
  const { id } = req.params;
  const agentName = (req.body.agentName || req.body.assignee || '').trim();

  if (!agentName) {
    return res.status(400).json({
      success: false,
      message: 'Agent name is required.',
    });
  }

  try {
    const docRef = db.collection('support_tickets').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.',
      });
    }

    const currentHistory = docSnap.data().chatHistory || [];
    const now = new Date().toISOString();
    const systemMessage = {
      sender: 'System',
      message: `Ticket assigned to agent ${agentName}.`,
      timestamp: now,
    };

    await docRef.update({
      assignedAgent: agentName,
      status: docSnap.data().status === 'OPEN' ? 'IN PROGRESS' : docSnap.data().status,
      updatedAt: now,
      chatHistory: [...currentHistory, systemMessage],
    });

    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: 'Ticket successfully assigned.',
      ticket: { id, ...updatedSnap.data() },
    });
  } catch (err) {
    console.error('Error assigning ticket in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign ticket.',
      error: err.message,
    });
  }
};

/**
 * Update support ticket status in Firestore (Staff only)
 * Allowed statuses: ['OPEN', 'IN PROGRESS', 'AWAITING CUSTOMER', 'RESOLVED']
 */
export const updateTicketStatus = async (req, res) => {
  const { id } = req.params;
  const rawStatus = req.body.status;

  if (!rawStatus) {
    return res.status(400).json({
      success: false,
      message: 'Status is required.',
    });
  }

  const normalizedStatus = normalizeStatus(rawStatus);

  try {
    const docRef = db.collection('support_tickets').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.',
      });
    }

    const currentHistory = docSnap.data().chatHistory || [];
    const now = new Date().toISOString();
    const systemMessage = {
      sender: 'System',
      message: `Ticket status updated to [${normalizedStatus}].`,
      timestamp: now,
    };

    const updatePayload = {
      status: normalizedStatus,
      updatedAt: now,
      chatHistory: [...currentHistory, systemMessage],
    };

    if (normalizedStatus === 'RESOLVED') {
      updatePayload.resolvedAt = now;
    }

    await docRef.update(updatePayload);

    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: `Ticket status successfully updated to [${normalizedStatus}].`,
      ticket: { id, ...updatedSnap.data() },
    });
  } catch (err) {
    console.error('Error updating ticket status in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update ticket status.',
      error: err.message,
    });
  }
};

/**
 * Update ticket priority in Firestore (Staff only)
 * Allowed priorities: ['LOW', 'MID', 'HIGH']
 */
export const updateTicketPriority = async (req, res) => {
  const { id } = req.params;
  const rawPriority = req.body.priority;

  if (!rawPriority) {
    return res.status(400).json({
      success: false,
      message: 'Priority is required.',
    });
  }

  const normalizedPriority = normalizePriority(rawPriority);

  try {
    const docRef = db.collection('support_tickets').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.',
      });
    }

    const currentHistory = docSnap.data().chatHistory || [];
    const now = new Date().toISOString();
    const systemMessage = {
      sender: 'System',
      message: `Ticket priority updated to [${normalizedPriority}].`,
      timestamp: now,
    };

    await docRef.update({
      priority: normalizedPriority,
      updatedAt: now,
      chatHistory: [...currentHistory, systemMessage],
    });

    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: `Ticket priority updated to [${normalizedPriority}].`,
      ticket: { id, ...updatedSnap.data() },
    });
  } catch (err) {
    console.error('Error updating ticket priority in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update ticket priority.',
      error: err.message,
    });
  }
};

/**
 * General PATCH update for ticket (status, priority, assignedAgent, internalNotes)
 */
export const updateTicket = async (req, res) => {
  const { id } = req.params;
  const { status, priority, assignedAgent, internalNotes } = req.body;

  try {
    const docRef = db.collection('support_tickets').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.',
      });
    }

    const currentHistory = docSnap.data().chatHistory || [];
    const now = new Date().toISOString();
    const updatePayload = {
      updatedAt: now,
    };

    const auditMessages = [];

    if (status !== undefined) {
      const normStatus = normalizeStatus(status);
      updatePayload.status = normStatus;
      auditMessages.push(`Status set to [${normStatus}]`);
      if (normStatus === 'RESOLVED') {
        updatePayload.resolvedAt = now;
      }
    }

    if (priority !== undefined) {
      const normPriority = normalizePriority(priority);
      updatePayload.priority = normPriority;
      auditMessages.push(`Priority set to [${normPriority}]`);
    }

    if (assignedAgent !== undefined) {
      updatePayload.assignedAgent = assignedAgent;
      auditMessages.push(`Assigned agent set to ${assignedAgent || 'None'}`);
    }

    if (internalNotes !== undefined) {
      updatePayload.internalNotes = internalNotes;
    }

    if (auditMessages.length > 0) {
      updatePayload.chatHistory = [
        ...currentHistory,
        {
          sender: 'System',
          message: auditMessages.join(' • '),
          timestamp: now,
        },
      ];
    }

    await docRef.update(updatePayload);
    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: 'Ticket updated successfully.',
      ticket: { id, ...updatedSnap.data() },
    });
  } catch (err) {
    console.error('Error updating ticket in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update ticket.',
      error: err.message,
    });
  }
};

/**
 * Send chat message in a ticket in Firestore
 */
export const sendChatMessage = async (req, res) => {
  const { id } = req.params;
  const { sender, message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Message content is required.',
    });
  }

  try {
    const docRef = db.collection('support_tickets').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.',
      });
    }

    const ticketData = docSnap.data();
    const isStaff = Boolean(req.user?.isStaff || req.user?.isAdmin);

    if (!isStaff) {
      const callerUserId = (req.user?.userId || req.user?.uid || '').trim();
      const callerPhone = normalizePhone(req.user?.phoneNumber || '');
      const tUser = (ticketData.userId || '').trim();
      const tPhone = normalizePhone(ticketData.customerPhone || '');
      const isOwner =
        (callerUserId && tUser && callerUserId === tUser) ||
        (callerPhone && tPhone && callerPhone === tPhone);

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to message in this ticket.',
        });
      }
    }

    const currentHistory = ticketData.chatHistory || [];
    const now = new Date().toISOString();
    const newMessage = {
      sender: isStaff ? sender || 'Support Staff' : 'Customer',
      message: message.trim(),
      timestamp: now,
    };

    const updatePayload = {
      chatHistory: [...currentHistory, newMessage],
      updatedAt: now,
    };

    // If customer replies to a resolved ticket, reopen it
    if (!isStaff && ticketData.status === 'RESOLVED') {
      updatePayload.status = 'OPEN';
    } else if (isStaff && ticketData.status === 'OPEN') {
      updatePayload.status = 'IN PROGRESS';
    }

    await docRef.update(updatePayload);

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      chatMessage: newMessage,
    });
  } catch (err) {
    console.error('Error sending support chat message in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to send chat message.',
      error: err.message,
    });
  }
};
