import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { signup, login, getDropdownJobTitles, getDropdownCities, getDropdownSkills } from '../api';
import { useAuth } from '../context/AuthContext';
import './AuthModal.css';

export default function AuthModal({ isOpen, onClose, initialMode = 'login' }) {
  const { loginUser } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState(1); // signup steps: 1=creds, 2=profile, 3=writeup
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const backdropRef = useRef(null);

  // Form state
  const [form, setForm] = useState({
    fullName: '', email: '', password: '',
    jobTitle: '', city: '', writeup: '', selectedSkills: [], yearsOfExperience: 0,
  });

  // Dropdown data
  const [jobTitles, setJobTitles] = useState([]);
  const [cities, setCities] = useState([]);
  const [allSkills, setAllSkills] = useState([]);
  const [skillSearch, setSkillSearch] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [showJobDrop, setShowJobDrop] = useState(false);
  const [showCityDrop, setShowCityDrop] = useState(false);

  useEffect(() => {
    if (isOpen && mode === 'signup') {
      Promise.all([getDropdownJobTitles(), getDropdownCities(), getDropdownSkills()])
        .then(([jt, ct, sk]) => {
          setJobTitles(jt.data || []);
          setCities(ct.data || []);
          setAllSkills(sk.data || []);
        })
        .catch(() => {});
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (isOpen) setMode(initialMode);
  }, [isOpen, initialMode]);

  useEffect(() => {
    setError('');
    setStep(1);
    if (isOpen) setForm({ fullName: '', email: '', password: '', jobTitle: '', city: '', writeup: '', selectedSkills: [], yearsOfExperience: 0 });
  }, [mode, isOpen]);

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login({ email: form.email, password: form.password });
      loginUser(res.data.user);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await signup({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        jobTitle: form.jobTitle,
        city: form.city,
        writeup: form.writeup,
        selectedSkills: form.selectedSkills,
        yearsOfExperience: Number(form.yearsOfExperience) || 0,
      });
      loginUser(res.data.user);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed.');
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => {
    if (step === 1) {
      if (!form.fullName || !form.email || !form.password) { setError('All fields are required.'); return; }
      if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
      setError('');
      setStep(2);
    } else if (step === 2) {
      if (!form.jobTitle || !form.city) { setError('Please select a job title and city.'); return; }
      setError('');
      setStep(3);
    }
  };

  const toggleSkill = (skill) => {
    setForm(prev => ({
      ...prev,
      selectedSkills: prev.selectedSkills.includes(skill)
        ? prev.selectedSkills.filter(s => s !== skill)
        : [...prev.selectedSkills, skill],
    }));
  };

  const filteredSkills = allSkills.filter(s => s.toLowerCase().includes(skillSearch.toLowerCase()));
  const filteredJobs = jobTitles.filter(j => j.toLowerCase().includes(jobSearch.toLowerCase()));
  const filteredCities = cities.filter(c => c.toLowerCase().includes(citySearch.toLowerCase()));

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="auth-backdrop"
        ref={backdropRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      >
        <motion.div
          className="auth-modal"
          initial={{ opacity: 0, scale: 0.92, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 30 }}
          transition={{ duration: 0.3 }}
        >
          <button className="auth-modal__close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>

          {/* ─── LOGIN ──────────────────────────── */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="auth-form">
              <h2 className="auth-form__title">Welcome Back</h2>
              <p className="auth-form__sub">Sign in to your account</p>

              <label className="auth-label">
                <span className="material-symbols-outlined">mail</span>
                <input type="email" placeholder="Email" value={form.email} onChange={set('email')} autoFocus />
              </label>
              <label className="auth-label">
                <span className="material-symbols-outlined">lock</span>
                <input type="password" placeholder="Password" value={form.password} onChange={set('password')} />
              </label>

              {error && <p className="auth-error">{error}</p>}

              <button type="submit" className="auth-btn auth-btn--primary" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign In'}
              </button>

              <p className="auth-switch">
                Don't have an account?{' '}
                <button type="button" onClick={() => setMode('signup')}>Sign Up</button>
              </p>
            </form>
          )}

          {/* ─── SIGNUP STEP 1: Credentials ──────── */}
          {mode === 'signup' && step === 1 && (
            <div className="auth-form">
              <h2 className="auth-form__title">Create Account</h2>
              <p className="auth-form__sub">Step 1 of 3 — Your credentials</p>
              <div className="auth-steps">
                <span className="auth-step auth-step--active">1</span>
                <span className="auth-step-line" />
                <span className="auth-step">2</span>
                <span className="auth-step-line" />
                <span className="auth-step">3</span>
              </div>

              <label className="auth-label">
                <span className="material-symbols-outlined">person</span>
                <input type="text" placeholder="Full Name" value={form.fullName} onChange={set('fullName')} autoFocus />
              </label>
              <label className="auth-label">
                <span className="material-symbols-outlined">mail</span>
                <input type="email" placeholder="Email" value={form.email} onChange={set('email')} />
              </label>
              <label className="auth-label">
                <span className="material-symbols-outlined">lock</span>
                <input type="password" placeholder="Password (min 6 chars)" value={form.password} onChange={set('password')} />
              </label>

              {error && <p className="auth-error">{error}</p>}

              <button type="button" className="auth-btn auth-btn--primary" onClick={nextStep}>Continue</button>

              <p className="auth-switch">
                Already have an account?{' '}
                <button type="button" onClick={() => setMode('login')}>Sign In</button>
              </p>
            </div>
          )}

          {/* ─── SIGNUP STEP 2: Profile ───────────── */}
          {mode === 'signup' && step === 2 && (
            <div className="auth-form">
              <h2 className="auth-form__title">Your Profile</h2>
              <p className="auth-form__sub">Step 2 of 3 — Job & location</p>
              <div className="auth-steps">
                <span className="auth-step auth-step--done">1</span>
                <span className="auth-step-line auth-step-line--done" />
                <span className="auth-step auth-step--active">2</span>
                <span className="auth-step-line" />
                <span className="auth-step">3</span>
              </div>

              {/* Job Title Dropdown */}
              <div className="auth-dropdown-wrap">
                <label className="auth-label">
                  <span className="material-symbols-outlined">work</span>
                  <input
                    type="text"
                    placeholder="Search job title…"
                    value={form.jobTitle || jobSearch}
                    onChange={(e) => { setJobSearch(e.target.value); setForm(p => ({ ...p, jobTitle: '' })); setShowJobDrop(true); }}
                    onFocus={() => setShowJobDrop(true)}
                  />
                </label>
                {showJobDrop && (
                  <div className="auth-dropdown">
                    {filteredJobs.slice(0, 50).map(j => (
                      <div
                        key={j}
                        className={`auth-dropdown__item ${form.jobTitle === j ? 'auth-dropdown__item--sel' : ''}`}
                        onClick={() => { setForm(p => ({ ...p, jobTitle: j })); setShowJobDrop(false); setJobSearch(''); }}
                      >{j}</div>
                    ))}
                    {filteredJobs.length === 0 && <div className="auth-dropdown__empty">No matches</div>}
                  </div>
                )}
              </div>

              {/* City Dropdown */}
              <div className="auth-dropdown-wrap">
                <label className="auth-label">
                  <span className="material-symbols-outlined">location_on</span>
                  <input
                    type="text"
                    placeholder="Search city…"
                    value={form.city || citySearch}
                    onChange={(e) => { setCitySearch(e.target.value); setForm(p => ({ ...p, city: '' })); setShowCityDrop(true); }}
                    onFocus={() => setShowCityDrop(true)}
                  />
                </label>
                {showCityDrop && (
                  <div className="auth-dropdown">
                    {filteredCities.map(c => (
                      <div
                        key={c}
                        className={`auth-dropdown__item ${form.city === c ? 'auth-dropdown__item--sel' : ''}`}
                        onClick={() => { setForm(p => ({ ...p, city: c })); setShowCityDrop(false); setCitySearch(''); }}
                      >{c}</div>
                    ))}
                    {filteredCities.length === 0 && <div className="auth-dropdown__empty">No matches</div>}
                  </div>
                )}
              </div>

              {/* Years of Experience */}
              <label className="auth-label">
                <span className="material-symbols-outlined">hourglass_top</span>
                <input
                  type="number"
                  placeholder="Years of experience"
                  min="0"
                  max="50"
                  value={form.yearsOfExperience}
                  onChange={(e) => setForm(p => ({ ...p, yearsOfExperience: e.target.value }))}
                />
              </label>

              {error && <p className="auth-error">{error}</p>}

              <div className="auth-btn-row">
                <button type="button" className="auth-btn auth-btn--ghost" onClick={() => setStep(1)}>Back</button>
                <button type="button" className="auth-btn auth-btn--primary" onClick={nextStep}>Continue</button>
              </div>
            </div>
          )}

          {/* ─── SIGNUP STEP 3: Writeup + Skills ──── */}
          {mode === 'signup' && step === 3 && (
            <div className="auth-form">
              <h2 className="auth-form__title">About You</h2>
              <p className="auth-form__sub">Step 3 of 3 — Describe your work & select skills</p>
              <div className="auth-steps">
                <span className="auth-step auth-step--done">1</span>
                <span className="auth-step-line auth-step-line--done" />
                <span className="auth-step auth-step--done">2</span>
                <span className="auth-step-line auth-step-line--done" />
                <span className="auth-step auth-step--active">3</span>
              </div>

              <textarea
                className="auth-textarea"
                rows={4}
                placeholder="What do you do day-to-day? What are you good at? What work do you want to move toward?"
                value={form.writeup}
                onChange={set('writeup')}
              />

              <div className="auth-skills-section">
                <label className="auth-label auth-label--skills">
                  <span className="material-symbols-outlined">search</span>
                  <input
                    type="text"
                    placeholder="Search skills…"
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                  />
                </label>
                {form.selectedSkills.length > 0 && (
                  <div className="auth-skills-selected">
                    {form.selectedSkills.map(s => (
                      <span key={s} className="auth-skill-chip auth-skill-chip--sel" onClick={() => toggleSkill(s)}>
                        {s} <span className="material-symbols-outlined" style={{ fontSize: '0.7em' }}>close</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="auth-skills-grid">
                  {filteredSkills.slice(0, 60).map(s => (
                    <span
                      key={s}
                      className={`auth-skill-chip ${form.selectedSkills.includes(s) ? 'auth-skill-chip--sel' : ''}`}
                      onClick={() => toggleSkill(s)}
                    >{s}</span>
                  ))}
                  {filteredSkills.length === 0 && <p className="auth-dropdown__empty">No skills found</p>}
                </div>
              </div>

              {error && <p className="auth-error">{error}</p>}

              <div className="auth-btn-row">
                <button type="button" className="auth-btn auth-btn--ghost" onClick={() => setStep(2)}>Back</button>
                <button type="button" className="auth-btn auth-btn--primary" onClick={handleSignup} disabled={loading}>
                  {loading ? 'Creating…' : 'Create Account'}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
