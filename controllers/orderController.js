import { pool } from '../config/db.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

// Initialize Razorpay client only if keys are present
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  try {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log('Razorpay SDK initialized successfully with credentials.');
  } catch (err) {
    console.error('Failed to initialize Razorpay SDK:', err);
  }
} else {
  console.log('Razorpay keys not configured. Falling back to sandbox/simulation.');
}

/**
 * Create Order
 * POST /api/orders
 */
export const createOrder = async (req, res) => {
  const {
    recipient_name,
    recipient_phone,
    delivery_address,
    gift_message,
    items,
    items_subtotal,
    addons_subtotal,
    delivery_total,
    grand_total,
    payment_method,
  } = req.body;

  const grandTotal = grand_total;

  if (!recipient_name || !recipient_phone || !delivery_address || !items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Required fields are missing.' });
  }

  // Generate unique order ID
  const randNum = Math.floor(100000 + Math.random() * 900000);
  const orderId = `FS-${Date.now().toString().slice(-6)}-${randNum}`;

  try {
    // 1. Insert Order record (pending state)
    const orderInsertQuery = `
      INSERT INTO orders (
        id, recipient_name, recipient_phone, delivery_address, gift_message,
        items_subtotal, addons_subtotal, delivery_total, grand_total,
        payment_method, payment_status, delivery_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const initialPaymentStatus = payment_method === 'cod' ? 'pending' : 'pending';
    const orderValues = [
      orderId, recipient_name, recipient_phone, delivery_address, gift_message || null,
      items_subtotal, addons_subtotal, delivery_total, grand_total,
      payment_method, initialPaymentStatus, 'pending'
    ];
    const orderResult = await pool.query(orderInsertQuery, orderValues);
    const savedOrder = orderResult.rows[0];

    // 2. Insert Order Items records
    const itemInsertQuery = `
      INSERT INTO order_items (
        order_id, product_id, product_title, product_image, quantity, price,
        delivery_date, delivery_slot, delivery_price, addons
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    for (const item of items) {
      const itemValues = [
        orderId,
        item.product_id,
        item.product_title,
        item.product_image || null,
        item.quantity,
        item.price,
        item.delivery_date ? new Date(item.delivery_date) : null,
        item.delivery_slot || null,
        item.delivery_price || 0.0,
        JSON.stringify(item.addons || [])
      ];
      await pool.query(itemInsertQuery, itemValues);
    }

    // 3. Handle Payment Method Integration
    if (payment_method === 'cod') {
      console.log(`COD order placed: ${orderId}`);
      return res.status(201).json({
        success: true,
        message: 'Order created successfully (COD).',
        orderId: orderId,
        paymentMethod: 'cod',
        grandTotal: grandTotal,
      });
    }

    // Razorpay Payment Link Integration
    if (razorpay) {
      try {
        const amountInPaisa = Math.round(parseFloat(grandTotal) * 100);

        // Host callback url mapping (matches local server port or production host)
        // Standard checkout redirect URL after payment
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const callbackUrl = `${protocol}://${host}/api/orders/callback`;

        const plinkOptions = {
          amount: amountInPaisa,
          currency: 'INR',
          accept_partial: false,
          reference_id: orderId,
          description: `Payment Receipt for Flower Studio Order ${orderId}`,
          customer: {
            name: recipient_name,
            contact: recipient_phone,
            email: 'customer@flowerstudio.com',
          },
          notify: {
            sms: false,
            email: false
          },
          reminder_enable: false,
          callback_url: callbackUrl,
          callback_method: 'get',
          options: {
            checkout: {
              method: {
                card: true,
                upi: true,
                netbanking: true,
                wallet: true
              }
            }
          }
        };

        const paymentLink = await razorpay.paymentLink.create(plinkOptions);

        // Update order record with Razorpay Payment Link ID
        await pool.query(
          'UPDATE orders SET razorpay_order_id = $1 WHERE id = $2',
          [paymentLink.id, orderId]
        );

        console.log(`Razorpay Payment Link generated: ${paymentLink.id} (URL: ${paymentLink.short_url})`);

        return res.status(201).json({
          success: true,
          message: 'Razorpay payment link generated.',
          orderId: orderId,
          paymentLink: paymentLink.short_url,
          paymentMethod: payment_method,
          grandTotal: grandTotal,
          isSimulated: false
        });
      } catch (err) {
        console.error('Error creating Razorpay Payment Link, falling back to mock checkout:', err);
      }
    }

    // Fallback Mock Hosted Checkout Page URL (runs on our Express server)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const mockCheckoutUrl = `${protocol}://${host}/api/orders/mock-checkout/${orderId}`;
    console.log(`Mock payment link generated: ${orderId} -> URL: ${mockCheckoutUrl}`);
    return res.status(201).json({
      success: true,
      message: 'Payment link simulated (mock hosted checkout).',
      orderId: orderId,
      paymentLink: mockCheckoutUrl,
      paymentMethod: payment_method,
      grandTotal: grandTotal,
      isSimulated: true
    });

  } catch (error) {
    console.error('Error placing order:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error.' });
  }
};

/**
 * Verify Payment Signature
 * POST /api/orders/verify
 */
export const verifyPayment = async (req, res) => {
  const {
    orderId,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
    isSimulated,
    paymentMethod
  } = req.body;

  if (!orderId) {
    return res.status(400).json({ success: false, message: 'Order ID is required.' });
  }

  try {
    // Check if the order exists in db
    const orderCheck = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found in database.' });
    }

    const order = orderCheck.rows[0];

    // If simulated or keys are absent
    if (isSimulated || !razorpay || razorpay_signature === 'simulated_signature_ok') {
      const finalPaymentId = razorpay_payment_id || `pay_sim_${Math.random().toString(36).substr(2, 9)}`;
      const pMethod = paymentMethod || order.payment_method;
      const pStatus = pMethod === 'cod' ? 'pending' : 'paid';

      await pool.query(
        `UPDATE orders 
         SET payment_status = $1, razorpay_payment_id = $2, razorpay_signature = $3, delivery_status = 'handcrafting', payment_method = $4
         WHERE id = $5`,
        [pStatus, finalPaymentId, razorpay_signature || 'simulated_sig', pMethod, orderId]
      );
      console.log(`Order ${orderId} verified successfully (simulated)`);
      return res.status(200).json({
        success: true,
        message: 'Payment verified and saved successfully (Simulated mode).',
        orderId: orderId
      });
    }

    // Verify Real Signature
    const dataToVerify = razorpay_order_id + '|' + razorpay_payment_id;
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(dataToVerify.toString())
      .digest('hex');

    if (generatedSignature === razorpay_signature) {
      await pool.query(
        `UPDATE orders 
         SET payment_status = 'paid', razorpay_payment_id = $1, razorpay_signature = $2, delivery_status = 'handcrafting'
         WHERE id = $3`,
        [razorpay_payment_id, razorpay_signature, orderId]
      );
      console.log(`Order ${orderId} verified successfully (Real Razorpay)`);
      return res.status(200).json({
        success: true,
        message: 'Payment signature verified successfully.',
        orderId: orderId
      });
    } else {
      await pool.query("UPDATE orders SET payment_status = 'failed' WHERE id = $1", [orderId]);
      console.error(`Invalid Razorpay signature for order ${orderId}`);
      return res.status(400).json({ success: false, message: 'Invalid payment signature verified.' });
    }

  } catch (error) {
    console.error('Error verifying payment:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error during verification.' });
  }
};

/**
 * Get Orders by a list of IDs
 * POST /api/orders/by-ids
 */
export const getOrdersByIds = async (req, res) => {
  const { orderIds } = req.body;

  if (!orderIds || !Array.isArray(orderIds)) {
    return res.status(400).json({ success: false, message: 'orderIds array must be provided.' });
  }

  if (orderIds.length === 0) {
    return res.status(200).json({ success: true, orders: [] });
  }

  try {
    // Query orders matching ANY of the IDs in the array
    const ordersQuery = `
      SELECT * FROM orders 
      WHERE id = ANY($1) 
      ORDER BY created_at DESC
    `;
    const ordersResult = await pool.query(ordersQuery, [orderIds]);
    const orders = ordersResult.rows;

    // Fetch items for each order
    const completedOrders = [];
    for (const order of orders) {
      const itemsQuery = 'SELECT * FROM order_items WHERE order_id = $1';
      const itemsResult = await pool.query(itemsQuery, [order.id]);

      // Parse JSON columns back appropriately
      const items = itemsResult.rows.map(item => ({
        ...item,
        addons: typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons
      }));

      completedOrders.push({
        ...order,
        items
      });
    }

    return res.status(200).json({ success: true, orders: completedOrders });

  } catch (error) {
    console.error('Error fetching order records:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error.' });
  }
};

/**
 * Generate Printable GST Invoice/Receipt (HTML format)
 * GET /api/orders/:orderId/invoice
 */
export const getInvoice = async (req, res) => {
  const { orderId } = req.params;

  try {
    const orderQuery = 'SELECT * FROM orders WHERE id = $1';
    const orderResult = await pool.query(orderQuery, [orderId]);

    if (orderResult.rows.length === 0) {
      return res.status(404).send('<h1>Invoice Not Found</h1><p>The specified order details do not exist.</p>');
    }

    const order = orderResult.rows[0];

    const itemsQuery = 'SELECT * FROM order_items WHERE order_id = $1';
    const itemsResult = await pool.query(itemsQuery, [orderId]);
    const items = itemsResult.rows.map(item => ({
      ...item,
      addons: typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons
    }));

    // Perform tax back-calculation (GST is 18% inclusive in the catalog prices)
    const gstRate = 0.18;
    const calcSubtotal = parseFloat(order.items_subtotal);
    const calcAddons = parseFloat(order.addons_subtotal);
    const calcDelivery = parseFloat(order.delivery_total);
    const calcGrand = parseFloat(order.grand_total);

    // Items and Addons are GST items, delivery can be considered service (GST inclusive or exempt, let's treat all inclusive for simpler compliance)
    const grossPrice = calcSubtotal + calcAddons + calcDelivery;
    const taxableValue = grossPrice / (1 + gstRate);
    const totalGst = grossPrice - taxableValue;
    const cgst = totalGst / 2;
    const sgst = totalGst / 2;

    const formattedDate = new Date(order.created_at).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Determine HSN code depending on category defaults
    const getHSN = (title = '') => {
      const lower = title.toLowerCase();
      if (lower.includes('cake')) return '1905'; // Bakery
      if (lower.includes('chocolate')) return '1806'; // Chocolates
      if (lower.includes('plant')) return '0602'; // Live Plants
      return '0603'; // Cut flowers & arrangements (Flower Studio standard)
    };

    // Render HTML
    let tableRows = '';
    let counter = 1;

    for (const item of items) {
      const itemPrice = parseFloat(item.price);
      const itemGst = itemPrice - (itemPrice / (1 + gstRate));
      const itemTaxable = itemPrice - itemGst;

      tableRows += `
        <tr>
          <td>${counter++}</td>
          <td class="desc">
            <strong>${item.product_title}</strong>
            ${item.delivery_slot ? `<br><small class="text-muted">Delivery Slot: ${item.delivery_slot}</small>` : ''}
          </td>
          <td>${getHSN(item.product_title)}</td>
          <td>₹${itemTaxable.toFixed(2)}</td>
          <td>${item.quantity}</td>
          <td>9%<br><small>₹${(itemGst / 2 * item.quantity).toFixed(2)}</small></td>
          <td>9%<br><small>₹${(itemGst / 2 * item.quantity).toFixed(2)}</small></td>
          <td>₹${(itemPrice * item.quantity).toFixed(2)}</td>
        </tr>
      `;

      // Render Add-ons if present
      if (item.addons && item.addons.length > 0) {
        for (const addon of item.addons) {
          const addonPrice = parseFloat(addon.product.price);
          const addonGst = addonPrice - (addonPrice / (1 + gstRate));
          const addonTaxable = addonPrice - addonGst;

          tableRows += `
            <tr class="addon-row">
              <td></td>
              <td class="desc">🎁 Add-on: ${addon.product.title}</td>
              <td>${getHSN(addon.product.title)}</td>
              <td>₹${addonTaxable.toFixed(2)}</td>
              <td>${addon.quantity}</td>
              <td>9%<br><small>₹${(addonGst / 2 * addon.quantity).toFixed(2)}</small></td>
              <td>9%<br><small>₹${(addonGst / 2 * addon.quantity).toFixed(2)}</small></td>
              <td>₹${(addonPrice * addon.quantity).toFixed(2)}</td>
            </tr>
          `;
        }
      }
    }

    // Add delivery charges as a row if > 0
    if (calcDelivery > 0) {
      const delGst = calcDelivery - (calcDelivery / (1 + gstRate));
      const delTaxable = calcDelivery - delGst;
      tableRows += `
        <tr>
          <td>${counter++}</td>
          <td class="desc">🚚 Delivery Slot Shipping Charges</td>
          <td>9965</td>
          <td>₹${delTaxable.toFixed(2)}</td>
          <td>1</td>
          <td>9%<br><small>₹${(delGst / 2).toFixed(2)}</small></td>
          <td>9%<br><small>₹${(delGst / 2).toFixed(2)}</small></td>
          <td>₹${calcDelivery.toFixed(2)}</td>
        </tr>
      `;
    }

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Flower Studio - Tax Invoice - ${order.id}</title>
  <style>
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      color: #2b2d42;
      margin: 0;
      padding: 30px;
      font-size: 14px;
      line-height: 1.5;
      background-color: #f7f9fa;
    }
    .invoice-card {
      max-width: 850px;
      margin: 0 auto;
      background: #ffffff;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
      border: 1px solid #eaeef2;
    }
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    .header-table td {
      vertical-align: top;
    }
    .logo-container h1 {
      margin: 0;
      color: #6e0d25;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .logo-container p {
      margin: 4px 0 0 0;
      font-size: 12px;
      color: #8d99ae;
      text-transform: uppercase;
      font-weight: 600;
    }
    .company-details {
      text-align: right;
      font-size: 12px;
      color: #5d6778;
    }
    .invoice-title {
      font-size: 20px;
      font-weight: 700;
      color: #6e0d25;
      margin-bottom: 20px;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-bottom: 2px solid #6e0d25;
      padding-bottom: 8px;
    }
    .meta-table {
      width: 100%;
      margin-bottom: 30px;
    }
    .meta-table td {
      width: 50%;
      vertical-align: top;
    }
    .meta-block {
      background: #faf6f0;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #eee7dd;
      height: 110px;
    }
    .meta-block h3 {
      margin: 0 0 8px 0;
      font-size: 12px;
      text-transform: uppercase;
      color: #6e0d25;
      font-weight: bold;
    }
    .meta-block p {
      margin: 3px 0;
      font-size: 13px;
      color: #333333;
    }
    .meta-block strong {
      color: #2b2d42;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    .items-table th {
      background-color: #6e0d25;
      color: #ffffff;
      text-align: left;
      padding: 10px;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .items-table td {
      padding: 12px 10px;
      border-bottom: 1px solid #eaeef2;
      vertical-align: middle;
      font-size: 13px;
    }
    .items-table tr.addon-row td {
      background-color: #fafbfc;
      font-style: italic;
      color: #555555;
      padding-top: 8px;
      padding-bottom: 8px;
    }
    .items-table td.desc {
      max-width: 250px;
    }
    .items-table .text-muted {
      font-size: 11px;
      color: #8d99ae;
    }
    .summary-section {
      float: right;
      width: 320px;
      margin-bottom: 30px;
    }
    .summary-table {
      width: 100%;
      border-collapse: collapse;
    }
    .summary-table td {
      padding: 6px 10px;
      font-size: 13px;
    }
    .summary-table tr.total-row td {
      border-top: 2px solid #6e0d25;
      font-size: 16px;
      font-weight: bold;
      color: #6e0d25;
      padding-top: 10px;
    }
    .clear {
      clear: both;
    }
    .invoice-footer {
      border-top: 1px solid #eaeef2;
      padding-top: 20px;
      text-align: center;
      font-size: 11px;
      color: #8d99ae;
    }
    .actions-bar {
      max-width: 850px;
      margin: 0 auto 20px auto;
      text-align: right;
    }
    .btn {
      background-color: #6e0d25;
      color: white;
      border: none;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: bold;
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(110, 13, 37, 0.2);
    }
    .btn:hover {
      background-color: #570a1d;
    }
    @media print {
      body {
        background-color: white;
        padding: 0;
      }
      .invoice-card {
        box-shadow: none;
        border: none;
        padding: 0;
      }
      .actions-bar {
        display: none;
      }
    }
  </style>
</head>
<body>

  <div class="actions-bar">
    <button class="btn" onclick="window.print()">Print / Download PDF</button>
  </div>

  <div class="invoice-card">
    <table class="header-table">
      <tr>
        <td class="logo-container">
          <h1>Flower Studio</h1>
          <p>Luxurious Blooms & Handcrafted Gifts</p>
        </td>
        <td class="company-details">
          <strong>FLOWER STUDIO PVT. LTD.</strong><br>
          GSTIN: 07AAACF8418K1ZM<br>
          Regd. Office: Sector 29D, Chandigarh<br>
          Pincode - 160030, India<br>
          support@flowerstudio.com
        </td>
      </tr>
    </table>

    <div class="invoice-title">Tax Invoice / Receipt</div>

    <table class="meta-table">
      <tr>
        <td style="padding-right: 10px;">
          <div class="meta-block">
            <h3>Invoice Details</h3>
            <p><strong>Invoice No:</strong> FS-INV-${order.id.split('-')[1] || order.id.slice(-6)}</p>
            <p><strong>Order ID:</strong> ${order.id}</p>
            <p><strong>Date:</strong> ${formattedDate}</p>
          </div>
        </td>
        <td style="padding-left: 10px;">
          <div class="meta-block">
            <h3>Recipient / Delivery Details</h3>
            <p><strong>Name:</strong> ${order.recipient_name}</p>
            <p><strong>Phone:</strong> +91 ${order.recipient_phone}</p>
            <p style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              <strong>Address:</strong> ${order.delivery_address}
            </p>
          </div>
        </td>
      </tr>
    </table>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 5%">#</th>
          <th style="width: 40%">Items & Description</th>
          <th style="width: 10%">HSN</th>
          <th style="width: 10%">Taxable Value</th>
          <th style="width: 5%">Qty</th>
          <th style="width: 10%">CGST</th>
          <th style="width: 10%">SGST</th>
          <th style="width: 10%">Gross Total</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>

    <div class="summary-section">
      <table class="summary-table">
        <tr>
          <td>Taxable Value Subtotal:</td>
          <td style="text-align: right;">₹${taxableValue.toFixed(2)}</td>
        </tr>
        <tr>
          <td>CGST Subtotal (9%):</td>
          <td style="text-align: right;">₹${cgst.toFixed(2)}</td>
        </tr>
        <tr>
          <td>SGST Subtotal (9%):</td>
          <td style="text-align: right;">₹${sgst.toFixed(2)}</td>
        </tr>
        <tr>
          <td>Total Tax Amount (18%):</td>
          <td style="text-align: right;">₹${totalGst.toFixed(2)}</td>
        </tr>
        <tr class="total-row">
          <td>Grand Total:</td>
          <td style="text-align: right;">₹${calcGrand.toFixed(2)}</td>
        </tr>
        <tr>
          <td colspan="2" style="font-size: 11px; text-align: right; color: #8d99ae; padding-top: 10px;">
            Payment Method: <strong>${order.payment_method.toUpperCase()}</strong> (${order.payment_status.toUpperCase()})
            ${order.razorpay_payment_id ? `<br>Txn Ref: <strong>${order.razorpay_payment_id}</strong>` : ''}
          </td>
        </tr>
      </table>
    </div>
    
    <div class="clear"></div>

    <div class="invoice-footer">
      <p>Thank you for shopping with Flower Studio! To track or modify your gift deliveries, contact support@flowerstudio.com</p>
      <p>This is a computer-generated document and requires no physical signatures.</p>
    </div>
  </div>

</body>
</html>
    `;

    return res.status(200).send(htmlContent);

  } catch (error) {
    console.error('Error generating receipt invoice page:', error);
    return res.status(500).send('<h1>Internal Server Error</h1><p>Could not build the invoice page.</p>');
  }
};

/**
 * Get Order Payment Status (for polling)
 * GET /api/orders/:orderId/status
 */
export const getOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await pool.query('SELECT payment_status FROM orders WHERE id = $1', [orderId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    return res.status(200).json({ success: true, payment_status: result.rows[0].payment_status });
  } catch (error) {
    console.error('Error checking order status:', error);
    return res.status(500).json({ success: false, message: 'Error checking status.' });
  }
};

/**
 * Render Mock Hosted Checkout Page
 * GET /api/orders/mock-checkout/:orderId
 */
export const getMockCheckout = async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (result.rows.length === 0) {
      return res.status(404).send('<h1>Order not found</h1>');
    }
    const order = result.rows[0];

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Razorpay - Secured hosted Checkout</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #0c132e;
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #141d3d;
      padding: 30px;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      width: 400px;
      text-align: center;
    }
    .logo {
      color: #0e5bff;
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 20px;
    }
    .btn {
      background-color: #0e5bff;
      color: white;
      border: none;
      padding: 12px 20px;
      width: 100%;
      border-radius: 8px;
      font-weight: bold;
      cursor: pointer;
      margin-top: 16px;
    }
    .btn-secondary {
      background-color: transparent;
      border: 1px solid #ff4d4d;
      color: #ff4d4d;
      margin-top: 10px;
    }
    .details {
      margin: 20px 0;
      text-align: left;
      font-size: 14px;
      color: #b0b8db;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">razorpay</div>
    <h3>Flower Studio Hosted Payment Portal</h3>
    <p>Simulating secure hosted checkout page</p>
    
    <div class="details">
      <div class="row"><strong>Order ID:</strong> <span>${order.id}</span></div>
      <div class="row"><strong>Customer:</strong> <span>${order.recipient_name}</span></div>
      <div class="row"><strong>Phone:</strong> <span>${order.recipient_phone}</span></div>
      <div class="row"><strong>Amount:</strong> <span style="color:#0e5bff;font-weight:bold;">₹${parseFloat(order.grand_total).toFixed(2)}</span></div>
    </div>
    
    <form action="/api/orders/callback" method="GET">
      <input type="hidden" name="razorpay_payment_link_id" value="plink_sim_${orderId.slice(-6)}">
      <input type="hidden" name="razorpay_payment_link_reference_id" value="${order.id}">
      <input type="hidden" name="razorpay_payment_link_status" value="paid">
      <input type="hidden" name="razorpay_payment_id" value="pay_sim_${Math.random().toString(36).substr(2, 9)}">
      <input type="hidden" name="razorpay_signature" value="simulated_signature_ok">
      <input type="hidden" name="isSimulated" value="true">
      <button class="btn" type="submit">AUTHORIZE SECURE PAYMENT</button>
    </form>
    
    <button class="btn btn-secondary" onclick="window.close();">CANCEL PAYMENT</button>
  </div>
</body>
</html>
    `;
    return res.status(200).send(htmlContent);
  } catch (error) {
    console.error('Error serving mock checkout:', error);
    return res.status(500).send('<h1>Server error loading checkout</h1>');
  }
};

/**
 * Handle Razorpay Hosted Payment Callback
 * GET /api/orders/callback
 */
export const paymentCallback = async (req, res) => {
  const {
    razorpay_payment_id,
    razorpay_payment_link_id,
    razorpay_payment_link_reference_id,
    razorpay_payment_link_status,
    razorpay_signature,
    isSimulated
  } = req.query;

  const orderId = razorpay_payment_link_reference_id;

  try {
    const orderCheck = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderCheck.rows.length === 0) {
      return res.status(404).send('<h1>Order not found</h1>');
    }

    const order = orderCheck.rows[0];

    // Verification
    if (isSimulated === 'true' || !razorpay || razorpay_signature === 'simulated_signature_ok') {
      // Update database
      await pool.query(
        `UPDATE orders 
         SET payment_status = 'paid', razorpay_payment_id = $1, razorpay_signature = $2, delivery_status = 'handcrafting'
         WHERE id = $3`,
        [razorpay_payment_id || 'pay_sim', razorpay_signature || 'sim_sig', orderId]
      );
    } else {
      // Verify Real Payment Link signature: 
      // text is: payment_link_id + '|' + reference_id + '|' + status + '|' + payment_id
      const text = razorpay_payment_link_id + '|' + razorpay_payment_link_reference_id + '|' + razorpay_payment_link_status + '|' + razorpay_payment_id;
      const expectedSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text.toString())
        .digest('hex');

      if (expectedSig === razorpay_signature && razorpay_payment_link_status === 'paid') {
        await pool.query(
          `UPDATE orders 
           SET payment_status = 'paid', razorpay_payment_id = $1, razorpay_signature = $2, delivery_status = 'handcrafting'
           WHERE id = $3`,
          [razorpay_payment_id, razorpay_signature, orderId]
        );
      } else {
        await pool.query("UPDATE orders SET payment_status = 'failed' WHERE id = $1", [orderId]);
        return res.status(400).send('<h1>Payment Verification Failed</h1>');
      }
    }

    // Render Success Web page
    const htmlSuccess = `
<!DOCTYPE html>
<html>
<head>
  <title>Payment Successful</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      text-align: center;
      background-color: #faf6f0;
      color: #2b2d42;
      padding-top: 100px;
    }
    .container {
      background: white;
      max-width: 500px;
      margin: 0 auto;
      padding: 40px;
      border-radius: 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.05);
      border: 1px solid #eeeeee;
    }
    .icon {
      color: #2d6a4f;
      font-size: 64px;
      margin-bottom: 20px;
    }
    .btn {
      background-color: #6e0d25;
      color: white;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: bold;
      display: inline-block;
      margin-top: 30px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✔</div>
    <h2>Payment Completed Successfully!</h2>
    <p>Your payment for Order <strong>${orderId}</strong> was verified and processed.</p>
    <p>You can close this tab/window and return to the Flower Studio app.</p>
    <button class="btn" onclick="window.close();">CLOSE WINDOW</button>
  </div>
</body>
</html>
    `;
    return res.status(200).send(htmlSuccess);

  } catch (error) {
    console.error('Error verifying callback payment:', error);
    return res.status(500).send('<h1>Internal Server Error confirming payment</h1>');
  }
};

// =========================================================================
// INTERNAL OPERATIONS ENDPOINTS (ADMIN & SUPERVISOR REST API)
// =========================================================================

// Retrieve all regular orders with items
export const getAllOrders = async (req, res) => {
  const queryText = `
    SELECT o.id, o.recipient_name AS "recipientName", o.recipient_phone AS "recipientPhone",
           o.delivery_address AS "deliveryAddress", o.gift_message AS "giftMessage",
           o.items_subtotal AS "itemsSubtotal", o.addons_subtotal AS "addonsSubtotal",
           o.delivery_total AS "deliveryTotal", o.grand_total AS "grandTotal",
           o.payment_method AS "paymentMethod", o.payment_status AS "paymentStatus",
           o.delivery_status AS "deliveryStatus", o.created_at AS "createdAt",
           COALESCE(
             json_agg(
               json_build_object(
                 'productId', oi.product_id,
                 'productImage', oi.product_image,
                 'productName', oi.product_title,
                 'quantity', oi.quantity,
                 'price', oi.price,
                 'deliveryDate', oi.delivery_date,
                 'deliverySlot', oi.delivery_slot,
                 'addons', oi.addons
               )
             ) FILTER (WHERE oi.id IS NOT NULL),
             '[]'
           ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    GROUP BY o.id
    ORDER BY o.created_at DESC;
  `;

  try {
    const result = await pool.query(queryText);
    
    // Map order fields to match frontend properties
    const mapped = result.rows.map(row => ({
      id: row.id,
      customerName: row.recipientName,
      customerEmail: row.recipientName.toLowerCase().replace(/\s+/g, '') + '@example.com',
      totalAmount: parseFloat(row.grandTotal),
      orderDate: row.createdAt,
      status: row.paymentStatus === 'paid' || row.paymentStatus === 'success' ? 'Confirmed' : 'Pending',
      paymentStatus: row.paymentStatus === 'paid' ? 'Paid' : row.paymentStatus === 'refunded' ? 'Refunded' : 'Unpaid',
      deliveryAddress: row.deliveryAddress,
      items: row.items.map(it => ({
        productId: it.productId,
        productImage: it.productImage,
        productName: it.productName,
        quantity: parseInt(it.quantity, 10),
        price: parseFloat(it.price)
      }))
    }));

    return res.status(200).json({
      success: true,
      orders: mapped
    });
  } catch (err) {
    console.error('Error fetching all orders for admin:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve order listings.',
      error: err.message
    });
  }
};

// Manually update order status (Confirmed or Cancelled)
export const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body; // e.g. 'Confirmed' or 'Cancelled'

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status parameter is required.' });
  }

  // Map Confirmed/Cancelled status to delivery_status and payment_status in database
  const deliveryStatus = status === 'Confirmed' ? 'order confirmed' : 'cancelled';
  let paymentStatusQuery = '';
  if (status === 'Cancelled') {
    paymentStatusQuery = ", payment_status = 'refunded'";
  } else if (status === 'Confirmed') {
    paymentStatusQuery = ", payment_status = 'paid'";
  }

  try {
    const queryText = `
      UPDATE orders
      SET delivery_status = $1 ${paymentStatusQuery}
      WHERE id = $2
      RETURNING *;
    `;
    const result = await pool.query(queryText, [deliveryStatus, orderId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    return res.status(200).json({
      success: true,
      message: `Order status updated to ${status}.`,
      order: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating order status:', err);
    return res.status(500).json({ success: false, message: 'Failed to update order status.', error: err.message });
  }
};

// Manually update payment status (pending, success, Cash)
export const updateOrderPaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const { paymentStatus } = req.body; // 'pending', 'success', 'cash'

  if (!paymentStatus) {
    return res.status(400).json({ success: false, message: 'Payment status parameter is required.' });
  }

  // Convert success to 'paid' in DB, cash/pending as is
  const dbStatus = paymentStatus === 'success' ? 'paid' : paymentStatus.toLowerCase();

  try {
    const queryText = `
      UPDATE orders
      SET payment_status = $1
      WHERE id = $2
      RETURNING *;
    `;
    const result = await pool.query(queryText, [dbStatus, orderId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    return res.status(200).json({
      success: true,
      message: `Payment status updated to ${paymentStatus}.`,
      order: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating payment status:', err);
    return res.status(500).json({ success: false, message: 'Failed to update payment status.', error: err.message });
  }
};

// Update delivery status (10 specific statuses)
export const updateOrderDeliveryStatus = async (req, res) => {
  const { orderId } = req.params;
  const { deliveryStatus } = req.body; // order confirmed, shipped, dispatched, received to motherhub, received to delivery hub, out for delivery, delivery rescheduled, out for pickup, delivered, cancelled

  if (!deliveryStatus) {
    return res.status(400).json({ success: false, message: 'Delivery status parameter is required.' });
  }

  try {
    const queryText = `
      UPDATE orders
      SET delivery_status = $1
      WHERE id = $2
      RETURNING *;
    `;
    const result = await pool.query(queryText, [deliveryStatus, orderId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    return res.status(200).json({
      success: true,
      message: `Delivery status updated to ${deliveryStatus}.`,
      order: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating delivery status:', err);
    return res.status(500).json({ success: false, message: 'Failed to update delivery status.', error: err.message });
  }
};

// --- CUSTOM ORDERS CONTROLLERS ---

// Get all custom orders
export const getCustomOrders = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM custom_orders ORDER BY created_at DESC');
    const mapped = result.rows.map(row => ({
      id: row.id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      category: row.category,
      description: row.description,
      referenceImageUrl: row.reference_image_url || '',
      budget: parseFloat(row.budget),
      requiredDate: row.required_date,
      status: row.status,
      calculatedCost: row.calculated_cost ? parseFloat(row.calculated_cost) : null,
      requestedAt: row.created_at
    }));
    return res.status(200).json({ success: true, customOrders: mapped });
  } catch (err) {
    console.error('Error getting custom orders:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve custom orders.', error: err.message });
  }
};

// Create custom order request
export const createCustomOrder = async (req, res) => {
  const { customerName, customerEmail, category, description, referenceImageUrl, budget, requiredDate } = req.body;
  if (!customerName || !customerEmail || !category || !description || !budget || !requiredDate) {
    return res.status(400).json({ success: false, message: 'Missing required custom order parameters.' });
  }

  const id = 'CUST-' + Math.floor(1000 + Math.random() * 9000);

  try {
    const queryText = `
      INSERT INTO custom_orders (id, customer_name, customer_email, category, description, reference_image_url, budget, required_date, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending Review')
      RETURNING *;
    `;
    const result = await pool.query(queryText, [id, customerName, customerEmail, category, description, referenceImageUrl || null, budget, new Date(requiredDate)]);
    return res.status(201).json({ success: true, message: 'Custom order request created!', customOrder: result.rows[0] });
  } catch (err) {
    console.error('Error creating custom order:', err);
    return res.status(500).json({ success: false, message: 'Failed to create custom order.', error: err.message });
  }
};

// Update custom order status or calculated quote
export const updateCustomOrder = async (req, res) => {
  const { id } = req.params;
  const { status, calculatedCost } = req.body;

  let queryText = 'UPDATE custom_orders SET ';
  const values = [];
  let paramIndex = 1;

  if (status !== undefined) {
    queryText += 'status = $' + paramIndex + ', ';
    values.push(status);
    paramIndex++;
  }
  if (calculatedCost !== undefined) {
    queryText += 'calculated_cost = $' + paramIndex + ', ';
    values.push(calculatedCost);
    paramIndex++;
  }

  // Remove trailing comma and space
  queryText = queryText.slice(0, -2);
  queryText += ' WHERE id = $' + paramIndex + ' RETURNING *;';
  values.push(id);

  try {
    const result = await pool.query(queryText, values);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Custom order not found.' });
    }
    return res.status(200).json({ success: true, message: 'Custom order updated successfully!', customOrder: result.rows[0] });
  } catch (err) {
    console.error('Error updating custom order:', err);
    return res.status(500).json({ success: false, message: 'Failed to update custom order.', error: err.message });
  }
};

// --- REQUESTED ORDERS CONTROLLERS ---

// Get all requested orders
export const getRequestedOrders = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM requested_orders ORDER BY created_at DESC');
    const mapped = result.rows.map(row => ({
      id: row.id,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      productId: row.product_id,
      productTitle: row.product_title,
      quantity: row.quantity,
      notes: row.notes || '',
      budget: parseFloat(row.budget),
      status: row.status,
      createdAt: row.created_at
    }));
    return res.status(200).json({ success: true, requestedOrders: mapped });
  } catch (err) {
    console.error('Error getting requested orders:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve requested orders.', error: err.message });
  }
};

// Create requested order request
export const createRequestedOrder = async (req, res) => {
  const { customerName, customerEmail, productId, productTitle, quantity, notes, budget } = req.body;
  if (!customerName || !customerEmail || !productId || !productTitle || !budget) {
    return res.status(400).json({ success: false, message: 'Missing required parameters.' });
  }

  const id = 'REQ-' + Math.floor(1000 + Math.random() * 9000);

  try {
    const queryText = `
      INSERT INTO requested_orders (id, customer_name, customer_email, product_id, product_title, quantity, notes, budget, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
      RETURNING *;
    `;
    const result = await pool.query(queryText, [id, customerName, customerEmail, productId, productTitle, quantity || 1, notes || null, budget]);
    return res.status(201).json({ success: true, message: 'Requested order submitted!', requestedOrder: result.rows[0] });
  } catch (err) {
    console.error('Error creating requested order:', err);
    return res.status(500).json({ success: false, message: 'Failed to create requested order.', error: err.message });
  }
};

// Update requested order status
export const updateRequestedOrder = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required.' });
  }

  try {
    const result = await pool.query('UPDATE requested_orders SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Requested order not found.' });
    }
    return res.status(200).json({ success: true, message: 'Requested order status updated!', requestedOrder: result.rows[0] });
  } catch (err) {
    console.error('Error updating requested order:', err);
    return res.status(500).json({ success: false, message: 'Failed to update requested order status.', error: err.message });
  }
};


