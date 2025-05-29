// server.js - Backend voor GymTracker App met PostgreSQL
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// JWT Secret Key
const JWT_SECRET = process.env.JWT_SECRET || 'jouw_geheime_sleutel_hier';
const SALT_ROUNDS = 10;

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Middleware voor authenticatie controle
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authenticatie vereist' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Ongeldige of verlopen token' });
    }
    
    req.user = user;
    next();
  });
};

// PostgreSQL Database verbinding
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database verbinding en initialiseer
db.connect()
  .then(() => {
    console.log('Verbonden met PostgreSQL database');
    initializeDatabase();
  })
  .catch(err => {
    console.error('Database verbinding fout:', err);
  });

// Database initialisatie
async function initializeDatabase() {
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
      console.log('Database tabellen bestaan al.');
    }
  } catch (err) {
    console.error('Fout bij database initialisatie:', err);
  }
}

// Maak tabellen aan
async function createTables() {
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
        description TEXT,
        instructions TEXT,
        video_url VARCHAR(255)
    );

    CREATE TABLE IF NOT EXISTS equipment (
        equipment_id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        location VARCHAR(100),
        last_maintenance DATE
    );

    CREATE TABLE IF NOT EXISTS nfc_tags (
        tag_id VARCHAR(100) PRIMARY KEY,
        equipment_id VARCHAR(20) NOT NULL REFERENCES equipment(equipment_id),
        exercise_id INTEGER NOT NULL REFERENCES exercises(exercise_id),
        date_registered DATE NOT NULL DEFAULT CURRENT_DATE,
        last_scanned TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workouts (
        workout_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id),
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        start_time TIME,
        end_time TIME,
        notes TEXT
    );

    CREATE TABLE IF NOT EXISTS workout_exercises (
        workout_exercise_id SERIAL PRIMARY KEY,
        workout_id INTEGER NOT NULL REFERENCES workouts(workout_id),
        exercise_id INTEGER NOT NULL REFERENCES exercises(exercise_id),
        equipment_id VARCHAR(20) REFERENCES equipment(equipment_id)
    );

    CREATE TABLE IF NOT EXISTS exercise_sets (
        set_id SERIAL PRIMARY KEY,
        workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(workout_exercise_id),
        set_number INTEGER NOT NULL,
        weight FLOAT,
        reps INTEGER,
        duration INTEGER,
        notes TEXT
    );

    CREATE TABLE IF NOT EXISTS personal_records (
        pr_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id),
        exercise_id INTEGER NOT NULL REFERENCES exercises(exercise_id),
        value FLOAT NOT NULL,
        date_achieved DATE NOT NULL DEFAULT CURRENT_DATE,
        type VARCHAR(20) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS progress_tracking (
        progress_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id),
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        weight FLOAT,
        body_fat_percentage FLOAT
    );

    INSERT INTO categories (name) VALUES 
    ('Borst'), ('Benen'), ('Rug'), ('Schouders'), ('Armen'), ('Kern'), ('Cardio'), ('Alle')
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO equipment (equipment_id, name, location) VALUES
    ('BP001', 'Bench Press Station', 'Free Weights Area'),
    ('SQ001', 'Squat Rack', 'Free Weights Area'),
    ('LP001', 'Leg Press Machine', 'Machine Area'),
    ('CR001', 'Calf Raise Machine', 'Machine Area'),
    ('CB001', 'Cable Machine', 'Cable Station')
    ON CONFLICT (equipment_id) DO NOTHING;

    INSERT INTO exercises (name, category_id, equipment) VALUES
    ('Bankdrukken', 1, 'Barbell, Bench'),
    ('Squats', 2, 'Barbell, Squat Rack'),
    ('Shoulder Press', 4, 'Dumbbells, Bench'),
    ('Deadlift', 3, 'Barbell'),
    ('Bicep Curls', 5, 'Dumbbells')
    ON CONFLICT DO NOTHING;
  `;

  try {
    await db.query(schema);
    console.log('Database schema succesvol aangemaakt!');
  } catch (err) {
    console.error('Fout bij aanmaken schema:', err);
  }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'API is running' });
});

// Alle oefeningen ophalen
app.get('/api/exercises', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT e.exercise_id, e.name, c.name AS category, e.equipment, e.description
      FROM exercises e
      JOIN categories c ON e.category_id = c.category_id
      ORDER BY e.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User registratie
app.post('/api/register', async (req, res) => {
  const { username, email, password, name, height, weight } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Gebruikersnaam, e-mail en wachtwoord zijn verplicht' });
  }
  
  try {
    // Controleer of gebruiker al bestaat
    const existingUser = await db.query(
      'SELECT user_id FROM users WHERE username = $1 OR email = $2', 
      [username, email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Gebruikersnaam of e-mail is al in gebruik' });
    }
    
    // Hash het wachtwoord
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Maak een nieuwe gebruiker aan
    const result = await db.query(
      `INSERT INTO users (username, email, password, name, height, weight) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id, username, email, name, join_date`,
      [username, email, hashedPassword, name || null, height || null, weight || null]
    );
    
    const newUser = result.rows[0];
    
    // Genereer JWT token
    const token = jwt.sign(
      { id: newUser.user_id, username: newUser.username, email: newUser.email }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );
    
    return res.status(201).json({
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
    return res.status(500).json({ error: error.message });
  }
});

// User login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });
  }
  
  try {
    // Zoek gebruiker in database
    const result = await db.query(
      `SELECT user_id, username, email, password, name, join_date 
       FROM users 
       WHERE username = $1 OR email = $1`,
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord' });
    }
    
    const user = result.rows[0];
    
    // Controleer wachtwoord
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord' });
    }
    
    // Genereer JWT token
    const token = jwt.sign(
      { id: user.user_id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    return res.json({
      message: 'Login succesvol',
      token,
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
        name: user.name,
        join_date: user.join_date
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Server starten
app.listen(port, () => {
  console.log(`Server draait op http://localhost:${port}`);
});

// Shut down database connection when app is terminated
process.on('SIGINT', () => {
  db.end(() => {
    console.log('Database verbinding gesloten.');
    process.exit(0);
  });
});