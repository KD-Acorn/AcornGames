require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { runApply, forceRestart, isLocked, startWatchdog } = require('./services/modApply');

const app = express();
const PORT = process.env.PORT || 3004;

const dbConfig = {
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
};
// Use Unix socket if host looks like a path (peer auth), else TCP
if (process.env.DB_HOST && process.env.DB_HOST.startsWith('/')) {
  dbConfig.host = process.env.DB_HOST;
} else {
  dbConfig.host = process.env.DB_HOST || 'localhost';
  dbConfig.port = parseInt(process.env.DB_PORT) || 5432;
  if (process.env.DB_PASSWORD) dbConfig.password = process.env.DB_PASSWORD;
}
const pool = new Pool(dbConfig);

app.use(cors({
  origin: ['http://localhost:3003', 'https://acorngames.net', 'http://acorngames.net', 'https://satisfactory.doneitmobile.com', 'http://satisfactory.doneitmobile.com'],
  credentials: true,
}));
app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────────────────────

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminRequired(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function modOrAdminRequired(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'mod') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

async function serverAccessRequired(req, res, next) {
  if (req.user.role === 'admin') return next();
  const { id } = req.params;
  const result = await pool.query(
    'SELECT server_role FROM user_server_access WHERE user_id = $1 AND server_id = $2',
    [req.user.id, id]
  );
  if (result.rows.length === 0) return res.status(403).json({ error: 'No access to this server' });
  req.serverRole = result.rows[0].server_role;
  next();
}

async function serverAdminRequired(req, res, next) {
  if (req.user.role === 'admin') return next();
  const { id } = req.params;
  const result = await pool.query(
    'SELECT server_role FROM user_server_access WHERE user_id = $1 AND server_id = $2',
    [req.user.id, id]
  );
  if (result.rows.length === 0 || result.rows[0].server_role !== 'admin') {
    return res.status(403).json({ error: 'Server admin access required' });
  }
  next();
}

function auditLog(userId, action, serverId = null) {
  pool.query(
    'INSERT INTO audit_log (user_id, action, server_id) VALUES ($1, $2, $3)',
    [userId, action, serverId]
  ).catch(() => {});
}

function getPm2Status(pm2Name) {
  try {
    const raw = execSync('pm2 jlist', { timeout: 5000 }).toString();
    const list = JSON.parse(raw);
    const proc = list.find(p => p.name === pm2Name);
    if (!proc) return { status: 'offline', uptime: null, pid: null };
    return {
      status: proc.pm2_env.status === 'online' ? 'online' : 'offline',
      uptime: proc.pm2_env.pm_uptime || null,
      pid: proc.pid || null,
      restarts: proc.pm2_env.restart_time || 0,
    };
  } catch {
    return { status: 'unknown', uptime: null, pid: null };
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Public registration endpoint
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  // username: 3-20 chars alphanumeric or underscore
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Invalid username format' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hash, 'viewer']
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Servers ───────────────────────────────────────────────────────────────────

app.get('/api/servers', authRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, game, game_icon_url, pm2_name, host, port FROM servers ORDER BY name');
    const servers = result.rows;

    // Attach access info for non-admins
    if (req.user.role !== 'admin') {
      const accessResult = await pool.query(
        'SELECT server_id, server_role FROM user_server_access WHERE user_id = $1',
        [req.user.id]
      );
      const accessMap = {};
      accessResult.rows.forEach(r => { accessMap[r.server_id] = r.server_role; });
      servers.forEach(s => {
        s.hasAccess = !!accessMap[s.id];
        s.serverRole = accessMap[s.id] || null;
      });
    } else {
      servers.forEach(s => { s.hasAccess = true; s.serverRole = 'admin'; });
    }

    res.json(servers);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/servers/:id', authRequired, serverAccessRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
    const server = result.rows[0];
    server.serverRole = req.user.role === 'admin' ? 'admin' : (req.serverRole || 'viewer');
    res.json(server);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/servers/:id/status', authRequired, serverAccessRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT pm2_name, host, port FROM servers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
    const { pm2_name } = result.rows[0];

    if (pm2_name === 'satisfactory-server') {
      const pm2Raw = getSFPm2RawStatus();
      if (pm2Raw !== 'online') {
        return res.json({ status: pm2Raw === 'launching' ? 'booting' : 'offline', playerCount: 0, lastApplyRun: null });
      }
      try {
        const token = await getSFToken();
        const data = await sfHttpPost('/api/v1', { function: 'QueryServerState', data: {} }, token);
        const playerCount = data?.data?.serverGameState?.numConnectedPlayers ?? 0;
        const runRes = await pool.query(
          'SELECT id, status, created_at, detail FROM mod_apply_runs WHERE server_id=$1 ORDER BY created_at DESC LIMIT 1',
          [req.params.id]
        );
        const lastApplyRun = runRes.rows[0] || null;
        const vanillaFlag = fs.existsSync(process.env.HOME + '/backups/satisfactory/.vanilla_mode');
        return res.json({ status: playerCount > 0 ? 'online' : 'online', playerCount, lastApplyRun, vanillaMode: vanillaFlag, applyLocked: isLocked() });
      } catch (err) {
        sfTokenCache = { token: null, expiresAt: 0 };
        const booting = err.code === 'ECONNREFUSED' || err.message === 'Timeout';
        return res.json({ status: booting ? 'booting' : 'offline', playerCount: 0, lastApplyRun: null });
      }
    }

    // Generic: PM2 stats
    res.json(getPm2Status(pm2_name));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/servers/:id/restart', authRequired, serverAdminRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT pm2_name, name FROM servers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
    const { pm2_name, name } = result.rows[0];
    execSync(`pm2 restart ${pm2_name}`, { timeout: 10000 });
    auditLog(req.user.id, `Restarted server "${name}"`, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restart server' });
  }
});

app.post('/api/servers/:id/stop', authRequired, serverAdminRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT pm2_name, name FROM servers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
    const { pm2_name, name } = result.rows[0];
    execSync(`pm2 stop ${pm2_name}`, { timeout: 10000 });
    auditLog(req.user.id, `Stopped server "${name}"`, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop server' });
  }
});

app.post('/api/servers/:id/start', authRequired, serverAdminRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT pm2_name, name FROM servers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
    const { pm2_name, name } = result.rows[0];
    execSync(`pm2 start ${pm2_name}`, { timeout: 10000 });
    auditLog(req.user.id, `Started server "${name}"`, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start server' });
  }
});

// Admin: add server
app.post('/api/servers', authRequired, adminRequired, async (req, res) => {
  const { name, game, pm2_name, host, port, description, game_icon_url, connect_info } = req.body;
  if (!name || !game || !pm2_name || !host || !port) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO servers (name, game, pm2_name, host, port, description, game_icon_url, connect_info) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [name, game, pm2_name, host, parseInt(port), description || null, game_icon_url || null, connect_info ? JSON.stringify(connect_info) : null]
    );
    auditLog(req.user.id, `Created server "${name}"`, result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: delete server
app.delete('/api/servers/:id', authRequired, adminRequired, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM servers WHERE id = $1 RETURNING name', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Server not found' });
    auditLog(req.user.id, `Deleted server "${result.rows[0].name}"`, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Access requests ───────────────────────────────────────────────────────────

app.post('/api/access/request', authRequired, async (req, res) => {
  const { server_id } = req.body;
  if (!server_id) return res.status(400).json({ error: 'server_id required' });
  try {
    // Check for existing pending request
    const existing = await pool.query(
      "SELECT id FROM access_requests WHERE user_id = $1 AND server_id = $2 AND status = 'pending'",
      [req.user.id, server_id]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Request already pending' });

    await pool.query(
      'INSERT INTO access_requests (user_id, server_id) VALUES ($1, $2)',
      [req.user.id, server_id]
    );

    // Notify log
    try {
      const serverResult = await pool.query('SELECT name FROM servers WHERE id = $1', [server_id]);
      const serverName = serverResult.rows[0]?.name || 'Unknown';
      const logLine = `[${new Date().toISOString()}] Access request: user "${req.user.username}" requested access to server "${serverName}"\n`;
      fs.appendFileSync(path.join(__dirname, '..', 'notifications.log'), logLine);
    } catch {}

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/access/pending', authRequired, modOrAdminRequired, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ar.id, ar.status, ar.requested_at,
             u.id AS user_id, u.username,
             s.id AS server_id, s.name AS server_name
      FROM access_requests ar
      JOIN users u ON u.id = ar.user_id
      JOIN servers s ON s.id = ar.server_id
      WHERE ar.status = 'pending'
      ORDER BY ar.requested_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/access/grant/:requestId', authRequired, modOrAdminRequired, async (req, res) => {
  const { server_role = 'viewer' } = req.body;
  try {
    // mods cannot grant admin server_role
    if (req.user.role === 'mod' && server_role === 'admin') {
      return res.status(403).json({ error: 'Mods cannot grant admin server role' });
    }

    const reqResult = await pool.query('SELECT * FROM access_requests WHERE id = $1', [req.params.requestId]);
    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const request = reqResult.rows[0];

    // Upsert access
    await pool.query(
      `INSERT INTO user_server_access (user_id, server_id, server_role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, server_id) DO UPDATE SET server_role = EXCLUDED.server_role, granted_at = NOW()`,
      [request.user_id, request.server_id, server_role]
    );

    await pool.query(
      "UPDATE access_requests SET status = 'approved', resolved_at = NOW() WHERE id = $1",
      [req.params.requestId]
    );

    auditLog(req.user.id, `Granted ${server_role} access to user ${request.user_id} for server ${request.server_id}`, request.server_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/access/deny/:requestId', authRequired, modOrAdminRequired, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE access_requests SET status = 'denied', resolved_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.requestId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

app.get('/api/users', authRequired, modOrAdminRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY created_at');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users/create', authRequired, adminRequired, async (req, res) => {
  const { username, password, role = 'viewer' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (!['admin', 'mod', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username, hash, role]
    );
    auditLog(req.user.id, `Created user "${username}"`, null);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/users/:id/delete', authRequired, adminRequired, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING username', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    auditLog(req.user.id, `Deleted user "${result.rows[0].username}"`, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:id/access', authRequired, modOrAdminRequired, async (req, res) => {
  try {
    const servers = await pool.query('SELECT id, name, game FROM servers ORDER BY name');
    const access = await pool.query(
      'SELECT server_id, server_role, granted_at FROM user_server_access WHERE user_id = $1',
      [req.params.id]
    );
    const accessMap = {};
    access.rows.forEach(r => { accessMap[r.server_id] = { server_role: r.server_role, granted_at: r.granted_at }; });
    const result = servers.rows.map(s => ({
      ...s,
      hasAccess: !!accessMap[s.id],
      server_role: accessMap[s.id]?.server_role || 'viewer',
      granted_at: accessMap[s.id]?.granted_at || null,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users/:id/access', authRequired, modOrAdminRequired, async (req, res) => {
  // body: { server_id, hasAccess, server_role }
  const { server_id, hasAccess, server_role = 'viewer' } = req.body;
  if (!server_id) return res.status(400).json({ error: 'server_id required' });
  try {
    // mods cannot set admin server_role
    if (req.user.role === 'mod' && server_role === 'admin') {
      return res.status(403).json({ error: 'Mods cannot assign admin server role' });
    }

    if (hasAccess) {
      await pool.query(
        `INSERT INTO user_server_access (user_id, server_id, server_role)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, server_id) DO UPDATE SET server_role = EXCLUDED.server_role, granted_at = NOW()`,
        [req.params.id, server_id, server_role]
      );
    } else {
      await pool.query(
        'DELETE FROM user_server_access WHERE user_id = $1 AND server_id = $2',
        [req.params.id, server_id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Audit log ─────────────────────────────────────────────────────────────────

app.get('/api/audit', authRequired, adminRequired, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const server_id = req.query.server_id || null;

  try {
    const where = server_id ? 'WHERE al.server_id = $3' : '';
    const params = server_id ? [limit, offset, server_id] : [limit, offset];
    const result = await pool.query(`
      SELECT al.id, al.action, al.timestamp,
             u.username,
             s.name AS server_name
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      LEFT JOIN servers s ON s.id = al.server_id
      ${where}
      ORDER BY al.timestamp DESC
      LIMIT $1 OFFSET $2
    `, params);

    const countParams = server_id ? [server_id] : [];
    const countWhere = server_id ? 'WHERE server_id = $1' : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM audit_log ${countWhere}`, countParams);

    res.json({ entries: result.rows, total: parseInt(countResult.rows[0].count), page, limit });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/servers-list', authRequired, adminRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM servers ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Satisfactory status ───────────────────────────────────────────────────────

let sfTokenCache = { token: null, expiresAt: 0 };

function sfHttpPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = https.request(
      { hostname: 'localhost', port: 7777, path, method: 'POST', headers, rejectUnauthorized: false },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

async function getSFToken() {
  if (sfTokenCache.token && Date.now() < sfTokenCache.expiresAt) return sfTokenCache.token;
  const password = process.env.SF_PASSWORD;
  if (!password) throw new Error('SF_PASSWORD not configured');
  const data = await sfHttpPost('/api/v1', { function: 'PasswordLogin', data: { MinimumPrivilegeLevel: 'Administrator', Password: password } }, null);
  const token = data?.data?.authenticationToken;
  if (!token) throw new Error('No token in SF login response');
  sfTokenCache = { token, expiresAt: Date.now() + 25 * 60 * 1000 };
  return token;
}

function getSFPm2RawStatus() {
  try {
    const list = JSON.parse(execSync('pm2 jlist', { timeout: 5000 }).toString());
    const proc = list.find(p => p.name === 'satisfactory-server');
    if (!proc) return 'offline';
    return proc.pm2_env.status;
  } catch { return 'unknown'; }
}

app.get('/api/satisfactory/status', authRequired, async (req, res) => {
  const pm2Status = getSFPm2RawStatus();

  if (pm2Status === 'launching') {
    return res.json({ status: 'booting', playerCount: 0, emptySince: null });
  }
  if (pm2Status !== 'online') {
    return res.json({ status: 'offline', playerCount: 0, emptySince: null });
  }

  try {
    const token = await getSFToken();
    const data = await sfHttpPost('/api/v1', { function: 'QueryServerState', data: {} }, token);
    const playerCount = data?.data?.serverGameState?.numConnectedPlayers ?? 0;

    let emptySince = null;
    try {
      const raw = fs.readFileSync('/home/sketchy/.sf_watcher_state', 'utf8').trim();
      emptySince = parseInt(raw) || null;
    } catch {}

    const nowSec = Math.floor(Date.now() / 1000);
    let status;
    if (playerCount > 0) {
      status = 'online';
      emptySince = null;
    } else if (emptySince && (nowSec - emptySince) >= 4 * 3600) {
      status = 'idle';
    } else {
      status = 'online';
    }

    res.json({ status, playerCount, emptySince });
  } catch (err) {
    sfTokenCache = { token: null, expiresAt: 0 };
    const booting = err.code === 'ECONNREFUSED' || err.message === 'Timeout';
    res.json({ status: booting ? 'booting' : 'offline', playerCount: 0, emptySince: null });
  }
});

// ── Mod catalog cache ─────────────────────────────────────────────────────────

const catalogCache = new Map(); // key → { data, expiresAt }
const CATALOG_TTL  = 15 * 60 * 1000;

function ficsitGraphQL(query) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.ficsit.app', path: '/v2/query', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('ficsit API timeout')); });
    req.write(payload);
    req.end();
  });
}

async function searchCatalog(q, offset = 0) {
  const term = (q || '').toLowerCase().trim();
  const cacheKey = `${term}:${offset}`;
  const hit = catalogCache.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) return hit.data;

  // order_by:search uses ficsit's relevance ranking — essential so exact name matches
  // (e.g. "LoadBalancers") rank first regardless of last-update recency.
  const gql = `{
    getMods(filter:{limit:50,offset:${offset},search:${JSON.stringify(term)},order_by:search,order:desc}) {
      count
      mods {
        id name mod_reference short_description logo
        versions(filter:{limit:1}) {
          version created_at
          targets { targetName }
        }
      }
    }
  }`;

  const data = await ficsitGraphQL(gql);
  const raw  = data?.data?.getMods || {};
  const mods = (raw.mods || []).map(m => {
    const v  = m.versions?.[0];
    const tg = v?.targets?.map(t => t.targetName) || [];
    // null = no target data published (show as "unverified" in UI, don't hide)
    const server_compatible = tg.length === 0 ? null
      : (tg.includes('LinuxServer') || tg.includes('WindowsServer'));
    return {
      mod_reference:     m.mod_reference,
      name:              m.name,
      short_description: m.short_description || '',
      logo:              m.logo || null,
      version:           v?.version || null,
      updated_at:        v?.created_at || null,
      server_compatible,
      targets:           tg,
    };
  });

  const result = { mods, count: raw.count ?? mods.length, offset };
  catalogCache.set(cacheKey, { data: result, expiresAt: Date.now() + CATALOG_TTL });
  return result;
}

// ── Mod catalog search ────────────────────────────────────────────────────────

app.get('/api/servers/:id/mods/catalog', authRequired, serverAccessRequired, async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const result = await searchCatalog(req.query.q || '', offset);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach ficsit.app API', detail: err.message });
  }
});

// ── Current mod list ──────────────────────────────────────────────────────────

app.get('/api/servers/:id/mods', authRequired, serverAccessRequired, async (req, res) => {
  try {
    const modsRes = await pool.query(
      `SELECT sm.id, sm.mod_reference, sm.display_name, sm.version_constraint, sm.enabled,
              sm.broken, sm.broken_reason, sm.updated_at,
              u.username AS changed_by_username
       FROM server_mods sm
       LEFT JOIN users u ON u.id = sm.changed_by
       WHERE sm.server_id = $1
       ORDER BY sm.mod_reference`,
      [req.params.id]
    );

    // Merge with installed state from lock file
    let lockData = {};
    try {
      const lockPath = path.join(
        process.env.HOME, 'projects/satisfactory-server/FactoryGame/Mods/acorn-main-lock.json'
      );
      lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8')).mods || {};
    } catch {}

    const mods = modsRes.rows.map(m => ({
      ...m,
      installed_version: lockData[m.mod_reference]?.version || null,
    }));

    const runRes = await pool.query(
      `SELECT r.id, r.status, r.created_at, r.detail, u.username AS triggered_by_username
       FROM mod_apply_runs r
       LEFT JOIN users u ON u.id = r.triggered_by
       WHERE r.server_id = $1
       ORDER BY r.created_at DESC LIMIT 1`,
      [req.params.id]
    );

    res.json({ mods, lastRun: runRes.rows[0] || null, applyLocked: isLocked() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Set mod list + trigger apply ──────────────────────────────────────────────

app.post('/api/servers/:id/mods', authRequired, async (req, res) => {
  // Must be site admin/mod OR have server-level admin access
  if (req.user.role !== 'admin' && req.user.role !== 'mod') {
    const access = await pool.query(
      'SELECT server_role FROM user_server_access WHERE user_id=$1 AND server_id=$2',
      [req.user.id, req.params.id]
    );
    if (!access.rows.length || access.rows[0].server_role !== 'admin') {
      return res.status(403).json({ error: 'Admin or mod role required to manage mods' });
    }
  }

  const { mods, force = false } = req.body;
  if (!Array.isArray(mods)) return res.status(400).json({ error: 'mods array required' });

  try {
    // Upsert desired mod list
    await pool.query('BEGIN');
    // Remove mods not in the new list
    if (mods.length > 0) {
      const refs = mods.map(m => m.mod_reference);
      await pool.query(
        'DELETE FROM server_mods WHERE server_id=$1 AND mod_reference != ALL($2::text[])',
        [req.params.id, refs]
      );
    } else {
      await pool.query('DELETE FROM server_mods WHERE server_id=$1', [req.params.id]);
    }
    // Upsert each mod
    for (const m of mods) {
      await pool.query(
        `INSERT INTO server_mods (server_id, mod_reference, display_name, version_constraint, enabled, changed_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (server_id, mod_reference) DO UPDATE
           SET display_name=$3, version_constraint=$4, enabled=$5, changed_by=$6, updated_at=now()`,
        [req.params.id, m.mod_reference, m.display_name || m.mod_reference,
         m.version_constraint || '>=0.0.0', m.enabled !== false, req.user.id]
      );
    }
    await pool.query('COMMIT');

    auditLog(req.user.id, `Mod list updated: ${mods.map(m => m.mod_reference).join(', ') || '(empty)'}`, req.params.id);

    // Trigger pipeline (runs async, returns runId immediately)
    const result = await runApply(pool, req.params.id, req.user.id, force);
    res.json(result);
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// Force restart after pending_restart
app.post('/api/servers/:id/mods/force-restart', authRequired, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'mod') {
    return res.status(403).json({ error: 'Admin or mod role required' });
  }
  try {
    const result = await forceRestart(pool, req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Apply run history ─────────────────────────────────────────────────────────

app.get('/api/servers/:id/mods/runs', authRequired, serverAccessRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.status, r.created_at, r.detail,
              u.username AS triggered_by_username
       FROM mod_apply_runs r
       LEFT JOIN users u ON u.id = r.triggered_by
       WHERE r.server_id = $1
       ORDER BY r.created_at DESC LIMIT 10`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Game update trigger (Task 5) ──────────────────────────────────────────────

app.post('/api/servers/:id/update', authRequired, adminRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT pm2_name FROM servers WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Server not found' });
    if (result.rows[0].pm2_name !== 'satisfactory-server') {
      return res.status(400).json({ error: 'Update only supported for Satisfactory server' });
    }
    const HOME = process.env.HOME;
    const scriptPath = path.join(HOME, 'scripts/update-satisfactory.sh');
    if (!fs.existsSync(scriptPath)) return res.status(500).json({ error: 'Update script not found' });

    auditLog(req.user.id, 'Triggered manual game update', req.params.id);

    // Run async; return immediately
    const { spawn } = require('child_process');
    const logDir = path.join(HOME, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = fs.openSync(path.join(logDir, 'satisfactory-update.log'), 'a');
    const proc = spawn('bash', [scriptPath], {
      detached: true, stdio: ['ignore', logFile, logFile],
      env: { ...process.env, PATH: `${HOME}/bin:/usr/games:/usr/local/bin:/usr/bin:/bin` },
    });
    proc.unref();

    res.json({ started: true, logFile: path.join(logDir, 'satisfactory-update.log') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Account settings (self-service) ──────────────────────────────────────────

app.patch('/api/account/password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    auditLog(req.user.id, `Changed own password`, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/account/username', authRequired, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–30 characters: letters, numbers, _ or -' });
  }
  try {
    const old = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.id]);
    if (!old.rows.length) return res.status(404).json({ error: 'User not found' });
    const result = await pool.query(
      'UPDATE users SET username = $1 WHERE id = $2 RETURNING id, username, role',
      [username, req.user.id]
    );
    auditLog(req.user.id, `Changed own username: "${old.rows[0].username}" → "${username}"`, null);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin user management ─────────────────────────────────────────────────────

app.post('/api/users/:id/reset-password', authRequired, adminRequired, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'newPassword required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
    if (!userRes.rows.length) return res.status(404).json({ error: 'User not found' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    auditLog(req.user.id, `Reset password for user "${userRes.rows[0].username}"`, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/users/:id/username', authRequired, adminRequired, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–30 characters: letters, numbers, _ or -' });
  }
  try {
    const old = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: 'User not found' });
    const result = await pool.query(
      'UPDATE users SET username = $1 WHERE id = $2 RETURNING id, username, role',
      [username, req.params.id]
    );
    auditLog(req.user.id, `Changed username for user id=${req.params.id}: "${old.rows[0].username}" → "${username}"`, null);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  // Start crash-loop watchdog for the Satisfactory server
  pool.query("SELECT id FROM servers WHERE pm2_name='satisfactory-server' LIMIT 1")
    .then(r => { if (r.rows[0]) startWatchdog(pool, r.rows[0].id); })
    .catch(() => {});
});
