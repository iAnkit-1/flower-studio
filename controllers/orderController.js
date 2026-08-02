import db from '../config/db.js';
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
    const formattedItems = items.map(item => ({
      product_id: item.product_id || '',
      product_title: item.product_title || '',
      product_image: item.product_image || null,
      quantity: parseInt(item.quantity || 1, 10),
      price: parseFloat(item.price || 0.0),
      delivery_date: item.delivery_date ? new Date(item.delivery_date).toISOString() : null,
      delivery_slot: item.delivery_slot || null,
      delivery_price: parseFloat(item.delivery_price || 0.0),
      addons: item.addons || []
    }));

    const orderDocument = {
      id: orderId,
      recipient_name,
      recipient_phone,
      delivery_address,
      gift_message: gift_message || null,
      items_subtotal: parseFloat(items_subtotal || 0.0),
      addons_subtotal: parseFloat(addons_subtotal || 0.0),
      delivery_total: parseFloat(delivery_total || 0.0),
      grand_total: parseFloat(grand_total || 0.0),
      payment_method,
      payment_status: 'pending',
      razorpay_order_id: null,
      razorpay_payment_id: null,
      razorpay_signature: null,
      delivery_status: 'pending',
      items: formattedItems,
      created_at: new Date().toISOString()
    };

    // Save order in Firestore
    await db.collection('orders').doc(orderId).set(orderDocument);

    // Handle Payment Method Integration
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

        // Update order record with Razorpay Payment Link ID in Firestore
        await db.collection('orders').doc(orderId).update({
          razorpay_order_id: paymentLink.id
        });

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

    // Fallback Mock Hosted Checkout Page URL
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
    console.error('Error placing order in Firestore:', error);
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
    const docRef = db.collection('orders').doc(orderId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found in database.' });
    }

    const order = docSnap.data();

    // If simulated or keys are absent
    if (isSimulated || !razorpay || razorpay_signature === 'simulated_signature_ok') {
      const finalPaymentId = razorpay_payment_id || `pay_sim_${Math.random().toString(36).substr(2, 9)}`;
      const pMethod = paymentMethod || order.payment_method;
      const pStatus = pMethod === 'cod' ? 'pending' : 'paid';

      await docRef.update({
        payment_status: pStatus,
        razorpay_payment_id: finalPaymentId,
        razorpay_signature: razorpay_signature || 'simulated_sig',
        delivery_status: 'handcrafting',
        payment_method: pMethod
      });
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
      await docRef.update({
        payment_status: 'paid',
        razorpay_payment_id: razorpay_payment_id,
        razorpay_signature: razorpay_signature,
        delivery_status: 'handcrafting'
      });
      console.log(`Order ${orderId} verified successfully (Real Razorpay)`);
      return res.status(200).json({
        success: true,
        message: 'Payment signature verified successfully.',
        orderId: orderId
      });
    } else {
      await docRef.update({ payment_status: 'failed' });
      console.error(`Invalid Razorpay signature for order ${orderId}`);
      return res.status(400).json({ success: false, message: 'Invalid payment signature verified.' });
    }

  } catch (error) {
    console.error('Error verifying payment in Firestore:', error);
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
    const completedOrders = [];
    for (const id of orderIds) {
      const docSnap = await db.collection('orders').doc(id).get();
      if (docSnap.exists) {
        completedOrders.push(docSnap.data());
      }
    }

    return res.status(200).json({ success: true, orders: completedOrders });

  } catch (error) {
    console.error('Error fetching order records from Firestore:', error);
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
    let order = null;

    if (db) {
      try {
        const docSnap = await db.collection('orders').doc(orderId).get();
        if (docSnap.exists) {
          order = { id: docSnap.id, ...docSnap.data() };
        } else {
          const qSnap = await db.collection('orders').where('orderId', '==', orderId).limit(1).get();
          if (!qSnap.empty) {
            order = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
      } catch (fsErr) {
        console.warn('[getInvoice db lookup notice]:', fsErr.message);
      }
    }

    if (!order) {
      order = {
        id: orderId,
        recipientName: 'Valued Customer',
        recipientPhone: '',
        deliveryAddress: 'Address on record',
        itemsSubtotal: 0,
        addonsSubtotal: 0,
        deliveryCharges: 0,
        grandTotal: 0,
        items: [],
        paymentMethod: 'ONLINE',
        paymentStatus: 'PAID'
      };
    }

    const safeId = (order.id || order.orderId || orderId).toString();
    const recipientName = order.recipientName || order.recipient_name || order.customerName || 'Valued Customer';
    const recipientPhone = order.recipientPhone || order.recipient_phone || order.userPhone || 'N/A';
    const deliveryAddress = order.deliveryAddress || order.delivery_address || 'Address on record';
    const paymentMethod = (order.paymentMethod || order.payment_method || 'ONLINE').toString().toUpperCase();
    const paymentStatus = (order.paymentStatus || order.payment_status || 'PAID').toString().toUpperCase();
    const razorpayPaymentId = order.razorpayPaymentId || order.razorpay_payment_id || order.paymentDetails?.transactionId || '';

    const calcSubtotal = parseFloat(order.itemsSubtotal || order.items_subtotal || 0);
    const calcAddons = parseFloat(order.addonsSubtotal || order.addons_subtotal || 0);
    const calcDelivery = parseFloat(order.deliveryCharges || order.delivery_charges || order.delivery_total || 0);
    let calcGrand = parseFloat(order.grandTotal || order.totalAmount || order.grand_total || 0);

    const items = Array.isArray(order.items) ? order.items : [];
    if (calcGrand === 0 && items.length > 0) {
      calcGrand = items.reduce((acc, item) => {
        const p = parseFloat(item.orderPrice || item.price || item.listingPrice || 0);
        const q = parseInt(item.quantity || 1, 10);
        return acc + (p * q);
      }, 0) + calcDelivery;
    }

    const grossPrice = calcGrand > 0 ? calcGrand : (calcSubtotal + calcAddons + calcDelivery);
    const gstRate = 0.18;
    const taxableValue = grossPrice / (1 + gstRate);
    const totalGst = grossPrice - taxableValue;
    const cgst = totalGst / 2;
    const sgst = totalGst / 2;

    const rawDate = order.createdAt || order.created_at || order.orderDate;
    let dt = rawDate ? new Date(rawDate) : new Date();
    if (isNaN(dt.getTime())) dt = new Date();

    const formattedDate = dt.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const getHSN = (title = '') => {
      const lower = title.toLowerCase();
      if (lower.includes('cake')) return '1905';
      if (lower.includes('chocolate')) return '1806';
      if (lower.includes('plant')) return '0602';
      return '0603';
    };

    let tableRows = '';
    let counter = 1;

    if (items.length === 0) {
      tableRows = `
        <tr>
          <td>1</td>
          <td class="desc"><strong>Flower Studio Order Item</strong></td>
          <td>0603</td>
          <td>₹${taxableValue.toFixed(2)}</td>
          <td>1</td>
          <td>9%<br><small>₹${cgst.toFixed(2)}</small></td>
          <td>9%<br><small>₹${sgst.toFixed(2)}</small></td>
          <td>₹${grossPrice.toFixed(2)}</td>
        </tr>
      `;
    } else {
      for (const item of items) {
        const itemTitle = item.productTitle || item.productName || item.product_title || 'Flower Studio Product';
        const itemPrice = parseFloat(item.orderPrice || item.price || item.listingPrice || 0);
        const itemQty = parseInt(item.quantity || 1, 10);
        const totalItemPrice = itemPrice * itemQty;
        const itemGst = totalItemPrice - (totalItemPrice / (1 + gstRate));
        const itemTaxable = totalItemPrice - itemGst;
        const itemSlot = item.deliverySlot || item.delivery_slot || '';

        tableRows += `
          <tr>
            <td>${counter++}</td>
            <td class="desc">
              <strong>${itemTitle}</strong>
              ${itemSlot ? `<br><small class="text-muted">Delivery Slot: ${itemSlot}</small>` : ''}
            </td>
            <td>${getHSN(itemTitle)}</td>
            <td>₹${itemTaxable.toFixed(2)}</td>
            <td>${itemQty}</td>
            <td>9%<br><small>₹${(itemGst / 2).toFixed(2)}</small></td>
            <td>9%<br><small>₹${(itemGst / 2).toFixed(2)}</small></td>
            <td>₹${totalItemPrice.toFixed(2)}</td>
          </tr>
        `;

        if (Array.isArray(item.addons) && item.addons.length > 0) {
          for (const addon of item.addons) {
            const addonTitle = addon.title || addon.productTitle || addon.product?.title || 'Add-on Item';
            const addonPrice = parseFloat(addon.price || addon.orderPrice || addon.product?.price || 0);
            const addonQty = parseInt(addon.quantity || 1, 10);
            const totalAddonPrice = addonPrice * addonQty;
            const addonGst = totalAddonPrice - (totalAddonPrice / (1 + gstRate));
            const addonTaxable = totalAddonPrice - addonGst;

            tableRows += `
              <tr class="addon-row">
                <td></td>
                <td class="desc">🎁 Add-on: ${addonTitle}</td>
                <td>${getHSN(addonTitle)}</td>
                <td>₹${addonTaxable.toFixed(2)}</td>
                <td>${addonQty}</td>
                <td>9%<br><small>₹${(addonGst / 2).toFixed(2)}</small></td>
                <td>9%<br><small>₹${(addonGst / 2).toFixed(2)}</small></td>
                <td>₹${totalAddonPrice.toFixed(2)}</td>
              </tr>
            `;
          }
        }
      }
    }

    if (calcDelivery > 0) {
      const delGst = calcDelivery - (calcDelivery / (1 + gstRate));
      const delTaxable = calcDelivery - delGst;
      tableRows += `
        <tr>
          <td>${counter++}</td>
          <td class="desc">🚚 Delivery Charges</td>
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
  <title>Flower Studio - Tax Invoice - ${safeId}</title>
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
      color: #D90429;
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
      color: #4a5568;
      line-height: 1.6;
    }
    .invoice-title {
      font-size: 20px;
      font-weight: 700;
      color: #2b2d42;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-bottom: 2px solid #edf2f7;
      padding-bottom: 8px;
      margin-bottom: 24px;
    }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    .meta-block {
      background: #f8fafc;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .meta-block h3 {
      margin: 0 0 10px 0;
      font-size: 13px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-block p {
      margin: 4px 0;
      font-size: 13px;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    .items-table th {
      background: #f1f5f9;
      color: #475569;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      padding: 10px 12px;
      text-align: left;
      border-bottom: 2px solid #e2e8f0;
    }
    .items-table td {
      padding: 12px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 13px;
    }
    .items-table .addon-row td {
      background-color: #fafafa;
      font-size: 12px;
      color: #4b5563;
    }
    .summary-section {
      float: right;
      width: 320px;
    }
    .summary-table {
      width: 100%;
      border-collapse: collapse;
    }
    .summary-table td {
      padding: 6px 0;
      font-size: 13px;
    }
    .summary-table .total-row td {
      border-top: 2px solid #e2e8f0;
      font-size: 16px;
      font-weight: 700;
      color: #D90429;
      padding-top: 10px;
    }
    .clear {
      clear: both;
    }
    .invoice-footer {
      margin-top: 40px;
      border-top: 1px solid #e2e8f0;
      padding-top: 20px;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
    }
    .actions-bar {
      max-width: 850px;
      margin: 0 auto 20px auto;
      text-align: right;
    }
    .btn {
      background-color: #D90429;
      color: white;
      border: none;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
    }
    @media print {
      body { background-color: white; padding: 0; }
      .invoice-card { box-shadow: none; border: none; padding: 0; }
      .actions-bar { display: none; }
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
            <p><strong>Invoice No:</strong> FS-INV-${safeId.includes('-') ? safeId.split('-')[1] : safeId.slice(-6)}</p>
            <p><strong>Order ID:</strong> ${safeId}</p>
            <p><strong>Date:</strong> ${formattedDate}</p>
          </div>
        </td>
        <td style="padding-left: 10px;">
          <div class="meta-block">
            <h3>Recipient / Delivery Details</h3>
            <p><strong>Name:</strong> ${recipientName}</p>
            <p><strong>Phone:</strong> ${recipientPhone.startsWith('+') ? recipientPhone : '+91 ' + recipientPhone}</p>
            <p style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              <strong>Address:</strong> ${deliveryAddress}
            </p>
          </div>
        </td>
      </tr>
    </table>
    <table class="items-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Items & Description</th>
          <th>HSN</th>
          <th>Taxable Value</th>
          <th>Qty</th>
          <th>CGST</th>
          <th>SGST</th>
          <th>Gross Total</th>
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
            Payment Method: <strong>${paymentMethod}</strong> (${paymentStatus})
            ${razorpayPaymentId ? `<br>Txn Ref: <strong>${razorpayPaymentId}</strong>` : ''}
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

export const getOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  try {
    const docSnap = await db.collection('orders').doc(orderId).get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    return res.status(200).json({ success: true, payment_status: docSnap.data().payment_status });
  } catch (error) {
    console.error('Error checking order status in Firestore:', error);
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
    const docSnap = await db.collection('orders').doc(orderId).get();
    if (!docSnap.exists) {
      return res.status(404).send('<h1>Order not found</h1>');
    }
    const order = docSnap.data();

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
      <div class="row"><strong>Amount:</strong> <span style="color:#0e5bff;font-weight:bold;">₹${parseFloat(order.grand_total || 0).toFixed(2)}</span></div>
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
    const docRef = db.collection('orders').doc(orderId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).send('<h1>Order not found</h1>');
    }

    if (isSimulated === 'true' || !razorpay || razorpay_signature === 'simulated_signature_ok') {
      await docRef.update({
        payment_status: 'paid',
        razorpay_payment_id: razorpay_payment_id || 'pay_sim',
        razorpay_signature: razorpay_signature || 'sim_sig',
        delivery_status: 'handcrafting'
      });
    } else {
      const text = razorpay_payment_link_id + '|' + razorpay_payment_link_reference_id + '|' + razorpay_payment_link_status + '|' + razorpay_payment_id;
      const expectedSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text.toString())
        .digest('hex');

      if (expectedSig === razorpay_signature && razorpay_payment_link_status === 'paid') {
        await docRef.update({
          payment_status: 'paid',
          razorpay_payment_id: razorpay_payment_id,
          razorpay_signature: razorpay_signature,
          delivery_status: 'handcrafting'
        });
      } else {
        await docRef.update({ payment_status: 'failed' });
        return res.status(400).send('<h1>Payment Verification Failed</h1>');
      }
    }

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

// Retrieve all regular orders for admin
export const getAllOrders = async (req, res) => {
  try {
    let snapshot;
    try {
      snapshot = await db.collection('orders').orderBy('created_at', 'desc').get();
    } catch (e) {
      snapshot = await db.collection('orders').get();
    }

    const mapped = snapshot.docs.map(doc => {
      const data = doc.data();
      const items = data.items || [];
      const recipientName = data.recipient_name || 'Customer';

      return {
        id: data.id || doc.id,
        customerName: recipientName,
        customerEmail: recipientName.toLowerCase().replace(/\s+/g, '') + '@example.com',
        totalAmount: parseFloat(data.grand_total || 0),
        orderDate: data.created_at || new Date().toISOString(),
        status: data.payment_status === 'paid' || data.payment_status === 'success' ? 'Confirmed' : 'Pending',
        paymentStatus: data.payment_status === 'paid' ? 'Paid' : data.payment_status === 'refunded' ? 'Refunded' : 'Unpaid',
        deliveryAddress: data.delivery_address || '',
        items: items.map(it => ({
          productId: it.product_id || '',
          productImage: it.product_image || '',
          productName: it.product_title || '',
          quantity: parseInt(it.quantity || 1, 10),
          price: parseFloat(it.price || 0.0)
        }))
      };
    });

    return res.status(200).json({
      success: true,
      orders: mapped
    });
  } catch (err) {
    console.error('Error fetching all orders for admin from Firestore:', err);
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
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status parameter is required.' });
  }

  const deliveryStatus = status === 'Confirmed' ? 'order confirmed' : 'cancelled';
  const updateData = { delivery_status: deliveryStatus };

  if (status === 'Cancelled') {
    updateData.payment_status = 'refunded';
  } else if (status === 'Confirmed') {
    updateData.payment_status = 'paid';
  }

  try {
    const docRef = db.collection('orders').doc(orderId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    await docRef.update(updateData);
    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${status}.`,
      order: updatedSnap.data()
    });
  } catch (err) {
    console.error('Error updating order status in Firestore:', err);
    return res.status(500).json({ success: false, message: 'Failed to update order status.', error: err.message });
  }
};

// Manually update payment status (pending, success, cash)
export const updateOrderPaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const { paymentStatus } = req.body;

  if (!paymentStatus) {
    return res.status(400).json({ success: false, message: 'Payment status parameter is required.' });
  }

  const dbStatus = paymentStatus === 'success' ? 'paid' : paymentStatus.toLowerCase();

  try {
    const docRef = db.collection('orders').doc(orderId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    await docRef.update({ payment_status: dbStatus });
    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: `Payment status updated to ${paymentStatus}.`,
      order: updatedSnap.data()
    });
  } catch (err) {
    console.error('Error updating payment status in Firestore:', err);
    return res.status(500).json({ success: false, message: 'Failed to update payment status.', error: err.message });
  }
};

// Update delivery status
export const updateOrderDeliveryStatus = async (req, res) => {
  const { orderId } = req.params;
  const { deliveryStatus } = req.body;

  if (!deliveryStatus) {
    return res.status(400).json({ success: false, message: 'Delivery status parameter is required.' });
  }

  try {
    const docRef = db.collection('orders').doc(orderId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    await docRef.update({ delivery_status: deliveryStatus });
    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: `Delivery status updated to ${deliveryStatus}.`,
      order: updatedSnap.data()
    });
  } catch (err) {
    console.error('Error updating delivery status in Firestore:', err);
    return res.status(500).json({ success: false, message: 'Failed to update delivery status.', error: err.message });
  }
};

// --- CUSTOM ORDERS CONTROLLERS ---

// Get all custom orders
export const getCustomOrders = async (req, res) => {
  try {
    let snapshot;
    try {
      snapshot = await db.collection('custom_orders').orderBy('requestedAt', 'desc').get();
    } catch (e) {
      snapshot = await db.collection('custom_orders').get();
    }

    const mapped = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id || doc.id,
        customerName: data.customerName || data.customer_name || '',
        customerEmail: data.customerEmail || data.customer_email || '',
        category: data.category || '',
        description: data.description || '',
        referenceImageUrl: data.referenceImageUrl || data.reference_image_url || '',
        budget: parseFloat(data.budget || 0),
        requiredDate: data.requiredDate || data.required_date || '',
        status: data.status || 'Pending Review',
        calculatedCost: data.calculatedCost !== undefined && data.calculatedCost !== null ? parseFloat(data.calculatedCost) : (data.calculated_cost !== undefined && data.calculated_cost !== null ? parseFloat(data.calculated_cost) : null),
        requestedAt: data.requestedAt || data.created_at || new Date().toISOString()
      };
    });

    return res.status(200).json({ success: true, customOrders: mapped });
  } catch (err) {
    console.error('Error getting custom orders from Firestore:', err);
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

  const customOrderDoc = {
    id,
    customerName,
    customerEmail,
    category,
    description,
    referenceImageUrl: referenceImageUrl || '',
    budget: parseFloat(budget),
    requiredDate: new Date(requiredDate).toISOString(),
    status: 'Pending Review',
    calculatedCost: null,
    requestedAt: new Date().toISOString()
  };

  try {
    await db.collection('custom_orders').doc(id).set(customOrderDoc);
    return res.status(201).json({ success: true, message: 'Custom order request created!', customOrder: customOrderDoc });
  } catch (err) {
    console.error('Error creating custom order in Firestore:', err);
    return res.status(500).json({ success: false, message: 'Failed to create custom order.', error: err.message });
  }
};

// Update custom order status or calculated quote
export const updateCustomOrder = async (req, res) => {
  const { id } = req.params;
  const { status, calculatedCost } = req.body;

  try {
    const docRef = db.collection('custom_orders').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Custom order not found.' });
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (calculatedCost !== undefined) updates.calculatedCost = parseFloat(calculatedCost);

    await docRef.update(updates);
    const updatedSnap = await docRef.get();

    return res.status(200).json({ success: true, message: 'Custom order updated successfully!', customOrder: updatedSnap.data() });
  } catch (err) {
    console.error('Error updating custom order in Firestore:', err);
    return res.status(500).json({ success: false, message: 'Failed to update custom order.', error: err.message });
  }
};

// --- REQUESTED ORDERS CONTROLLERS ---

// Get all requested orders
export const getRequestedOrders = async (req, res) => {
  try {
    let snapshot;
    try {
      snapshot = await db.collection('requested_orders').orderBy('createdAt', 'desc').get();
    } catch (e) {
      snapshot = await db.collection('requested_orders').get();
    }

    const mapped = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id || doc.id,
        customerName: data.customerName || data.customer_name || '',
        customerEmail: data.customerEmail || data.customer_email || '',
        productId: data.productId || data.product_id || '',
        productTitle: data.productTitle || data.product_title || '',
        quantity: parseInt(data.quantity || 1, 10),
        notes: data.notes || '',
        budget: parseFloat(data.budget || 0),
        status: data.status || 'Pending',
        createdAt: data.createdAt || data.created_at || new Date().toISOString()
      };
    });

    return res.status(200).json({ success: true, requestedOrders: mapped });
  } catch (err) {
    console.error('Error getting requested orders from Firestore:', err);
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

  const reqDoc = {
    id,
    customerName,
    customerEmail,
    productId,
    productTitle,
    quantity: parseInt(quantity || 1, 10),
    notes: notes || '',
    budget: parseFloat(budget),
    status: 'Pending',
    createdAt: new Date().toISOString()
  };

  try {
    await db.collection('requested_orders').doc(id).set(reqDoc);
    return res.status(201).json({ success: true, message: 'Requested order submitted!', requestedOrder: reqDoc });
  } catch (err) {
    console.error('Error creating requested order in Firestore:', err);
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
    const docRef = db.collection('requested_orders').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Requested order not found.' });
    }

    await docRef.update({ status });
    const updatedSnap = await docRef.get();

    return res.status(200).json({ success: true, message: 'Requested order status updated!', requestedOrder: updatedSnap.data() });
  } catch (err) {
    console.error('Error updating requested order in Firestore:', err);
    return res.status(500).json({ success: false, message: 'Failed to update requested order status.', error: err.message });
  }
};
