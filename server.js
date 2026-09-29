import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import productRoutes           from './routes/productRoutes.js';
import authRoutes              from './routes/authRoutes.js';
import orderRoutes             from './routes/orderRoutes.js';
import paymentRoutes           from './routes/paymentRoutes.js';
import supportRoutes           from './routes/supportRoutes.js';
import orgAuthRoutes           from './routes/orgAuthRoutes.js';
import deliveryChargesRoutes   from './routes/deliveryChargesRoutes.js';
import accountDeletionRoutes   from './routes/accountDeletionRoutes.js';
import { seedDeliveryCharges } from './controllers/deliveryChargesController.js';

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

// Edge-safe Body Parser (eliminates legacy body-parser / iconv-lite stream crash on Cloudflare Workers)
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const contentType = req.headers['content-type'] || '';
  const isWebhook = req.path.includes('/webhook');

  const chunks = [];
  req.on('data', (chunk) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  });

  req.on('end', () => {
    const rawBuffer = Buffer.concat(chunks);
    if (isWebhook) {
      req.body = rawBuffer;
      return next();
    }

    const rawStr = rawBuffer.toString('utf8');
    if (!rawStr) {
      req.body = {};
      return next();
    }

    if (contentType.includes('application/json')) {
      try {
        req.body = JSON.parse(rawStr);
      } catch (err) {
        req.body = {};
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      req.body = Object.fromEntries(new URLSearchParams(rawStr));
    } else {
      req.body = rawStr;
    }
    next();
  });

  req.on('error', (err) => {
    next(err);
  });
});

// Customer routes (Firebase Auth & Public Data)
app.use('/api/products',                 productRoutes);
app.use('/api/auth',                     authRoutes);
app.use('/api/orders',                   orderRoutes);
app.use('/api/payments',                 paymentRoutes);
app.use('/api/support',                  supportRoutes);
app.use('/api/delivery-charges',         deliveryChargesRoutes);
app.use('/api/account-deletion-request',  accountDeletionRoutes);
app.use('/api/account-deletion-requests', accountDeletionRoutes);
app.use('/api/account',                  accountDeletionRoutes);

// Organization routes (Custom JWT)
app.use('/api/org/auth', orgAuthRoutes);
app.use('/api/org',      orgAuthRoutes);

// Seed Firestore collections with defaults on startup
try {
  seedDeliveryCharges();
} catch (e) {
  console.warn('[Seed Delivery Charges]:', e.message);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Flower Studio Backend is running on Cloudflare Workers / Node.js' });
});

// Start Server locally when executed directly
if (process.env.NODE_ENV !== 'production' && !process.env.CF_PAGES && !process.env.WORKER) {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Flower Studio Backend Server started on port ${PORT}`);
    console.log(`==================================================`);
  });
}

// Cloudflare Workers entry handler
let handler = null;
try {
  const { httpServerHandler } = await import('cloudflare:node');
  if (httpServerHandler) {
    handler = httpServerHandler(app);
  }
} catch (e) {
  // Not in Cloudflare Workers runtime
}

export default handler || app;