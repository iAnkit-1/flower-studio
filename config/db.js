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

  // 1. Local Development: Use local serviceAccountKey.json if present
  if (fs.existsSync(keyFilePath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin initialized via local serviceAccountKey.json');
      return admin.firestore();
    } catch (err) {
      console.error('Failed to load local serviceAccountKey.json:', err.message);
    }
  }

  // 2. Production / Vercel: Single JSON Environment Variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if (rawEnv.startsWith('"') && rawEnv.endsWith('"')) {
        rawEnv = rawEnv.slice(1, -1);
      }
      const serviceAccount = typeof rawEnv === 'string' ? JSON.parse(rawEnv) : rawEnv;
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT env var');
      return admin.firestore();
    } catch (err) {
      console.error('Failed to initialize Firebase with FIREBASE_SERVICE_ACCOUNT:', err.message);
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT: ${err.message}`);
    }
  }

  // 3. Production / Vercel: Individual Environment Variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    try {
      const formattedPrivateKey = privateKey
        .trim()
        .replace(/^"|"$/g, '')
        .replace(/\\n/g, '\n');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail: clientEmail.trim(),
          privateKey: formattedPrivateKey,
        }),
      });
      console.log('Firebase Admin initialized via individual environment variables');
      return admin.firestore();
    } catch (err) {
      console.error('Failed to initialize Firebase Admin with individual env vars:', err.message);
      throw new Error(`Firebase Admin initialization failed: ${err.message}`);
    }
  }

  throw new Error(
    'Firebase environment variables missing. Please configure FIREBASE_SERVICE_ACCOUNT or (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) in Vercel settings.'
  );
}

export function getDb() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }
  return initFirebase();
}

export const db = new Proxy(
  {},
  {
    get(target, prop) {
      const firestore = getDb();
      const value = firestore[prop];

      if (typeof value === 'function') {
        return value.bind(firestore);
      }

      return value;
    },
  }
);

export { admin };
export default db;
