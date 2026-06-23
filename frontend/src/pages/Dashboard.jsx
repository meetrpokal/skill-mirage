import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, useScroll, useInView } from 'framer-motion';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Stars } from '@react-three/drei';
import * as THREE from 'three';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Brush,
} from 'recharts';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  getHiringTrends, getHiringSummary, getCities, getRoles, getSectors,
  getJobsByState, getJobHierarchy,
  getTrendingSkills, getSkillGaps,
  getVulnerabilityScores, getVulnerabilityHeatmap, getMethodology,
  getWatchlistAlerts,
  getAggregates,
} from '../api';
import socket from '../socket';
import IndiaHeatmap from '../components/IndiaHeatmap';
import JobSunburst from '../components/JobSunburst';
import SkillsKDE from '../components/SkillsKDE';
import CityRiskTreemap from '../components/CityRiskTreemap';
import SkillGapRadial from '../components/SkillGapRadial';
import './Dashboard.css';

gsap.registerPlugin(ScrollTrigger);

const TABS = [
  { id: 'hiring', label: 'Hiring Trends', icon: <span className="material-symbols-outlined">trending_up</span> },
  { id: 'skills', label: 'Skills Intelligence', icon: <span className="material-symbols-outlined">psychology</span> },
  { id: 'vulnerability', label: 'AI Vulnerability Index', icon: <span className="material-symbols-outlined">bolt</span> },
];

const POLL_INTERVAL = 30_000;
const TIME_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1yr', days: 365 },
];

const ACCENT_COLORS = ['#ff3d5a', '#a855f7', '#06b6d4', '#22c55e', '#eab308', '#3b82f6', '#f97316'];

const PAGE_SIZE = 20;

function riskColor(score) {
  if (score >= 80) return 'var(--red)';
  if (score >= 60) return 'var(--orange)';
  if (score >= 40) return 'var(--yellow)';
  return 'var(--green)';
}

function riskLabel(score) {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MODERATE';
  return 'LOW';
}

/* ---------- Three.js floating particles for dashboard bg ---------- */
function DashParticles({ count = 200, mouse }) {
  const mesh = useRef();
  const positions = useMemo(() => {
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 20;
      p[i * 3 + 1] = (Math.random() - 0.5) * 20;
      p[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    return p;
  }, [count]);
  useFrame((state) => {
    if (!mesh.current) return;
    mesh.current.rotation.y = state.clock.elapsedTime * 0.02 + (mouse.current?.[0] || 0) * 0.1;
    mesh.current.rotation.x = state.clock.elapsedTime * 0.01 + (mouse.current?.[1] || 0) * 0.05;
  });
  return (
    <points ref={mesh}>
      <bufferGeometry><bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} /></bufferGeometry>
      <pointsMaterial size={0.03} color="#ff3d5a" transparent opacity={0.5} sizeAttenuation blending={THREE.AdditiveBlending} />
    </points>
  );
}

function FloatingRing({ radius = 3, speed = 0.15, color = '#a855f7' }) {
  const ref = useRef();
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.x = state.clock.elapsedTime * speed;
    ref.current.rotation.z = state.clock.elapsedTime * speed * 0.6;
  });
  return (
    <mesh ref={ref}>
      <torusGeometry args={[radius, 0.005, 32, 128]} />
      <meshBasicMaterial color={color} transparent opacity={0.2} />
    </mesh>
  );
}

/* ---------- 3D tilt wrapper for dashboard cards ---------- */
function TiltBox({ children, className, style }) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [6, -6]), { stiffness: 300, damping: 30 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-6, 6]), { stiffness: 300, damping: 30 });
  const handleMouse = useCallback((e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  }, [x, y]);
  const handleLeave = useCallback(() => { x.set(0); y.set(0); }, [x, y]);
  return (
    <motion.div ref={ref} className={className} style={{ ...style, rotateX, rotateY, transformPerspective: 800, transformStyle: 'preserve-3d' }} onMouseMove={handleMouse} onMouseLeave={handleLeave}>
      {children}
    </motion.div>
  );
}

/* ---------- Animated counter ---------- */
function CountUp({ end, suffix = '' }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    let v = 0;
    const step = end / 90;
    const t = setInterval(() => { v += step; if (v >= end) { setCount(end); clearInterval(t); } else setCount(Math.floor(v)); }, 1000 / 60);
    return () => clearInterval(t);
  }, [inView, end]);
  return <span ref={ref}>{count}{suffix}</span>;
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('hiring');
  const headerRef = useRef(null);
  const mouse = useRef([0, 0]);
  const { scrollYProgress } = useScroll();
  const bgY = useTransform(scrollYProgress, [0, 1], [0, -120]);

  useEffect(() => {
    const h = (e) => { mouse.current = [(e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1]; };
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);

  /* One-time entrance animations (header + tabs already animated by Framer Motion) */
  useEffect(() => {
    const ctx = gsap.context(() => {
      /* Scroll-triggered animations for chart boxes */
      gsap.utils.toArray('.chart-box').forEach((box) => {
        gsap.fromTo(box,
          { y: 40, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out',
            scrollTrigger: { trigger: box, start: 'top 85%' } });
      });

      /* Stat cards stagger */
      gsap.utils.toArray('.stat-card').forEach((card, i) => {
        gsap.fromTo(card,
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.4, delay: i * 0.06, ease: 'back.out(1.7)',
            scrollTrigger: { trigger: card, start: 'top 90%' } });
      });
    }, headerRef);
    return () => ctx.revert();
  }, [activeTab]);

  return (
    <div className="dashboard" ref={headerRef}>
      {/* 3D Particle background */}
      <motion.div className="dashboard__canvas-bg" style={{ y: bgY }}>
        <Canvas camera={{ position: [0, 0, 8], fov: 45 }} dpr={[1, 1.5]}>
          <fog attach="fog" args={['#0a0a0f', 5, 18]} />
          <DashParticles mouse={mouse} />
          <FloatingRing radius={4} speed={0.1} color="#ff3d5a" />
          <FloatingRing radius={5.5} speed={-0.07} color="#a855f7" />
          <Stars radius={40} depth={60} count={600} factor={3} fade speed={0.3} />
        </Canvas>
      </motion.div>

      <div className="dashboard__bg-grid" />

      <header className="dashboard__header section-container">
        <motion.h1
          initial={{ opacity: 0, y: 60, filter: 'blur(15px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          Job Market <span className="gradient-text">Intelligence</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          Layer 1 — Real-time macro analytics across India's labor market
        </motion.p>
        <LiveBadge />
      </header>

      <div className="dashboard__tabs section-container">
        {TABS.map((t, i) => (
          <motion.button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            whileTap={{ scale: 0.96 }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.12, type: 'spring', stiffness: 300, damping: 20 }}
          >
            <span className="tab-btn__icon">{t.icon}</span>
            {t.label}
            {activeTab === t.id && <motion.div className="tab-btn__indicator" layoutId="tabIndicator" />}
          </motion.button>
        ))}
      </div>

      <div className="dashboard__content section-container">
        <AnimatePresence mode="wait">
          {activeTab === 'hiring' && <HiringTab key="hiring" />}
          {activeTab === 'skills' && <SkillsTab key="skills" />}
          {activeTab === 'vulnerability' && <VulnerabilityTab key="vulnerability" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ============ TAB A: Hiring Trends ============ */
function HiringTab() {
  const [trends, setTrends] = useState([]);
  const [summary, setSummary] = useState(null);
  const [cities, setCities] = useState([]);
  const [roles, setRoles] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [filters, setFilters] = useState({ city: '', role: '', sector: '', range: '30' });
  const [loading, setLoading] = useState(true);
  const [brushRange, setBrushRange] = useState(null);
  const [mapData, setMapData] = useState([]);
  const [hierarchy, setHierarchy] = useState(null);
  const isFirstLoad = useRef(true);

  const load = useCallback(async () => {
    if (isFirstLoad.current) setLoading(true);
    try {
      const [trRes, smRes, ciRes, roRes, seRes, stRes, hiRes] = await Promise.all([
        getHiringTrends(filters),
        getHiringSummary(filters),
        getCities(),
        getRoles(),
        getSectors(),
        getJobsByState({ range: filters.range, sector: filters.sector, role: filters.role }),
        getJobHierarchy({ range: filters.range, city: filters.city }),
      ]);
      setTrends(prev => {
        const next = trRes.data;
        if (prev.length === next.length && prev.every((p, i) => p.date === next[i].date && p.count === next[i].count)) return prev;
        return next;
      });
      setSummary(prev => {
        const next = smRes.data;
        if (prev && prev.current === next.current && prev.previous === next.previous) return prev;
        return next;
      });
      setCities(ciRes.data);
      setRoles(roRes.data);
      setSectors(seRes.data);
      setMapData(stRes.data);
      setHierarchy(hiRes.data);
      window.dispatchEvent(new Event('dashboard:data-loaded'));
    } catch {
      /* fallback empty */
    }
    if (isFirstLoad.current) { setLoading(false); isFirstLoad.current = false; }
  }, [filters]);

  // Reset brush when filters change
  useEffect(() => { setBrushRange(null); isFirstLoad.current = true; }, [filters]);

  useEffect(() => { load(); }, [load]);

  /* Live updates: poll every 30s + re-fetch on socket event */
  useEffect(() => {
    const interval = setInterval(load, POLL_INTERVAL);
    const onRefresh = () => load();
    socket.on('dashboard:refresh', onRefresh);
    return () => { clearInterval(interval); socket.off('dashboard:refresh', onRefresh); };
  }, [load]);

  const chartData = useMemo(() => trends.map((t) => ({
    date: t.date ? new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : `W${t.week}/${t.year}`,
    count: t.count,
    avgSalary: Math.round(t.avgSalaryMin || t.avgSalary || 0),
  })), [trends]);

  return (
    <TabWrapper>
      {/* Filters */}
      <div className="filters">
        <select value={filters.city} onChange={(e) => setFilters((p) => ({ ...p, city: e.target.value }))}>
          <option value="">All Cities</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.role} onChange={(e) => setFilters((p) => ({ ...p, role: e.target.value }))}>
          <option value="">All Job Categories</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.sector} onChange={(e) => setFilters((p) => ({ ...p, sector: e.target.value }))}>
          <option value="">All Sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="time-range">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.days}
              className={`time-range__btn${filters.range === String(tr.days) ? ' active' : ''}`}
              onClick={() => setFilters((p) => ({ ...p, range: String(tr.days) }))}
            >
              {tr.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="stat-grid">
          <StatCard label="Total Postings" value={summary.current?.toLocaleString() || '—'} />
          <StatCard label="Avg / Day" value={trends.length > 0 ? Math.round(trends.reduce((s, t) => s + t.count, 0) / trends.length).toLocaleString() : '—'} />
          <StatCard
            label="Trend"
            value={(() => {
              if (trends.length < 2) return 'Insufficient data';
              const n = trends.length;
              const sumX = n * (n - 1) / 2;
              const sumX2 = n * (n - 1) * (2 * n - 1) / 6;
              const sumY = trends.reduce((s, t) => s + t.count, 0);
              const sumXY = trends.reduce((s, t, i) => s + i * t.count, 0);
              const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
              const mean = sumY / n;
              // Daily slope as % of mean, clamped to ±30 %
              const raw = mean > 0 ? (slope / mean) * 100 : 0;
              const pct = Math.round(Math.max(-30, Math.min(30, raw)));
              const dir = pct >= 0 ? 'up' : 'down';
              return `${pct > 0 ? '+' : ''}${pct}% ${dir}`;
            })()}
            accent
          />
          <StatCard label="Cities Tracked" value={cities.length} />
        </div>
      )}

      {/* Line chart */}
      <div className="chart-box glass">
        <h3>Posting Volume Over Time</h3>
        {loading ? <LoadingSkeleton /> : (
          <ResponsiveContainer width="100%" height={380}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff3d5a" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#ff3d5a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#222235" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#8888a0', fontSize: 11 }} />
              <YAxis tick={{ fill: '#8888a0', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#16161f', border: '1px solid #222235', borderRadius: 12, color: '#f0f0f5' }} />
              <Area type="monotone" dataKey="count" stroke="#ff3d5a" fill="url(#areaGrad)" strokeWidth={2} isAnimationActive={false} />
              <Brush
                dataKey="date" height={28} stroke="#ff3d5a" fill="#16161f" travellerWidth={10}
                startIndex={brushRange?.startIndex}
                endIndex={brushRange?.endIndex}
                onChange={(range) => setBrushRange(range)}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* D3 Visualizations */}
      <div className="d3-split">
        <div className="chart-box glass">
          <h3><span className="material-symbols-outlined" style={{ verticalAlign: '-0.15em', marginRight: 8 }}>map</span> Job Density by State</h3>
          {loading ? <LoadingSkeleton /> : <IndiaHeatmap data={mapData} />}
        </div>
        <div className="chart-box glass">
          <h3>🌀 Sector &amp; Role Breakdown</h3>
          {loading ? <LoadingSkeleton /> : <JobSunburst data={hierarchy} />}
        </div>
      </div>
    </TabWrapper>
  );
}

/* ============ TAB B: Skills Intelligence ============ */
function SkillsTab() {
  const [trending, setTrending] = useState([]);
  const [cooccurrence, setCooccurrence] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [gapPage, setGapPage] = useState(1);
  const [gapHasMore, setGapHasMore] = useState(false);
  const [gapLoading, setGapLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const isFirstLoad = useRef(true);
  const gapSentinelRef = useRef(null);
  const hoveringRef = useRef(false);
  const pendingRef = useRef(null); // { trending, cooccurrence } buffered while hovering
  const risingBoxRef = useRef(null);

  const loadGapsPage = useCallback(async (page) => {
    setGapLoading(true);
    try {
      const res = await getSkillGaps({ page, limit: PAGE_SIZE });
      const data = res.data;
      const rawRows = (data.rows || []).map(s => ({ skill: s.skill, gap: Math.abs(s.week_over_week_change || 0), mentions: s.mention_count || 0 }));

      // Aggregate duplicates (same skill across cities) — keep max gap, sum mentions
      const merge = (existing, incoming) => {
        const map = new Map();
        for (const r of existing) map.set(r.skill, { ...r });
        for (const r of incoming) {
          const prev = map.get(r.skill);
          if (prev) {
            prev.gap = Math.max(prev.gap, r.gap);
            prev.mentions += r.mentions;
          } else {
            map.set(r.skill, { ...r });
          }
        }
        return [...map.values()].sort((a, b) => b.gap - a.gap);
      };

      if (page === 1) {
        setGaps(merge([], rawRows));
      } else {
        setGaps(prev => merge(prev, rawRows));
      }
      setGapPage(data.page);
      setGapHasMore(data.hasMore);
    } catch { /* */ }
    setGapLoading(false);
  }, []);

  const load = useCallback(async () => {
    if (isFirstLoad.current) setLoading(true);
    try {
      const [tr, aggRes] = await Promise.all([
        getTrendingSkills({ limit: 15 }),
        getAggregates(),
      ]);
      // Defer gap refresh while hovering to avoid layout shifts
      if (!hoveringRef.current || isFirstLoad.current) {
        await loadGapsPage(1);
      }

      // Use real scraped skills from aggregates as primary source
      const scrapedSkills = (aggRes.data?.top_skills || []).map(s => ({
        skill: s.name, mentions: parseInt(s.count, 10) || 0,
      }));

      // Skill co-occurrence pairs (skills appearing in the same job posting)
      const newCooccurrence = aggRes.data?.skill_cooccurrence || [];

      const rising = (tr.data?.rising || tr.data || []).map(s => ({ skill: s.skill, mentions: s.mention_count || s.mentions || 0, wow: s.week_over_week_change }));

      // Merge: scraped skills take priority, append trending skills not already present
      const merged = [...scrapedSkills];
      const existingNames = new Set(merged.map(s => s.skill.toLowerCase()));
      for (const r of rising) {
        if (!existingNames.has(r.skill.toLowerCase())) {
          merged.push(r);
          existingNames.add(r.skill.toLowerCase());
        }
      }
      merged.sort((a, b) => b.mentions - a.mentions);

      // If user is hovering the Rising Skills chart, buffer the update
      if (hoveringRef.current && !isFirstLoad.current) {
        pendingRef.current = { trending: merged, cooccurrence: newCooccurrence, refreshGaps: true };
      } else {
        pendingRef.current = null;
        setCooccurrence(prev => {
          if (prev.length === newCooccurrence.length && prev.every((c, i) => c.source === newCooccurrence[i].source && c.target === newCooccurrence[i].target && c.weight === newCooccurrence[i].weight)) return prev;
          return newCooccurrence;
        });
        setTrending(prev => {
          if (prev.length === merged.length && prev.every((p, i) => p.skill === merged[i].skill && p.mentions === merged[i].mentions)) return prev;
          return merged;
        });
      }
      window.dispatchEvent(new Event('dashboard:data-loaded'));
    } catch { /* */ }
    if (isFirstLoad.current) { setLoading(false); isFirstLoad.current = false; }
  }, [loadGapsPage]);

  useEffect(() => { load(); }, [load]);

  /* Live updates */
  useEffect(() => {
    const interval = setInterval(load, POLL_INTERVAL);
    const onRefresh = () => load();
    socket.on('dashboard:refresh', onRefresh);
    return () => { clearInterval(interval); socket.off('dashboard:refresh', onRefresh); };
  }, [load]);

  /* Infinite scroll for gap list */
  useEffect(() => {
    const el = gapSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && gapHasMore && !gapLoading) {
        loadGapsPage(gapPage + 1);
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [gapHasMore, gapLoading, gapPage, loadGapsPage]);

  const flushPending = useCallback(() => {
    hoveringRef.current = false;
    if (pendingRef.current) {
      const { trending: t, cooccurrence: co, refreshGaps } = pendingRef.current;
      pendingRef.current = null;
      setCooccurrence(co);
      setTrending(t);
      if (refreshGaps) loadGapsPage(1);
    }
  }, [loadGapsPage]);

  return (
    <TabWrapper>
      <div className="skills-split">
        {/* Rising Skills – KDE Ridge Plot from scraped data */}
        <div
          className="chart-box glass kde-chart-box"
          ref={risingBoxRef}
          onMouseEnter={() => { hoveringRef.current = true; }}
          onMouseLeave={flushPending}
        >
          <h3><span className="material-symbols-outlined" style={{ color: 'var(--green)', fontSize: '1.1em', verticalAlign: '-0.15em', marginRight: 8 }}>trending_up</span> Rising Skills <span className="kde-badge">LIVE</span></h3>
          {loading ? <LoadingSkeleton /> : <SkillsKDE data={trending} cooccurrence={cooccurrence} height={560} />}
        </div>

        {/* Gaps / declining */}
        <div className="chart-box glass">
          <h3><span className="material-symbols-outlined" style={{ color: 'var(--red)', fontSize: '1.1em', verticalAlign: '-0.15em', marginRight: 8 }}>trending_down</span> Skill Gap Map</h3>
          {loading ? <LoadingSkeleton /> : gaps.length === 0 ? (
            <p className="empty-state">No gap data available yet.</p>
          ) : (
            <SkillGapRadial data={gaps} height={520} />
          )}
        </div>
      </div>
    </TabWrapper>
  );
}

/* ============ TAB C: AI Vulnerability Index ============ */
function VulnerabilityTab() {
  const [scores, setScores] = useState([]);
  const [scorePage, setScorePage] = useState(1);
  const [scoreHasMore, setScoreHasMore] = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [heatmap, setHeatmap] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [methodology, setMethodology] = useState(null);
  const [loading, setLoading] = useState(true);
  const [jobAge, setJobAge] = useState(30);
  const isFirstLoad = useRef(true);
  const sentinelRef = useRef(null);

  const VULN_TIME_RANGES = [
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: '1yr', days: 365 },
  ];

  const handleJobAgeChange = useCallback((days) => {
    setJobAge(days);
    socket.emit('scraper:config', { jobAge: days });
  }, []);

  // Listen for real-time ML vulnerability updates (debounced batch)
  useEffect(() => {
    let pending = [];
    let timer = null;

    const flush = () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];

      setScores(prev => {
        const next = [...prev];
        batch.forEach(data => {
          const idx = next.findIndex(
            s => (s.canonical_role || s.role) === data.canonical_role && s.city === data.city
          );
          if (idx >= 0) {
            next[idx] = { ...next[idx], score: data.score, risk_band: data.risk_band, scoring_mode: data.scoring_mode };
          } else {
            next.push({
              canonical_role: data.canonical_role,
              city: data.city,
              score: data.score,
              risk_band: data.risk_band,
              scoring_mode: data.scoring_mode,
            });
          }
        });
        // Keep sorted by score DESC so high-risk entries stay on top
        next.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return next;
      });
    };

    const handler = (data) => {
      pending.push(data);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 300); // debounce 300ms
    };

    socket.on('vulnerability:update', handler);
    return () => {
      socket.off('vulnerability:update', handler);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const loadScoresPage = useCallback(async (page) => {
    setScoreLoading(true);
    try {
      const res = await getVulnerabilityScores({ page, limit: PAGE_SIZE });
      const data = res.data;
      if (page === 1) {
        const sorted = [...data.rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        setScores(sorted);
      } else {
        setScores(prev => {
          const next = [...prev, ...data.rows];
          next.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          return next;
        });
      }
      setScorePage(data.page);
      setScoreHasMore(data.hasMore);
    } catch { /* */ }
    setScoreLoading(false);
  }, []);

  const load = useCallback(async () => {
    if (isFirstLoad.current) setLoading(true);
    try {
      const [hm, wl, mt] = await Promise.all([
        getVulnerabilityHeatmap(),
        getWatchlistAlerts(),
        getMethodology(),
      ]);
      await loadScoresPage(1);
      setHeatmap(prev => {
        const next = hm.data;
        if (prev.length === next.length && prev.every((p, i) => p.city === next[i].city && p.score === next[i].score)) return prev;
        return next;
      });
      setWatchlist(prev => {
        const next = wl.data;
        if (prev.length === next.length && prev.every((p, i) => p.city === next[i].city && (p.canonical_role || p.role) === (next[i].canonical_role || next[i].role))) return prev;
        return next;
      });
      setMethodology(mt.data);
      window.dispatchEvent(new Event('dashboard:data-loaded'));
    } catch { /* */ }
    if (isFirstLoad.current) { setLoading(false); isFirstLoad.current = false; }
  }, [loadScoresPage]);

  useEffect(() => { load(); }, [load]);

  /* Live updates — debounce dashboard:refresh to avoid re-fetch storms */
  useEffect(() => {
    const interval = setInterval(load, POLL_INTERVAL);
    let refreshTimer = null;
    const onRefresh = (ev) => {
      // Skip full re-fetch for ML scoring — socket handler covers those in real-time
      if (ev?.source === 'ml_scoring') return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(load, 2000);
    };
    socket.on('dashboard:refresh', onRefresh);
    return () => { clearInterval(interval); clearTimeout(refreshTimer); socket.off('dashboard:refresh', onRefresh); };
  }, [load]);

  /* Infinite scroll for scores table */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && scoreHasMore && !scoreLoading) {
        loadScoresPage(scorePage + 1);
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [scoreHasMore, scoreLoading, scorePage, loadScoresPage]);

  return (
    <TabWrapper>
      {/* Time range filter for live scraping */}
      <div className="filters">
        <div className="time-range">
          {VULN_TIME_RANGES.map((tr) => (
            <button
              key={tr.days}
              className={`time-range__btn${jobAge === tr.days ? ' active' : ''}`}
              onClick={() => handleJobAgeChange(tr.days)}
            >
              {tr.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scores table */}
      <div className="chart-box glass">
        <h3>Top Vulnerable Roles</h3>
        {loading ? <LoadingSkeleton /> : (
          <div className="vuln-table vuln-table--scroll">
            <div className="vuln-row vuln-row--header">
              <span>Role</span><span>City</span><span>Score</span><span>Risk Band</span><span>Source</span>
            </div>
            {scores.map((s) => {
              const displayScore = s.score;
              const displayBand = s.risk_band || s.riskBand || riskLabel(s.score);
              const isML = s.scoring_mode === 'model';
              const rowKey = `${s.canonical_role || s.role}-${s.city}`;
              return (
              <div key={rowKey} className="vuln-row">
                <span>{s.canonical_role || s.role}</span>
                <span>{s.city}</span>
                <span style={{ color: riskColor(displayScore), fontWeight: 700 }}>{displayScore}</span>
                <span className="vuln-badge" style={{ background: riskColor(displayScore) + '22', color: riskColor(displayScore) }}>
                  {displayBand}
                </span>
                <span className="vuln-badge" style={{ background: isML ? '#22c55e22' : '#8888a022', color: isML ? '#22c55e' : '#8888a0', fontSize: '0.7em' }}>
                  {isML ? 'ML' : 'Formula'}
                </span>
              </div>
              );
            })}
            {scoreLoading && <div className="loading-more">Loading more…</div>}
            {scoreHasMore && <div ref={sentinelRef} className="scroll-sentinel" />}
          </div>
        )}
      </div>

      {/* City Risk Treemap — full width */}
      <div className="chart-box glass chart-box--treemap">
        <h3><span className="material-symbols-outlined" style={{ color: 'var(--cyan)', fontSize: '1.1em', verticalAlign: '-0.15em', marginRight: 8 }}>grid_view</span> City Risk Treemap</h3>
        {loading ? <LoadingSkeleton /> : <CityRiskTreemap data={heatmap} height={560} />}
      </div>

      <div className="vuln-split" style={{ gridTemplateColumns: '1fr' }}>
        {/* Watchlist */}
        <div className="chart-box glass">
          <h3><span className="material-symbols-outlined" style={{ color: 'var(--orange)', fontSize: '1.1em', verticalAlign: '-0.15em', marginRight: 8 }}>warning</span> Early Warning Watchlist</h3>
          {watchlist.length === 0 ? (
            <p className="empty-state">No active alerts.</p>
          ) : (
            <div className="watchlist">
              {watchlist.map((w, i) => (
                <div key={i} className="watchlist__item">
                  <div className="watchlist__header">
                    <span className="watchlist__role">{w.canonical_role || w.role} — {w.city}</span>
                    <span className="vuln-badge" style={{ background: w.severity === 'critical' ? 'var(--red)22' : 'var(--orange)22', color: w.severity === 'critical' ? 'var(--red)' : 'var(--orange)' }}>
                      {w.severity}
                    </span>
                  </div>
                  <p className="watchlist__msg">{w.consecutive_decline_months} months of decline · {w.affected_workers?.toLocaleString()} workers affected</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Methodology */}
      {/* {methodology && (
        <div className="chart-box glass methodology">
          <h3>Methodology</h3>
          <p>{methodology.formula || 'Score = (Decline × 0.40) + (AI Mention Rate × 0.35) + (Displacement Ratio × 0.25)'}</p>
          {methodology.sources && (
            <div className="methodology__sources">
              <h4>Data Sources</h4>
              <ul>{methodology.sources.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )} */}
    </TabWrapper>
  );
}

/* ============ Shared sub-components ============ */
function TabWrapper({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -30, filter: 'blur(8px)' }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="tab-panel"
    >
      {children}
    </motion.div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="stat-card glass">
      <p className="stat-card__label">{label}</p>
      <p className={`stat-card__value ${accent ? 'gradient-text' : ''}`}>{value}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return <div className="skeleton" style={{ height: 300 }} />;
}

function LiveBadge() {
  const [ago, setAgo] = useState(0);
  const refreshedAt = useRef(Date.now());

  useEffect(() => {
    const onRefresh = () => { refreshedAt.current = Date.now(); setAgo(0); };
    socket.on('dashboard:refresh', onRefresh);
    window.addEventListener('dashboard:data-loaded', onRefresh);
    const tick = setInterval(() => setAgo(Math.floor((Date.now() - refreshedAt.current) / 1000)), 1000);
    return () => { socket.off('dashboard:refresh', onRefresh); window.removeEventListener('dashboard:data-loaded', onRefresh); clearInterval(tick); };
  }, []);

  const label = ago < 5 ? 'just now' : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`;
  return (
    <div className="live-badge">
      <span className="live-badge__dot" />
      <span className="live-badge__text">LIVE — updated {label}</span>
    </div>
  );
}
