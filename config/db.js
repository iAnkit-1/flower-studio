import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyFilePath = path.join(__dirname, 'serviceAccountKey.json');

function initFirebase() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  try {
    // 1. Try local serviceAccountKey.json file if present
    if (fs.existsSync(keyFilePath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin initialized with serviceAccountKey.json (Project: ' + serviceAccount.project_id + ')');
      return admin.firestore();
    }

    // 2. Try FIREBASE_SERVICE_ACCOUNT (JSON string or Base64 in env var)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      
      // If base64 encoded string
      if (!rawEnv.startsWith('{') && !rawEnv.startsWith('"')) {
        try {
          rawEnv = Buffer.from(rawEnv, 'base64').toString('utf8');
        } catch (_) {}
      }

      if (rawEnv.startsWith('"') && rawEnv.endsWith('"')) {
        rawEnv = rawEnv.slice(1, -1);
      }

      const serviceAccount = typeof rawEnv === 'string' ? JSON.parse(rawEnv) : rawEnv;
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin initialized with FIREBASE_SERVICE_ACCOUNT env var.');
      return admin.firestore();
    }

    // 3. Try FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY
    if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      let rawKey = process.env.FIREBASE_PRIVATE_KEY.trim();
      if (rawKey.startsWith('"') && rawKey.endsWith('"')) {
        rawKey = rawKey.slice(1, -1);
      }
      const formattedKey = rawKey.replace(/\\n/g, '\n');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID || 'flower-studio-37861',
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
          privateKey: formattedKey,
        })
      });
      console.log('Firebase Admin initialized with client email & private key.');
      return admin.firestore();
    }

    // 4. Fallback Default Project ID initialization
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'flower-studio-37861'
    });
    console.log('Firebase Admin initialized with default project ID.');
    return admin.firestore();
  } catch (error) {
    console.error('Firebase Admin initialization error:', error.message);
    return null;
  }
}

export function getDb() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }
  const dbInstance = initFirebase();
  if (!dbInstance) {
    throw new Error('Firebase Firestore is not initialized. Ensure FIREBASE_SERVICE_ACCOUNT or FIREBASE_CLIENT_EMAIL & FIREBASE_PRIVATE_KEY environment variables are configured in Vercel settings.');
  }
  return dbInstance;
}

// Proxy object for backward compatibility with `db.collection(...)`
const dbProxy = new Proxy({}, {
  get(target, prop) {
    const firestore = getDb();
    const value = firestore[prop];
    if (typeof value === 'function') {
      return value.bind(firestore);
    }
    return value;
  }
});

export const db = dbProxy;
export { admin };
export default dbProxy;
