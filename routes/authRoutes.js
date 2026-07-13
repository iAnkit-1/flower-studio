import express from 'express';
import { login } from '../controllers/authController.js';

const router = express.Router();

// Routes mapping for /api/auth/login
router.post('/login', login);

export default router;
