import { useState, useEffect } from 'react';
import Navbar from '../Navbar';
import { useToast } from '../Toast';
import api from '../api';

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const toast = useToast();

  useEffect(() => { loadUsers(); }, []);
  async function loadUsers() {
    const res = await api.get('/api/users');
    setUsers(res.data);
  }

  return (
    <div>
      <div className="page-header">
        <span className="section-title" style={{ marginBottom: 0 }}>Users ({users.length})</span>
      </div>

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
                    {new Date(u.created_at).toLocaleDateString()
                      }
                  </td>
                  <td style={{ color: 'var(--accent)', fontSize: 13 }}>
                    {expanded === u.id ? '▲ Hide' : '▼ Manage'}
                  </td>
                  <td />
                </tr>
                {expanded === u.id && (
                  <tr key={`access-${u.id}`}>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <UserAccessPanel userId={u.id} />
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

function UserAccessPanel({ userId }) {
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
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save access', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (servers.length === 0) return <div className="access-panel"><div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No servers configured.</div></div>;

  return (
    <div className="access-panel">
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <option value="viewer">viewer</option>
            <option value="mod">mod</option>
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

function AccessRequestsTab({ onCountChange }) {
  const [requests, setRequests] = useState([]);
  const [approveModal, setApproveModal] = useState(null);
  const [approveRole, setApproveRole] = useState('viewer');
  const toast = useToast();

  useEffect(() => { loadRequests(); }, []);

  async function loadRequests() {
    const res = await api.get('/api/access/pending');
    setRequests(res.data);
    onCountChange && onCountChange(res.data.length);
  }

  async function handleApprove(reqObj) {
    try {
      await api.post(`/api/access/grant/${reqObj.id}`, { server_role: approveRole });
      toast(`Access granted to ${reqObj.username} for ${reqObj.server_name}`);
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
                <option value="viewer">Viewer (see details only)</option>
                <option value="mod">Mod (manage access, no admin actions)</option>
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

export default function ModPanel() {
  const [tab, setTab] = useState('requests');
  const [pendingCount, setPendingCount] = useState(0);

  return (
    <>
      <Navbar />
      <div className="page">
        <div className="page-header">
          <h1>Mod Panel</h1>
        </div>

        <div className="tabs">
          {[
            { key: 'requests', label: 'Access Requests', count: pendingCount },
            { key: 'users', label: 'Users' },
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

        {tab === 'requests' && <AccessRequestsTab onCountChange={setPendingCount} />}
        {tab === 'users' && <UsersTab />}
      </div>
    </>
  );
}
