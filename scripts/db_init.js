import { pool } from '../config/db.js';

const createTablesQuery = `
  CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    hsn_code VARCHAR(50),
    barcode VARCHAR(100),
    sku VARCHAR(100),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    mrp NUMERIC(10, 2) NOT NULL,
    sale_price NUMERIC(10, 2) NOT NULL,
    discount_percentage NUMERIC(5, 2),
    ratings NUMERIC(3, 2),
    reviews_count INT DEFAULT 0,
    category VARCHAR(100) NOT NULL,
    sub_category VARCHAR(100) NOT NULL,
    availability VARCHAR(50) NOT NULL,
    stock NUMERIC(10, 2) NOT NULL,
    tags TEXT[] DEFAULT '{}',
    addons JSONB DEFAULT '{}',
    occasions TEXT[] DEFAULT '{}',
    images TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(100) PRIMARY KEY,
    recipient_name VARCHAR(255) NOT NULL,
    recipient_phone VARCHAR(20) NOT NULL,
    delivery_address TEXT NOT NULL,
    gift_message TEXT,
    items_subtotal NUMERIC(10, 2) NOT NULL,
    addons_subtotal NUMERIC(10, 2) NOT NULL,
    delivery_total NUMERIC(10, 2) NOT NULL,
    grand_total NUMERIC(10, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_status VARCHAR(50) DEFAULT 'pending',
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    razorpay_signature VARCHAR(255),
    delivery_status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
    product_id VARCHAR(100) NOT NULL,
    product_title VARCHAR(255) NOT NULL,
    product_image VARCHAR(500),
    quantity INT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    delivery_date TIMESTAMP,
    delivery_slot VARCHAR(100),
    delivery_price NUMERIC(10, 2) DEFAULT 0.0,
    addons JSONB DEFAULT '[]'
  );
`;

async function initDb() {
  console.log('Connecting to Neon Database to run schema migrations (ES6)...');
  try {
    await pool.query(createTablesQuery);
    console.log('Database tables initialized successfully!');
  } catch (err) {
    console.error('Error migrating PostgreSQL schema:', err);
  } finally {
    await pool.end();
    console.log('Database connection pool closed.');
  }
}

initDb();
