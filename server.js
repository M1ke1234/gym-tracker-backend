const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// JWT Secret Key
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';
const SALT_ROUNDS = 10;

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check route (altijd werkend)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    port: port,
    hasDatabase: !!process.env.DATABASE_URL
  });
});

// Database setup (alleen als DATABASE_URL beschikbaar is)
let db = null;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  // Test database verbinding
  db.connect()
    .then(client => {
      console.log('✅ Verbonden met PostgreSQL database');
      client.release();
      initializeDatabase();
    })
    .catch(err => {
      console.error('❌ Database verbinding fout:', err.message);
    });
} else {
  console.log('⚠️  Geen DATABASE_URL gevonden, database routes zijn uitgeschakeld');
}

// Database initialisatie
async function initializeDatabase() {
  if (!db) return;
  
  try {
    const result = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    if (!result.rows[0].exists) {
      console.log('Database tabellen bestaan nog niet. Schema initialiseren...');
      await createTables();
    } else {
      console.log('✅ Database tabellen bestaan al.');
    }
  } catch (err) {
    console.error('❌ Fout bij database initialisatie:', err.message);
  }
}

// Maak tabellen aan
async function createTables() {
  if (!db) return;
  
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        join_date DATE NOT NULL DEFAULT CURRENT_DATE,
        height FLOAT,
        weight FLOAT,
        last_login TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
        category_id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exercises (
        exercise_id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        category_id INTEGER REFERENCES categories(category_id),
        equipment TEXT,
        description TEXT
    );

    INSERT INTO categories (name) VALUES 
    ('Borst'), ('Benen'), ('Rug'), ('Schouders'), ('Armen'), ('Kern'), ('Cardio')
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO exercises (name, category_id, equipment) VALUES
    ('Bankdrukken', 1, 'Barbell, Bench'),
    ('Squats', 2, 'Barbell, Squat Rack'),
    ('Deadlift', 3, 'Barbell')
    ON CONFLICT DO NOTHING;
  `;

  try {
    await db.query(schema);
    console.log('✅ Database schema succesvol aangemaakt!');
  } catch (err) {
    console.error('❌ Fout bij aanmaken schema:', err.message);
  }
}

// Middleware voor database check
const requireDatabase = (req, res, next) => {
  if (!db) {
    return res.status(503).json({ error: 'Database niet beschikbaar' });
  }
  next();
};

// API Routes

// Eenvoudige routes zonder database
app.get('/api/exercises', requireDatabase, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT e.exercise_id, e.name, c.name AS category, e.equipment
      FROM exercises e
      JOIN categories c ON e.category_id = c.category_id
      ORDER BY e.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// User registratie
app.post('/api/register', requireDatabase, async (req, res) => {
  const { username, email, password, name } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Gebruikersnaam, e-mail en wachtwoord zijn verplicht' });
  }
  
  try {
    // Check of gebruiker al bestaat
    const existingUser = await db.query(
      'SELECT user_id FROM users WHERE username = $1 OR email = $2', 
      [username, email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Gebruikersnaam of e-mail is al in gebruik' });
    }
    
    // Hash wachtwoord
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Maak gebruiker aan
    const result = await db.query(
      `INSERT INTO users (username, email, password, name) 
       VALUES ($1, $2, $3, $4) RETURNING user_id, username, email, name, join_date`,
      [username, email, hashedPassword, name || null]
    );
    
    const newUser = result.rows[0];
    
    // JWT token
    const token = jwt.sign(
      { id: newUser.user_id, username: newUser.username, email: newUser.email }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: 'Gebruiker succesvol geregistreerd',
      token,
      user: {
        id: newUser.user_id,
        username: newUser.username,
        email: newUser.email,
        name: newUser.name,
        join_date: newUser.join_date
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Server starten
app.listen(port, () => {
  console.log(`🚀 Server draait op http://localhost:${port}`);
  console.log(`🔍 Health check: http://localhost:${port}/api/health`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Server wordt afgesloten...');
  if (db) {
    await db.end();
    console.log('📦 Database verbinding gesloten.');
  }
  process.exit(0);
});