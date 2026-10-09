import Razorpay from 'razorpay';
import dotenv from 'dotenv';

dotenv.config();

export function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_live_TlTZMHvnMnXHGZ';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '37HQJoRCjVLSG8uf4FzaR3pQ';

  if (!keyId || !keySecret) {
    console.warn('[Razorpay] Keys missing in environment variables.');
    return null;
  }

  try {
    return new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  } catch (err) {
    console.error('[Razorpay] Failed to initialize SDK client:', err);
    return null;
  }
}

/**
 * Universal Razorpay Order Creator (Works natively in Cloudflare Workers, Node, and Vercel)
 */
export async function createRazorpayOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_live_TlTZMHvnMnXHGZ';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '37HQJoRCjVLSG8uf4FzaR3pQ';

  if (!keyId || !keySecret) {
    throw new Error('Razorpay API credentials not configured.');
  }

  const receiptStr = String(receipt || `rcpt_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40);
  const amountInt = Math.round(Number(amount));

  // 1. Primary: Native fetch with Basic Auth (Zero dependencies, 100% Cloudflare Workers compliant)
  try {
    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountInt,
        currency: currency || 'INR',
        receipt: receiptStr,
        notes: notes || {},
      }),
    });

    const data = await response.json();
    if (response.ok && data && data.id) {
      console.log(`[Razorpay Native Fetch] Order created successfully: ${data.id} for amount ₹${(amountInt / 100).toFixed(2)}`);
      return data;
    } else {
      console.error('[Razorpay API Error Response]', data);
      throw new Error(data.error?.description || data.message || `Razorpay HTTP ${response.status}`);
    }
  } catch (fetchErr) {
    console.warn('[Razorpay Native Fetch Failed, attempting SDK fallback]:', fetchErr.message);
    const rzpClient = getRazorpayClient();
    if (rzpClient) {
      const sdkOrder = await rzpClient.orders.create({
        amount: amountInt,
        currency: currency || 'INR',
        receipt: receiptStr,
        notes: notes || {},
      });
      return sdkOrder;
    }
    throw fetchErr;
  }
}

const razorpay = getRazorpayClient();
export default razorpay;

