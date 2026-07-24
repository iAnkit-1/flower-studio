import db from '../config/db.js';

/**
 * Script to wipe/empty all collections in live Firestore (flower-studio-37861)
 * Deletes all documents from: products, orders, custom_orders, requested_orders, support_tickets, users, otp_sessions
 */
const clearCollection = async (collectionName) => {
  if (!db) {
    console.error('Firestore DB instance is not initialized.');
    return;
  }

  try {
    const snapshot = await db.collection(collectionName).get();
    if (snapshot.empty) {
      console.log(`Collection '${collectionName}' is already empty.`);
      return;
    }

    const batchSize = snapshot.size;
    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`Successfully deleted ${batchSize} documents from collection '${collectionName}'.`);
  } catch (error) {
    console.error(`Error clearing collection '${collectionName}':`, error.message);
  }
};

const clearAllDatabase = async () => {
  console.log('==================================================');
  console.log('Wiping all collections in Firestore (flower-studio-37861)...');
  console.log('==================================================');

  const collections = [
    'products',
    'orders',
    'custom_orders',
    'requested_orders',
    'support_tickets',
    'users',
    'otp_sessions'
  ];

  for (const col of collections) {
    await clearCollection(col);
  }

  console.log('==================================================');
  console.log('Database successfully emptied! Only new data from Customer & Organization apps will be stored.');
  console.log('==================================================');
  process.exit(0);
};

clearAllDatabase();
