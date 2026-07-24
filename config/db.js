import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyFilePath = path.join(__dirname, 'serviceAccountKey.json');

if (!admin.apps.length) {
  try {
    if (fs.existsSync(keyFilePath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin initialized with serviceAccountKey.json (Project: ' + serviceAccount.project_id + ')');
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin initialized with FIREBASE_SERVICE_ACCOUNT env var.');
    } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      let rawKey = process.env.FIREBASE_PRIVATE_KEY;
      if (rawKey.startsWith('"') && rawKey.endsWith('"')) {
        rawKey = rawKey.slice(1, -1);
      }
      const formattedKey = rawKey.replace(/\\n/g, '\n');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID || 'flower-studio-37861',
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: formattedKey,
        })
      });
      console.log('Firebase Admin initialized with client email & private key.');
    } else {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'flower-studio-37861'
      });
      console.log('Firebase Admin initialized with default project ID.');
    }
  } catch (error) {
    console.error('Firebase Admin initialization error:', error.message);
  }
}

export const db = admin.apps.length ? admin.firestore() : null;
export { admin };
export default db;
