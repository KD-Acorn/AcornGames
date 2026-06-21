import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo" style={{ textDecoration: 'none' }}>
        ⚡ Game Hub
      </Link>
      <span className="navbar-spacer" />
      {user?.role === 'admin' && (
        <Link
          to="/admin"
          className={`navbar-link ${location.pathname.startsWith('/admin') ? 'active' : ''}`}
          style={{ textDecoration: 'none' }}
        >
          Admin Panel
        </Link>
      )}
      {(user?.role === 'mod' || user?.role === 'admin') && (
        <Link
          to="/mod"
          className={`navbar-link ${location.pathname.startsWith('/mod') ? 'active' : ''}`}
          style={{ textDecoration: 'none', marginLeft: 12 }}
        >
          Mod Panel
        </Link>
      )}
      <Link
        to="/settings"
        className="navbar-user"
        style={{ textDecoration: 'none' }}
        title="Account settings"
      >
        <span>{user?.username}</span>
      </Link>
      <button
        className="btn btn-secondary btn-sm"
        onClick={handleLogout}
      >
        Logout
      </button>
    </nav>
  );
}
