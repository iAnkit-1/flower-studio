import { pool } from '../config/db.js';

// Retrieve all support tickets with chat history
export const getTickets = async (req, res) => {
  const queryText = `
    SELECT t.id, t.customer_name AS "customerName", t.order_id AS "orderId", 
           t.category, t.priority, t.status, t.assigned_agent AS "assignedAgent", 
           t.created_at AS "createdAt",
           COALESCE(
             json_agg(
               json_build_object(
                 'sender', m.sender,
                 'message', m.message,
                 'timestamp', m.created_at
               ) ORDER BY m.created_at ASC
             ) FILTER (WHERE m.id IS NOT NULL),
             '[]'
           ) AS "chatHistory"
    FROM support_tickets t
    LEFT JOIN support_messages m ON t.id = m.ticket_id
    GROUP BY t.id
    ORDER BY t.created_at DESC;
  `;

  try {
    const result = await pool.query(queryText);
    return res.status(200).json({
      success: true,
      tickets: result.rows
    });
  } catch (err) {
    console.error('Error fetching support tickets:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve support tickets.',
      error: err.message
    });
  }
};

// Create a new support ticket (usually called from customer app or auto-generated)
export const createTicket = async (req, res) => {
  const { customerName, orderId, category, priority, message } = req.body;

  if (!customerName || !category || !message) {
    return res.status(400).json({
      success: false,
      message: 'Missing required support ticket fields.'
    });
  }

  const ticketId = `TKT-${Math.floor(100 + Math.random() * 900)}`;

  try {
    // 1. Insert support ticket
    const ticketInsertText = `
      INSERT INTO support_tickets (id, customer_name, order_id, category, priority, status)
      VALUES ($1, $2, $3, $4, $5, 'Open')
      RETURNING *;
    `;
    const ticketResult = await pool.query(ticketInsertText, [
      ticketId,
      customerName,
      orderId || null,
      category,
      priority || 'Medium'
    ]);

    // 2. Insert initial chat message
    const msgInsertText = `
      INSERT INTO support_messages (ticket_id, sender, message)
      VALUES ($1, 'Customer', $2)
      RETURNING *;
    `;
    await pool.query(msgInsertText, [ticketId, message]);

    return res.status(201).json({
      success: true,
      message: 'Support ticket successfully generated.',
      ticket: ticketResult.rows[0]
    });
  } catch (err) {
    console.error('Error creating support ticket:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create support ticket.',
      error: err.message
    });
  }
};

// Assign ticket to agent
export const assignTicket = async (req, res) => {
  const { id } = req.params;
  const { agentName } = req.body;

  if (!agentName) {
    return res.status(400).json({
      success: false,
      message: 'Agent name is required.'
    });
  }

  const queryText = `
    UPDATE support_tickets
    SET assigned_agent = $1, status = 'Assigned'
    WHERE id = $2
    RETURNING *;
  `;

  try {
    const result = await pool.query(queryText, [agentName, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.'
      });
    }

    // Insert system message about assignment
    const msgText = `
      INSERT INTO support_messages (ticket_id, sender, message)
      VALUES ($1, 'System', $2);
    `;
    await pool.query(msgText, [id, `Ticket assigned to agent ${agentName}.`]);

    return res.status(200).json({
      success: true,
      message: 'Ticket successfully assigned.',
      ticket: result.rows[0]
    });
  } catch (err) {
    console.error('Error assigning ticket:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign ticket.',
      error: err.message
    });
  }
};

// Update support ticket status
export const updateTicketStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required.'
    });
  }

  const queryText = `
    UPDATE support_tickets
    SET status = $1
    WHERE id = $2
    RETURNING *;
  `;

  try {
    const result = await pool.query(queryText, [status, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found.'
      });
    }

    // Insert system message about status update
    const msgText = `
      INSERT INTO support_messages (ticket_id, sender, message)
      VALUES ($1, 'System', $2);
    `;
    await pool.query(msgText, [id, `Ticket status updated to ${status}.`]);

    return res.status(200).json({
      success: true,
      message: 'Ticket status successfully updated.',
      ticket: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating ticket status:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update ticket status.',
      error: err.message
    });
  }
};

// Send chat message in a ticket
export const sendChatMessage = async (req, res) => {
  const { id } = req.params;
  const { sender, message } = req.body;

  if (!sender || !message) {
    return res.status(400).json({
      success: false,
      message: 'Sender and message content are required.'
    });
  }

  const queryText = `
    INSERT INTO support_messages (ticket_id, sender, message)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;

  try {
    const result = await pool.query(queryText, [id, sender, message]);
    
    // Auto-update ticket status to open if customer replies
    if (sender === 'Customer') {
      await pool.query("UPDATE support_tickets SET status = 'Open' WHERE id = $1", [id]);
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      chatMessage: result.rows[0]
    });
  } catch (err) {
    console.error('Error sending support chat message:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to send chat message.',
      error: err.message
    });
  }
};
