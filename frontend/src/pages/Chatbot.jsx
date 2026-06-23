import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { sendAIChat, generateReskillPlan } from '../api';
import { useAuth } from '../context/AuthContext';
import './Chatbot.css';

/* ---------- Background particles ---------- */
function ChatParticles({ count = 150 }) {
  const mesh = useRef();
  const positions = useMemo(() => {
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 16;
      p[i * 3 + 1] = (Math.random() - 0.5) * 16;
      p[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    return p;
  }, [count]);
  useFrame((state) => {
    if (!mesh.current) return;
    mesh.current.rotation.y = state.clock.elapsedTime * 0.02;
    mesh.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.01) * 0.1;
  });
  return (
    <points ref={mesh}>
      <bufferGeometry><bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} /></bufferGeometry>
      <pointsMaterial size={0.03} color="#a855f7" transparent opacity={0.4} sizeAttenuation blending={THREE.AdditiveBlending} />
    </points>
  );
}

/* ---------- Format message text ---------- */
function formatMessage(text) {
  if (!text) return text;
  const lines = text.split('\n');
  return lines.map((line, li) => {
    // ### prefix → italic line
    const isHeading = line.startsWith('###');
    const lineContent = isHeading ? line.replace(/^###\s*/, '') : line;

    // Split by **bold** markers
    const parts = lineContent.split(/(\*\*[^*]+\*\*)/);
    const rendered = parts.map((part, pi) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={pi}>{part.slice(2, -2)}</strong>;
      }
      return <span key={pi}>{part}</span>;
    });

    return (
      <span key={li}>
        {isHeading ? <em>{rendered}</em> : rendered}
        {li < lines.length - 1 && <br />}
      </span>
    );
  });
}

const SUGGESTIONS = [
  'Which jobs are most at risk in Pune?',
  'What skills should I learn for AI readiness?',
  'Show me reskilling courses for data entry workers',
  'मेरी नौकरी कितनी सुरक्षित है?',
  'What is the vulnerability score methodology?',
];

export default function Chatbot() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('chat');
  const [language, setLanguage] = useState('english');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hello! I\'m the Skills Mirage AI assistant. I can help you understand job market risks, suggest reskilling paths, and answer questions about AI displacement in India. Ask me anything — English or Hindi!',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Plan tab state
  const [preferences, setPreferences] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [planData, setPlanData] = useState(null);
  const [planError, setPlanError] = useState('');

  const messagesRef = useRef(null);
  const bgY = useTransform(useScroll().scrollYProgress, [0, 1], [0, -60]);

  const send = async (text) => {
    if (!text.trim()) return;
    const userMsg = { role: 'user', text: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await sendAIChat({
        query: text.trim(),
        userId: user?.id || undefined,
        language,
      });
      const data = res.data;
      let replyText = data.answer || data.reply || 'No response received.';

      // Append sources if present
      if (data.sources && data.sources.length > 0) {
        replyText += '\n\n📚 Sources:\n' + data.sources.map((s, i) =>
          `${i + 1}. ${s.title}${s.platform ? ` (${s.platform})` : ''}${s.link ? ` — ${s.link}` : ''}`
        ).join('\n');
      }

      setMessages((prev) => [...prev, { role: 'assistant', text: replyText }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Sorry, I couldn\'t process that request. Please try again.' },
      ]);
    }
    setLoading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    send(input);
  };

  const handleGeneratePlan = async () => {
    if (!user) return;
    setPlanLoading(true);
    setPlanError('');
    setPlanData(null);

    try {
      const res = await generateReskillPlan({
        userId: user.id,
        preferences: preferences.trim(),
        language,
      });
      setPlanData(res.data);
    } catch {
      setPlanError('Failed to generate your reskilling plan. Please try again.');
    }
    setPlanLoading(false);
  };

  return (
    <div className="chat-page">
      {/* 3D Background */}
      <motion.div className="chat-page__canvas" style={{ y: bgY }}>
        <Canvas camera={{ position: [0, 0, 6], fov: 45 }} dpr={[1, 1.5]}>
          <fog attach="fog" args={['#0a0a0f', 4, 14]} />
          <ChatParticles />
          <Stars radius={35} depth={50} count={400} factor={3} fade speed={0.3} />
        </Canvas>
      </motion.div>

      <div className="chat-page__inner section-container">
        <motion.div
          className="chat-hero"
          initial={{ opacity: 0, y: 30, filter: 'blur(15px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <h1>AI <span className="gradient-text">Assistant</span></h1>
          <p>Ask about job risks, reskilling paths, and market intelligence — in English or Hindi.</p>
        </motion.div>

        {/* ─── Tab Bar + Language Toggle ──────────── */}
        <div className="chat-controls">
          <div className="chat-tabs">
            <button
              className={`chat-tab ${activeTab === 'chat' ? 'chat-tab--active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <span className="material-symbols-outlined">chat</span>
              AI Chat
            </button>
            <button
              className={`chat-tab ${activeTab === 'plan' ? 'chat-tab--active' : ''}`}
              onClick={() => setActiveTab('plan')}
            >
              <span className="material-symbols-outlined">school</span>
              Reskill Plan
            </button>
          </div>
          <div className="lang-toggle">
            <button
              className={`lang-btn ${language === 'english' ? 'lang-btn--active' : ''}`}
              onClick={() => setLanguage('english')}
            >
              EN
            </button>
            <button
              className={`lang-btn ${language === 'hindi' ? 'lang-btn--active' : ''}`}
              onClick={() => setLanguage('hindi')}
            >
              हि
            </button>
          </div>
        </div>

        {/* ─── Auth Guard ────────────────────────── */}
        {!user && (
          <motion.div
            className="chat-auth-guard glass"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '2.5rem', color: 'var(--accent)' }}>lock</span>
            <h3>Please log in to continue</h3>
            <p>Sign in or create an account to use the AI assistant and get a personalised reskilling plan.</p>
          </motion.div>
        )}

        {/* ─── Chat Tab ─────────────────────────── */}
        {user && activeTab === 'chat' && (
          <motion.div
            className="chat-container glass"
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* Messages */}
            <div className="chat-messages" ref={messagesRef}>
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  className={`chat-bubble chat-bubble--${m.role}`}
                  initial={{ opacity: 0, y: 15, scale: 0.95, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                  transition={{ duration: 0.35, type: 'spring', stiffness: 300, damping: 25 }}
                >
                  {m.role === 'assistant' && <span className="chat-avatar"><span className="material-symbols-outlined">smart_toy</span></span>}
                  <div className="chat-bubble__text">{formatMessage(m.text)}</div>
                </motion.div>
              ))}
              {loading && (
                <div className="chat-bubble chat-bubble--assistant">
                  <span className="chat-avatar"><span className="material-symbols-outlined">smart_toy</span></span>
                  <div className="chat-typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}
            </div>

            {/* Suggestions */}
            {messages.length <= 2 && (
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <motion.button
                    key={i}
                    className="chat-suggestion"
                    onClick={() => send(s)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + i * 0.08, type: 'spring', stiffness: 300 }}
                    whileHover={{ scale: 1.06, y: -2, boxShadow: '0 4px 20px rgba(255,61,90,0.15)' }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            )}

            {/* Input */}
            <form className="chat-input-bar" onSubmit={handleSubmit}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                disabled={loading}
              />
              <motion.button
                type="submit"
                className="btn btn--primary"
                disabled={loading || !input.trim()}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.92 }}
              >
                Send
              </motion.button>
            </form>
          </motion.div>
        )}

        {/* ─── Reskill Plan Tab ──────────────────── */}
        {user && activeTab === 'plan' && (
          <motion.div
            className="plan-container glass"
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* User Profile Summary */}
            <div className="plan-profile">
              <h3>Your Profile</h3>
              <div className="plan-profile__grid">
                <div className="plan-profile__item">
                  <span className="material-symbols-outlined">work</span>
                  <div>
                    <span className="plan-profile__label">Job Title</span>
                    <span className="plan-profile__value">{user.job_title || 'Not set'}</span>
                  </div>
                </div>
                <div className="plan-profile__item">
                  <span className="material-symbols-outlined">location_on</span>
                  <div>
                    <span className="plan-profile__label">City</span>
                    <span className="plan-profile__value">{user.city || 'Not set'}</span>
                  </div>
                </div>
                <div className="plan-profile__item">
                  <span className="material-symbols-outlined">hourglass_top</span>
                  <div>
                    <span className="plan-profile__label">Experience</span>
                    <span className="plan-profile__value">{user.years_of_experience || 0} years</span>
                  </div>
                </div>
                <div className="plan-profile__item">
                  <span className="material-symbols-outlined">psychology</span>
                  <div>
                    <span className="plan-profile__label">Skills</span>
                    <span className="plan-profile__value">
                      {user.selected_skills?.length > 0
                        ? user.selected_skills.slice(0, 5).join(', ') + (user.selected_skills.length > 5 ? ` +${user.selected_skills.length - 5} more` : '')
                        : 'Not set'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Preferences Input */}
            <div className="plan-preferences">
              <label className="plan-preferences__label">
                <span className="material-symbols-outlined">tune</span>
                Preferences (optional)
              </label>
              <textarea
                className="plan-preferences__input"
                rows={3}
                placeholder="e.g. I want to transition to data science, prefer courses under 3 months, interested in AI/ML..."
                value={preferences}
                onChange={(e) => setPreferences(e.target.value)}
              />
              <motion.button
                className="btn btn--primary plan-generate-btn"
                onClick={handleGeneratePlan}
                disabled={planLoading}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
              >
                {planLoading ? (
                  <>
                    <span className="plan-spinner" />
                    Generating Plan...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined">auto_awesome</span>
                    Generate Reskill Plan
                  </>
                )}
              </motion.button>
            </div>

            {/* Error */}
            {planError && (
              <div className="plan-error">
                <span className="material-symbols-outlined">error</span>
                {planError}
              </div>
            )}

            {/* Plan Results */}
            <AnimatePresence>
              {planData && (
                <motion.div
                  className="plan-results"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.5 }}
                >
                  {/* Risk Analysis */}
                  {planData.risk_analysis && Object.keys(planData.risk_analysis).length > 0 && (
                    <div className="plan-risk">
                      <h4><span className="material-symbols-outlined">warning</span> Risk Analysis</h4>
                      <div className="plan-risk__items">
                        {Object.entries(planData.risk_analysis).map(([key, value]) => (
                          <div key={key} className="plan-risk__item">
                            <span className="plan-risk__key">{key.replace(/_/g, ' ')}</span>
                            <span className="plan-risk__value">{typeof value === 'number' ? value.toFixed(1) : String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Plan Content */}
                  <div className="plan-content">
                    <h4><span className="material-symbols-outlined">route</span> Your Personalised Plan</h4>
                    <div className="plan-content__text">{formatMessage(planData.plan)}</div>
                  </div>

                  {/* Recommended Courses */}
                  {planData.recommended_courses && planData.recommended_courses.length > 0 && (
                    <div className="plan-courses">
                      <h4><span className="material-symbols-outlined">menu_book</span> Recommended Courses</h4>
                      <div className="plan-courses__list">
                        {planData.recommended_courses.map((course, i) => (
                          <div key={i} className="plan-course-card">
                            <div className="plan-course-card__title">{course.title}</div>
                            {course.platform && <span className="plan-course-card__platform">{course.platform}</span>}
                            {course.institute && <span className="plan-course-card__institute">{course.institute}</span>}
                            {course.link && (
                              <a
                                href={course.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="plan-course-card__link"
                              >
                                View Course <span className="material-symbols-outlined">open_in_new</span>
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}
