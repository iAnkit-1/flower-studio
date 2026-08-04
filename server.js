import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import productRoutes  from './routes/productRoutes.js';
import authRoutes     from './routes/authRoutes.js';
import orderRoutes    from './routes/orderRoutes.js';
import supportRoutes  from './routes/supportRoutes.js';
import orgAuthRoutes  from './routes/orgAuthRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration for Flutter Web, APK, and browser cross-origin requests
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Preflight handler: return 200 OK immediately with CORS headers for all OPTIONS requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Customer routes (Firebase Auth)
app.use('/api/products', productRoutes);
app.use('/api/auth',     authRoutes);
app.use('/api/orders',   orderRoutes);
app.use('/api/support',  supportRoutes);

// Organization routes (Custom JWT)
app.use('/api/org/auth', orgAuthRoutes);
app.use('/api/org',      orgAuthRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Flower Studio Backend is running (ES6+)' });
});

// Start Server (only if not running as a Vercel serverless function)
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Flower Studio Backend Server (ES6+) started successfully.`);
    console.log(`Port: ${PORT}`);
    console.log(`Environment: Development`);
    console.log(`==================================================`);
  });
}

export default app;
