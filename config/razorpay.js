import Razorpay from 'razorpay';
import dotenv from 'dotenv';

dotenv.config();

let razorpay = null;

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  try {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log('Razorpay SDK client initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize Razorpay SDK:', err);
  }
} else {
  console.warn('Razorpay keys missing in environment variables.');
}

export default razorpay;
