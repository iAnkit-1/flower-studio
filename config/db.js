import { initializeApp, cert, getApps } from '@ljoukov/firebase-admin-cloudflare/app';
import { getFirestore } from '@ljoukov/firebase-admin-cloudflare/firestore';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

let db = null;
let app = null;

/**
 * Safely format and clean RSA Private Key for OpenSSL 3.0 / Edge compatibility
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

  // 2. Check if string is base64 encoded
  if (!str.includes('-----BEGIN') && !str.includes('\n') && !str.includes('\\n')) {
    try {
      const decoded = Buffer.from(str, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) {
        str = decoded.trim();
      }
    } catch (e) {}
  }

  // 3. Normalize windows newlines \r\n and \r to standard \n
  str = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 4. Convert string literal "\\n" or "\n" to actual newline character \n
  str = str.replace(/\\n/g, '\n');

  return str.trim();
}

/**
 * Resolve service account credentials across Edge variables, Env vars, or local file
 */
function getServiceAccount() {
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
          if (decoded.startsWith('{')) rawEnv = decoded;
        } catch (e) {}
      }
      const sa = typeof rawEnv === 'string' ? JSON.parse(rawEnv) : rawEnv;
      if (sa.private_key) sa.private_key = cleanPrivateKey(sa.private_key);
      return sa;
    } catch (e) {
      console.error('[Firebase Init] Failed to parse FIREBASE_SERVICE_ACCOUNT:', e.message);
    }
  }

  // 2. Individual Environment Variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail.trim(),
      private_key: cleanPrivateKey(privateKey),
    };
  }

  // 3. Local Development File Fallback (serviceAccountKey.json)
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const keyFilePath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs && fs.existsSync && fs.existsSync(keyFilePath)) {
      const sa = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
      if (sa.private_key) sa.private_key = cleanPrivateKey(sa.private_key);
      return sa;
    }
  } catch (e) {
    // Edge runtime might not have fs
  }

  return null;
}

function initFirebase() {
  if (db) return db;

  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
    db = getFirestore(app);
    return db;
  }

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      'Firebase initialization failed. Please set FIREBASE_SERVICE_ACCOUNT or (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) in environment variables/secrets.'
    );
  }

  const normalized = {
    projectId: serviceAccount.projectId || serviceAccount.project_id,
    clientEmail: serviceAccount.clientEmail || serviceAccount.client_email,
    privateKey: cleanPrivateKey(serviceAccount.privateKey || serviceAccount.private_key),
    tokenUri: serviceAccount.tokenUri || serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
  };

  app = initializeApp({
    credential: cert(normalized),
  });

  db = getFirestore(app);
  return db;
}

export function getDb() {
  if (db) return db;
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

export const admin = {
  apps: [{ name: 'default' }],
};

export default dbProxy;
