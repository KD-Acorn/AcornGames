import { useState } from 'react';
import Navbar from '../Navbar';
import { useToast } from '../Toast';
import { useAuth } from '../AuthContext';
import api from '../api';

function Section({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function FieldError({ msg }) {
  if (!msg) return null;
  return <div className="form-error" style={{ textAlign: 'left', marginBottom: 12 }}>{msg}</div>;
}

export default function Settings() {
  const { user, updateUser } = useAuth();
  const toast = useToast();

  // Username form
  const [username, setUsername] = useState(user?.username || '');
  const [usernameError, setUsernameError] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);

  // Password form
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  async function handleUsernameSubmit(e) {
    e.preventDefault();
    setUsernameError('');
    if (username === user?.username) {
      setUsernameError('That is already your username.');
      return;
    }
    setUsernameLoading(true);
    try {
      const res = await api.patch('/api/account/username', { username });
      updateUser({ username: res.data.username });
      toast('Username updated');
    } catch (err) {
      setUsernameError(err.response?.data?.error || 'Failed to update username');
    } finally {
      setUsernameLoading(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setPwError('');
    if (pwForm.next !== pwForm.confirm) {
      setPwError('New passwords do not match.');
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    setPwLoading(true);
    try {
      await api.patch('/api/account/password', {
        currentPassword: pwForm.current,
        newPassword: pwForm.next,
      });
      setPwForm({ current: '', next: '', confirm: '' });
      toast('Password changed');
    } catch (err) {
      setPwError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 560 }}>
        <div className="page-header">
          <h1>Account Settings</h1>
        </div>

        <Section title="Username">
          <form onSubmit={handleUsernameSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                minLength={2}
                maxLength={30}
                pattern="[a-zA-Z0-9_\-]+"
                title="Letters, numbers, _ or - only"
                required
              />
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                2–30 characters, letters / numbers / _ / -
              </div>
            </div>
            <FieldError msg={usernameError} />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={usernameLoading || username === user?.username}
            >
              {usernameLoading ? 'Saving…' : 'Save Username'}
            </button>
          </form>
        </Section>

        <Section title="Change Password">
          <form onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label className="form-label">Current Password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={pwForm.current}
                onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input
                type="password"
                autoComplete="new-password"
                value={pwForm.next}
                onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                minLength={8}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input
                type="password"
                autoComplete="new-password"
                value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                minLength={8}
                required
              />
            </div>
            <FieldError msg={pwError} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={pwLoading}>
              {pwLoading ? 'Saving…' : 'Change Password'}
            </button>
          </form>
        </Section>
      </div>
    </>
  );
}
