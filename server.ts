import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createViteServer } from 'vite';

interface SessionUser {
  userId: string;
  fullName: string;
  team: string;
}

const PORT = Number(process.env.PORT) || 3000;
const app = express();

// Middleware
app.use(express.json({ limit: '15mb' }));

// In-Memory Session Cache
const sessions = new Map<string, SessionUser>();

// SQLite Database Connection
const dbPath = path.join(process.cwd(), 'database', 'inventory_system.db');
let db: DatabaseSync;

try {
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  console.log(`[Database] Successfully connected to SQLite database at: ${dbPath}`);
} catch (err) {
  console.error('[Database] Failed to open SQLite database:', err);
}

// Password verification helper
function hashPassword(password: string): string {
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  return `sha256$${hash}`;
}

function verifyPassword(storedHash: string | null | undefined, attempted: string): boolean {
  if (!storedHash) return false;
  if (storedHash === attempted) return true;

  // SHA-256 standard
  if (storedHash.startsWith('sha256$')) {
    const expected = crypto.createHash('sha256').update(attempted).digest('hex');
    return storedHash.slice(7) === expected;
  }

  // Werkzeug pbkdf2 format: pbkdf2:sha256:600000$salt$hash
  if (storedHash.startsWith('pbkdf2:sha256:')) {
    try {
      const parts = storedHash.split('$');
      if (parts.length === 3) {
        const iter = parseInt(parts[0].split(':')[2], 10) || 600000;
        const salt = parts[1];
        const expectedHash = parts[2];
        const derived = crypto.pbkdf2Sync(attempted, salt, iter, expectedHash.length / 2, 'sha256').toString('hex');
        if (derived === expectedHash) return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

// Session resolver
function getSessionFromReq(req: express.Request): { sessionId?: string; user?: SessionUser } {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-session-id']) {
    token = String(req.headers['x-session-id']).trim();
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').map((c) => c.trim());
    const sessCookie = cookies.find((c) => c.startsWith('session_id='));
    if (sessCookie) {
      token = sessCookie.split('=')[1];
    }
  }

  if (token && sessions.has(token)) {
    return { sessionId: token, user: sessions.get(token) };
  }

  return {};
}

// ==========================================
// 1. USER REGISTRATION
// ==========================================
app.post('/api/register', (req, res) => {
  const { userId, password, fullName, team } = req.body || {};

  if (!userId || !password || !fullName || !team) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = hashPassword(password);

  try {
    const stmt = db.prepare(
      `INSERT INTO users (user_id, password_hash, full_name, team)
       VALUES (?, ?, ?, ?)`
    );
    stmt.run(String(userId).trim().toLowerCase(), hashedPassword, String(fullName).trim(), String(team).trim());
    return res.status(201).json({ message: 'User registered successfully' });
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'User ID already exists' });
    }
    return res.status(500).json({ error: 'Failed to register user: ' + err.message });
  }
});

// ==========================================
// 2. USER LOGIN
// ==========================================
app.post('/api/login', (req, res) => {
  const { userId, password } = req.body || {};

  if (!userId || !password) {
    return res.status(400).json({ error: 'User ID and password are required' });
  }

  try {
    const stmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
    const user = stmt.get(String(userId).trim().toLowerCase()) as any;

    if (user && verifyPassword(user.password_hash, password)) {
      const sessionId = crypto.randomUUID();
      const sessionUser: SessionUser = {
        userId: user.user_id,
        fullName: user.full_name,
        team: user.team,
      };
      sessions.set(sessionId, sessionUser);

      res.cookie('session_id', sessionId, {
        httpOnly: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 3600 * 1000,
      });

      return res.status(200).json({
        message: 'Login successful',
        token: sessionId,
        user: {
          userId: user.user_id,
          fullName: user.full_name,
          team: user.team,
        },
      });
    }

    return res.status(401).json({ error: 'Invalid User ID or password' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Authentication error: ' + err.message });
  }
});

// ==========================================
// 3. LOGOUT & CURRENT USER
// ==========================================
app.post('/api/logout', (req, res) => {
  const { sessionId } = getSessionFromReq(req);
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.clearCookie('session_id');
  return res.status(200).json({ message: 'Logged out successfully' });
});

app.get('/api/me', (req, res) => {
  const { user } = getSessionFromReq(req);
  if (!user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.status(200).json({
    authenticated: true,
    userId: user.userId,
    fullName: user.fullName,
    team: user.team,
  });
});

// ==========================================
// 4. PROCESS DETECTIONS (WITH USER/TEAM ACCOUNTABILITY)
// ==========================================
app.post('/api/process-detections', (req, res) => {
  const { user } = getSessionFromReq(req);

  // Enforce server-side authentication check
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  const { store_id = 1, detections = [] } = req.body || {};
  const userId = user.userId;
  const team = user.team;

  try {
    let processedCount = 0;

    for (const det of detections) {
      const sku = det.sku;
      const qty = Number(det.detected_quantity) || 0;
      const conf = Number(det.confidence_score) || 0.0;
      const imgPath = det.image_path || '';

      const prodStmt = db.prepare('SELECT product_id FROM products WHERE sku = ?');
      const prod = prodStmt.get(sku) as any;

      if (prod) {
        // Insert into image_detections_log with user/team accountability
        const logStmt = db.prepare(`
          INSERT INTO image_detections_log 
          (store_id, product_id, detected_quantity, confidence_score, image_path, created_by_user_id, team, processed_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'verified')
        `);
        logStmt.run(store_id, prod.product_id, qty, conf, imgPath, userId, team);

        // Update inventory table preserving existing User/Team accountability fields
        const invStmt = db.prepare(`
          INSERT INTO store_inventory (store_id, product_id, quantity, last_synced_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(store_id, product_id) DO UPDATE SET
              quantity = quantity + excluded.quantity,
              last_synced_at = CURRENT_TIMESTAMP
        `);
        invStmt.run(store_id, prod.product_id, qty);
        processedCount++;
      }
    }

    return res.status(200).json({
      status: 'success',
      processedCount,
      user: user.fullName,
      team,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to process detections: ' + err.message });
  }
});

// ==========================================
// 5. AUDIT LOGS & INVENTORY QUERIES
// ==========================================
app.get('/api/detections-log', (req, res) => {
  try {
    const logs = db
      .prepare(
        `SELECT l.detection_id, l.store_id, s.store_name, p.product_name, p.sku,
                l.detected_quantity, l.confidence_score, l.image_path,
                l.created_by_user_id, l.team, l.timestamp, l.processed_status
         FROM image_detections_log l
         JOIN products p ON l.product_id = p.product_id
         JOIN stores s ON l.store_id = s.store_id
         ORDER BY l.timestamp DESC
         LIMIT 100;`
      )
      .all();
    return res.json({ logs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventory', (req, res) => {
  try {
    const inventory = db
      .prepare(
        `SELECT si.store_id, s.store_name, p.product_id, p.sku, p.product_name,
                c.category_name, si.quantity, si.last_synced_at
         FROM store_inventory si
         JOIN products p ON si.product_id = p.product_id
         JOIN categories c ON p.category_id = c.category_id
         JOIN stores s ON si.store_id = s.store_id
         ORDER BY si.store_id, p.product_id;`
      )
      .all();
    return res.json({ inventory });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// START SERVER WITH VITE INTEGRATION
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
