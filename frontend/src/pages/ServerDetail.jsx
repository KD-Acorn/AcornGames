import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Navbar from '../Navbar';
import { useToast } from '../Toast';
import { useAuth } from '../AuthContext';
import api from '../api';
import ModsTab from './ModsTab';

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status}`}>
      <span className={`status-dot ${status}`} />
      {status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Unknown'}
    </span>
  );
}

function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

export default function ServerDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [server, setServer] = useState(null);
  const [status, setStatus] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    async function load() {
      try {
        const [sRes, auditRes] = await Promise.all([
          api.get(`/api/servers/${id}`),
          api.get(`/api/audit?server_id=${id}&page=1`).catch(() => ({ data: { entries: [] } })),
        ]);
        setServer(sRes.data);
        setAuditLog(auditRes.data.entries || []);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load server');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!server) return;
    const fetchStatus = () => {
      api.get(`/api/servers/${id}/status`)
        .then(res => setStatus(res.data))
        .catch(() => setStatus({ status: 'unknown' }));
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [server, id]);

  async function doAction(action) {
    setActionLoading(true);
    try {
      await api.post(`/api/servers/${id}/${action}`);
      toast(`Server ${action} successful`);
      setTimeout(() => {
        api.get(`/api/servers/${id}/status`).then(res => setStatus(res.data)).catch(() => {});
      }, 2000);
    } catch (err) {
      toast(err.response?.data?.error || `Failed to ${action} server`, 'error');
    } finally {
      setActionLoading(false);
      setConfirmModal(null);
    }
  }

  const canControl = user?.role === 'admin' || server?.serverRole === 'admin';
  const isSatisfactory = server?.pm2_name === 'satisfactory-server';

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: 'var(--text-secondary)' }}>Loading...</div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Navbar />
        <div className="page">
          <div className="card" style={{ color: 'var(--danger)', textAlign: 'center' }}>
            {error}
          </div>
        </div>
      </>
    );
  }

  const connectInfo = server?.connect_info || {};

  return (
    <>
      <Navbar />
      <div className="page">
        <div className="page-header">
          <button className="back-btn btn" onClick={() => navigate('/')}>← Back</button>
          <h1>
            {server?.game_icon_url && (
              <img src={server.game_icon_url} alt="" style={{ width: 32, height: 32, borderRadius: 6, marginRight: 12, verticalAlign: 'middle' }} />
            )}
            {server?.name}
          </h1>
          <span className="navbar-spacer" />
          {status && <StatusBadge status={status.status} />}
        </div>

        {/* Connection Banner */}
        <div className="connect-banner">
          <h2>How to Connect</h2>
          {connectInfo.connect_string && (
            <div className="connect-string">{connectInfo.connect_string}</div>
          )}
          {connectInfo.instructions && (
            <div className="connect-instructions">{connectInfo.instructions}</div>
          )}
          {!connectInfo.connect_string && (
            <div className="connect-string">{server?.host}:{server?.port}</div>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Host: <strong style={{ color: 'var(--text)' }}>{server?.host}</strong>
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Port: <strong style={{ color: 'var(--text)' }}>{server?.port}</strong>
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'overview', label: 'Overview' },
            ...(isSatisfactory ? [{ key: 'mods', label: 'Mods' }] : []),
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 16px', fontSize: 14, fontWeight: 600,
                color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-secondary)',
                borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <>
            {/* Status & Controls */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="section-title">Server Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                <StatusBadge status={status?.status || 'unknown'} />
                {status?.uptime && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Up since: <strong style={{ color: 'var(--text)' }}>
                      {new Date(status.uptime).toLocaleString()}
                    </strong>
                  </span>
                )}
                {status?.playerCount != null && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Players online: <strong style={{ color: 'var(--text)' }}>{status.playerCount}</strong>
                  </span>
                )}
                {status?.pid && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    PID: <strong style={{ color: 'var(--text)' }}>{status.pid}</strong>
                  </span>
                )}
              </div>

              {canControl && (
                <div className="server-controls">
                  <button
                    className="btn btn-success btn-sm"
                    disabled={actionLoading}
                    onClick={() => setConfirmModal({ action: 'start', title: 'Start Server', message: `Start ${server?.name}?` })}
                  >
                    ▶ Start
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={actionLoading}
                    onClick={() => setConfirmModal({ action: 'restart', title: 'Restart Server', message: `Restart ${server?.name}? This will briefly disconnect all players.` })}
                  >
                    ↺ Restart
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={actionLoading}
                    onClick={() => setConfirmModal({ action: 'stop', title: 'Stop Server', message: `Stop ${server?.name}? This will disconnect all players.` })}
                  >
                    ■ Stop
                  </button>
                </div>
              )}
            </div>

            {/* Recent Activity */}
            <div className="card">
              <div className="section-title">Recent Activity</div>
              {auditLog.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>No activity recorded yet.</div>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>User</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLog.map(entry => (
                        <tr key={entry.id}>
                          <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                            {new Date(entry.timestamp).toLocaleString()}
                          </td>
                          <td>{entry.username || '—'}</td>
                          <td>{entry.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'mods' && (
          <div className="card">
            <ModsTab serverId={id} isSatisfactory={isSatisfactory} />
          </div>
        )}
      </div>

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={() => doAction(confirmModal.action)}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </>
  );
}
