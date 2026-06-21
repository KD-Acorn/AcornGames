import { useState, useEffect } from 'react';
import Navbar from '../Navbar';
import { useToast } from '../Toast';
import api from '../api';

// ── Servers Tab ────────────────────────────────────────────────────────────────

function ServersTab() {
  const [servers, setServers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [statuses, setStatuses] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const toast = useToast();

  const emptyForm = { name: '', game: '', pm2_name: '', host: '', port: '', description: '', game_icon_url: '', connect_info: '' };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');

  useEffect(() => { loadServers(); }, []);

  async function loadServers() {
    const res = await api.get('/api/servers');
    setServers(res.data);
    res.data.forEach(async s => {
      try {
        const st = await api.get(`/api/servers/${s.id}/status`);
        setStatuses(prev => ({ ...prev, [s.id]: st.data.status }));
      } catch {
        setStatuses(prev => ({ ...prev, [s.id]: 'unknown' }));
      }
    });
  }

  async function handleAdd(e) {
    e.preventDefault();
    setFormError('');
    let connect_info = null;
    if (form.connect_info.trim()) {
      try { connect_info = JSON.parse(form.connect_info); }
      catch { setFormError('connect_info must be valid JSON'); return; }
    }
    try {
      await api.post('/api/servers', { ...form, port: parseInt(form.port), connect_info });
      toast('Server added');
      setShowForm(false);
      setForm(emptyForm);
      loadServers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to add server');
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/api/servers/${id}`);
      toast('Server deleted');
      setDeleteConfirm(null);
      loadServers();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  const statusColor = { online: 'var(--online)', offline: 'var(--offline)', unknown: 'var(--text-secondary)' };

  return (
    <div>
      <div className="page-header">
        <span className="section-title" style={{ marginBottom: 0 }}>Servers ({servers.length})</span>
        <span className="navbar-spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? '✕ Cancel' : '+ Add Server'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="section-title">New Server</div>
          <form onSubmit={handleAdd}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Server Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Satisfactory" required />
              </div>
              <div className="form-group">
                <label className="form-label">Game *</label>
                <input value={form.game} onChange={e => setForm(f => ({ ...f, game: e.target.value }))} placeholder="Satisfactory" required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">PM2 Name *</label>
                <input value={form.pm2_name} onChange={e => setForm(f => ({ ...f, pm2_name: e.target.value }))} placeholder="satisfactory-server" required />
              </div>
              <div className="form-group">
                <label className="form-label">Host *</label>
                <input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="174.107.237.86" required />
              </div>
              <div className="form-group" style={{ maxWidth: 120 }}>
                <label className="form-label">Port *</label>
                <input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} placeholder="7777" required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Game Icon URL</label>
              <input value={form.game_icon_url} onChange={e => setForm(f => ({ ...f, game_icon_url: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            </div>
            <div className="form-group">
              <label className="form-label">Connect Info (JSON)</label>
              <textarea
                value={form.connect_info}
                onChange={e => setForm(f => ({ ...f, connect_info: e.target.value }))}
                placeholder={'{"type":"Server Manager","instructions":"Open game → Join Server","connect_string":"host:port"}'}
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
            {formError && <div className="form-error" style={{ textAlign: 'left', marginBottom: 12 }}>{formError}</div>}
            <button type="submit" className="btn btn-primary btn-sm">Add Server</button>
          </form>
        </div>
      )}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Game</th>
              <th>Status</th>
              <th>PM2 Name</th>
              <th>Host</th>
              <th>Port</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {servers.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td>{s.game}</td>
                <td>
                  <span style={{ color: statusColor[statuses[s.id] || 'unknown'], fontSize: 13, fontWeight: 600 }}>
                    ● {statuses[s.id] || 'unknown'}
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-secondary)' }}>{s.pm2_name}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{s.host}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{s.port}</td>
                <td>
                  {deleteConfirm === s.id ? (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s.id)}>Confirm</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(s.id)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Users Tab ──────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' });
  const [formError, setFormError] = useState('');
  const toast = useToast();

  function handleUsernameChanged(userId, newUsername) {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, username: newUsername } : u));
  }

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    const res = await api.get('/api/users');
    setUsers(res.data);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    try {
      await api.post('/api/users/create', form);
      toast('User created');
      setShowForm(false);
      setForm({ username: '', password: '', role: 'viewer' });
      loadUsers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create user');
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/api/users/${id}/delete`);
      toast('User deleted');
      setDeleteConfirm(null);
      loadUsers();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  }

  return (
    <div>
      <div className="page-header">
        <span className="section-title" style={{ marginBottom: 0 }}>Users ({users.length})</span>
        <span className="navbar-spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? '✕ Cancel' : '+ Create User'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="section-title">New User</div>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Username *</label>
                <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Password *</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
              </div>
              <div className="form-group" style={{ maxWidth: 140 }}>
                <label className="form-label">Global Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="viewer">Viewer</option>                  <option value="mod">Mod</option>                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            {formError && <div className="form-error" style={{ textAlign: 'left', marginBottom: 12 }}>{formError}</div>}
            <button type="submit" className="btn btn-primary btn-sm">Create User</button>
          </form>
        </div>
      )}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Created</th>
              <th>Server Access</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <>
                <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => setExpanded(expanded === u.id ? null : u.id)}>
                  <td style={{ fontWeight: 600 }}>{u.username}</td>
                  <td>
                    <span style={{
                      color: u.role === 'admin' ? 'var(--accent)' : 'var(--text-secondary)',
                      fontWeight: 600, fontSize: 13
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ color: 'var(--accent)', fontSize: 13 }}>
                    {expanded === u.id ? '▲ Hide' : '▼ Manage'}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {deleteConfirm === u.id ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u.id)}>Confirm</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(u.id)}>Delete</button>
                    )}
                  </td>
                </tr>
                {expanded === u.id && (
                  <tr key={`access-${u.id}`}>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <UserAccessPanel
                        userId={u.id}
                        username={u.username}
                        onUsernameChanged={newName => handleUsernameChanged(u.id, newName)}
                      />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserAdminActions({ userId, currentUsername, onUsernameChanged }) {
  const [resetPw, setResetPw] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const [newUsername, setNewUsername] = useState(currentUsername);
  const [unameError, setUnameError] = useState('');
  const [unameLoading, setUnameLoading] = useState(false);

  const toast = useToast();

  async function handleResetPassword(e) {
    e.preventDefault();
    setResetError('');
    if (resetPw !== resetConfirm) { setResetError('Passwords do not match.'); return; }
    if (resetPw.length < 8) { setResetError('Minimum 8 characters.'); return; }
    setResetLoading(true);
    try {
      await api.post(`/api/users/${userId}/reset-password`, { newPassword: resetPw });
      setResetPw(''); setResetConfirm(''); setResetDone(true);
      toast(`Password reset for ${currentUsername}`);
    } catch (err) {
      setResetError(err.response?.data?.error || 'Failed');
    } finally { setResetLoading(false); }
  }

  async function handleUsernameChange(e) {
    e.preventDefault();
    setUnameError('');
    if (newUsername === currentUsername) { setUnameError('Same as current username.'); return; }
    setUnameLoading(true);
    try {
      const res = await api.patch(`/api/users/${userId}/username`, { username: newUsername });
      onUsernameChanged(res.data.username);
      toast(`Username changed to "${res.data.username}"`);
    } catch (err) {
      setUnameError(err.response?.data?.error || 'Failed');
    } finally { setUnameLoading(false); }
  }

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
      {/* Username change */}
      <form onSubmit={handleUsernameChange} style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>Change Username</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className=""
            style={{ flex: 1 }}
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
            minLength={2} maxLength={30}
            pattern="[a-zA-Z0-9_\-]+"
            required
          />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={unameLoading || newUsername === currentUsername}>
            {unameLoading ? '…' : 'Save'}
          </button>
        </div>
        {unameError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{unameError}</div>}
      </form>

      {/* Password reset */}
      <form onSubmit={handleResetPassword} style={{ flex: '1 1 280px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>Reset Password</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="password"
            className=""
            style={{ flex: 1, minWidth: 120 }}
            placeholder="New password"
            value={resetPw}
            onChange={e => { setResetPw(e.target.value); setResetDone(false); }}
            minLength={8}
            required
          />
          <input
            type="password"
            className=""
            style={{ flex: 1, minWidth: 120 }}
            placeholder="Confirm"
            value={resetConfirm}
            onChange={e => { setResetConfirm(e.target.value); setResetDone(false); }}
            minLength={8}
            required
          />
          <button type="submit" className="btn btn-danger btn-sm" disabled={resetLoading}>
            {resetLoading ? '…' : resetDone ? '✓ Done' : 'Reset'}
          </button>
        </div>
        {resetError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{resetError}</div>}
      </form>
    </div>
  );
}

function UserAccessPanel({ userId, username, onUsernameChanged }) {
  const [servers, setServers] = useState([]);
  const [pending, setPending] = useState({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get(`/api/users/${userId}/access`).then(res => setServers(res.data));
  }, [userId]);

  function setAccess(serverId, field, value) {
    setServers(prev => prev.map(s => s.id === serverId ? { ...s, [field]: value } : s));
    setPending(p => ({ ...p, [serverId]: true }));
  }

  async function saveAll() {
    setSaving(true);
    try {
      const changed = servers.filter(s => pending[s.id]);
      await Promise.all(changed.map(s =>
        api.post(`/api/users/${userId}/access`, {
          server_id: s.id,
          hasAccess: s.hasAccess,
          server_role: s.server_role,
        })
      ));
      toast('Access updated');
      setPending({});
    } catch {
      toast('Failed to save access', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (servers.length === 0) {
    return (
      <div className="access-panel">
        <UserAdminActions userId={userId} currentUsername={username} onUsernameChanged={onUsernameChanged} />
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '12px 16px' }}>No servers configured.</div>
      </div>
    );
  }

  return (
    <div className="access-panel">
      <UserAdminActions userId={userId} currentUsername={username} onUsernameChanged={onUsernameChanged} />
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px 0' }}>
        <span className="section-title" style={{ marginBottom: 0 }}>Server Access</span>
        <button className="btn btn-primary btn-sm" onClick={saveAll} disabled={saving || Object.keys(pending).length === 0}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
      {servers.map(s => (
        <div key={s.id} className="access-row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={s.hasAccess}
              onChange={e => setAccess(s.id, 'hasAccess', e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
          <span className="access-row-name">{s.name}</span>
          <select
            value={s.server_role}
            onChange={e => setAccess(s.id, 'server_role', e.target.value)}
            style={{ width: 100 }}
            disabled={!s.hasAccess}
          >
            <option value="viewer">viewer</option>            <option value="mod">mod</option>            <option value="admin">admin</option>
          </select>
          {s.granted_at && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Since {new Date(s.granted_at).toLocaleDateString()}
            </span>
          )}
          {pending[s.id] && <span style={{ color: 'var(--accent)', fontSize: 12 }}>●</span>}
        </div>
      ))}
    </div>
  );
}

// ── Access Requests Tab ────────────────────────────────────────────────────────

function AccessRequestsTab({ onCountChange }) {
  const [requests, setRequests] = useState([]);
  const [approveModal, setApproveModal] = useState(null);
  const [approveRole, setApproveRole] = useState('viewer');
  const toast = useToast();

  useEffect(() => { loadRequests(); }, []);

  async function loadRequests() {
    const res = await api.get('/api/access/pending');
    setRequests(res.data);
    onCountChange(res.data.length);
  }

  async function handleApprove(req) {
    try {
      await api.post(`/api/access/grant/${req.id}`, { server_role: approveRole });
      toast(`Access granted to ${req.username} for ${req.server_name}`);
      setApproveModal(null);
      loadRequests();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to approve', 'error');
    }
  }

  async function handleDeny(id) {
    try {
      await api.post(`/api/access/deny/${id}`);
      toast('Request denied');
      loadRequests();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to deny', 'error');
    }
  }

  return (
    <div>
      <div className="section-title">Pending Access Requests ({requests.length})</div>
      {requests.length === 0 ? (
        <div className="empty-state">No pending access requests.</div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Server</th>
                <th>Requested</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.username}</td>
                  <td>{r.server_name}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {new Date(r.requested_at).toLocaleString()}
                  </td>
                  <td>
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => { setApproveModal(r); setApproveRole('viewer'); }}
                      >
                        Approve
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeny(r.id)}>
                        Deny
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approveModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setApproveModal(null)}>
          <div className="modal">
            <h2>Approve Access</h2>
            <p>
              Grant <strong style={{ color: 'var(--text)' }}>{approveModal.username}</strong> access to{' '}
              <strong style={{ color: 'var(--text)' }}>{approveModal.server_name}</strong>.
            </p>
            <div className="form-group">
              <label className="form-label">Server Role</label>
              <select value={approveRole} onChange={e => setApproveRole(e.target.value)}>
                <option value="viewer">Viewer (see details only)</option>                <option value="mod">Mod (manage access, no admin actions)</option>                <option value="admin">Admin (start/stop/restart)</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setApproveModal(null)}>Cancel</button>
              <button className="btn btn-success" onClick={() => handleApprove(approveModal)}>Grant Access</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audit Log Tab ──────────────────────────────────────────────────────────────

function AuditLogTab() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [serverFilter, setServerFilter] = useState('');
  const [serverList, setServerList] = useState([]);

  useEffect(() => {
    api.get('/api/servers-list').then(res => setServerList(res.data));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page });
    if (serverFilter) params.set('server_id', serverFilter);
    api.get(`/api/audit?${params}`).then(res => {
      setEntries(res.data.entries);
      setTotal(res.data.total);
    });
  }, [page, serverFilter]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <span className="section-title" style={{ marginBottom: 0 }}>Audit Log</span>
        <span className="navbar-spacer" />
        <select
          value={serverFilter}
          onChange={e => { setServerFilter(e.target.value); setPage(1); }}
          style={{ width: 200 }}
        >
          <option value="">All Servers</option>
          {serverList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Server</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td style={{ color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'nowrap' }}>
                  {new Date(e.timestamp).toLocaleString()}
                </td>
                <td>{e.username || '—'}</td>
                <td>{e.action}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{e.server_name || '—'}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 32 }}>No entries found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Page {page} of {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Admin Panel ────────────────────────────────────────────────────────────────

export default function AdminPanel() {
  const [tab, setTab] = useState('servers');
  const [pendingCount, setPendingCount] = useState(0);

  return (
    <>
      <Navbar />
      <div className="page">
        <div className="page-header">
          <h1>Admin Panel</h1>
        </div>

        <div className="tabs">
          {[
            { key: 'servers', label: 'Servers' },
            { key: 'users', label: 'Users' },
            { key: 'requests', label: 'Access Requests', count: pendingCount },
            { key: 'audit', label: 'Audit Log' },
          ].map(t => (
            <button
              key={t.key}
              className={`tab-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.count > 0 && <span className="tab-count">{t.count}</span>}
            </button>
          ))}
        </div>

        {tab === 'servers' && <ServersTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'requests' && <AccessRequestsTab onCountChange={setPendingCount} />}
        {tab === 'audit' && <AuditLogTab />}
      </div>
    </>
  );
}
