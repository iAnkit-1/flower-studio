// CDN image links for receipt branding and authorized signature
const LOGO_SRC = 'https://cdn.flowerstudiobypushpraj.com/assets/logo.png';
const SIGNATURE_SRC = 'https://cdn.flowerstudiobypushpraj.com/assets/signature.jpg';

/**
 * Format date in IST (Asia/Kolkata) as dd-mm-yyyy
 */
export function formatISTDate(dateVal) {
  if (!dateVal) return 'N/A';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  const options = { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' };
  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const year = parts.find((p) => p.type === 'year')?.value;
  return `${day}-${month}-${year}`;
}

/**
 * Format currency in Indian numbering format
 */
export function formatINR(num) {
  const n = Number(num) || 0;
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);
}

/**
 * Convert number in Indian numbering system to Words (Rupees Only)
 */
export function numberToWordsINR(amount) {
  let num = Math.round(Number(amount) || 0);
  if (num === 0) return 'Zero Rupees Only';
  if (num < 0) return `Minus ${numberToWordsINR(Math.abs(num))}`;

  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(n) {
    if (n < 20) return a[n];
    const digit = n % 10;
    return b[Math.floor(n / 10)] + (digit ? ' ' + a[digit] : '');
  }

  function convert(n) {
    if (n === 0) return '';
    let res = '';
    if (Math.floor(n / 10000000) > 0) {
      res += convert(Math.floor(n / 10000000)) + ' Crore ';
      n %= 10000000;
    }
    if (Math.floor(n / 100000) > 0) {
      res += convert(Math.floor(n / 100000)) + ' Lakh ';
      n %= 100000;
    }
    if (Math.floor(n / 1000) > 0) {
      res += convert(Math.floor(n / 1000)) + ' Thousand ';
      n %= 1000;
    }
    if (Math.floor(n / 100) > 0) {
      res += convert(Math.floor(n / 100)) + ' Hundred ';
      n %= 100;
    }
    if (n > 0) {
      res += inWords(n) + ' ';
    }
    return res.trim();
  }

  return convert(num) + ' Rupees Only';
}

/**
 * Generate standard HTML Tax Invoice / Receipt
 */
export function generateReceiptHtml(order = {}) {
  const safeId = (order.orderId || order.id || 'N/A').toString();
  const creationDate = order.createdAt || order.created_at || order.orderDate;
  const orderDateIST = formatISTDate(creationDate);

  const recipientName =
    order.deliveryDetails?.recipientName ||
    order.recipientName ||
    order.recipient_name ||
    order.customerName ||
    'Valued Customer';

  const recipientPhone =
    order.deliveryDetails?.recipientPhone ||
    order.recipientPhone ||
    order.recipient_phone ||
    order.userPhone ||
    'N/A';

  const rawDeliveryDate =
    order.deliveryDetails?.deliveryDate ||
    order.deliveryDate ||
    '';
  const deliveryDateFormatted = rawDeliveryDate ? formatISTDate(rawDeliveryDate) : 'Standard Delivery';

  const deliverySlot =
    order.deliveryDetails?.deliverySlot ||
    order.deliverySlot ||
    'Standard Delivery';

  const deliveryAddress =
    order.deliveryDetails?.fullAddress ||
    order.deliveryAddress ||
    order.delivery_address ||
    'Address on record';

  const paymentMethod = (order.paymentMethod || order.payment_method || '').toString().toUpperCase();
  const paymentStatus = (order.paymentStatus || order.payment_status || '').toString().toUpperCase();
  const razorpayPaymentId = (
    order.razorpayPaymentId ||
    order.razorpay_payment_id ||
    order.paymentDetails?.razorpay_payment_id ||
    order.paymentDetails?.razorpayPaymentId ||
    ''
  ).toString().trim();

  const isPaid = paymentStatus === 'PAID' || paymentStatus === 'PAIDD';
  const hasPaymentId = Boolean(razorpayPaymentId);

  const items = Array.isArray(order.items) ? order.items : [];

  let tableRows = '';
  let counter = 1;
  let computedItemsSubtotal = 0;

  if (items.length === 0) {
    const singlePrice = parseFloat(order.itemsSubtotal || order.items_subtotal);
    computedItemsSubtotal = singlePrice;
    tableRows = `
      <tr>
        <td class="text-center">1</td>
        <td class="pid-cell">FS-PROD-01</td>
        <td class="item-title-cell">Flower Studio Fresh Collection Item</td>
        <td class="text-right">₹${formatINR(singlePrice)}</td>
        <td class="text-right">₹0</td>
        <td class="text-right">₹${formatINR(singlePrice)}</td>
        <td class="text-center">1</td>
        <td class="text-right bold">₹${formatINR(singlePrice)}</td>
      </tr>
    `;
  } else {
    for (const item of items) {
      const pid = (item.productId || item.id || `PROD-${counter}`).toString();
      const title = item.productTitle || 'Flower Studio Item';
      const mrp = parseFloat(item.listingPrice);
      const unitPrice = parseFloat(item.orderPrice);
      const discount = parseFloat(item.discount ?? Math.max(0, mrp - unitPrice));
      const qty = parseInt(item.quantity);
      const lineAmount = unitPrice * qty;

      computedItemsSubtotal += lineAmount;

      tableRows += `
        <tr>
          <td class="text-center">${counter++}</td>
          <td class="pid-cell">${pid}</td>
          <td class="item-title-cell">
            <span class="product-title-text">${title}</span>
            ${item.cakeMessage ? `<div class="sub-item-note">Cake Message: &ldquo;${item.cakeMessage}&rdquo;</div>` : ''}
          </td>
          <td class="text-right">₹${formatINR(mrp)}</td>
          <td class="text-right">${discount > 0 ? `₹${formatINR(discount)}` : '₹0'}</td>
          <td class="text-right">₹${formatINR(unitPrice)}</td>
          <td class="text-center">${qty}</td>
          <td class="text-right bold">₹${formatINR(lineAmount)}</td>
        </tr>
      `;

      // Handle addons if present
      if (Array.isArray(item.addons) && item.addons.length > 0) {
        for (const addon of item.addons) {
          const addonPid = (addon.productId || addon.id || `ADDON-${counter}`).toString();
          const addonTitle = addon.title || addon.productTitle || addon.name || 'Add-on Item';
          const addonMrp = parseFloat(addon.listingPrice || addon.price || 0);
          const addonUnitPrice = parseFloat(addon.price || addon.orderPrice || addonMrp);
          const addonDiscount = parseFloat(addon.discount || Math.max(0, addonMrp - addonUnitPrice));
          const addonQty = parseInt(addon.quantity || 1, 10);
          const addonAmount = addonUnitPrice * addonQty;

          computedItemsSubtotal += addonAmount;

          tableRows += `
            <tr class="addon-row">
              <td class="text-center">${counter++}</td>
              <td class="pid-cell">${addonPid}</td>
              <td class="item-title-cell addon-title">
                <span class="addon-badge">ADD-ON</span> ${addonTitle}
              </td>
              <td class="text-right">₹${formatINR(addonMrp)}</td>
              <td class="text-right">${addonDiscount > 0 ? `₹${formatINR(addonDiscount)}` : '₹0'}</td>
              <td class="text-right">₹${formatINR(addonUnitPrice)}</td>
              <td class="text-center">${addonQty}</td>
              <td class="text-right bold">₹${formatINR(addonAmount)}</td>
            </tr>
          `;
        }
      }
    }
  }

  // Extra charges & discounts
  const deliveryCharges = parseFloat(
    order.deliveryCharges ?? order.delivery_charges ?? order.delivery_total ?? order.deliveryTotal ?? 0
  );
  const totalDiscount = parseFloat(order.totalDiscount ?? order.total_discount ?? 0);
  const couponDiscount = parseFloat(order.couponDiscount ?? order.coupon_discount ?? 0);
  const couponCode = (order.couponCode || order.coupon_code || '').trim();

  let grandTotal = parseFloat(
    order.grandTotal ?? order.grand_total ?? (computedItemsSubtotal + deliveryCharges - totalDiscount - couponDiscount)
  );
  if (grandTotal <= 0 && computedItemsSubtotal > 0) {
    grandTotal = computedItemsSubtotal + deliveryCharges - totalDiscount - couponDiscount;
  }

  const amountInWords = numberToWordsINR(grandTotal);

  const logoUri = LOGO_SRC;
  const signatureUri = SIGNATURE_SRC;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tax Invoice - ${safeId} - Flower Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: #f1f5f9;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0f172a;
      padding: 24px 16px;
      font-size: 13px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }

    .action-bar {
      max-width: 820px;
      margin: 0 auto 16px auto;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    .btn-print {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
      color: #ffffff;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(17, 24, 39, 0.15);
      transition: all 0.2s ease;
    }

    .btn-print:hover {
      background: #000000;
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .invoice-card {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      padding: 36px 40px;
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
      border: 1px solid #e2e8f0;
      position: relative;
    }

    /* TOP HEADER: Left side logo only, right side branding + address */
    .invoice-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 6px;
    }

    .header-left-logo {
      flex: 0 0 auto;
    }

    .header-left-logo img {
      height: 82px;
      max-width: 140px;
      object-fit: contain;
      display: block;
    }

    .header-left-logo .fallback-logo-text {
      font-family: 'Playfair Display', serif;
      font-size: 26px;
      font-weight: 700;
      color: #be123c;
    }

    .header-right-branding {
      text-align: right;
      flex: 0 0 auto;
    }

    .header-right-branding .brand-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 25px;
      font-weight: 700;
      color: #111827;
      letter-spacing: -0.2px;
      margin-bottom: 4px;
    }

    .header-right-branding .brand-meta {
      font-size: 11.5px;
      color: #000000;
      line-height: 1.5;
      font-weight: 500;
    }

    .header-divider {
      border: 0;
      border-top: 1.5px solid #111827;
      margin: 14px 0 16px 0;
    }

    /* CENTER TITLE: Bold Tax Invoice */
    .tax-invoice-heading {
      text-align: center;
      font-size: 19px;
      font-weight: 800;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #111827;
      margin-bottom: 20px;
    }

    /* 2 SECTIONS: Left (Invoice To) & Right (Invoice Details) */
    .invoice-sections-grid {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 28px;
      margin-bottom: 24px;
      background: #f8fafc;
      padding: 16px 20px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
    }

    .section-box h3 {
      font-size: 13px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 10px;
      padding-bottom: 4px;
      border-bottom: 1px solid #cbd5e1;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .meta-line {
      display: flex;
      align-items: flex-start;
      font-size: 12px;
      margin-bottom: 6px;
      line-height: 1.4;
    }

    .meta-line:last-child {
      margin-bottom: 0;
    }

    .meta-line .lbl {
      width: 110px;
      flex-shrink: 0;
      font-weight: 600;
      color: #475569;
    }

    .meta-line .val {
      flex: 1;
      color: #0f172a;
      word-break: break-word;
    }

    .meta-line .val.bold {
      font-weight: 700;
    }

    /* ITEMS TABLE */
    .table-scroll-hint {
      display: none;
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      margin-bottom: 6px;
      text-align: right;
    }

    .table-container {
      margin-bottom: 20px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .items-table {
      width: 100%;
      min-width: 600px;
      border-collapse: collapse;
      font-size: 12px;
    }

    .items-table thead tr {
      background-color: #f1f5f9;
      border-bottom: 1.5px solid #cbd5e1;
    }

    .items-table th {
      padding: 10px 8px;
      font-size: 11px;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .items-table td {
      padding: 10px 8px;
      border-bottom: 1px solid #f1f5f9;
      color: #1e293b;
      vertical-align: middle;
    }

    .items-table tbody tr:nth-child(even) {
      background-color: #fcfcfd;
    }

    .items-table tbody tr:last-child td {
      border-bottom: none;
    }

    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }

    .pid-cell {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #475569;
      font-weight: 600;
    }

    .item-title-cell {
      font-weight: 600;
      color: #0f172a;
    }

    .sub-item-note {
      font-size: 11px;
      font-weight: normal;
      color: #64748b;
      margin-top: 2px;
      font-style: italic;
    }

    .addon-badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 700;
      color: #be123c;
      background: #ffe4e6;
      padding: 1px 5px;
      border-radius: 4px;
      margin-right: 4px;
    }

    /* TOTALS & CHARGES CALCULATION BOX */
    .summary-wrapper {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }

    .summary-table {
      width: 340px;
      border-collapse: collapse;
      font-size: 12px;
    }

    .summary-table td {
      padding: 5px 0;
      color: #334155;
    }

    .summary-table td:last-child {
      text-align: right;
      font-weight: 600;
      color: #0f172a;
    }

    .summary-table .discount-row td {
      color: #16a34a;
    }

    .summary-table .grand-total-row td {
      border-top: 1.5px solid #111827;
      border-bottom: 1.5px solid #111827;
      padding: 8px 0;
      font-size: 14px;
      font-weight: 800;
      color: #111827;
    }

    .summary-table .grand-total-row td:last-child {
      color: #be123c;
      font-size: 16px;
    }

    /* AMOUNT IN WORDS ROW */
    .amount-words-box {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 12px;
      color: #0f172a;
      margin-bottom: 28px;
    }

    .amount-words-box strong {
      color: #475569;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
      margin-right: 6px;
    }

    /* SIGNATORY SECTION */
    .signatory-container {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }

    .signatory-inner {
      text-align: center;
      width: 240px;
    }

    .signatory-inner .for-company {
      font-size: 12px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 4px;
    }

    .signatory-img-box {
      height: 75px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 4px;
    }

    .signatory-img-box img {
      max-height: 72px;
      max-width: 210px;
      object-fit: contain;
      mix-blend-mode: multiply;
    }

    .signatory-inner .sig-label {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
      border-top: 1px dashed #94a3b8;
      padding-top: 4px;
    }

    /* INVOICE FOOTER */
    .invoice-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
      text-align: center;
      font-size: 11px;
      color: #64748b;
    }

    /* MOBILE RESPONSIVE TWEAKS */
    @media (max-width: 680px) {
      body {
        padding: 12px 8px;
      }
      .action-bar {
        margin-bottom: 12px;
      }
      .btn-print {
        width: 100%;
        justify-content: center;
        padding: 11px 16px;
      }
      .invoice-card {
        padding: 20px 14px;
        border-radius: 8px;
      }
      .invoice-header {
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 12px;
      }
      .header-right-branding {
        text-align: center;
      }
      .tax-invoice-heading {
        font-size: 16px;
        margin-bottom: 14px;
      }
      .invoice-sections-grid {
        grid-template-columns: 1fr;
        gap: 16px;
        padding: 14px;
      }
      .meta-line .lbl {
        width: 105px;
      }
      .table-scroll-hint {
        display: block;
      }
      .table-container {
        border-radius: 6px;
        box-shadow: inset -4px 0 8px -4px rgba(0,0,0,0.08);
      }
      .items-table {
        min-width: 580px;
      }
      .summary-wrapper {
        justify-content: flex-end;
      }
      .summary-table {
        width: 100%;
        max-width: 100%;
      }
      .amount-words-box {
        padding: 10px 12px;
        font-size: 11px;
        margin-bottom: 20px;
      }
      .signatory-container {
        display: flex;
        justify-content: flex-end;
      }
      .signatory-inner {
        width: 200px;
      }
    }

    @media print {
      body {
        background: #ffffff;
        padding: 0;
        font-size: 12px;
      }
      .action-bar, .table-scroll-hint {
        display: none !important;
      }
      .invoice-card {
        box-shadow: none !important;
        border: none !important;
        padding: 0 !important;
        max-width: 100% !important;
      }
      .table-container {
        overflow: visible !important;
        border: 1px solid #cbd5e1 !important;
        box-shadow: none !important;
      }
      .items-table {
        min-width: 100% !important;
        width: 100% !important;
      }
      .invoice-sections-grid {
        grid-template-columns: 1.15fr 0.85fr !important;
      }
      .invoice-header {
        flex-direction: row !important;
        justify-content: space-between !important;
      }
      .header-right-branding {
        text-align: right !important;
      }
      @page {
        size: A4 portrait;
        margin: 12mm 15mm;
      }
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <button class="btn-print" onclick="window.print()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      Print / Download PDF
    </button>
  </div>

  <div class="invoice-card">
    <!-- TOP HEADER -->
    <div class="invoice-header">
      <div class="header-left-logo">
        ${logoUri ? `<img src="${logoUri}" alt="Flower Studio Logo" />` : '<div class="fallback-logo-text">Flower Studio</div>'}
      </div>
      <div class="header-right-branding">
        <div class="brand-title">Flower Studio</div>
        <div class="brand-meta">
          SCO-52, Sector 29D, Chandigarh<br>
          MSME s.no: UDYAM-CH-01-0022686
        </div>
      </div>
    </div>

    <!-- UNDERLINE -->
    <hr class="header-divider" />

    <!-- CENTER BOLD TEXT: Tax Invoice -->
    <div class="tax-invoice-heading">Tax Invoice</div>

    <!-- 2 SECTIONS: Left (Invoice To) & Right (Invoice Details) -->
    <div class="invoice-sections-grid">
      <div class="section-box">
        <h3>Invoice To,</h3>
        <div class="meta-line">
          <span class="lbl">Name:</span>
          <span class="val bold">${recipientName}</span>
        </div>
        <div class="meta-line">
          <span class="lbl">phone:</span>
          <span class="val">${recipientPhone}</span>
        </div>
        <div class="meta-line">
          <span class="lbl">Delivery Date:</span>
          <span class="val">${deliveryDateFormatted}</span>
        </div>
        <div class="meta-line">
          <span class="lbl">Delivery Slot:</span>
          <span class="val">${deliverySlot}</span>
        </div>
        <div class="meta-line">
          <span class="lbl">Delivery Address:</span>
          <span class="val">${deliveryAddress}</span>
        </div>
      </div>

      <div class="section-box">
        <h3>Invoice details</h3>
        <div class="meta-line">
          <span class="lbl">Order id:</span>
          <span class="val bold">${safeId}</span>
        </div>
        <div class="meta-line">
          <span class="lbl">Date:</span>
          <span class="val">${orderDateIST} (IST)</span>
        </div>
        <div class="meta-line" style="margin-top: 10px; border-top: 1px dashed #cbd5e1; padding-top: 6px;">
          <span class="lbl">Payment Mode:</span>
          <span class="val">${paymentMethod} (${paymentStatus})</span>
        </div>
        ${hasPaymentId && isPaid ? `
        <div class="meta-line">
          <span class="lbl">Payment ID:</span>
          <span class="val" style="font-family: monospace; font-size: 11.5px; font-weight: 600; color: #0f172a;">${razorpayPaymentId}</span>
        </div>
        ` : ''}
      </div>
    </div>

    <!-- ITEMS TABLE -->
    <div class="table-scroll-hint">
      <span>⟷ Scroll horizontally to view all columns</span>
    </div>
    <div class="table-container">
      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 4%;" class="text-center">#</th>
            <th style="width: 20%;">PID</th>
            <th style="width: 32%;">ITEMS</th>
            <th style="width: 10%;" class="text-right">mrp</th>
            <th style="width: 10%;" class="text-right">discount</th>
            <th style="width: 11%;" class="text-right">Unit Price</th>
            <th style="width: 5%;" class="text-center">qty</th>
            <th style="width: 10%;" class="text-right">amount</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <!-- CHARGES & GRAND TOTAL SECTION -->
    <div class="summary-wrapper">
      <table class="summary-table">
        <tr>
          <td>Items Subtotal:</td>
          <td>₹${formatINR(order.itemsSubtotal ?? order.items_subtotal)}</td>
        </tr>
        ${deliveryCharges > 0 ? `
        <tr>
          <td>Delivery Charges:</td>
          <td>+ ₹${formatINR(deliveryCharges)}</td>
        </tr>
        ` : `
        <tr>
          <td>Delivery Charges:</td>
          <td><span style="color: #16a34a; font-weight: 600;">FREE</span></td>
        </tr>
        `}
        ${totalDiscount > 0 ? `
        <tr class="discount-row">
          <td>Total Discount:</td>
          <td>- ₹${formatINR(totalDiscount)}</td>
        </tr>
        ` : ''}
        ${couponDiscount > 0 ? `
        <tr class="discount-row">
          <td>Coupon OFF ${couponCode ? `(${couponCode})` : ''}:</td>
          <td>- ₹${formatINR(couponDiscount)}</td>
        </tr>
        ` : ''}
        <tr class="grand-total-row">
          <td>Grand Total:</td>
          <td>₹${formatINR(order.grandTotal ?? order.grand_total)}</td>
        </tr>
      </table>
    </div>

    <!-- AMOUNT IN WORDS SINGLE ROW -->
    <div class="amount-words-box">
      <strong>Amount in words:</strong> ${amountInWords}
    </div>

    <!-- AUTHORIZED SIGNATORY -->
    <div class="signatory-container">
      <div class="signatory-inner">
        <div class="for-company">For Flower Studio</div>
        <div class="signatory-img-box">
          ${signatureUri ? `<img src="${signatureUri}" alt="Authorized Signatory" />` : '<div style="height:40px;"></div>'}
        </div>
        <div class="sig-label">Authorized Signatory</div>
      </div>
    </div>

    <!-- FOOTER -->
    <div class="invoice-footer">
      Thank you for choosing Flower Studio! This is a system-generated tax invoice.
    </div>
  </div>
</body>
</html>`;
}
