import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyFilePath = path.join(__dirname, 'serviceAccountKey.json');

let db = null;

function initFirebase() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  // 1. Single JSON Environment Variable (FIREBASE_SERVICE_ACCOUNT)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if ((rawEnv.startsWith("'") && rawEnv.endsWith("'")) || (rawEnv.startsWith('"') && rawEnv.endsWith('"'))) {
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
      db = admin.firestore();
      return db;
    } catch (error) {
      console.error('FIREBASE_SERVICE_ACCOUNT parse error:', error.message);
    }
  }

  // 2. Individual Environment Variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    try {
      const formattedPrivateKey = privateKey
        .replace(/\\n/g, '\n')
        .replace(/^"|"$/g, '')
        .trim();

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail: clientEmail.trim(),
          privateKey: formattedPrivateKey,
        }),
      });
      console.log('Firebase Admin initialized via individual environment variables');
      db = admin.firestore();
      return db;
    } catch (error) {
      console.error('Individual Firebase env vars error:', error.message);
    }
  }

  // 3. Local Development File Fallback (serviceAccountKey.json)
  if (fs.existsSync(keyFilePath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin initialized via local serviceAccountKey.json');
      db = admin.firestore();
      return db;
    } catch (error) {
      console.error('Local serviceAccountKey.json parse error:', error.message);
    }
  }

  throw new Error(
    'Firebase initialization failed. Please set FIREBASE_SERVICE_ACCOUNT or (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) in environment variables.'
  );
}

export function getDb() {
  if (db) {
    return db;
  }
  return initFirebase();
}

// Proxy export for backward compatibility with `import db from '../config/db.js'`
const dbProxy = new Proxy(
  {},
  {
    get(target, prop) {
      const firestore = getDb();
      const value = firestore[prop];
      return typeof value === 'function' ? value.bind(firestore) : value;
    },
  }
);

export { admin };
export default dbProxy;
