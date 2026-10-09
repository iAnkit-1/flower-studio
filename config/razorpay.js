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

const razorpay = getRazorpayClient();
export default razorpay;
