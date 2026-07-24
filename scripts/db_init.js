import db from '../config/db.js';

const initialProducts = [
  {
    id: 'f_rare_1',
    hsnCode: '0603',
    barcode: '8901234567890',
    sku: 'SKU-RARE-01',
    title: 'Divine Himalayan Brahma Kamal (Rare)',
    description: 'Exquisite, rare night-blooming lotus from high altitudes of the Himalayas.',
    mrp: 1999.00,
    salePrice: 1499.00,
    discountPercentage: 25.00,
    ratings: 4.9,
    reviewsCount: 42,
    category: 'flower',
    subCategory: 'Exotic & Rare',
    availability: 'request order',
    stock: 0,
    tags: ['rare', 'exotic', 'himalayan', 'divine'],
    addons: { 'Gourmet Chocolates Box': 350.00, 'Handwritten Gift Card': 50.00 },
    occasions: ['Birthday', 'Anniversary', 'Prayer Event'],
    images: ['https://images.unsplash.com/photo-1561181286-d3fee7d55364?auto=format&fit=crop&q=80&w=600'],
    addOns: [],
    similarItems: [],
    createdAt: new Date().toISOString()
  },
  {
    id: 'PROD-1001',
    hsnCode: '0603',
    barcode: '8901234567891',
    sku: 'SKU-ROSE-50',
    title: 'Velvet Royal Red Roses (50 Stems)',
    description: 'Grand arrangement of 50 long-stemmed premium red roses wrapped in satin ribbon.',
    mrp: 2999.00,
    salePrice: 2499.00,
    discountPercentage: 16.67,
    ratings: 4.8,
    reviewsCount: 128,
    category: 'flower',
    subCategory: 'Roses',
    availability: 'available',
    stock: 25,
    tags: ['roses', 'red', 'luxury', 'romance'],
    addons: { 'Heart Shape Balloon': 150.00, 'Teddy Bear 6 inch': 299.00 },
    occasions: ['Anniversary', 'Valentine', 'Birthday'],
    images: ['https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=600'],
    addOns: ['f_rare_1'],
    similarItems: [],
    createdAt: new Date().toISOString()
  }
];

const initialCustomOrders = [
  {
    id: 'CUST-3901',
    customerName: 'Kavita Sen',
    customerEmail: 'kavita@gmail.com',
    category: 'Bouquet',
    description: 'A massive 50-stem red and yellow rose heart arrangement with premium ribbons.',
    referenceImageUrl: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?auto=format&fit=crop&q=80&w=300',
    budget: 4500.0,
    requiredDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'Pending Review',
    calculatedCost: null,
    requestedAt: new Date().toISOString()
  }
];

const initialRequestedOrders = [
  {
    id: 'REQ-7201',
    customerName: 'Pranav Roy',
    customerEmail: 'pranav@outlook.com',
    productId: 'f_rare_1',
    productTitle: 'Divine Himalayan Brahma Kamal (Rare)',
    quantity: 1,
    notes: 'Urgent request for grandparent birthday prayer event.',
    budget: 1499.0,
    status: 'Pending',
    createdAt: new Date().toISOString()
  }
];

const initialSupportTickets = [
  {
    id: 'TKT-892',
    customerName: 'Aanchal Mittal',
    orderId: 'ORD-5398',
    category: 'Late Delivery',
    priority: 'High',
    status: 'Open',
    assignedAgent: null,
    createdAt: new Date().toISOString(),
    chatHistory: [
      {
        sender: 'Customer',
        message: 'My order ORD-5398 was scheduled to arrive by 5:00 PM, but it is 5:30 PM and the rider has not contacted me. Can you please check?',
        timestamp: new Date().toISOString()
      }
    ]
  }
];

async function seedCollectionIfEmpty(collectionName, items, keyField = 'id') {
  try {
    const snapshot = await db.collection(collectionName).limit(1).get();
    if (snapshot.empty) {
      console.log(`Seeding ${collectionName} collection in Firestore...`);
      const batch = db.batch();
      for (const item of items) {
        const docRef = db.collection(collectionName).doc(item[keyField]);
        batch.set(docRef, item, { merge: true });
      }
      await batch.commit();
      console.log(`Seeded ${items.length} records into ${collectionName}.`);
    } else {
      console.log(`Collection ${collectionName} already has documents. Skipping seed.`);
    }
  } catch (err) {
    console.error(`Error checking/seeding ${collectionName}:`, err.message);
  }
}

async function initFirestore() {
  console.log('Initializing Firestore database tables/collections...');
  try {
    await seedCollectionIfEmpty('products', initialProducts);
    await seedCollectionIfEmpty('custom_orders', initialCustomOrders);
    await seedCollectionIfEmpty('requested_orders', initialRequestedOrders);
    await seedCollectionIfEmpty('support_tickets', initialSupportTickets);
    console.log('Firestore initialization complete!');
  } catch (err) {
    console.error('Firestore init failed:', err);
  }
}

initFirestore();
