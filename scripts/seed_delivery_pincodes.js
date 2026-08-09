import db from '../config/db.js';

const tricityPincodes = [
  // ─── CHANDIGARH ─────────────────────────────────────────────────────────
  '160001', '160002', '160003', '160004', '160005', '160009', '160010',
  '160011', '160012', '160014', '160015', '160017', '160018', '160019',
  '160020', '160021', '160022', '160023', '160024', '160025', '160026',
  '160028', '160029', '160030', '160031', '160032', '160033', '160034',
  '160035', '160036', '160037', '160038', '160044', '160047', '160048',
  '160049', '160050', '160055', '160059', '160062', '160070', '160071',
  '160101', '160102', '160103',

  // ─── MOHALI (SAS NAGAR / KHARAR / ZIRAKPUR) ─────────────────────────────
  '140055', '140301', '140306', '140307', '140308', '140413', '140501',
  '140507', '140603', '140604', '140706',

  // ─── PANCHKULA / PINJORE / KALKA ────────────────────────────────────────
  '134107', '134108', '134109', '134112', '134113', '134114', '134115',
  '134116', '134117', '134118', '133301', '133302'
];

const detailedPincodeMap = {
  // Chandigarh
  '160001': 'Chandigarh (Sector 1 - 6, Secretariat)',
  '160002': 'Chandigarh (Sector 7 - 9)',
  '160003': 'Chandigarh (Sector 10 - 11)',
  '160004': 'Chandigarh (Sector 12, PGI, PEC)',
  '160005': 'Chandigarh (Sector 14, Panjab University)',
  '160009': 'Chandigarh (Sector 13, Manimajra West)',
  '160010': 'Chandigarh (Sector 10)',
  '160011': 'Chandigarh (Sector 15 - 16, General Hospital)',
  '160012': 'Chandigarh (Sector 17, City Centre)',
  '160014': 'Chandigarh (Sector 18 - 19)',
  '160015': 'Chandigarh (Sector 20 - 21)',
  '160017': 'Chandigarh (Sector 22 - 23, ISBT 17)',
  '160018': 'Chandigarh (Sector 24 - 25)',
  '160019': 'Chandigarh (Sector 26, Grain Market)',
  '160020': 'Chandigarh (Sector 27 - 28)',
  '160021': 'Chandigarh (Sector 29)',
  '160022': 'Chandigarh (Sector 30 - 31)',
  '160023': 'Chandigarh (Sector 32, GMCH 32)',
  '160024': 'Chandigarh (Sector 33 - 34, Sub City Centre)',
  '160025': 'Chandigarh (Sector 35 - 36)',
  '160026': 'Chandigarh (Sector 26 Timber Market)',
  '160028': 'Chandigarh (Sector 28)',
  '160029': 'Chandigarh (Sector 29)',
  '160030': 'Chandigarh (Sector 37 - 38, 38 West)',
  '160031': 'Chandigarh (Sector 31, Air Force Station)',
  '160032': 'Chandigarh (Sector 32)',
  '160033': 'Chandigarh (Sector 33)',
  '160034': 'Chandigarh (Sector 34)',
  '160035': 'Chandigarh (Sector 35)',
  '160036': 'Chandigarh (Sector 39 - 40)',
  '160037': 'Chandigarh (Sector 37)',
  '160038': 'Chandigarh (Sector 38)',
  '160044': 'Chandigarh (Sector 44)',
  '160047': 'Chandigarh (Sector 41 - 42)',
  '160048': 'Chandigarh (Sector 48)',
  '160049': 'Chandigarh (Sector 49)',
  '160050': 'Chandigarh (Sector 50)',
  '160055': 'Chandigarh / Mohali Border (Sector 43 - 44, ISBT 43)',
  '160059': 'Chandigarh (Sector 45 - 46, Burail)',
  '160062': 'Chandigarh (Sector 47 - 48)',
  '160070': 'Mohali (Phase 7 - 11)',
  '160071': 'Mohali / Chandigarh (Sector 51 - 56, Phase 1 - 6)',
  '160101': 'Chandigarh (Mani Majra, IT Park)',
  '160102': 'Chandigarh (International Airport Area / Behlana)',
  '160103': 'Chandigarh (Burail / Dhanas)',

  // Mohali
  '140055': 'Mohali (Phase 1 to 11, Industrial Area)',
  '140301': 'Kharar / Landran / Sunny Enclave (Mohali)',
  '140306': 'SAS Nagar (Sector 68 - 82, Aerocity, IT City)',
  '140307': 'New Chandigarh / Mullanpur (Mohali)',
  '140308': 'Chunni Kalan / Landran Extension (Mohali)',
  '140413': 'Banur / Tepla (Mohali)',
  '140501': 'Zirakpur (VIP Road, Dhakoli, Baltana)',
  '140507': 'Dera Bassi / Mubarikpur (Mohali)',
  '140603': 'Zirakpur / Peer Muchalla (Mohali)',
  '140604': 'Baltana / Zirakpur (Mohali)',
  '140706': 'Dera Bassi (Mohali)',

  // Panchkula
  '134107': 'Panchkula (Sector 1 - 4, Mansa Devi Complex)',
  '134108': 'Panchkula (Sector 5 - 8)',
  '134109': 'Panchkula (Sector 9 - 16, Industrial Area)',
  '134112': 'Panchkula (Sector 17 - 21, MDC Sector 4-6)',
  '134113': 'Panchkula (Sector 23 - 28, Alchemist Hospital)',
  '134114': 'Panchkula (Barwala, Ramgarh)',
  '134115': 'Pinjore / Surajpur (Panchkula)',
  '134116': 'Panchkula (Sector 21, Sector 20 Ext.)',
  '134117': 'Panchkula (Mansa Devi Complex Sector 4-5)',
  '134118': 'Panchkula (Urban Estate)',
  '133301': 'Kalka (Panchkula Region)',
  '133302': 'Pinjore (Panchkula Region)'
};

async function seedDeliveryPincodes() {
  try {
    console.log('Seeding delivery_pincodes collection in Firestore...');

    const docRef = db.collection('delivery_pincodes').doc('tricity');
    await docRef.set({
      region: 'Chandigarh, Panchkula & Mohali (Tricity)',
      pincodes: tricityPincodes,
      locations: detailedPincodeMap,
      count: tricityPincodes.length,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    console.log(`✅ Successfully created collection 'delivery_pincodes' with document 'tricity' (${tricityPincodes.length} pincodes)!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding delivery_pincodes:', error);
    process.exit(1);
  }
}

seedDeliveryPincodes();
