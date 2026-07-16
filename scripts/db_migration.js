import { pool } from '../config/db.js';

const migrationQuery = `
  -- 1. Alter products table to add add_ons and similar_items arrays
  ALTER TABLE products ADD COLUMN IF NOT EXISTS add_ons VARCHAR(50)[] DEFAULT '{}';
  ALTER TABLE products ADD COLUMN IF NOT EXISTS similar_items VARCHAR(50)[] DEFAULT '{}';

  -- 2. Create custom_orders table
  CREATE TABLE IF NOT EXISTS custom_orders (
    id VARCHAR(100) PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    reference_image_url TEXT,
    budget NUMERIC(10, 2) NOT NULL,
    required_date TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending Review',
    calculated_cost NUMERIC(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 3. Create requested_orders table
  CREATE TABLE IF NOT EXISTS requested_orders (
    id VARCHAR(100) PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    product_id VARCHAR(100) NOT NULL,
    product_title VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    notes TEXT,
    budget NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 4. Create support_tickets table
  CREATE TABLE IF NOT EXISTS support_tickets (
    id VARCHAR(100) PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    order_id VARCHAR(100),
    category VARCHAR(100) NOT NULL,
    priority VARCHAR(50) NOT NULL DEFAULT 'Medium',
    status VARCHAR(50) NOT NULL DEFAULT 'Open',
    assigned_agent VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 5. Create support_messages table
  CREATE TABLE IF NOT EXISTS support_messages (
    id SERIAL PRIMARY KEY,
    ticket_id VARCHAR(100) REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

const seedQuery = `
  -- Seed Custom Orders if empty
  INSERT INTO custom_orders (id, customer_name, customer_email, category, description, reference_image_url, budget, required_date, status)
  SELECT 'CUST-3901', 'Kavita Sen', 'kavita@gmail.com', 'Bouquet', 'A massive 50-stem red and yellow rose heart arrangement with premium ribbons.', 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?auto=format&fit=crop&q=80&w=300', 4500.0, NOW() + INTERVAL '2 days', 'Pending Review'
  WHERE NOT EXISTS (SELECT 1 FROM custom_orders WHERE id = 'CUST-3901');

  -- Seed Requested Orders if empty
  INSERT INTO requested_orders (id, customer_name, customer_email, product_id, product_title, quantity, notes, budget, status)
  SELECT 'REQ-7201', 'Pranav Roy', 'pranav@outlook.com', 'f_rare_1', 'Divine Himalayan Brahma Kamal (Rare)', 1, 'Urgent request for grandparent birthday prayer event.', 1499.0, 'Pending'
  WHERE NOT EXISTS (SELECT 1 FROM requested_orders WHERE id = 'REQ-7201');

  -- Seed Support Tickets if empty
  INSERT INTO support_tickets (id, customer_name, order_id, category, priority, status, assigned_agent)
  SELECT 'TKT-892', 'Aanchal Mittal', 'ORD-5398', 'Late Delivery', 'High', 'Open', NULL
  WHERE NOT EXISTS (SELECT 1 FROM support_tickets WHERE id = 'TKT-892');

  -- Seed Support Messages if empty
  INSERT INTO support_messages (ticket_id, sender, message)
  SELECT 'TKT-892', 'Customer', 'My order ORD-5398 was scheduled to arrive by 5:00 PM, but it is 5:30 PM and the rider has not contacted me. Can you please check?'
  WHERE NOT EXISTS (SELECT 1 FROM support_messages WHERE ticket_id = 'TKT-892');
`;

async function migrate() {
  console.log('Connecting to database and running migrations...');
  try {
    await pool.query(migrationQuery);
    console.log('Table structures migrated successfully!');
    
    await pool.query(seedQuery);
    console.log('Demo seed data injected successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
    console.log('Database connection closed.');
  }
}

migrate();
