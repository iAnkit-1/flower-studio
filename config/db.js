import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let db = null;

function initFirebase() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID environment variable is missing.');
  }

  if (!clientEmail) {
    throw new Error('FIREBASE_CLIENT_EMAIL environment variable is missing.');
  }

  if (!privateKey) {
    throw new Error('FIREBASE_PRIVATE_KEY environment variable is missing.');
  }

  const formattedPrivateKey = privateKey
    .replace(/\\n/g, '\n')
    .replace(/^"|"$/g, '')
    .trim();

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail: clientEmail.trim(),
        privateKey: formattedPrivateKey,
      }),
    });

    console.log('Firebase Admin initialized successfully');
    db = admin.firestore();
    return db;
  } catch (error) {
    console.error('Firebase Admin initialization failed:', error.message);
    throw new Error(`Firebase Admin initialization failed: ${error.message}`);
  }
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

export const dbExport = dbProxy;
export { admin };
export default dbProxy;
