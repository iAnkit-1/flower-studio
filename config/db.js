import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyFilePath = path.join(__dirname, 'serviceAccountKey.json');

// Built-in Service Account Credentials Fallback for Vercel Serverless Functions
const DEFAULT_SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "flower-studio-37861",
  private_key_id: "103ea16f1c2d8982fad3c8d34343b29a27e1dbc2",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDJbaFB+5wkh7V+\nR672HrPoTIjvnVqYuMZRAthYaBq6IetOp/VCA0TRUhRs8RMGwqBxPaysh8U80zAh\nzhOtCCQxfRrPHH7fEJ6aqEBXwtKaW4Tfnd5Zs1RhcyrSoyueTrw5mq6yV3X58NXZ\ng2QK69RWnKOOxW9B8fCfCw2tp5YeRA8wVxjszsXOr/BdkwF3RQHAiy/OLwVx2mwZ\nXRWaKFE9IL9AUMQK+oIOa3B6G+ULExFn1OFuD51eEWI/oXeheV7D+tQAv6G38Rhg\nCdSKZ2JBcVce8zofqPQYpRquy8lRhtOw17Oc1lC0/rGR4U7tkY9oHpi2hTICSYSP\ngkszi7ZZAgMBAAECggEABosiLvOOif1CnxyTCXnL3GMIG8if1dBC2QTfpFeVbrCF\nZWO9auySQr6I3VUjiheugJ9BScWLWcN+j8qTBw75pgXrZgkF8hcnH90RYgh5MPyC\nH4WQYJebySKlpHwagaULJk/pFvASbBEv0UYcbOJmXn3uLkgpqhnC+FeylQ6ZqNf8\nZEdMWWcoBJJgV8po9aOv47vMO+VQsVB/pZWqEEUOdZCDSGtTtbAOPqYuRALiyvvF\n8vv6hWRA9rJ/efqWFybNXLdNe8RdRa6i/hB0N1/Z4UFgPDRTkrnPoLYFNLWT6Dso\nXVPwYEijzB+kOVl37cSAYdsgi8bHx7U36jwu1g8cdQKBgQDvJTuf+CYOuNm0NMPu\ndfQm13RS6jFkl5MCOY1vn6+CZVrG5BQAprPnD7GgxeoqHYOoaX1nO/s83gP5UQrf\nx3LtaloKqYRSeuKj99/3rqY9KmizJK+9GHAIbyigxZQuEKl0vfP10UpH/BV/bAJX\nMZy1VGKBSwmiLEoKrIvlUoC5twKBgQDXn+MAoIwqrDcKuAyrWUHCz6KXL47u0MG0\n5Yuh5eVNBk+rDSnekKyUqFbcTnML3jiaFROZS1ujmjXKg1Kll01yAl79KFrPDXNg\n9plqaBJHd48ihmagX60IssmQEYZpnZC0JMEligMQ7WemqmrHP1TotDMVv36ARAWI\nn0DSEd5QbwKBgCfsgljBd7ELgSTJjlA4FuuJGp1hBZ/yghNkAk25Tfap7w63MvOs\n4OnZP+FESUSAquMpwUrDw7y0n9s2gWc8h95E3AVdqX6Pj1iqYBScbppVgyctH72k\n38c4r4KvmX5bP78Cm0DVkN4Voo0kPfvKh4vqK4vEODZ/yFih17UQIfdfAoGANwEU\nWT6bQu93gwZ8ROGaAuYQpdx967HZGBpOSlho7AMmI45SFfJ1894VelGQy4A+lB+4\nRiyRDeTyv9xMIu271c+BB7dZouPdgOinLhuqPgzjuHzshRCjBUsGW/f8f8iv9yRB\nGSBhs9m7zSo/3t/q+wms1mlpDbNMbhOh53Sjb4UCgYEAkDO883yyf/DR3V5+T7lX\n7I/yPmcFnmDOTVL+Lf3osV75+A8IDPgfO3yYQy9rH4msum1BW4P7BAX3HQzuDZdz\nMKXjvDSv3ahwK1NExqNI0RewB/BISMvqWAbRmyUS6YVqzXEsiXaj0OLiTX8WA2Cq\n90XjUL3LtTFdL1fE2Fd8wwQ=\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk-fbsvc@flower-studio-37861.iam.gserviceaccount.com",
  client_id: "111014837619350737840",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40flower-studio-37861.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
};

let lastInitError = null;

function initFirebase() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  try {
    // 1. Local serviceAccountKey.json file if present
    if (fs.existsSync(keyFilePath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin initialized with serviceAccountKey.json');
      return admin.firestore();
    }

    // 2. FIREBASE_SERVICE_ACCOUNT (JSON string or Base64 string in env var)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let rawEnv = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      
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

    // 3. FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY env vars
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

    // 4. Built-in Credential Fallback (Ensures Vercel serverless works 100% out-of-the-box)
    admin.initializeApp({
      credential: admin.credential.cert(DEFAULT_SERVICE_ACCOUNT)
    });
    console.log('Firebase Admin initialized with built-in service account credential.');
    return admin.firestore();
  } catch (error) {
    console.error('Firebase Admin initialization error:', error.message);
    lastInitError = error.message;
    return null;
  }
}

export function getDb() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }
  const dbInstance = initFirebase();
  if (!dbInstance) {
    throw new Error(`Firebase Firestore is not initialized. Error: ${lastInitError || 'Unknown initialization error'}`);
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
