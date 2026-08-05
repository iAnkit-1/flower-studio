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
  console.warn('Razorpay keys not configured. Operating in simulation mode.');
}

/**
 * Create Order (Server-Side Price Validation & Razorpay Order Creation)
 * POST /api/orders or POST /api/payments/create-order
 */
export const createOrder = async (req, res) => {
  const {
    recipient_name,
    recipient_phone,
    delivery_address,
    gift_message,
    items,
    items_subtotal_listing,
    itemsSubtotalListing,
    items_subtotal,
    itemsSubtotal,
    total_discount,
    totalDiscount,
    addons_subtotal,
    delivery_total,
    grand_total,
    payment_method,
  } = req.body;

  if (!recipient_name || !recipient_phone || !delivery_address || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Required order details (recipient_name, phone, address, items) are missing.' });
  }

  // Generate unique order ID
  const randNum = Math.floor(100000 + Math.random() * 900000);
  const orderId = `FS-${Date.now().toString().slice(-6)}-${randNum}`;

  try {
    let validatedSubtotal = 0.0;
    let validatedListingSubtotal = 0.0;
    let validatedDiscount = 0.0;
    const validatedItems = [];

    // Server-Side Price Calculation & Validation against Firestore
    for (const item of items) {
      const productId = item.productId || item.product_id;
      const qty = parseInt(item.quantity || 1, 10);
      if (qty <= 0) continue;

      let unitListingPrice = parseFloat(item.listingPrice || item.price || 0.0);
      let unitOrderPrice = parseFloat(item.orderPrice || item.price || 0.0);
      let productTitle = item.productTitle || item.product_title || 'Flower Studio Product';

      if (productId && db) {
        try {
          const productSnap = await db.collection('products').doc(productId).get();
          if (productSnap.exists) {
            const prodData = productSnap.data();
            productTitle = prodData.title || productTitle;
            unitListingPrice = parseFloat(prodData.mrp || prodData.salePrice || unitListingPrice);
            unitOrderPrice = parseFloat(prodData.salePrice || unitOrderPrice);
          }
        } catch (dbErr) {
          console.warn(`[Price Validation Notice] Product lookup failed for ${productId}, using client payload:`, dbErr.message);
        }
      }

      const unitDiscount = Math.max(0.0, unitListingPrice - unitOrderPrice);
      const itemListingTotal = unitListingPrice * qty;
      const itemOrderTotal = unitOrderPrice * qty;
      const itemTotalDiscount = unitDiscount * qty;

      validatedListingSubtotal += itemListingTotal;
      validatedSubtotal += itemOrderTotal;
      validatedDiscount += itemTotalDiscount;

      validatedItems.push({
        productId: productId || '',
        productTitle: productTitle,
        category: item.category || 'flower',
        quantity: qty,
        listingPrice: unitListingPrice,
        orderPrice: unitOrderPrice,
        discount: unitDiscount,
        itemListingPrice: itemListingTotal,
        itemOrderPrice: itemOrderTotal,
        itemTotalDiscount: itemTotalDiscount,
        imageUrl: item.imageUrl || item.product_image || null,
        cakeMessage: item.cakeMessage || null,
        addons: item.addons || []
      });
    }

    const addonsSubtotalVal = parseFloat(addons_subtotal || 0.0);
    const deliveryTotalVal = parseFloat(delivery_total || 0.0);
    
    // Server-calculated grand total
    const computedGrandTotal = validatedSubtotal + addonsSubtotalVal + deliveryTotalVal;
    const finalGrandTotal = computedGrandTotal > 0 ? computedGrandTotal : parseFloat(grand_total || 0.0);

    const firstItem = items && items.length > 0 ? items[0] : {};
    const globalDeliveryDate = req.body.deliveryDate || req.body.delivery_date || firstItem.deliveryDate || firstItem.delivery_date || new Date().toISOString();
    const globalDeliverySlot = req.body.deliverySlot || req.body.delivery_slot || firstItem.deliverySlot || firstItem.delivery_slot || 'Standard Delivery';

    const deliveryDetailsObj = req.body.deliveryDetails && typeof req.body.deliveryDetails === 'object'
      ? {
          fullAddress: req.body.deliveryDetails.fullAddress || delivery_address,
          latitude: parseFloat(req.body.deliveryDetails.latitude || req.body.latitude || 25.9207997),
          longitude: parseFloat(req.body.deliveryDetails.longitude || req.body.longitude || 82.2026451),
          recipientName: req.body.deliveryDetails.recipientName || recipient_name,
          recipientPhone: req.body.deliveryDetails.recipientPhone || recipient_phone,
          deliveryDate: req.body.deliveryDetails.deliveryDate || globalDeliveryDate,
          deliverySlot: req.body.deliveryDetails.deliverySlot || globalDeliverySlot,
        }
      : {
          fullAddress: delivery_address,
          latitude: parseFloat(req.body.latitude || 25.9207997),
          longitude: parseFloat(req.body.longitude || 82.2026451),
          recipientName: recipient_name,
          recipientPhone: recipient_phone,
          deliveryDate: globalDeliveryDate,
          deliverySlot: globalDeliverySlot,
        };

    const isCod = (payment_method || '').toLowerCase() === 'cod';

    let razorpayOrderId = null;
    let amountInPaise = Math.round(finalGrandTotal * 100);

    if (!isCod && razorpay) {
      try {
        const razorpayOrder = await razorpay.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: `rcpt_${orderId.replace(/-/g, '_')}`,
          notes: {
            orderId: orderId,
            userId: req.body.userId || req.body.user_id || '',
            recipientPhone: recipient_phone,
          }
        });
        razorpayOrderId = razorpayOrder.id;
        console.log(`[Razorpay Order Created] Order ID: ${orderId} -> Razorpay Order ID: ${razorpayOrderId}`);
      } catch (rpErr) {
        console.error('Error creating Razorpay Order via SDK:', rpErr);
      }
    }

    const orderDocument = {
      id: orderId,
      orderId: orderId,
      userId: req.body.userId || req.body.user_id || `GUEST_${Date.now()}`,
      userPhone: req.body.userPhone || req.body.user_phone || recipient_phone,
      recipientName: recipient_name,
      recipientPhone: recipient_phone,
      recipient_name: recipient_name,
      recipient_phone: recipient_phone,
      deliveryAddress: delivery_address,
      delivery_address: delivery_address,
      deliveryDetails: deliveryDetailsObj,
      giftMessage: gift_message || null,
      gift_message: gift_message || null,
      itemsSubtotal: validatedListingSubtotal,
      items_subtotal: validatedListingSubtotal,
      totalDiscount: validatedDiscount,
      total_discount: validatedDiscount,
      addonsSubtotal: addonsSubtotalVal,
      addons_subtotal: addonsSubtotalVal,
      deliveryCharges: deliveryTotalVal,
      delivery_total: deliveryTotalVal,
      grandTotal: finalGrandTotal,
      grand_total: finalGrandTotal,
      currency: 'INR',
      paymentMethod: payment_method || (isCod ? 'COD' : 'ONLINE'),
      payment_method: payment_method || (isCod ? 'COD' : 'ONLINE'),
      paymentStatus: isCod ? 'PENDING_COD' : 'PENDING',
      payment_status: isCod ? 'pending_cod' : 'pending',
      orderStatus: isCod ? 'PLACED' : 'PAYMENT_PENDING',
      status: isCod ? 'PLACED' : 'PAYMENT_PENDING',
      razorpayOrderId: razorpayOrderId,
      razorpay_order_id: razorpayOrderId,
      razorpayPaymentId: null,
      razorpay_payment_id: null,
      razorpay_signature: null,
      delivery_status: 'pending',
      items: validatedItems,
      createdAt: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save order in Firestore
    await db.collection('orders').doc(orderId).set(orderDocument);

    if (isCod) {
      console.log(`COD Order Placed Successfully: ${orderId}`);
      return res.status(201).json({
        success: true,
        message: 'Order created successfully (COD).',
        orderId: orderId,
        paymentMethod: 'cod',
        grandTotal: finalGrandTotal,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Razorpay order created successfully.',
      orderId: orderId,
      razorpayOrderId: razorpayOrderId || `order_sim_${Date.now()}`,
      amount: amountInPaise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_TACOfiOWpIflBg',
      grandTotal: finalGrandTotal,
      isSimulated: !razorpayOrderId,
    });

  } catch (error) {
    console.error('Error placing order in Firestore:', error);
    return res.status(500).json({ success: false, message: 'Failed to create order on server.' });
  }
};

/**
 * Verify Payment Signature (Client Callback Verification)
 * POST /api/orders/verify or POST /api/payments/verify
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

    // Idempotency check: If already marked PAID, return success immediately
    if (order.paymentStatus === 'PAID' || order.payment_status === 'paid') {
      console.log(`Order ${orderId} already verified and marked as PAID.`);
      return res.status(200).json({
        success: true,
        message: 'Payment already verified.',
        orderId: orderId,
      });
    }

    // Simulated verification or fallback mode
    if (isSimulated || !process.env.RAZORPAY_KEY_SECRET || razorpay_signature === 'simulated_signature_ok') {
      const finalPaymentId = razorpay_payment_id || `pay_sim_${Math.random().toString(36).substr(2, 9)}`;
      const pMethod = paymentMethod || order.paymentMethod || 'ONLINE';

      await docRef.update({
        paymentStatus: 'PAID',
        payment_status: 'paid',
        orderStatus: 'CONFIRMED',
        status: 'CONFIRMED',
        razorpayPaymentId: finalPaymentId,
        razorpay_payment_id: finalPaymentId,
        razorpay_signature: razorpay_signature || 'simulated_sig',
        delivery_status: 'handcrafting',
        paymentMethod: pMethod,
        payment_method: pMethod,
        updatedAt: new Date().toISOString()
      });

      console.log(`Order ${orderId} verified successfully (simulated/fallback mode)`);
      return res.status(200).json({
        success: true,
        message: 'Payment verified successfully (Simulated mode).',
        orderId: orderId
      });
    }

    // Verify Real Razorpay Signature using HMAC SHA-256
    const rzpOrderId = razorpay_order_id || order.razorpayOrderId || order.razorpay_order_id;
    const dataToVerify = rzpOrderId + '|' + razorpay_payment_id;
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(dataToVerify.toString())
      .digest('hex');

    if (generatedSignature === razorpay_signature) {
      await docRef.update({
        paymentStatus: 'PAID',
        payment_status: 'paid',
        orderStatus: 'CONFIRMED',
        status: 'CONFIRMED',
        razorpayPaymentId: razorpay_payment_id,
        razorpay_payment_id: razorpay_payment_id,
        razorpay_signature: razorpay_signature,
        delivery_status: 'handcrafting',
        updatedAt: new Date().toISOString()
      });

      console.log(`Order ${orderId} verified successfully via HMAC SHA-256 Signature!`);
      return res.status(200).json({
        success: true,
        message: 'Payment signature verified successfully.',
        orderId: orderId
      });
    } else {
      await docRef.update({
        paymentStatus: 'FAILED',
        payment_status: 'failed',
        orderStatus: 'PAYMENT_FAILED',
        status: 'PAYMENT_FAILED',
        updatedAt: new Date().toISOString()
      });
      console.error(`Invalid Razorpay signature for order ${orderId}`);
      return res.status(400).json({ success: false, message: 'Invalid payment signature.' });
    }

  } catch (error) {
    console.error('Error verifying payment in Firestore:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error during verification.' });
  }
};

/**
 * Handle Webhook Events from Razorpay
 * POST /api/payments/webhook or POST /api/orders/webhook
 * Handled events:
 * - payment.authorized
 * - payment.captured
 * - payment.failed
 * - order.paid
 * - refund.created
 * - refund.processed
 * - refund.failed
 */
export const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('RAZORPAY_WEBHOOK_SECRET is not configured in server .env.');
      return res.status(500).send('Webhook secret missing in server config.');
    }

    if (!signature) {
      console.error('Missing x-razorpay-signature header in webhook request');
      return res.status(400).send('Missing signature header');
    }

    // Convert raw body Buffer or string to UTF-8 for HMAC SHA-256 computation
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Razorpay Webhook signature verification failed!', {
        received: signature,
        computed: expectedSignature
      });
      return res.status(400).send('Invalid webhook signature');
    }

    const event = JSON.parse(rawBody);
    console.log(`==================================================`);
    console.log(`[Razorpay Webhook Triggered] Event: ${event.event}`);
    console.log(`==================================================`);

    const payload = event.payload || {};

    switch (event.event) {
      case 'payment.authorized': {
        const payment = payload.payment?.entity;
        if (payment) {
          const rzpOrderId = payment.order_id;
          const paymentId = payment.id;
          await _updateOrderInFirestoreByRzpId(rzpOrderId, {
            paymentStatus: 'AUTHORIZED',
            payment_status: 'authorized',
            razorpayPaymentId: paymentId,
            razorpay_payment_id: paymentId,
            updatedAt: new Date().toISOString()
          });
        }
        break;
      }

      case 'payment.captured':
      case 'order.paid': {
        const payment = payload.payment?.entity;
        const orderEntity = payload.order?.entity;
        const rzpOrderId = payment?.order_id || orderEntity?.id;
        const paymentId = payment?.id;

        if (rzpOrderId) {
          await _updateOrderInFirestoreByRzpId(rzpOrderId, {
            paymentStatus: 'PAID',
            payment_status: 'paid',
            orderStatus: 'CONFIRMED',
            status: 'CONFIRMED',
            delivery_status: 'handcrafting',
            razorpayPaymentId: paymentId || '',
            razorpay_payment_id: paymentId || '',
            updatedAt: new Date().toISOString()
          });
        }
        break;
      }

      case 'payment.failed': {
        const payment = payload.payment?.entity;
        if (payment) {
          const rzpOrderId = payment.order_id;
          await _updateOrderInFirestoreByRzpId(rzpOrderId, {
            paymentStatus: 'FAILED',
            payment_status: 'failed',
            orderStatus: 'PAYMENT_FAILED',
            status: 'PAYMENT_FAILED',
            updatedAt: new Date().toISOString()
          });
        }
        break;
      }

      case 'refund.created':
      case 'refund.processed': {
        const refund = payload.refund?.entity;
        if (refund) {
          const paymentId = refund.payment_id;
          await _updateOrderInFirestoreByPaymentId(paymentId, {
            paymentStatus: 'REFUNDED',
            payment_status: 'refunded',
            orderStatus: 'CANCELLED',
            status: 'CANCELLED',
            refundId: refund.id,
            updatedAt: new Date().toISOString()
          });
        }
        break;
      }

      case 'refund.failed': {
        const refund = payload.refund?.entity;
        if (refund) {
          const paymentId = refund.payment_id;
          await _updateOrderInFirestoreByPaymentId(paymentId, {
            paymentStatus: 'REFUND_FAILED',
            payment_status: 'refund_failed',
            updatedAt: new Date().toISOString()
          });
        }
        break;
      }

      default:
        console.log(`[Razorpay Webhook] Unhandled event type: ${event.event}`);
    }

    return res.status(200).json({ success: true, message: `Webhook ${event.event} processed successfully.` });

  } catch (error) {
    console.error('Razorpay Webhook Processing Error:', error);
    return res.status(500).send('Internal Server Error processing webhook.');
  }
};

/**
 * Helper to update order by razorpayOrderId (Idempotent)
 */
async function _updateOrderInFirestoreByRzpId(razorpayOrderId, updatePayload) {
  if (!razorpayOrderId || !db) return;
  try {
    let snap = await db.collection('orders').where('razorpayOrderId', '==', razorpayOrderId).get();
    if (snap.empty) {
      snap = await db.collection('orders').where('razorpay_order_id', '==', razorpayOrderId).get();
    }
    for (const doc of snap.docs) {
      const data = doc.data();
      // Idempotency: Don't downgrade PAID order to FAILED or AUTHORIZED
      if (data.paymentStatus === 'PAID' && updatePayload.paymentStatus !== 'PAID' && updatePayload.paymentStatus !== 'REFUNDED') {
        console.log(`[Webhook Idempotency] Skipping status downgrade for order ${doc.id}`);
        continue;
      }
      await doc.ref.update(updatePayload);
      console.log(`[Webhook Firestore Sync] Updated order ${doc.id} (Razorpay Order ${razorpayOrderId}) -> ${updatePayload.paymentStatus}`);
    }
  } catch (e) {
    console.error(`[Webhook Firestore Error] Failed to update order by rzpOrderId ${razorpayOrderId}:`, e);
  }
}

/**
 * Helper to update order by razorpayPaymentId (Idempotent)
 */
async function _updateOrderInFirestoreByPaymentId(paymentId, updatePayload) {
  if (!paymentId || !db) return;
  try {
    let snap = await db.collection('orders').where('razorpayPaymentId', '==', paymentId).get();
    if (snap.empty) {
      snap = await db.collection('orders').where('razorpay_payment_id', '==', paymentId).get();
    }
    for (const doc of snap.docs) {
      await doc.ref.update(updatePayload);
      console.log(`[Webhook Firestore Sync] Updated order ${doc.id} (Payment ID ${paymentId}) -> ${updatePayload.paymentStatus}`);
    }
  } catch (e) {
    console.error(`[Webhook Firestore Error] Failed to update order by paymentId ${paymentId}:`, e);
  }
}


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
      snapshot = await db.collection('orders').orderBy('createdAt', 'desc').get();
    } catch (e) {
      snapshot = await db.collection('orders').get();
    }

    if (!snapshot || snapshot.empty) {
      snapshot = await db.collection('orders').get();
    }

    const mapped = snapshot.docs.map(doc => {
      const data = doc.data();
      const items = data.items || [];
      const delDetails = data.deliveryDetails || {};

      const recipientName = delDetails.recipientName || data.recipientName || data.recipient_name || data.customerName || 'Customer';
      const recipientPhone = delDetails.recipientPhone || data.recipientPhone || data.recipient_phone || data.userPhone || '';
      const fullAddress = delDetails.fullAddress || data.deliveryAddress || data.delivery_address || 'No Address Provided';

      // Derive itemsSubtotal and totalDiscount from items array
      let calcItemsSubtotal = 0.0;
      let calcTotalDiscount = 0.0;
      const mappedItems = items.map(it => {
        const img = it.productImage || it.imageUrl || it.product_image || '';
        const qty = parseInt(it.quantity || 1, 10);
        const unitListingPrice = parseFloat(it.listingPrice || 0);
        const unitOrderPrice = parseFloat(it.orderPrice || it.price || 0);
        // Support new names first, fall back to old names
        const itemListingPrice = parseFloat(it.itemListingPrice || it.itemSubtotalListingPrice || (unitListingPrice * qty));
        const itemOrderPrice = parseFloat(it.itemOrderPrice || it.itemSubtotalOrderPrice || (unitOrderPrice * qty));
        const itemTotalDiscount = parseFloat(it.itemTotalDiscount || it.discount || 0);

        calcItemsSubtotal += itemListingPrice;
        calcTotalDiscount += itemTotalDiscount;

        return {
          productId: it.productId || it.product_id || '',
          productTitle: it.productTitle || it.productName || it.product_title || '',
          productName: it.productTitle || it.productName || it.product_title || '',
          productImage: img,
          category: it.category || '',
          quantity: qty,
          listingPrice: unitListingPrice,
          orderPrice: unitOrderPrice,
          price: unitOrderPrice,
          discount: parseFloat(it.discount || 0),
          itemListingPrice: itemListingPrice,
          itemOrderPrice: itemOrderPrice,
          itemTotalDiscount: itemTotalDiscount,
          cakeMessage: it.cakeMessage || null,
          addons: it.addons || []
        };
      });

      // Prefer stored values, fall back to computed
      const finalItemsSubtotal = parseFloat(data.itemsSubtotal || calcItemsSubtotal);
      const finalTotalDiscount = parseFloat(data.totalDiscount || calcTotalDiscount);

      // Delivery date & slot — now stored in deliveryDetails
      const deliveryDate = delDetails.deliveryDate || data.deliveryDate || '';
      const deliverySlot = delDetails.deliverySlot || data.deliverySlot || '';

      return {
        orderId: data.orderId || data.id || doc.id,
        id: data.orderId || data.id || doc.id,
        userId: data.userId || '',
        userPhone: data.userPhone || '',
        createdAt: data.createdAt || data.created_at || new Date().toISOString(),
        orderStatus: data.orderStatus || data.status || data.deliveryStatus || data.delivery_status || 'PLACED',
        paymentStatus: data.paymentStatus || data.payment_status || 'PENDING_COD',
        paymentMethod: data.paymentMethod || data.payment_method || 'COD',
        razorpayPaymentId: data.razorpayPaymentId || '',
        giftMessage: data.giftMessage || data.gift_message || '',
        itemsSubtotal: finalItemsSubtotal,
        totalDiscount: finalTotalDiscount,
        deliveryCharges: parseFloat(data.deliveryCharges || 0),
        grandTotal: parseFloat(data.grandTotal || data.grand_total || data.totalAmount || 0),
        customerEmail: data.customerEmail || (recipientName !== 'Customer' ? recipientName.toLowerCase().replace(/\s+/g, '') + '@example.com' : 'customer@example.com'),
        deliveryDetails: {
          recipientName: recipientName,
          recipientPhone: recipientPhone,
          fullAddress: fullAddress,
          latitude: delDetails.latitude || null,
          longitude: delDetails.longitude || null,
          deliveryDate: deliveryDate,
          deliverySlot: deliverySlot,
        },
        items: mappedItems
      };
    });

    mapped.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

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

// Manually update order status (Confirmed, Cancelled, Delivered, etc.)
export const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status, orderStatus } = req.body;
  const targetStatus = orderStatus || status;

  if (!targetStatus) {
    return res.status(400).json({ success: false, message: 'Status parameter is required.' });
  }

  const updateData = { orderStatus: targetStatus };

  if (targetStatus === 'Cancelled' || targetStatus === 'CANCELLED') {
    updateData.paymentStatus = 'REFUNDED';
  } else if (targetStatus === 'Confirmed' || targetStatus === 'CONFIRMED') {
    updateData.paymentStatus = 'PAID';
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
      message: `Order status updated to ${targetStatus}.`,
      order: updatedSnap.data()
    });
  } catch (err) {
    console.error('Error updating order status in Firestore:', err);
    return res.status(500).json({ success: false, message: 'Failed to update order status.', error: err.message });
  }
};

// Manually update payment status
export const updateOrderPaymentStatus = async (req, res) => {
  const { orderId } = req.params;
  const { paymentStatus, paymentMethod } = req.body;

  if (!paymentStatus) {
    return res.status(400).json({ success: false, message: 'Payment status parameter is required.' });
  }

  try {
    const docRef = db.collection('orders').doc(orderId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const updatePayload = { paymentStatus };
    if (paymentMethod) {
      updatePayload.paymentMethod = paymentMethod;
    }

    await docRef.update(updatePayload);
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

// Update delivery/order status
export const updateOrderDeliveryStatus = async (req, res) => {
  const { orderId } = req.params;
  const { deliveryStatus, orderStatus } = req.body;
  const newStatus = orderStatus || deliveryStatus;

  if (!newStatus) {
    return res.status(400).json({ success: false, message: 'Order status parameter is required.' });
  }

  try {
    const docRef = db.collection('orders').doc(orderId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    await docRef.update({ orderStatus: newStatus });
    const updatedSnap = await docRef.get();

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${newStatus}.`,
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

    if (snapshot.empty) {
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

    if (snapshot.empty) {
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
