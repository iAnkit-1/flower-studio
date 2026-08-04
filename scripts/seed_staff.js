/**
 * Flower Studio — Staff User Seed Script
 * ----------------------------------------
 * Creates / updates staff accounts in the Firestore `staff_users` collection.
 *
 * Usage:
 *   node scripts/seed_staff.js
 *
 * Roles:
 *   admin    → full access to all screens
 *   catalog  → product catalogue & add-product only
 *   orders   → order management, product details, order details, support
 *   delivery → logistics dashboard, product details, order details
 */

import bcrypt from 'bcryptjs';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Initialize Firebase Admin ─────────────────────────────────────────────────
const keyFilePath = path.join(__dirname, '../config/serviceAccountKey.json');

if (admin.apps.length === 0) {
  if (fs.existsSync(keyFilePath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } else {
    throw new Error('serviceAccountKey.json not found. Cannot seed staff.');
  }
}

const db = admin.firestore();

// ── Staff definitions ─────────────────────────────────────────────────────────
// ⚠️  Change passwords before running in production!
const STAFF_MEMBERS = [
  {
    email:    'admin@flowerstudio.com',
    password: 'Admin@2024!',
    name:     'Admin User',
    role:     'admin',
    isActive: true,
  },
  {
    email:    'catalog@flowerstudio.com',
    password: 'Catalog@2024!',
    name:     'Catalog Manager',
    role:     'catalog',
    isActive: true,
  },
  {
    email:    'orders@flowerstudio.com',
    password: 'Orders@2024!',
    name:     'Orders Manager',
    role:     'orders',
    isActive: true,
  },
  {
    email:    'delivery@flowerstudio.com',
    password: 'Delivery@2024!',
    name:     'Delivery Staff',
    role:     'delivery',
    isActive: true,
  },
];

// ── Seed function ─────────────────────────────────────────────────────────────
async function seedStaff() {
  console.log('🌸 Flower Studio — Seeding staff users...\n');

  const SALT_ROUNDS = 12;

  for (const member of STAFF_MEMBERS) {
    const docId         = member.email.replace(/[@.]/g, '_');
    const hashedPassword = await bcrypt.hash(member.password, SALT_ROUNDS);
    const now           = new Date().toISOString();

    const staffDoc = {
      email:          member.email,
      hashedPassword,
      name:           member.name,
      role:           member.role,
      isActive:       member.isActive,
      createdAt:      now,
      lastLoginAt:    null,
    };

    await db.collection('staff_users').doc(docId).set(staffDoc, { merge: true });

    console.log(`✅ Seeded: ${member.email}  (role: ${member.role})`);
  }

  console.log('\n🎉 All staff users seeded successfully!');
  console.log('\n⚠️  IMPORTANT: Change default passwords in production!');
  process.exit(0);
}

seedStaff().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
