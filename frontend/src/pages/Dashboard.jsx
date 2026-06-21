import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../Navbar';
import { useToast } from '../Toast';
import api from '../api';
import SatisfactoryCard from '../SatisfactoryCard';

const GamepadIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="7" width="20" height="12" rx="5" />
    <path d="M7 11v4M5 13h4M15 12h2M18 12h-2" />
  </svg>
);

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 11H6V8a6 6 0 0112 0v3zm-6 8a2 2 0 100-4 2 2 0 000 4zm8-8H4a1 1 0 00-1 1v9a1 1 0 001 1h16a1 1 0 001-1v-9a1 1 0 00-1-1z"/>
  </svg>
);

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status}`}>
      <span className={`status-dot ${status}`} />
      {status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Unknown'}
    </span>
  );
}

function RequestModal({ server, onClose, onConfirm }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Request Access</h2>
        <p>
          You don't have access to <strong style={{ color: 'var(--text)' }}>{server.name}</strong>.
          Would you like to request access?
        </p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm}>Request Access</button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [servers, setServers] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [requestModal, setRequestModal] = useState(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api.get('/api/servers').then(res => {
      setServers(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Fetch live status for servers user has access to
  useEffect(() => {
    const accessible = servers.filter(s => s.hasAccess);
    if (accessible.length === 0) return;

    accessible.forEach(async (s) => {
      try {
        const res = await api.get(`/api/servers/${s.id}/status`);
        setStatuses(prev => ({ ...prev, [s.id]: res.data.status }));
      } catch {
        setStatuses(prev => ({ ...prev, [s.id]: 'unknown' }));
      }
    });
  }, [servers]);

  async function handleRequest(server) {
    try {
      await api.post('/api/access/request', { server_id: server.id });
      toast('Access request sent for ' + server.name + '!');
      setRequestModal(null);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to send request';
      toast(msg === 'Request already pending' ? 'You already have a pending request for this server.' : msg, 'error');
      setRequestModal(null);
    }
  }

  function handleCardClick(server) {
    if (server.hasAccess) {
      navigate(`/server/${server.id}`);
    } else {
      setRequestModal(server);
    }
  }

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: 'var(--text-secondary)' }}>Loading servers...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page">
        <div className="page-header">
          <h1>Game Servers</h1>
        </div>
        {servers.length === 0 ? (
          <div className="empty-state">No servers configured yet.</div>
        ) : (
          <div className="server-grid">
            {servers.map(server => {
              if (server.pm2_name === 'satisfactory-server') {
                return (
                  <SatisfactoryCard
                    key={server.id}
                    server={server}
                    onClick={() => handleCardClick(server)}
                  />
                );
              }
              return (
                <div
                  key={server.id}
                  className={`server-card ${server.hasAccess ? '' : 'locked'}`}
                  onClick={() => handleCardClick(server)}
                  title={server.hasAccess ? `Connect to ${server.name}` : `Request access to ${server.name}`}
                >
                  {!server.hasAccess && (
                    <div className="lock-overlay"><LockIcon /></div>
                  )}
                  {server.game_icon_url ? (
                    <img
                      src={server.game_icon_url}
                      alt={server.game}
                      className="server-card-icon"
                      onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                    />
                  ) : null}
                  <div
                    className="server-card-icon"
                    style={{
                      display: server.game_icon_url ? 'none' : 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-secondary)',
                      background: 'var(--bg3)',
                    }}
                  >
                    <GamepadIcon />
                  </div>
                  <div className="server-card-game">{server.game}</div>
                  <div className="server-card-name">{server.name}</div>
                  <StatusBadge status={statuses[server.id] || 'unknown'} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {requestModal && (
        <RequestModal
          server={requestModal}
          onClose={() => setRequestModal(null)}
          onConfirm={() => handleRequest(requestModal)}
        />
      )}
    </>
  );
}
