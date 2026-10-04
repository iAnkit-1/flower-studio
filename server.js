import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { httpServerHandler } from 'cloudflare:node';

import productRoutes           from './routes/productRoutes.js';
import authRoutes              from './routes/authRoutes.js';
import orderRoutes             from './routes/orderRoutes.js';
import paymentRoutes           from './routes/paymentRoutes.js';
import supportRoutes           from './routes/supportRoutes.js';
import orgAuthRoutes           from './routes/orgAuthRoutes.js';
import deliveryChargesRoutes   from './routes/deliveryChargesRoutes.js';
import accountDeletionRoutes   from './routes/accountDeletionRoutes.js';
import couponRoutes            from './routes/couponRoutes.js';
import reminderRoutes          from './routes/reminderRoutes.js';
import { seedDeliveryCharges } from './controllers/deliveryChargesController.js';
import { seedCouponCodes }     from './controllers/couponController.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Allowed Origins for Web Portals & Production Domains
const allowedOrigins = [
  'https://www.flowerstudiobypushpraj.com',
  'https://flowerstudiobypushpraj.com',
  'https://flowerstudio.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:5000',
];

// CORS configuration supporting HttpOnly Cookies & Bearer Tokens across Web & APK
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app') || origin.endsWith('flowerstudiobypushpraj.com')) {
      return callback(null, true);
    }
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cookie', 'X-Razorpay-Signature'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Preflight handler: return 200 OK immediately with dynamic origin CORS headers for cookie credentials
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Cookie, X-Razorpay-Signature');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cookieParser());


app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use('/api/orders/webhook',   express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Customer routes (Firebase Auth & Public Data)
app.use('/api/products',                 productRoutes);
app.use('/api/auth',                     authRoutes);
app.use('/api/orders',                   orderRoutes);
app.use('/api/payments',                 paymentRoutes);
app.use('/api/support',                  supportRoutes);
app.use('/api/delivery-charges',         deliveryChargesRoutes);
app.use('/api/coupons',                  couponRoutes);
app.use('/api/coupon-codes',             couponRoutes);
app.use('/coupons',                      couponRoutes);
app.use('/api/reminders',                reminderRoutes);
app.use('/api/account-deletion-request',  accountDeletionRoutes);
app.use('/api/account-deletion-requests', accountDeletionRoutes);
app.use('/api/account',                  accountDeletionRoutes);

// Organization routes (Custom JWT)
app.use('/api/org/auth', orgAuthRoutes);
app.use('/api/org',      orgAuthRoutes);

// Seed Firestore collections with defaults on startup
try {
  seedDeliveryCharges();
  seedCouponCodes();
} catch (e) {
  console.warn('[Seed Delivery Charges / Coupons]:', e.message);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Flower Studio Backend is running on Cloudflare Workers / Node.js' });
});

// Cloudflare Workers HTTP Server Handler
app.listen(3000);
export default httpServerHandler({ port: 3000 });