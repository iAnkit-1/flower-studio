import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyFilePath = path.join(__dirname, 'serviceAccountKey.json');

// Built-in Base64 credential fallback for Vercel production serverless functions
const DEFAULT_SERVICE_ACCOUNT_B64 = "eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6ImZsb3dlci1zdHVkaW8tMzc4NjEiLCJwcml2YXRlX2tleV9pZCI6IjEwM2VhMTZmMWMyZDg5ODJmYWQzYzhkMzQzNDNiMjlhMjdlMWRiYzIiLCJwcml2YXRlX2tleSI6Ii0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLVxuTUlJRXZRSUJBREFOQmdrcWhraUc5dzBCQVFFRkFBU0NCS2N3Z2dTakFnRUFBb0lCQVFESmJhRkIrNXdraDdWK1xuUjY3MkhyUG9USWp2blZxWXVNWFJBdGhZYUJxNklldE9wL1ZDQTBUUlVoUnM4Uk1Hd3FCeFBheXNoOFU4MHpBaFxuemhPdENDUXhmUnJQSEg3ZkVKNmFxRUJYd3RLYVc0VGZuZDVaczFSaGN5clNveXVlVHJ3NW1xNnlWM1g1OE5YWlxuZzJRSzY5UlduS09PeFc5QjhmQ2ZDdzJ0cDVZZVJBOHdWeGpzejNYT3IvQmRrd0YzUlFIQWl5L09Md1Z4Mm13WlxuWFJXYUtGRTlJTDkgQVVNUUsrb0lPYTNCNkcrVUxFeEZuMU9GdUQ1MWVXV0kvb1hlaGVWN0QrdFFBdjZHMzhSaGdcbmNTS1oySkJjVmNlOHpvZnFQUVlwcnF1eThsUmh0T3cxN09jMWxDMC9yR1I0VTd0a1k5b0hwaDJoVElDU1lTUGdua3N6aTdaWkFnTUJBQUVDZ2dFQUJvc2lMdk9PaWYxQ254eVRDWG5MM0dNSUc4aWYxZEJDMlFUZnBGZVZickNGXG5aV085YXV5U1FyNkkzVlVqaWhldWdKOUJTY1dMV2NOK2pCcVRCdzc1cGdYclpna0Y4aGNuSDkwUllnaDVNUHlDXG5INFdRWUplYnlTS2xwaFdhR2FVTEprL3BGdkFTYkJFdjBVWWNiT0ptWG4zdUxrZ3BxaG5DK0ZleWxRNlpzTmY4XG5aRWRNV1djb0JKSmdWOHBvOWFPdjQ3dk1PK1ZRc1ZCL3BaV3FFRVVPZFpDRFNHdFR0YkFPcFl1UkFMaXl2dkZcbgh2djZoV1JBOXNKL2VmcVd5Yk5YTGROZThSZFJhNmloQjBOMS9aNFVGZ1BEUlRrcm5Qb0xZRk5MV1Q2RHNvXG5YVlB3WUVpanpCK2tPVmwzN2NTQVlkc2dpOGJIeDdVMzZqd3UxZzhjZFFLQmdRRDZKSENWdzg4MVpDTDV4bTdyTHpYMVFydXZsYmtxSnljVnJhdWRnK0ZlcHhSRlU1YmptQnhGTVp1aTlyN1NBNGt2N2pBNWZlMEp3cURoSW8xa1JjNDZ5SEdmdEZ5L011eG5lK0k4SmdWVUNaYnJjZ2JtNmdxckV3WkJHNVpMZDZwSldMNDh5U0E2OHp5aXlaOUFLQmdRRFhubE00b0lxckRjS3VBeXJXVUhDejZLWExMNDd1ME1HMDVZdWg1ZVZOQmtyRFNuZWtLeVVxRmJjVG5NTDNqaWFGUk9aUzF1am1qWEtnMUtsbDAxeUFsNzlLRnJQRFhOZzlwbHFhQkpIZDQ4aWhtYWdYNjBJc3NtUUVZaXBuWkMwSk1FbGlnTVE3V2VtcW1ySFAxVG90RE1WdjM2QVJBV0luMERTRGQ1UWJ3S0JnQ2ZzZ2xqQmQ3RUxnU1RKamxBNEZ1dUpHcDFoQloveWdoTmtBazI1VGZhcDd3NjNNdk9zNE9uWlArRkVTVVNBcXVNcHdVckR3N3kwbjlzMmdXYzhoOTVFM0FWZHFYNlBqMWlxWUJTY2JwcFZneWN0SDcyazM4YzRyS3ZtWDViUDc4Q20wRFZrTjRWb28wa1BmdktoNHZxSzR2RU9EWi95RmloMTdVUUlGZGZBb0dBTndFVVdUNmJRdTkzZ3daOFJPR2FBdVlRcGR4OTY3SFpHQnBPU2xobzdBTU1JNDVTRkpKODk0VmVsR1F5NEErAlternativeVNSERlVHl2OXhNSWUyNzFjK0JCN2Rab3VQZGdPaW5MaHVxUGd6dUh6c2hSQ2pCVXNHVzNmOGY4aXY5eVJCR1NCaHM5bTd6U28vM3QvcSt3bXMxbWxwRGJOTWJoT2g1M1NqYjRVQ2dZRUFrRE84ODN5eWYvRFIzVjUrVDdsWDdJL3lQbWNGbm1ET1RWTCtMZjNvc1Y3NStBOElEUGdmTzN5UVF5OXJING1zdW0xQlc0UDdCQVgzSFF6dURaZHpNS1h2ZFN2M2Fod0sxTkV4cU5JMFJld0IvQklTTXZxV0FiUm15VVM2WXZxeFhTaVhhajBDTGlUWDhXQTJDcTkwWGpVTDNMdFRGZEwxZkUyRmQ4d3dRPVxuLS0tLS1FTkQgUFJJVkFURUtFWS0tLS0tXG4iLCJjbGllbnRfZW1haWwiOiJmaXJlYmFzZS1hZG1pbnNkay1mYnN2Y0BmbG93ZXItc3R1ZGlvLTM3ODYxLmlhbS5nc2VydmljZWFjY291bnQuY29tIiwiY2xpZW50X2lkIjoiMTExMDE0ODM3NjE5MzUwNzM3ODQwIiwiYXV0aF91cmkiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vby9vYXV0aDIvYXV0aCIsInRva2VuX3VyaSI6Imh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwiYXV0aF9wcm92aWRlcl94NTA5X2NlcnRfdXJsIjoiaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vb2F1dGgyL3YxL2NlcnRzIiwiY2xpZW50X3g1MDlfY2VydF91cmwiOiJodHRwczovL2dvb2dsZWFwaXMuY29tL3JvYm90L3YxL21ldGFkYXRhL3g1MDkvZmlyZWJhc2UtYWRtaW5zZGstZmJzdmMlNDBmbG93ZXItc3R1ZGlvLTM3ODYxLmlhbS5nc2VydmljZWFjY291bnQuY29tIiwidW5pdmVyc2VfZG9tYWluIjoiZ29vZ2xlYXBpcy5jb20ifQ==";

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

    // 2. FIREBASE_SERVICE_ACCOUNT (JSON string or Base64 in env var)
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

    // 4. Built-in Base64 Credential Fallback (Ensures Vercel serverless works seamlessly)
    if (DEFAULT_SERVICE_ACCOUNT_B64) {
      const decodedJson = Buffer.from(DEFAULT_SERVICE_ACCOUNT_B64, 'base64').toString('utf8');
      const serviceAccount = JSON.parse(decodedJson);
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin initialized with built-in Base64 credential fallback.');
      return admin.firestore();
    }

    // 5. Fallback Default Project ID initialization
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
    throw new Error('Firebase Firestore is not initialized.');
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
