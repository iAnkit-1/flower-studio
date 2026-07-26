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

/**
 * Safely format and clean RSA Private Key for OpenSSL 3.0 compatibility in Node.js / Vercel
 */
function cleanPrivateKey(key) {
  if (!key || typeof key !== 'string') return '';

  let str = key.trim();

  // 1. Remove wrapping single or double quotes
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    str = str.slice(1, -1).trim();
  }

  // 2. Check if string is base64 encoded (for users who base64 encode keys in Vercel)
  if (!str.includes('-----BEGIN') && !str.includes('\n') && !str.includes('\\n')) {
    try {
      const decoded = Buffer.from(str, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) {
        str = decoded.trim();
      }
    } catch (e) {
      // Ignore if not base64
    }
  }

  // 3. Normalize windows newlines \r\n and \r to standard \n
  str = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 4. Convert string literal "\\n" or "\n" to actual newline character \n
  str = str.replace(/\\n/g, '\n');

  return str.trim();
}

function initFirebase() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  // 1. Single JSON Environment Variable (FIREBASE_SERVICE_ACCOUNT)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      let rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if (
        (rawEnv.startsWith("'") && rawEnv.endsWith("'")) ||
        (rawEnv.startsWith('"') && rawEnv.endsWith('"'))
      ) {
        rawEnv = rawEnv.slice(1, -1);
      }
      if (!rawEnv.startsWith('{')) {
        try {
          const decoded = Buffer.from(rawEnv, 'base64').toString('utf8');
          if (decoded.startsWith('{')) {
            rawEnv = decoded;
          }
        } catch (e) {}
      }
      const serviceAccount = typeof rawEnv === 'string' ? JSON.parse(rawEnv) : rawEnv;
      if (serviceAccount.private_key) {
        serviceAccount.private_key = cleanPrivateKey(serviceAccount.private_key);
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
      const formattedPrivateKey = cleanPrivateKey(privateKey);

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
      if (serviceAccount.private_key) {
        serviceAccount.private_key = cleanPrivateKey(serviceAccount.private_key);
      }
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
