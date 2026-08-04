import db from '../config/db.js';

/**
 * Seed or ensure 'delivery_charges' collection has default records.
 * Run this once at startup to populate if missing.
 */
const DELIVERY_CHARGE_DEFAULTS = [
  {
    id: 'standard',
    label: 'Standard',
    description: 'Standard Delivery (9:00 AM - 7:00 PM)',
    charge: 0,
    isFree: true,
  },
  {
    id: 'fixed_time',
    label: 'Fixed Time',
    description: 'Fixed Time Delivery (2-hour slots)',
    charge: 149,
    isFree: false,
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Midnight Delivery (11:00 PM - 11:59 PM)',
    charge: 249,
    isFree: false,
  },
];

export const seedDeliveryCharges = async () => {
  try {
    const batch = db.batch();
    for (const item of DELIVERY_CHARGE_DEFAULTS) {
      const ref = db.collection('delivery_charges').doc(item.id);
      const snap = await ref.get();
      if (!snap.exists) {
        batch.set(ref, item);
      }
    }
    await batch.commit();
    console.log('[Delivery Charges] Collection seeded/verified in Firestore.');
  } catch (err) {
    console.error('[Delivery Charges] Error seeding collection:', err);
  }
};

/**
 * GET /api/delivery-charges
 * Returns all delivery charge options from Firestore.
 */
export const getDeliveryCharges = async (req, res) => {
  try {
    const snapshot = await db.collection('delivery_charges').get();

    if (snapshot.empty) {
      // Seed and return defaults if collection is empty
      await seedDeliveryCharges();
      return res.status(200).json({
        success: true,
        charges: DELIVERY_CHARGE_DEFAULTS,
      });
    }

    const charges = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id || doc.id,
        label: data.label || '',
        description: data.description || '',
        charge: parseFloat(data.charge ?? 0),
        isFree: data.isFree === true || parseFloat(data.charge ?? 0) === 0,
      };
    });

    // Sort: standard first, then fixed_time, then midnight
    const order = ['standard', 'fixed_time', 'midnight'];
    charges.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

    return res.status(200).json({ success: true, charges });
  } catch (err) {
    console.error('[Delivery Charges] Error fetching charges:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery charges.',
      error: err.message,
    });
  }
};

/**
 * PUT /api/delivery-charges/:id
 * Update a delivery charge value (admin use).
 */
export const updateDeliveryCharge = async (req, res) => {
  const { id } = req.params;
  const { charge, label, description } = req.body;

  if (charge === undefined) {
    return res.status(400).json({ success: false, message: 'charge is required.' });
  }

  try {
    const ref = db.collection('delivery_charges').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, message: 'Delivery charge not found.' });
    }

    const updates = {
      charge: parseFloat(charge),
      isFree: parseFloat(charge) === 0,
    };
    if (label !== undefined) updates.label = label;
    if (description !== undefined) updates.description = description;

    await ref.update(updates);
    const updated = await ref.get();

    return res.status(200).json({
      success: true,
      message: 'Delivery charge updated successfully.',
      charge: updated.data(),
    });
  } catch (err) {
    console.error('[Delivery Charges] Error updating charge:', err);
    return res.status(500).json({ success: false, message: 'Failed to update.', error: err.message });
  }
};
