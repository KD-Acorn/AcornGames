import { useState, useEffect } from 'react';
import api from './api';

const IDLE_SECONDS = 4 * 60 * 60;

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 11H6V8a6 6 0 0112 0v3zm-6 8a2 2 0 100-4 2 2 0 000 4zm8-8H4a1 1 0 00-1 1v9a1 1 0 001 1h16a1 1 0 001-1v-9a1 1 0 00-1-1z"/>
  </svg>
);

const SFLogo = () => (
  <svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sf-plate" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stopColor="#2e3540"/>
        <stop offset="100%" stopColor="#1a1f26"/>
      </linearGradient>
      <linearGradient id="sf-metal-s" x1="0.5" y1="0" x2="0.5" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stopColor="#f4f8fc"/>
        <stop offset="20%" stopColor="#d4dce6"/>
        <stop offset="52%" stopColor="#8090a0"/>
        <stop offset="78%" stopColor="#c0ccd6"/>
        <stop offset="100%" stopColor="#e8f0f6"/>
      </linearGradient>
      <linearGradient id="sf-bolt-face" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stopColor="#3a4550"/>
        <stop offset="100%" stopColor="#252c34"/>
      </linearGradient>
    </defs>

    {/* Steel plate */}
    <rect width="72" height="72" rx="10" fill="url(#sf-plate)"/>
    {/* Top-edge highlight */}
    <rect x="1" y="1" width="70" height="2" rx="1" fill="rgba(255,255,255,0.07)"/>
    {/* Outer border */}
    <rect x="0.5" y="0.5" width="71" height="71" rx="9.5" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="1"/>
    {/* Inner recess border */}
    <rect x="5" y="5" width="62" height="62" rx="6" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="0.5"/>

    {/* Corner bolts — TL */}
    <circle cx="11.5" cy="11.5" r="5" fill="#16191e" stroke="#343c46" strokeWidth="0.5"/>
    <circle cx="11.5" cy="11.5" r="3.2" fill="url(#sf-bolt-face)"/>
    <circle cx="10.4" cy="10.4" r="1.1" fill="rgba(255,255,255,0.18)"/>
    {/* TR */}
    <circle cx="60.5" cy="11.5" r="5" fill="#16191e" stroke="#343c46" strokeWidth="0.5"/>
    <circle cx="60.5" cy="11.5" r="3.2" fill="url(#sf-bolt-face)"/>
    <circle cx="59.4" cy="10.4" r="1.1" fill="rgba(255,255,255,0.18)"/>
    {/* BL */}
    <circle cx="11.5" cy="60.5" r="5" fill="#16191e" stroke="#343c46" strokeWidth="0.5"/>
    <circle cx="11.5" cy="60.5" r="3.2" fill="url(#sf-bolt-face)"/>
    <circle cx="10.4" cy="59.4" r="1.1" fill="rgba(255,255,255,0.18)"/>
    {/* BR */}
    <circle cx="60.5" cy="60.5" r="5" fill="#16191e" stroke="#343c46" strokeWidth="0.5"/>
    <circle cx="60.5" cy="60.5" r="3.2" fill="url(#sf-bolt-face)"/>
    <circle cx="59.4" cy="59.4" r="1.1" fill="rgba(255,255,255,0.18)"/>

    {/* Metallic S */}
    <text
      x="36" y="51"
      textAnchor="middle"
      fontFamily="'Arial Black', Impact, 'Franklin Gothic Heavy', sans-serif"
      fontSize="48"
      fontWeight="900"
      fontStyle="italic"
      fill="url(#sf-metal-s)"
    >S</text>
  </svg>
);

function SFStatusBadge({ status, playerCount }) {
  if (status === 'booting') {
    return (
      <span className="status-badge booting">
        <span className="status-dot booting"/>
        Starting Up...
      </span>
    );
  }
  if (status === 'idle') {
    return (
      <span className="status-badge idle">
        <span className="status-dot idle"/>
        Idle
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="status-badge offline">
        <span className="status-dot offline"/>
        Offline
      </span>
    );
  }
  // online
  return (
    <span className="status-badge online">
      <span className="status-dot online"/>
      {playerCount > 0 ? `Online · ${playerCount} player${playerCount !== 1 ? 's' : ''}` : 'Online'}
    </span>
  );
}

function useCountdown(emptySince) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!emptySince) { setRemaining(null); return; }
    const idleAt = (emptySince + IDLE_SECONDS) * 1000;
    const update = () => setRemaining(Math.max(0, idleAt - Date.now()));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [emptySince]);
  return remaining;
}

function formatCountdown(ms) {
  if (ms == null || ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function SatisfactoryCard({ server, onClick }) {
  const [sfStatus, setSfStatus] = useState({ status: 'offline', playerCount: 0, emptySince: null });

  useEffect(() => {
    if (!server.hasAccess) return;
    const fetch = () => {
      api.get('/api/satisfactory/status')
        .then(res => setSfStatus(res.data))
        .catch(() => setSfStatus({ status: 'offline', playerCount: 0, emptySince: null }));
    };
    fetch();
    const interval = setInterval(fetch, 15000);
    return () => clearInterval(interval);
  }, [server.hasAccess]);

  const showCountdown = sfStatus.status === 'online' && sfStatus.playerCount === 0 && sfStatus.emptySince != null;
  const remaining = useCountdown(showCountdown ? sfStatus.emptySince : null);

  return (
    <div
      className={`server-card sf-card ${server.hasAccess ? '' : 'locked'}`}
      onClick={onClick}
      title={server.hasAccess ? `Connect to ${server.name}` : `Request access to ${server.name}`}
    >
      {!server.hasAccess && <div className="lock-overlay"><LockIcon /></div>}
      <SFLogo />
      <div className="server-card-game">{server.game}</div>
      <div className="server-card-name">{server.name}</div>
      <SFStatusBadge status={sfStatus.status} playerCount={sfStatus.playerCount} />
      {showCountdown && remaining != null && (
        <div className="sf-countdown">
          <span className="sf-countdown-label">IDLE IN</span>
          <span className="sf-countdown-timer">{formatCountdown(remaining)}</span>
        </div>
      )}
    </div>
  );
}
