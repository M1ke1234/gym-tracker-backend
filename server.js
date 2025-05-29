// server.js - Backend voor GymTracker App met NFC-functionaliteit
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// JWT Secret Key (in productie zou dit in een .env bestand moeten staan)
const JWT_SECRET = 'jouw_geheime_sleutel_hier'; // Vervang dit door een sterke willekeurige string
const SALT_ROUNDS = 10;
// Middleware voor authenticatie controle
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN format
  
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
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

const fs = require('fs');
const path = require('path');

// Database verbinding
const db = new sqlite3.Database('./database/gymtracker.db', (err) => {
  if (err) {
    console.error('Kon geen verbinding maken met database:', err.message);
  } else {
    console.log('Verbonden met de SQLite database.');
    
    // Controleer of de database al is geïnitialiseerd
// Wijzig dit deel in je database verbindingscode
// Controleer of de database al is geïnitialiseerd
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
  if (err) {
    console.error('Fout bij controleren van tabellen:', err.message);
  } else if (!row) {
    console.log('Database tabellen bestaan nog niet. Schema initialiseren...');
    
    // Lees schema.sql bestand
    const schemaPath = path.join(__dirname, './database/schema.sql');
    
    try {
      // Controleer of het bestand bestaat
      if (!fs.existsSync(schemaPath)) {
        console.error('Schema bestand niet gevonden op:', schemaPath);
        return;
      }
      
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      console.log('Schema bestand gelezen, lengte:', schemaSql.length);
      
      // Voer elke SQL-statement afzonderlijk uit
      const statements = schemaSql.split(';').filter(stmt => stmt.trim());
      console.log('Aantal SQL statements gevonden:', statements.length);
      
      db.serialize(() => {
        statements.forEach((statement, index) => {
          if (statement.trim()) {
            db.run(statement + ';', err => {
              if (err) {
                console.error(`Fout bij uitvoeren SQL statement #${index+1}:`, err.message);
                console.error('SQL statement:', statement);
              } else {
                console.log(`SQL statement #${index+1} succesvol uitgevoerd`);
              }
            });
          }
        });
        
        console.log('Database schema initialisatie voltooid!');
      });
      
    } catch (err) {
      console.error('Fout bij lezen schema.sql bestand:', err.message);
      console.error('Stack trace:', err.stack);
    }
  } else {
    console.log('Database tabellen bestaan al.');
  }
});
  }
});
// API Routes

// 1. NFC tag opzoeken
app.get('/api/nfc-tags/:tagId', (req, res) => {
  const { tagId } = req.params;
  
  const sql = `
    SELECT t.tag_id, t.equipment_id, e.name AS equipment_name, 
           t.exercise_id, ex.name AS exercise_name, ex.category_id,
           c.name AS category_name, e.location
    FROM nfc_tags t
    JOIN equipment e ON t.equipment_id = e.equipment_id
    JOIN exercises ex ON t.exercise_id = ex.exercise_id
    JOIN categories c ON ex.category_id = c.category_id
    WHERE t.tag_id = ?
  `;
  
  db.get(sql, [tagId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'NFC tag niet gevonden' });
    }
    
    // Update last_scanned timestamp
    db.run(
      'UPDATE nfc_tags SET last_scanned = CURRENT_TIMESTAMP WHERE tag_id = ?',
      [tagId],
      function(err) {
        if (err) {
          console.error('Fout bij updaten last_scanned:', err.message);
        }
      }
    );
    
    return res.json(row);
  });
});

// 2. NFC tag registreren of bijwerken
app.post('/api/nfc-tags', (req, res) => {
  const { tag_id, equipment_id, exercise_id } = req.body;
  
  if (!tag_id || !equipment_id || !exercise_id) {
    return res.status(400).json({ error: 'Verplichte velden ontbreken' });
  }
  
  // Controleer eerst of de tag al bestaat
  db.get('SELECT tag_id FROM nfc_tags WHERE tag_id = ?', [tag_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    let sql;
    let params;
    
    if (row) {
      // Update bestaande tag
      sql = `
        UPDATE nfc_tags 
        SET equipment_id = ?, exercise_id = ?, date_registered = CURRENT_DATE 
        WHERE tag_id = ?
      `;
      params = [equipment_id, exercise_id, tag_id];
    } else {
      // Maak nieuwe tag aan
      sql = `
        INSERT INTO nfc_tags (tag_id, equipment_id, exercise_id, date_registered) 
        VALUES (?, ?, ?, CURRENT_DATE)
      `;
      params = [tag_id, equipment_id, exercise_id];
    }
    
    db.run(sql, params, function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      return res.json({
        message: row ? 'Tag bijgewerkt' : 'Tag geregistreerd',
        tag_id: tag_id
      });
    });
  });
});

// 3. Oefening geschiedenis ophalen
app.get('/api/exercise-history/:exerciseId/:userId', (req, res) => {
  const { exerciseId, userId } = req.params;
  
  // Eerst, haal de workout datums en exercise IDs op
  const sql = `
    SELECT w.date, we.workout_exercise_id
    FROM workouts w
    JOIN workout_exercises we ON w.workout_id = we.workout_id
    WHERE we.exercise_id = ? AND w.user_id = ?
    ORDER BY w.date DESC
    LIMIT 10
  `;
  
  db.all(sql, [exerciseId, userId], (err, workoutExercises) => {
    if (err) {
      console.error("Fout bij ophalen oefengeschiedenis:", err.message);
      return res.status(500).json({ error: err.message });
    }
    
    if (workoutExercises.length === 0) {
      return res.json([]);
    }
    
    // Gebruik Promise.all om sets voor elke workout oefening op te halen
    const workoutPromises = workoutExercises.map(workoutExercise => {
      return new Promise((resolve, reject) => {
        // Haal sets op voor deze workout oefening
        const setsSql = `
          SELECT set_number, weight, reps
          FROM exercise_sets
          WHERE workout_exercise_id = ?
          ORDER BY set_number
        `;
        
        db.all(setsSql, [workoutExercise.workout_exercise_id], (err, sets) => {
          if (err) {
            console.error("Fout bij ophalen sets:", err.message);
            reject(err);
            return;
          }
          
          resolve({
            date: workoutExercise.date,
            workout_exercise_id: workoutExercise.workout_exercise_id,
            sets: sets
          });
        });
      });
    });
    
    // Wacht tot alle promises zijn opgelost
    Promise.all(workoutPromises)
      .then(results => {
        res.json(results);
      })
      .catch(error => {
        console.error("Fout bij verwerken oefengeschiedenis:", error);
        res.status(500).json({ error: "Fout bij verwerken oefengeschiedenis data" });
      });
  });
});

// 4. Set toevoegen aan workout
app.post('/api/sets', (req, res) => {
  const { user_id, exercise_id, equipment_id, weight, reps, notes } = req.body;
  
  if (!user_id || !exercise_id || !weight) {
    return res.status(400).json({ error: 'Verplichte velden ontbreken' });
  }
  
  // Begin een transactie
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // 1. Controleer of er een actieve workout is voor vandaag
    db.get(
      'SELECT workout_id FROM workouts WHERE user_id = ? AND date = CURRENT_DATE AND end_time IS NULL',
      [user_id],
      (err, workout) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }
        
        let workoutId;
        
        if (workout) {
          workoutId = workout.workout_id;
          processWorkoutExercise();
        } else {
          // Maak een nieuwe workout aan
          db.run(
            'INSERT INTO workouts (user_id, date, start_time) VALUES (?, CURRENT_DATE, CURRENT_TIME)',
            [user_id],
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
              }
              
              workoutId = this.lastID;
              processWorkoutExercise();
            }
          );
        }
        
        // 2. Controleer of de oefening al toegevoegd is aan de workout
        function processWorkoutExercise() {
          db.get(
            'SELECT workout_exercise_id FROM workout_exercises WHERE workout_id = ? AND exercise_id = ?',
            [workoutId, exercise_id],
            (err, workoutExercise) => {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
              }
              
              let workoutExerciseId;
              
              if (workoutExercise) {
                workoutExerciseId = workoutExercise.workout_exercise_id;
                addSet();
              } else {
                // Voeg de oefening toe aan de workout
                db.run(
                  'INSERT INTO workout_exercises (workout_id, exercise_id, equipment_id) VALUES (?, ?, ?)',
                  [workoutId, exercise_id, equipment_id || null],
                  function(err) {
                    if (err) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: err.message });
                    }
                    
                    workoutExerciseId = this.lastID;
                    addSet();
                  }
                );
              }
              
              // 3. Vind het volgende set nummer
              function addSet() {
                db.get(
                  'SELECT MAX(set_number) as max_set FROM exercise_sets WHERE workout_exercise_id = ?',
                  [workoutExerciseId],
                  (err, result) => {
                    if (err) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: err.message });
                    }
                    
                    const nextSetNumber = (result.max_set || 0) + 1;
                    
                    // 4. Voeg de set toe
                    db.run(
                      `INSERT INTO exercise_sets 
                       (workout_exercise_id, set_number, weight, reps, notes) 
                       VALUES (?, ?, ?, ?, ?)`,
                      [workoutExerciseId, nextSetNumber, weight, reps || null, notes || null],
                      function(err) {
                        if (err) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: err.message });
                        }
                        
                        // 5. Controleer op persoonlijk record
                        checkPersonalRecord(this.lastID, nextSetNumber);
                      }
                    );
                  }
                );
              }
              
              // 5. Controleer of dit een persoonlijk record is
              function checkPersonalRecord(setId, setNumber) {
                db.get(
                  `SELECT MAX(value) as current_pr 
                   FROM personal_records 
                   WHERE user_id = ? AND exercise_id = ? AND type = 'weight'`,
                  [user_id, exercise_id],
                  (err, record) => {
                    if (err) {
                      console.error('Fout bij controleren PR:', err);
                      // Ga door met commit, dit is niet kritiek
                    }
                    
                    // Als dit een nieuw PR is, sla het op
                    if (!record || !record.current_pr || weight > record.current_pr) {
                      db.run(
                        `INSERT INTO personal_records 
                         (user_id, exercise_id, value, date_achieved, type) 
                         VALUES (?, ?, ?, CURRENT_DATE, 'weight')`,
                        [user_id, exercise_id, weight],
                        (err) => {
                          if (err) {
                            console.error('Fout bij opslaan PR:', err);
                            // Ga door met commit, dit is niet kritiek
                          }
                        }
                      );
                    }
                    
                    // Commit de transactie
                    db.run('COMMIT', (err) => {
                      if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: 'Commit fout: ' + err.message });
                      }
                      
                      return res.json({
                        success: true,
                        set_id: setId,
                        workout_id: workoutId,
                        workout_exercise_id: workoutExerciseId,
                        set_number: setNumber,
                        is_personal_record: (!record || !record.current_pr || weight > record.current_pr)
                      });
                    });
                  }
                );
              }
            }
          );
        }
      }
    );
  });
});

// 5. Alle apparatuur ophalen
app.get('/api/equipment', (req, res) => {
  const sql = 'SELECT * FROM equipment ORDER BY name';
  
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    return res.json(rows);
  });
});

// 6. Alle oefeningen ophalen
app.get('/api/exercises', (req, res) => {
  const sql = `
    SELECT e.exercise_id, e.name, c.name AS category, e.equipment, e.description
    FROM exercises e
    JOIN categories c ON e.category_id = c.category_id
    ORDER BY e.name
  `;
  
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    return res.json(rows);
  });
});

// 7. Oefeningen per categorie ophalen
app.get('/api/exercises/category/:categoryId', (req, res) => {
  const { categoryId } = req.params;
  
  const sql = `
    SELECT e.exercise_id, e.name, c.name AS category, e.equipment, e.description
    FROM exercises e
    JOIN categories c ON e.category_id = c.category_id
    WHERE e.category_id = ?
    ORDER BY e.name
  `;
  
  db.all(sql, [categoryId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    return res.json(rows);
  });
});

// 7a. Nieuwe oefening toevoegen
app.post('/api/exercises', (req, res) => {
  const { name, category_id, equipment, description, instructions, video_url } = req.body;
  
  if (!name || !category_id) {
    return res.status(400).json({ error: 'Naam en categorie zijn verplicht' });
  }
  
  const sql = `
    INSERT INTO exercises (name, category_id, equipment, description, instructions, video_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  
  db.run(sql, [name, category_id, equipment || null, description || null, instructions || null, video_url || null], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    return res.json({
      success: true,
      exercise_id: this.lastID,
      message: 'Oefening toegevoegd'
    });
  });
});

// 8. Persoonlijke records ophalen
app.get('/api/personal-records/:userId', (req, res) => {
  const { userId } = req.params;
  
  const sql = `
    SELECT pr.pr_id, pr.value, pr.date_achieved, pr.type,
           e.exercise_id, e.name AS exercise_name, c.name AS category
    FROM personal_records pr
    JOIN exercises e ON pr.exercise_id = e.exercise_id
    JOIN categories c ON e.category_id = c.category_id
    WHERE pr.user_id = ?
    ORDER BY pr.date_achieved DESC
  `;
  
  db.all(sql, [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    return res.json(rows);
  });
});

// 9. Workouts ophalen voor een gebruiker
// 9. Workouts ophalen voor een gebruiker met oefeningen
app.get('/api/workouts/:userId', (req, res) => {
  const { userId } = req.params;
  
  console.log(`Verzoek voor workouts van gebruiker ID: ${userId}`);
  
  // Basis check om zeker te zijn dat userId een nummer is
  const userIdNum = parseInt(userId, 10);
  if (isNaN(userIdNum)) {
    console.error(`Ongeldig gebruikers-ID: ${userId}`);
    return res.status(400).json({ error: "Ongeldig gebruikers-ID" });
  }
  
  // Stap 1: Haal alle workouts op voor deze gebruiker
  const sql = `
    SELECT workout_id, date, start_time, end_time
    FROM workouts
    WHERE user_id = ?
    ORDER BY date DESC, start_time DESC
  `;
  
  console.log(`SQL query: ${sql.replace(/\s+/g, ' ')}`);
  
  // Voer de query uit
  db.all(sql, [userIdNum], (err, workouts) => {
    if (err) {
      console.error(`Database fout: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
    
    console.log(`Gevonden workouts: ${workouts.length}`);
    
    if (workouts.length === 0) {
      return res.json([]);
    }
    
    // Stap 2: Haal oefeningen op voor elke workout
    const workoutPromises = workouts.map(workout => {
      return new Promise((resolve, reject) => {
        const exercisesSql = `
          SELECT DISTINCT e.name
          FROM workout_exercises we
          JOIN exercises e ON we.exercise_id = e.exercise_id
          WHERE we.workout_id = ?
        `;
        
        db.all(exercisesSql, [workout.workout_id], (err, exercises) => {
          if (err) {
            console.error(`Fout bij ophalen oefeningen voor workout ${workout.workout_id}:`, err.message);
            reject(err);
            return;
          }
          
          // Format datum (optioneel)
          let formattedDate = workout.date;
          try {
            const date = new Date(workout.date);
            if (!isNaN(date.getTime())) {
              // Optioneel: gebruik toLocaleDateString voor mooiere datums
              formattedDate = date.toISOString().split('T')[0]; // YYYY-MM-DD formaat
            }
          } catch (e) {
            console.error(`Fout bij formatteren datum: ${e.message}`);
          }
          
          // Stuur workout info inclusief oefeningen
          resolve({
            workout_id: workout.workout_id,
            date: formattedDate,
            exercises: exercises.map(e => e.name) // Array van oefeningsnamen
          });
        });
      });
    });
    
    // Stap 3: Wacht tot alle promises zijn opgelost
    Promise.all(workoutPromises)
      .then(results => {
        console.log(`Workouts met oefeningen opgehaald: ${results.length}`);
        res.json(results);
      })
      .catch(error => {
        console.error("Fout bij verwerken workouts:", error);
        res.status(500).json({ error: "Fout bij verwerken workout gegevens" });
      });
  });
});
// 10. Workout details ophalen
app.get('/api/workouts/:workoutId/details', (req, res) => {
  const { workoutId } = req.params;
  
  const sql = `
    SELECT we.workout_exercise_id, e.name AS exercise_name,
           es.set_number, es.weight, es.reps
    FROM workout_exercises we
    JOIN exercises e ON we.exercise_id = e.exercise_id
    JOIN exercise_sets es ON we.workout_exercise_id = es.workout_exercise_id
    WHERE we.workout_id = ?
    ORDER BY e.name, es.set_number
  `;
  
  db.all(sql, [workoutId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Group the results by exercise
    const exercises = {};
    rows.forEach(row => {
      if (!exercises[row.exercise_name]) {
        exercises[row.exercise_name] = [];
      }
      
      exercises[row.exercise_name].push({
        set_number: row.set_number,
        weight: row.weight,
        reps: row.reps
      });
    });
    
    // Convert to array format expected by the frontend
    const result = Object.keys(exercises).map(exerciseName => {
      return {
        name: exerciseName,
        sets: exercises[exerciseName].length,
        reps: exercises[exerciseName][0].reps,
        weight: exercises[exerciseName][0].weight,
        details: exercises[exerciseName].map(set => ({
          set: set.set_number,
          reps: set.reps,
          weight: set.weight
        }))
      };
    });
    
    return res.json(result);
  });
});
// User registratie
app.post('/api/register', async (req, res) => {
  const { username, email, password, name, height, weight } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Gebruikersnaam, e-mail en wachtwoord zijn verplicht' });
  }
  
  try {
    // Controleer of gebruiker al bestaat
    db.get('SELECT user_id FROM users WHERE username = ? OR email = ?', 
      [username, email], 
      async (err, existingUser) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (existingUser) {
          return res.status(409).json({ error: 'Gebruikersnaam of e-mail is al in gebruik' });
        }
        
        try {
          // Hash het wachtwoord
          const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
          
          // Maak een nieuwe gebruiker aan
          db.run(
            `INSERT INTO users 
             (username, email, password, name, height, weight, join_date) 
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE)`,
            [username, email, hashedPassword, name || null, height || null, weight || null],
            function(err) {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              
              // Genereer JWT token
              const userId = this.lastID;
              const token = jwt.sign({ id: userId, username, email }, JWT_SECRET, { expiresIn: '7d' });
              
              return res.status(201).json({
                message: 'Gebruiker succesvol geregistreerd',
                token,
                user: {
                  id: userId,
                  username,
                  email,
                  name,
                  join_date: new Date().toISOString().split('T')[0] // Huidige datum in YYYY-MM-DD formaat
                }
              });
            }
          );
        } catch (hashError) {
          return res.status(500).json({ error: 'Fout bij het hashen van wachtwoord' });
        }
      }
    );
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// User login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Gebruikersnaam en wachtwoord zijn verplicht' });
  }
  
  try {
    // Zoek gebruiker in database
    db.get(
      `SELECT user_id, username, email, password, name, join_date 
       FROM users 
       WHERE username = ? OR email = ?`,
      [username, username], // Sta login toe met zowel gebruikersnaam als e-mail
      async (err, user) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (!user) {
          return res.status(401).json({ error: 'Ongeldige gebruikersnaam of wachtwoord' });
        }
        
        try {
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
        } catch (bcryptError) {
          return res.status(500).json({ error: 'Fout bij het verifiëren van wachtwoord' });
        }
      }
    );
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Gebruikersprofiel ophalen (voorbeeld van beveiligde route)
app.get('/api/profile', authenticateToken, (req, res) => {
  const userId = req.user.id;
  
  db.get(
    `SELECT user_id, username, email, name, height, weight, join_date 
     FROM users 
     WHERE user_id = ?`,
    [userId],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'Gebruiker niet gevonden' });
      }
      
      // Verwijder gevoelige informatie
      delete user.password;
      
      return res.json(user);
    }
  );
});
// Server starten
app.listen(port, () => {
  console.log(`Server draait op http://localhost:${port}`);
});

// Shut down database connection when app is terminated
process.on('SIGINT', () => {
  db.close(() => {
    console.log('Database verbinding gesloten.');
    process.exit(0);
  });
});
// Voortgangsgegevens ophalen
app.get('/api/progress/:userId', (req, res) => {
  const { userId } = req.params;
  
  // Basis check om zeker te zijn dat userId een nummer is
  const userIdNum = parseInt(userId, 10);
  if (isNaN(userIdNum)) {
    console.error(`Ongeldig gebruikers-ID: ${userId}`);
    return res.status(400).json({ error: "Ongeldig gebruikers-ID" });
  }
  
  // Query voor het ophalen van gewichtsmetingen
  const weightSql = `
    SELECT date, weight 
    FROM progress_tracking
    WHERE user_id = ?
    ORDER BY date ASC
  `;
  
  // Query voor het ophalen van vetpercentage
  const bodyFatSql = `
    SELECT date, body_fat_percentage
    FROM progress_tracking
    WHERE user_id = ? AND body_fat_percentage IS NOT NULL
    ORDER BY date ASC
  `;
  
  // Query voor het ophalen van PRs (1RM) voor bepaalde oefeningen
  const prSql = `
    SELECT pr.date_achieved as date, pr.value, e.name as exercise_name
    FROM personal_records pr
    JOIN exercises e ON pr.exercise_id = e.exercise_id
    WHERE pr.user_id = ? AND pr.type = 'weight'
    ORDER BY pr.date_achieved ASC
  `;
  
  // Uitvoeren van de queries
  db.all(weightSql, [userIdNum], (err, weightData) => {
    if (err) {
      console.error(`Fout bij ophalen gewichtsgegevens: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
    
    db.all(bodyFatSql, [userIdNum], (err, bodyFatData) => {
      if (err) {
        console.error(`Fout bij ophalen vetpercentage: ${err.message}`);
        return res.status(500).json({ error: err.message });
      }
      
      db.all(prSql, [userIdNum], (err, prData) => {
        if (err) {
          console.error(`Fout bij ophalen persoonlijke records: ${err.message}`);
          return res.status(500).json({ error: err.message });
        }
        
        // Groepeer PRs per oefening
        const prByExercise = {};
        prData.forEach(record => {
          if (!prByExercise[record.exercise_name]) {
            prByExercise[record.exercise_name] = [];
          }
          prByExercise[record.exercise_name].push({
            date: record.date,
            value: record.value
          });
        });
        
        // Stuur alles terug naar de client
        return res.json({
          weightData,
          bodyFatData,
          prByExercise
        });
      });
    });
  });
});
// Voeg deze route toe aan je server.js bestand

// Nieuwe voortgangsmeting toevoegen
app.post('/api/progress/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  const { weight, bodyFatPercentage } = req.body;
  
  // Valideer userId
  const userIdNum = parseInt(userId, 10);
  if (isNaN(userIdNum)) {
    return res.status(400).json({ error: "Ongeldig gebruikers-ID" });
  }
  
  // Controleer of het userId van de token overeenkomt met het gevraagde userId
  if (req.user.id !== userIdNum) {
    return res.status(403).json({ error: "Je hebt geen toegang tot deze gegevens" });
  }
  
  // Valideer gewicht (verplicht)
  if (!weight || isNaN(parseFloat(weight))) {
    return res.status(400).json({ error: "Geldig gewicht is verplicht" });
  }
  
  // Valideer vetpercentage (optioneel)
  let bodyFatValue = null;
  if (bodyFatPercentage && !isNaN(parseFloat(bodyFatPercentage))) {
    bodyFatValue = parseFloat(bodyFatPercentage);
    if (bodyFatValue < 2 || bodyFatValue > 50) {
      return res.status(400).json({ error: "Vetpercentage moet tussen 2% en 50% liggen" });
    }
  }
  
  // SQL voor het toevoegen van de meting
  const sql = `
    INSERT INTO progress_tracking (user_id, date, weight, body_fat_percentage)
    VALUES (?, CURRENT_DATE, ?, ?)
  `;
  
  // Voer query uit
  db.run(sql, [userIdNum, parseFloat(weight), bodyFatValue], function(err) {
    if (err) {
      console.error("Fout bij opslaan voortgang:", err.message);
      return res.status(500).json({ error: err.message });
    }
    
    // Antwoord met nieuwe metingID
    return res.status(201).json({
      message: "Voortgangsmeting succesvol opgeslagen",
      progressId: this.lastID
    });
  });
});