'use strict';
const { spawn, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const net  = require('net');
const https = require('https');

const HOME        = process.env.HOME || '/home/sketchy';
const INSTALL_DIR = path.join(HOME, 'projects/satisfactory-server');
const PROFILES_F  = path.join(HOME, '.local/share/ficsit/profiles.json');
const INSTALLS_F  = path.join(HOME, '.local/share/ficsit/installations.json');
const FICSIT      = path.join(HOME, 'bin/ficsit');
const LOG_FILE    = path.join(INSTALL_DIR, 'FactoryGame/Saved/Logs/FactoryGame.log');
const PM2_LOG     = path.join(HOME, '.pm2/logs/satisfactory-server-out.log');
const BACKUP_SH   = path.join(HOME, 'scripts/backup-satisfactory.sh');
const PROFILE     = 'acorn-main';
const FICSIT_ENV  = { ...process.env, PATH: `${HOME}/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` };

// In-process mutex — only one apply at a time per Node process
let applyLock = false;

// Watchdog state
const crashEventTimes = [];
let watchdogLastRestarts = -1;
let watchdogTimer = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function portOpen(port, timeout = 3000) {
  return new Promise(resolve => {
    const sock = net.createConnection({ host: 'localhost', port });
    const done = v => { try { sock.destroy(); } catch {} resolve(v); };
    sock.setTimeout(timeout);
    sock.on('connect', () => done(true));
    sock.on('error',   () => done(false));
    sock.on('timeout', () => done(false));
  });
}

function sfPost(body, token = null) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = https.request(
      { hostname: 'localhost', port: 7777, path: '/api/v1', method: 'POST', headers, rejectUnauthorized: false },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

async function getPlayerCount() {
  try {
    const auth = await sfPost({ function: 'PasswordlessLogin', data: { minimumPrivilegeLevel: 'NotAuthenticated' } });
    const token = auth?.data?.authenticationToken;
    if (!token) return 0;
    const st = await sfPost({ function: 'QueryServerState', data: {} }, token);
    return st?.data?.serverGameState?.numConnectedPlayers ?? 0;
  } catch { return 0; }
}

function spawnCapture(cmd, args, options = {}) {
  return new Promise(resolve => {
    let stdout = '', stderr = '';
    const proc = spawn(cmd, args, { env: options.env || FICSIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    let timedOut = false;
    const timer = options.timeout
      ? setTimeout(() => { timedOut = true; try { proc.kill(); } catch {} }, options.timeout)
      : null;
    proc.on('close', code => {
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? -1 : (code ?? -1), stdout, stderr, timedOut });
    });
  });
}

// ── Crash signature parsing ───────────────────────────────────────────────────

// Ordered by specificity — first match wins
const CRASH_PATTERNS = [
  {
    // ABI break: dlopen path contains mod name
    // e.g.: dlopen failed: .../Mods/FluidToGasRemux/Binaries/Linux/libFluidToGasRemux.so: undefined symbol: ...
    re: /dlopen failed: ([^\n:]+):\s*undefined symbol[:\s]+(\S+)/i,
    type: 'abi_incompatible',
    extractMod: m => {
      const p = m[1];
      const mods = p.match(/\/Mods\/(\w+)\//);
      if (mods) return mods[1];
      const lib = p.match(/lib(\w+)\.so$/);
      return lib ? lib[1] : null;
    },
    describe: m => `ABI incompatibility (undefined symbol: ${m[2].slice(0, 80)})`,
  },
  {
    // Plugin manager explicit load failure — always comes after dlopen if ABI; also standalone
    re: /LogPluginManager: Error: Plugin '(\w+)' failed to load/,
    type: 'plugin_load_failed',
    extractMod: m => m[1],
    describe: () => 'Plugin failed to load (incompatible with current game version)',
  },
  {
    // Fatal / crash handler
    re: /\[Plugins\/[^\]]*?\/(\w+)[^\]]*\].*fatal|Fatal error.*plugin/i,
    type: 'crash',
    extractMod: m => m[1],
    describe: () => 'Fatal crash',
  },
];

function parseCrashInfo(content) {
  for (const { re, type, extractMod, describe } of CRASH_PATTERNS) {
    const m = content.match(re);
    if (!m) continue;
    const failed_mod = extractMod(m);
    // Grab surrounding context (up to 600 chars from match start)
    const start = Math.max(0, m.index - 80);
    const excerpt = content.slice(start, m.index + Math.min(m[0].length + 200, 500)).trim();
    return {
      failed_mod,
      error_excerpt: excerpt.slice(0, 600),
      crash_type: type,
      crash_description: describe(m),
    };
  }
  if (content.includes('Exiting abnormally')) {
    return {
      failed_mod: null,
      error_excerpt: 'Server exited abnormally without a specific error.',
      crash_type: 'crash',
      crash_description: 'The server crashed without identifying a specific mod.',
    };
  }
  return null;
}

// Read bytes from PM2 out log starting at `fromOffset`
function readPm2LogFrom(fromOffset, maxBytes = 200 * 1024) {
  try {
    const stat = fs.statSync(PM2_LOG);
    if (stat.size <= fromOffset) return '';
    const readOffset = Math.max(fromOffset, stat.size - maxBytes);
    const length = stat.size - readOffset;
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(PM2_LOG, 'r');
    fs.readSync(fd, buf, 0, length, readOffset);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

// ── Wait for server to come up after restart ──────────────────────────────────

async function waitForSML(expectedMods, restartTime, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;

  // Record PM2 log position at restart time so fallback only reads new bytes
  let pm2LogOffset = 0;
  try { pm2LogOffset = fs.statSync(PM2_LOG).size; } catch {}

  while (Date.now() < deadline) {
    await sleep(2500);

    let content = '';

    // Primary source: FactoryGame.log (recreated/updated after restart)
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.mtimeMs > restartTime) {
        content = fs.readFileSync(LOG_FILE, 'utf8');
      }
    } catch {}

    // Fallback: PM2 out log captures all game stdout even before FactoryGame.log is written
    if (!content) {
      content = readPm2LogFrom(pm2LogOffset);
    }

    if (!content) continue;

    // Crash detection takes priority
    const crashInfo = parseCrashInfo(content);
    if (crashInfo) return { ok: false, errors: [crashInfo.error_excerpt], crashInfo };

    const loaded = new Set();

    if (expectedMods.length > 0) {
      if (!content.includes('LogSatisfactoryModLoader:')) continue;
      for (const m of content.matchAll(/LogSatisfactoryModLoader: Display: (\w+): /g)) loaded.add(m[1]);
      const missing = expectedMods.filter(m => m !== 'SML' && !loaded.has(m));
      if (missing.length > 0) continue;
    } else {
      if (!content.includes('LogInit:') && !content.includes('LogEngine:')) continue;
    }

    if (await portOpen(7777)) return { ok: true, loaded: [...loaded] };
  }

  return { ok: false, errors: ['Timeout (3 min) waiting for SML to load after restart'] };
}

// ── Rollback ──────────────────────────────────────────────────────────────────

async function doRollback(pool, runId, serverId, triggerUserId) {
  const bak = PROFILES_F + '.bak';
  const log = [];
  try {
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, PROFILES_F);
      log.push('Restored profiles.json from backup');
    } else {
      log.push('WARNING: no profiles.json.bak found — proceeding with current state');
    }

    const r = await spawnCapture(FICSIT, ['apply'], { timeout: 300000 });
    log.push(`ficsit apply exit=${r.code} ${r.code !== 0 ? r.stderr.slice(-200) : ''}`);

    const restartTime = Date.now();
    try { execSync('pm2 restart satisfactory-server', { timeout: 15000 }); log.push('pm2 restart issued'); }
    catch (e) { log.push(`pm2 restart error: ${e.message}`); }

    const up = await waitForSML([], restartTime, 120000);
    log.push(up.ok ? 'Server confirmed healthy after rollback' : `Server health uncertain: ${(up.errors || []).join('; ')}`);

    await pool.query(
      "UPDATE mod_apply_runs SET status='rolled_back', detail=detail||$1::jsonb WHERE id=$2",
      [JSON.stringify({ rollbackLog: log }), runId]
    );
    pool.query('INSERT INTO audit_log(user_id,action,server_id) VALUES($1,$2,$3)',
      [triggerUserId, `Mod apply ROLLED BACK. Log: ${log.slice(-2).join(' | ')}`, serverId]).catch(() => {});
  } catch (e) {
    log.push(`Rollback exception: ${e.message}`);
    await pool.query(
      "UPDATE mod_apply_runs SET status='failed', detail=detail||$1::jsonb WHERE id=$2",
      [JSON.stringify({ rollbackLog: log, rollbackError: e.message }), runId]
    ).catch(() => {});
  }
}

// ── Main apply function ───────────────────────────────────────────────────────

async function runApply(pool, serverId, userId, force = false) {
  // ── 1. Mutex ──
  if (applyLock) {
    const r = await pool.query(
      "SELECT id, status FROM mod_apply_runs WHERE server_id=$1 AND status IN ('running','pending_restart') ORDER BY created_at DESC LIMIT 1",
      [serverId]
    );
    return { locked: true, runId: r.rows[0]?.id, runStatus: r.rows[0]?.status };
  }
  applyLock = true;

  // ── 2. Create run row ──
  const { rows: [{ id: runId }] } = await pool.query(
    "INSERT INTO mod_apply_runs(server_id,triggered_by,status,detail) VALUES($1,$2,'running',$3::jsonb) RETURNING id",
    [serverId, userId, JSON.stringify({ steps: [], startedAt: new Date() })]
  );

  const detail = { steps: [], startedAt: new Date() };
  const step = async (name, data = {}) => {
    detail.steps.push({ name, ...data, at: new Date() });
    await pool.query('UPDATE mod_apply_runs SET detail=$1::jsonb WHERE id=$2', [JSON.stringify(detail), runId])
      .catch(() => {});
  };

  const fail = async (reason, withRollback = true) => {
    detail.error = reason;
    await step('failed', { reason });
    if (withRollback) {
      await doRollback(pool, runId, serverId, userId);
    } else {
      await pool.query("UPDATE mod_apply_runs SET status='failed',detail=$1::jsonb WHERE id=$2",
        [JSON.stringify(detail), runId]).catch(() => {});
    }
    pool.query('INSERT INTO audit_log(user_id,action,server_id) VALUES($1,$2,$3)',
      [userId, `Mod apply FAILED: ${reason.slice(0, 200)}`, serverId]).catch(() => {});
    applyLock = false;
    return { runId, status: withRollback ? 'rolled_back' : 'failed', error: reason };
  };

  try {
    // ── 3. Backup ──
    await step('backup', { status: 'running' });
    try {
      execSync(BACKUP_SH, { timeout: 120000, stdio: 'pipe' });
      await step('backup', { status: 'done' });
    } catch (e) {
      return fail(`Backup failed: ${(e.stderr?.toString() || e.message).slice(0, 300)}`, false);
    }

    // ── 4. Snapshot profiles.json ──
    const bakPath = PROFILES_F + '.bak';
    try { if (fs.existsSync(PROFILES_F)) fs.copyFileSync(PROFILES_F, bakPath); } catch {}

    // ── 5. Generate profiles.json from DB ──
    await step('generate_profile', { status: 'running' });
    const modsRes = await pool.query(
      'SELECT mod_reference, version_constraint FROM server_mods WHERE server_id=$1 AND enabled=true ORDER BY mod_reference',
      [serverId]
    );
    const mods = {};
    for (const r of modsRes.rows)
      mods[r.mod_reference] = { version: r.version_constraint || '>=0.0.0', enabled: true };

    let prof = { profiles: {}, selected_profile: PROFILE, version: 0 };
    try { prof = JSON.parse(fs.readFileSync(PROFILES_F, 'utf8')); } catch {}
    prof.profiles[PROFILE] = { mods, name: PROFILE, required_targets: null };
    fs.writeFileSync(PROFILES_F, JSON.stringify(prof, null, 2));

    // Keep installations.json pointing at acorn-main
    try {
      const inst = JSON.parse(fs.readFileSync(INSTALLS_F, 'utf8'));
      for (const i of (inst.installations || [])) { if (i.path === INSTALL_DIR) i.profile = PROFILE; }
      fs.writeFileSync(INSTALLS_F, JSON.stringify(inst, null, 2));
    } catch {}

    await step('generate_profile', { status: 'done', modCount: Object.keys(mods).length, mods: Object.keys(mods) });

    // ── 6. ficsit apply ──
    await step('ficsit_apply', { status: 'running' });
    const fRes = await spawnCapture(FICSIT, ['apply'], { timeout: 600000 });
    const ficsitOutput = (fRes.stdout + '\n' + fRes.stderr).trim().slice(-3000);
    if (fRes.code !== 0) {
      await step('ficsit_apply', { status: 'error', code: fRes.code, output: ficsitOutput });
      return fail(`ficsit apply failed (exit ${fRes.code}): ${fRes.stderr.slice(-400)}`);
    }
    await step('ficsit_apply', { status: 'done', output: ficsitOutput });

    // ── 7. Player check ──
    const players = await getPlayerCount();
    if (players > 0 && !force) {
      await step('player_check', { blocked: true, players });
      await pool.query("UPDATE mod_apply_runs SET status='pending_restart',detail=$1::jsonb WHERE id=$2",
        [JSON.stringify(detail), runId]);
      applyLock = false;
      return { runId, status: 'pending_restart', players };
    }
    await step('player_check', { ok: true, players });

    // ── 8. Restart ──
    await step('restart', { status: 'running' });
    const restartTime = Date.now();
    try {
      execSync('pm2 restart satisfactory-server', { timeout: 15000 });
    } catch (e) {
      return fail(`pm2 restart failed: ${e.message}`);
    }
    await step('restart', { status: 'done', restartedAt: new Date() });

    // ── 9. Wait for SML ──
    await step('verify', { status: 'waiting', expectedMods: Object.keys(mods) });
    const verify = await waitForSML(Object.keys(mods), restartTime);
    if (!verify.ok) {
      await step('verify', { status: 'failed', errors: verify.errors });

      if (verify.crashInfo) {
        detail.crashInfo = verify.crashInfo;
        // Mark broken mod in DB
        if (verify.crashInfo.failed_mod) {
          await pool.query(
            `UPDATE server_mods SET broken=true, broken_reason=$1
             WHERE server_id=$2 AND mod_reference=$3`,
            [
              `${verify.crashInfo.crash_type}: ${verify.crashInfo.error_excerpt.slice(0, 400)}`,
              serverId,
              verify.crashInfo.failed_mod,
            ]
          ).catch(() => {});
        }
        await pool.query('UPDATE mod_apply_runs SET detail=$1::jsonb WHERE id=$2',
          [JSON.stringify(detail), runId]).catch(() => {});
      }

      return fail(verify.errors.join('; '));
    }
    await step('verify', { status: 'ok', loaded: verify.loaded });

    // ── 10. Success: clear broken flag for mods that loaded cleanly ──
    if (verify.loaded && verify.loaded.length > 0) {
      pool.query(
        `UPDATE server_mods SET broken=false, broken_reason=NULL
         WHERE server_id=$1 AND mod_reference=ANY($2::text[]) AND broken=true`,
        [serverId, verify.loaded]
      ).catch(() => {});
    }

    await pool.query("UPDATE mod_apply_runs SET status='success',detail=$1::jsonb WHERE id=$2",
      [JSON.stringify(detail), runId]);
    pool.query('INSERT INTO audit_log(user_id,action,server_id) VALUES($1,$2,$3)',
      [userId, `Mod apply succeeded: ${Object.keys(mods).join(', ') || '(empty profile)'}`, serverId]).catch(() => {});

    applyLock = false;
    return { runId, status: 'success' };

  } catch (e) {
    return fail(`Unexpected error: ${e.message}`);
  }
}

// ── Force-resume a pending_restart run ────────────────────────────────────────

async function forceRestart(pool, serverId, userId) {
  await pool.query(
    "UPDATE mod_apply_runs SET status='failed', detail=detail||'{\"forcedRestart\":true}'::jsonb WHERE server_id=$1 AND status='pending_restart'",
    [serverId]
  );
  return runApply(pool, serverId, userId, true);
}

// ── Crash-loop watchdog ───────────────────────────────────────────────────────

function getPm2Status() {
  try {
    const out = execSync('pm2 jlist', { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    const list = JSON.parse(out);
    const proc = list.find(p => p.name === 'satisfactory-server');
    if (!proc) return null;
    return {
      restarts: proc.pm2_env.restart_time,
      startedAt: proc.pm2_env.pm_uptime, // epoch ms when process last started
      status: proc.pm2_env.status,
    };
  } catch { return null; }
}

async function handleCrashLoop(pool, serverId) {
  if (applyLock) return;
  applyLock = true;

  try {
    // Read the last 300KB of PM2 out log to find crash signature
    let logSearchOffset = 0;
    try { logSearchOffset = Math.max(0, fs.statSync(PM2_LOG).size - 300 * 1024); } catch {}
    const logContent = readPm2LogFrom(logSearchOffset);
    const crashInfo = parseCrashInfo(logContent) || {
      failed_mod: null,
      error_excerpt: 'Crash loop: server restarted ≥3 times within 5 minutes.',
      crash_type: 'crash_loop',
      crash_description: 'The server crashed repeatedly without identifying a specific mod.',
    };

    // Get a triggering user id from the last run
    const lastRunRes = await pool.query(
      'SELECT triggered_by FROM mod_apply_runs WHERE server_id=$1 ORDER BY created_at DESC LIMIT 1',
      [serverId]
    );
    const systemUserId = lastRunRes.rows[0]?.triggered_by || null;

    let disabledRef = null;

    if (crashInfo.failed_mod) {
      const updated = await pool.query(
        `UPDATE server_mods SET broken=true, broken_reason=$1, enabled=false, updated_at=now()
         WHERE server_id=$2 AND mod_reference=$3 AND enabled=true
         RETURNING mod_reference`,
        [
          `${crashInfo.crash_type}: ${crashInfo.error_excerpt.slice(0, 400)}`,
          serverId,
          crashInfo.failed_mod,
        ]
      );
      disabledRef = updated.rows[0]?.mod_reference || null;
    }

    // Create run row
    const { rows: [{ id: runId }] } = await pool.query(
      `INSERT INTO mod_apply_runs(server_id, triggered_by, status, detail)
       VALUES($1, $2, 'auto_disabled', $3::jsonb) RETURNING id`,
      [serverId, systemUserId, JSON.stringify({
        trigger: 'crash_loop_watchdog',
        crashInfo,
        disabledMod: disabledRef,
        startedAt: new Date(),
        steps: [],
      })]
    );

    pool.query('INSERT INTO audit_log(user_id,action,server_id) VALUES($1,$2,$3)', [
      systemUserId,
      `Crash-loop watchdog auto-disabled ${disabledRef || 'unknown mod'}: ${crashInfo.crash_type}`,
      serverId,
    ]).catch(() => {});

    // Re-generate profiles.json with the broken mod disabled and re-apply
    const modsRes = await pool.query(
      'SELECT mod_reference, version_constraint FROM server_mods WHERE server_id=$1 AND enabled=true ORDER BY mod_reference',
      [serverId]
    );
    const mods = {};
    for (const r of modsRes.rows)
      mods[r.mod_reference] = { version: r.version_constraint || '>=0.0.0', enabled: true };

    let prof = { profiles: {}, selected_profile: PROFILE, version: 0 };
    try { prof = JSON.parse(fs.readFileSync(PROFILES_F, 'utf8')); } catch {}
    prof.profiles[PROFILE] = { mods, name: PROFILE, required_targets: null };
    fs.writeFileSync(PROFILES_F, JSON.stringify(prof, null, 2));

    const fRes = await spawnCapture(FICSIT, ['apply'], { timeout: 300000 });
    const restartTime = Date.now();
    try { execSync('pm2 restart satisfactory-server', { timeout: 15000 }); } catch {}

    const verify = await waitForSML(Object.keys(mods), restartTime, 120000);

    await pool.query(
      'UPDATE mod_apply_runs SET detail=$1::jsonb WHERE id=$2',
      [JSON.stringify({
        trigger: 'crash_loop_watchdog',
        crashInfo,
        disabledMod: disabledRef,
        ficsitExit: fRes.code,
        serverHealthy: verify.ok,
        completedAt: new Date(),
      }), runId]
    ).catch(() => {});

    console.log(`[watchdog] auto-disable complete: mod=${disabledRef}, healthy=${verify.ok}`);
  } catch (e) {
    console.error('[watchdog] handleCrashLoop error:', e.message);
  } finally {
    applyLock = false;
  }
}

async function watchdogTick(pool, serverId) {
  if (applyLock) return;

  const status = getPm2Status();
  if (!status || status.status !== 'online') return;

  if (watchdogLastRestarts === -1) {
    watchdogLastRestarts = status.restarts;
    return;
  }

  if (status.restarts > watchdogLastRestarts) {
    watchdogLastRestarts = status.restarts;
    // Process restarted; only count as a crash if it was up less than 5 min
    const uptimeMs = Date.now() - status.startedAt;
    if (uptimeMs < 300_000) {
      const now = Date.now();
      crashEventTimes.push(now);
      // Prune events older than 5 min
      while (crashEventTimes.length > 0 && now - crashEventTimes[0] > 300_000) {
        crashEventTimes.shift();
      }
      console.log(`[watchdog] crash event #${crashEventTimes.length} (uptime was ${Math.round(uptimeMs / 1000)}s)`);
      if (crashEventTimes.length >= 3) {
        crashEventTimes.length = 0;
        await handleCrashLoop(pool, serverId);
      }
    }
  }
}

function startWatchdog(pool, serverId) {
  if (watchdogTimer) return;
  // Initialize restart counter without triggering
  const status = getPm2Status();
  if (status) watchdogLastRestarts = status.restarts;
  watchdogTimer = setInterval(
    () => watchdogTick(pool, serverId).catch(e => console.error('[watchdog]', e.message)),
    30_000
  );
  console.log(`[watchdog] started for server ${serverId} (restarts=${watchdogLastRestarts})`);
}

module.exports = { runApply, forceRestart, startWatchdog, isLocked: () => applyLock };
