import db from '../config/db.js';

// Retrieve all support tickets with chat history from Firestore
export const getTickets = async (req, res) => {
  try {
    let snapshot;
    try {
      snapshot = await db.collection('support_tickets').orderBy('createdAt', 'desc').get();
    } catch (e) {
      snapshot = await db.collection('support_tickets').get();
    }

    const tickets = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id || doc.id,
        customerName: data.customerName || '',
        orderId: data.orderId || null,
        category: data.category || '',
        priority: data.priority || 'Medium',
        status: data.status || 'Open',
        assignedAgent: data.assignedAgent || null,
        createdAt: data.createdAt || new Date().toISOString(),
        chatHistory: data.chatHistory || []
      };
    });

    return res.status(200).json({
      success: true,
      tickets
    });
  } catch (err) {
    console.error('Error fetching support tickets from Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve support tickets.',
      error: err.message
    });
  }
};

// Create a new support ticket in Firestore
export const createTicket = async (req, res) => {
  const { customerName, orderId, category, priority, message } = req.body;

  if (!customerName || !category || !message) {
    return res.status(400).json({
      success: false,
      message: 'Missing required support ticket fields.'
    });
  }

  const ticketId = `TKT-${Math.floor(100 + Math.random() * 900)}`;

  const newTicket = {
    id: ticketId,
    customerName,
    orderId: orderId || null,
    category,
    priority: priority || 'Medium',
    status: 'Open',
    assignedAgent: null,
    createdAt: new Date().toISOString(),
    chatHistory: [
      {
        sender: 'Customer',
        message: message,
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    await db.collection('support_tickets').doc(ticketId).set(newTicket);
    return res.status(201).json({
      success: true,
      message: 'Support ticket successfully generated.',
      ticket: newTicket
    });
  } catch (err) {
    console.error('Error creating support ticket in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create support ticket.',
      error: err.message
    });
  }
};

// Assign ticket to agent in Firestore
export const assignTicket = async (req, res) => {
  const { id } = req.params;
  const { agentName } = req.body;

  if (!agentName) {
    return res.status(400).json({
      success: false,
      message: 'Agent name is required.'
    });
  }

  try {
    const docRef = db.collection('support_tickets').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.'
      });
    }

    const currentHistory = docSnap.data().chatHistory || [];
    const systemMessage = {
      sender: 'System',
      message: `Ticket assigned to agent ${agentName}.`,
      timestamp: new Date().toISOString()
    };

    await docRef.update({
      assignedAgent: agentName,
      status: 'Assigned',
      chatHistory: [...currentHistory, systemMessage]
    });

    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: 'Ticket successfully assigned.',
      ticket: { id, ...updatedSnap.data() }
    });
  } catch (err) {
    console.error('Error assigning ticket in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign ticket.',
      error: err.message
    });
  }
};

// Update support ticket status in Firestore
export const updateTicketStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required.'
    });
  }

  try {
    const docRef = db.collection('support_tickets').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.'
      });
    }

    const currentHistory = docSnap.data().chatHistory || [];
    const systemMessage = {
      sender: 'System',
      message: `Ticket status updated to ${status}.`,
      timestamp: new Date().toISOString()
    };

    await docRef.update({
      status: status,
      chatHistory: [...currentHistory, systemMessage]
    });

    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: 'Ticket status successfully updated.',
      ticket: { id, ...updatedSnap.data() }
    });
  } catch (err) {
    console.error('Error updating ticket status in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update ticket status.',
      error: err.message
    });
  }
};

// Send chat message in a ticket in Firestore
export const sendChatMessage = async (req, res) => {
  const { id } = req.params;
  const { sender, message } = req.body;

  if (!sender || !message) {
    return res.status(400).json({
      success: false,
      message: 'Sender and message content are required.'
    });
  }

  try {
    const docRef = db.collection('support_tickets').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.'
      });
    }

    const currentHistory = docSnap.data().chatHistory || [];
    const newMessage = {
      sender,
      message,
      timestamp: new Date().toISOString()
    };

    const updatePayload = {
      chatHistory: [...currentHistory, newMessage]
    };

    if (sender === 'Customer') {
      updatePayload.status = 'Open';
    }

    await docRef.update(updatePayload);

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      chatMessage: newMessage
    });
  } catch (err) {
    console.error('Error sending support chat message in Firestore:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to send chat message.',
      error: err.message
    });
  }
};
