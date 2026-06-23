import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import AuthModal from './AuthModal';
import './Navbar.css';
import './AuthModal.css';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authModal, setAuthModal] = useState(null); // null | 'login' | 'signup'
  const { user, logoutUser } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <motion.nav
        className={`navbar ${scrolled ? 'navbar--scrolled' : ''}`}
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <div className="navbar__inner">
          <NavLink to="/" className="navbar__brand">
            <img rel="icon" type="image/svg+xml" src="/logo.svg" height={40} width={40} />
            <span className="navbar__title">SKILLS MIRAGE</span>
          </NavLink>

          <button
            className="navbar__toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <span />
            <span />
            <span />
          </button>

          <div className={`navbar__links ${menuOpen ? 'navbar__links--open' : ''}`}>
            {[
              { to: '/', label: 'Home', end: true },
              { to: '/dashboard', label: 'Dashboard' },
              { to: '/worker', label: 'Risk Score' },
              { to: '/chatbot', label: 'AI Chat' },
            ].map((link, i) => (
              <motion.div
                key={link.to}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
              >
                <NavLink
                  to={link.to}
                  end={link.end}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </NavLink>
              </motion.div>
            ))}

            {/* Auth section */}
            {user ? (
              <div className="navbar__user">
                <div className="navbar__avatar">{user.full_name[0].toUpperCase()}</div>
                <span className="navbar__user-name">{user.full_name}</span>
                <button className="navbar__logout" onClick={logoutUser}>Logout</button>
              </div>
            ) : (
              <div className="navbar__auth">
                <button className="navbar__auth-btn navbar__auth-btn--login" onClick={() => setAuthModal('login')}>Log In</button>
                <button className="navbar__auth-btn navbar__auth-btn--signup" onClick={() => setAuthModal('signup')}>Sign Up</button>
              </div>
            )}
          </div>
        </div>
      </motion.nav>

      <AuthModal
        isOpen={authModal !== null}
        onClose={() => setAuthModal(null)}
        initialMode={authModal || 'login'}
      />
    </>
  );
}
