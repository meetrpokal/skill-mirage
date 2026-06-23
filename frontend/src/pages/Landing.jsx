import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Float, MeshDistortMaterial, Trail, Stars } from '@react-three/drei';
import { motion, useScroll, useTransform, useMotionValue, useSpring, useInView } from 'framer-motion';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './Landing.css';

gsap.registerPlugin(ScrollTrigger);

/* ---------- Mouse-reactive particles ---------- */
function Particles({ count = 600, mouse }) {
  const mesh = useRef();
  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 16;
      vel[i * 3] = (Math.random() - 0.5) * 0.002;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.002;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.002;
    }
    return { positions: pos, velocities: vel };
  }, [count]);

  const sizes = useMemo(() => {
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) s[i] = Math.random() * 0.03 + 0.01;
    return s;
  }, [count]);

  useFrame((state, delta) => {
    if (!mesh.current) return;
    const geo = mesh.current.geometry;
    const posArr = geo.attributes.position.array;
    const mx = mouse.current[0] * 3;
    const my = mouse.current[1] * 3;
    for (let i = 0; i < count; i++) {
      posArr[i * 3] += velocities[i * 3] + (mx - posArr[i * 3]) * 0.00008;
      posArr[i * 3 + 1] += velocities[i * 3 + 1] + (my - posArr[i * 3 + 1]) * 0.00008;
      posArr[i * 3 + 2] += velocities[i * 3 + 2];
      if (Math.abs(posArr[i * 3]) > 8) velocities[i * 3] *= -1;
      if (Math.abs(posArr[i * 3 + 1]) > 8) velocities[i * 3 + 1] *= -1;
      if (Math.abs(posArr[i * 3 + 2]) > 8) velocities[i * 3 + 2] *= -1;
    }
    geo.attributes.position.needsUpdate = true;
    mesh.current.rotation.y += delta * 0.015;
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.025} color="#ff3d5a" transparent opacity={0.7} sizeAttenuation blending={THREE.AdditiveBlending} />
    </points>
  );
}

/* ---------- Orbiting ring ---------- */
function OrbitRing({ radius = 2.6, speed = 0.3, color = '#ff3d5a', thickness = 0.008 }) {
  const ref = useRef();
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x = state.clock.elapsedTime * speed;
      ref.current.rotation.z = state.clock.elapsedTime * speed * 0.7;
    }
  });
  return (
    <mesh ref={ref}>
      <torusGeometry args={[radius, thickness, 64, 200]} />
      <meshBasicMaterial color={color} transparent opacity={0.35} />
    </mesh>
  );
}

/* ---------- Interactive central sphere that reacts to mouse ---------- */
function HeroSphere({ mouse }) {
  const ref = useRef();
  const matRef = useRef();
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.x = t * 0.12 + mouse.current[1] * 0.3;
    ref.current.rotation.y = t * 0.08 + mouse.current[0] * 0.3;
    ref.current.rotation.z = t * 0.06;
    ref.current.scale.setScalar(1.6 + Math.sin(t * 0.5) * 0.08);
    if (matRef.current) {
      matRef.current.distort = 0.25 + mouse.current[0] * 0.15;
      matRef.current.emissiveIntensity = 0.15 + Math.sin(t * 2) * 0.08;
    }
  });
  return (
    <Float speed={1.5} rotationIntensity={0.2} floatIntensity={1}>
      <Trail width={3} length={6} color="#ff3d5a" attenuation={(t) => t * t}>
        <mesh ref={ref} scale={1.6}>
          <icosahedronGeometry args={[1, 12]} />
          <MeshDistortMaterial
            ref={matRef}
            color="#ff3d5a"
            emissive="#ff3d5a"
            emissiveIntensity={0.15}
            roughness={0.2}
            metalness={0.9}
            distort={0.25}
            speed={2}
            wireframe
          />
        </mesh>
      </Trail>
    </Float>
  );
}

/* ---------- Floating secondary geometry ---------- */
function FloatingGeo({ position, geometry = 'octahedron', color = '#a855f7', scale = 0.3 }) {
  const ref = useRef();
  const speed = useMemo(() => 0.3 + Math.random() * 0.5, []);
  const axis = useMemo(() => new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(), []);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = position[1] + Math.sin(t * speed) * 0.5;
    ref.current.rotation.x = t * speed;
    ref.current.rotation.y = t * speed * 0.7;
  });
  const Geo = geometry === 'octahedron' ? 'octahedronGeometry' : geometry === 'tetrahedron' ? 'tetrahedronGeometry' : 'dodecahedronGeometry';
  return (
    <mesh ref={ref} position={position} scale={scale}>
      <Geo args={[1, 0]} />
      <meshStandardMaterial color={color} wireframe transparent opacity={0.4} emissive={color} emissiveIntensity={0.2} />
    </mesh>
  );
}

/* ---------- Parallax grid plane ---------- */
function GridFloor() {
  const ref = useRef();
  useFrame((state) => {
    if (ref.current) {
      ref.current.position.z = (state.clock.elapsedTime * 0.3) % 2;
    }
  });
  return (
    <gridHelper ref={ref} args={[40, 60, '#1a1a2e', '#1a1a2e']} position={[0, -3, 0]} rotation={[0, 0, 0]} />
  );
}

/* ---------- CountUp animation ---------- */
function CountUp({ end, suffix = '', duration = 2 }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = end / (duration * 60);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 1000 / 60);
    return () => clearInterval(timer);
  }, [inView, end, duration]);
  return <span ref={ref}>{count}{suffix}</span>;
}

/* ---------- Tilt card on mouse ---------- */
function TiltCard({ children, className }) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [8, -8]), { stiffness: 300, damping: 30 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-8, 8]), { stiffness: 300, damping: 30 });

  const handleMouse = useCallback((e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  }, [x, y]);

  const handleLeave = useCallback(() => { x.set(0); y.set(0); }, [x, y]);

  return (
    <motion.div
      ref={ref}
      className={className}
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      style={{ rotateX, rotateY, transformPerspective: 800, transformStyle: 'preserve-3d' }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- Data ---------- */
const features = [
  { num: '01', title: 'Market Intelligence', desc: 'Macro-economic tracking of industrial AI adoption. Real-time vacancy and layoff data mapping displacement waves before they land.', stat: '20+ CITIES', icon: <span className="material-symbols-outlined">cell_tower</span> },
  { num: '02', title: 'Worker Risk Score', desc: 'Granular vulnerability assessment based on specific job functions, skill rarity, and the proximity of generative AI capabilities.', stat: '1.2M+ PROFILES', icon: <span className="material-symbols-outlined">bolt</span> },
  { num: '03', title: 'Reskilling Path', desc: 'Curated transition pathways linking vulnerable roles to emerging opportunities via NPTEL and SWAYAM certifications.', stat: '500+ COURSES', icon: <span className="material-symbols-outlined">gps_fixed</span> },
];

const tickerItems = [
  { role: 'BPO VOICE, PUNE', score: 87, level: 'CRITICAL' },
  { role: 'DATA ENTRY, HYDERABAD', score: 92, level: 'SEVERE' },
  { role: 'FRONT-END DEV, BLR', score: 45, level: 'MODERATE' },
  { role: 'CUSTOMER SUPPORT, GURGAON', score: 81, level: 'CRITICAL' },
  { role: 'CONTENT WRITER, MUMBAI', score: 78, level: 'SEVERE' },
  { role: 'ACCOUNTANT, JAIPUR', score: 55, level: 'MODERATE' },
  { role: 'HR EXECUTIVE, DELHI', score: 63, level: 'HIGH' },
];

const stats = [
  { value: 40, suffix: 'M+', label: 'Professionals Tracked' },
  { value: 20, suffix: '+', label: 'Metro Cities' },
  { value: 500, suffix: '+', label: 'Courses Mapped' },
  { value: 87, suffix: '/100', label: 'Max Risk Score' },
];

/* ---------- Landing component ---------- */
export default function Landing() {
  const containerRef = useRef(null);
  const mouse = useRef([0, 0]);
  const { scrollYProgress } = useScroll();
  const heroY = useTransform(scrollYProgress, [0, 0.25], [0, -200]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.25], [1, 0.9]);
  const canvasOpacity = useTransform(scrollYProgress, [0, 0.3], [1, 0.3]);

  /* GSAP parallax refs */
  const parallaxRef1 = useRef(null);
  const parallaxRef2 = useRef(null);
  const parallaxRef3 = useRef(null);
  const statsRef = useRef(null);
  const ctaRef = useRef(null);
  const marqueeRef = useRef(null);

  useEffect(() => {
    const handleMouse = (e) => {
      mouse.current = [
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      ];
    };
    window.addEventListener('mousemove', handleMouse);
    return () => window.removeEventListener('mousemove', handleMouse);
  }, []);

  /* GSAP ScrollTrigger animations */
  useEffect(() => {
    const ctx = gsap.context(() => {
      /* Parallax offset for feature cards */
      gsap.utils.toArray('.feature-card').forEach((card, i) => {
        gsap.fromTo(card, { y: 80 + i * 20, opacity: 0, rotateX: 15, scale: 0.92 }, {
          y: 0, opacity: 1, rotateX: 0, scale: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: { trigger: card, start: 'top 85%', end: 'top 40%', scrub: 1 },
        });
      });

      /* Stats counter entrance */
      if (statsRef.current) {
        gsap.fromTo(statsRef.current.children, { y: 60, opacity: 0, scale: 0.8 }, {
          y: 0, opacity: 1, scale: 1,
          stagger: 0.12,
          duration: 0.7,
          ease: 'back.out(1.7)',
          scrollTrigger: { trigger: statsRef.current, start: 'top 80%' },
        });
      }

      /* Displacement card */
      if (parallaxRef2.current) {
        gsap.fromTo(parallaxRef2.current, { y: 100, scale: 0.9, rotateX: 8 }, {
          y: 0, scale: 1, rotateX: 0,
          scrollTrigger: { trigger: parallaxRef2.current, start: 'top 85%', end: 'top 30%', scrub: 1.5 },
        });
      }

      /* CTA parallax */
      if (ctaRef.current) {
        gsap.fromTo(ctaRef.current, { y: 60, opacity: 0 }, {
          y: 0, opacity: 1,
          scrollTrigger: { trigger: ctaRef.current, start: 'top 85%', end: 'top 50%', scrub: 1 },
        });
      }

      /* Displacement marquee */
      gsap.to('.marquee__track', {
        xPercent: -50,
        duration: 20,
        ease: 'none',
        repeat: -1,
      });
    });
    return () => ctx.revert();
  }, []);

  return (
    <div className="landing" ref={containerRef}>
      {/* ---- Hero ---- */}
      <section className="hero">
        <motion.div className="hero__canvas" style={{ opacity: canvasOpacity }}>
          <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 2]}>
            <fog attach="fog" args={['#0a0a0f', 6, 20]} />
            <ambientLight intensity={0.25} />
            <directionalLight position={[5, 5, 5]} intensity={0.6} />
            <pointLight position={[-5, 3, -5]} intensity={0.4} color="#a855f7" />
            <pointLight position={[5, -3, 5]} intensity={0.3} color="#06b6d4" />
            <HeroSphere mouse={mouse} />
            <Particles mouse={mouse} />
            <OrbitRing radius={2.8} speed={0.25} color="#ff3d5a" />
            <OrbitRing radius={3.4} speed={-0.18} color="#a855f7" thickness={0.006} />
            <OrbitRing radius={4} speed={0.12} color="#06b6d4" thickness={0.004} />
            <FloatingGeo position={[-4, 2, -3]} geometry="octahedron" color="#ff3d5a" scale={0.25} />
            <FloatingGeo position={[4, -1.5, -2]} geometry="tetrahedron" color="#a855f7" scale={0.3} />
            <FloatingGeo position={[-3, -2, -4]} geometry="dodecahedron" color="#06b6d4" scale={0.2} />
            <FloatingGeo position={[3.5, 2.5, -3.5]} geometry="octahedron" color="#22c55e" scale={0.18} />
            <Stars radius={50} depth={80} count={1500} factor={4} fade speed={0.5} />
            <GridFloor />
          </Canvas>
        </motion.div>

        <motion.div className="hero__content" style={{ y: heroY, opacity: heroOpacity, scale: heroScale }}>
          <motion.div
            className="hero__badge"
            initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <span className="hero__badge-dot" />
            AI-DRIVEN DISPLACEMENT INTELLIGENCE
          </motion.div>

          <motion.h1
            className="hero__heading"
            initial={{ opacity: 0, y: 60, filter: 'blur(20px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: 0.5, duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            India's Jobs<br />Are Changing.<br />
            <span className="gradient-text">Is Yours?</span>
          </motion.h1>

          <motion.p
            className="hero__sub"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.7 }}
          >
            Real-time risk scoring for 40M+ professionals. Monitoring the tectonic
            shifts in India's labor market.
          </motion.p>

          <motion.div
            className="hero__actions"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.6 }}
          >
            <Link to="/worker" className="btn btn--primary btn--glow">Check Your Risk Score →</Link>
            <Link to="/dashboard" className="btn btn--ghost">View Dashboard</Link>
          </motion.div>

          <motion.div
            className="hero__scroll-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2, duration: 1 }}
          >
            <div className="scroll-mouse"><div className="scroll-wheel" /></div>
            <span>Scroll to explore</span>
          </motion.div>
        </motion.div>

        {/* Ticker */}
        <div className="hero__ticker">
          <div className="ticker__track">
            {[...tickerItems, ...tickerItems, ...tickerItems].map((t, i) => (
              <span key={i} className={`ticker__item ticker__item--${t.level.toLowerCase()}`}>
                ↑ {t.role}: {t.score}/100 {t.level}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Stats Counter ---- */}
      <section className="stats-section section-container">
        <div className="stats-grid" ref={statsRef}>
          {stats.map((s, i) => (
            <div key={i} className="stat-counter glass">
              <span className="stat-counter__value gradient-text">
                <CountUp end={s.value} suffix={s.suffix} />
              </span>
              <span className="stat-counter__label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Displacement Marquee ---- */}
      <div className="marquee" ref={marqueeRef}>
        <div className="marquee__track">
          {Array.from({ length: 10 }).map((_, i) => (
            <span key={i} className="marquee__word">DISPLACEMENT</span>
          ))}
        </div>
      </div>

      {/* ---- Features with 3D tilt ---- */}
      <section className="features section-container" ref={parallaxRef1}>
        <motion.h2
          className="section-heading"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          Intelligence <span className="gradient-text">Layers</span>
        </motion.h2>
        {features.map((f, i) => (
          <TiltCard key={f.num} className="feature-card glass">
            <div className="feature-card__icon">{f.icon}</div>
            <span className="feature-card__num">{f.num}</span>
            <h3 className="feature-card__title">{f.title}</h3>
            <p className="feature-card__desc">{f.desc}</p>
            <span className="feature-card__stat">{f.stat}</span>
            <div className="feature-card__glow" />
          </TiltCard>
        ))}
      </section>

      {/* ---- Displacement Banner ---- */}
      <section className="displacement section-container">
        <div className="displacement__card glass glow-accent" ref={parallaxRef2}>
          <motion.p
            className="displacement__quote"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
          >
            "3,200 BPO workers in Pune may face displacement in 12 months."
          </motion.p>
          <div className="displacement__stats">
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}>
              <span className="gradient-text"><CountUp end={40} suffix="%" /></span><small>Automation Adoption</small>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.4 }}>
              <span className="gradient-text"><CountUp end={87} suffix="/100" /></span><small>Vulnerability Index</small>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.6 }}>
              <span className="gradient-text">12mo</span><small>Window of Action</small>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ---- Parallax City Cards ---- */}
      <section className="city-risk section-container">
        <motion.h2
          className="section-heading"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          City <span className="gradient-text">Risk Radar</span>
        </motion.h2>
        <div className="city-grid">
          {['Pune: Critical', 'Hyderabad: Severe', 'Mumbai: Moderate', 'Gurgaon: High', 'Bangalore: Low', 'Chennai: Stable'].map((c, i) => {
            const [city, level] = c.split(': ');
            const lev = level.toLowerCase();
            return (
              <motion.div
                key={i}
                className={`city-card glass city-card--${lev}`}
                initial={{ opacity: 0, y: 50, rotateY: -15 }}
                whileInView={{ opacity: 1, y: 0, rotateY: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * 0.1, duration: 0.6, ease: 'backOut' }}
                whileHover={{ scale: 1.06, rotateY: 5, z: 30 }}
              >
                <span className="city-card__name">{city}</span>
                <span className={`city-card__level city-card__level--${lev}`}>{level}</span>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ---- CTA ---- */}
      <section className="cta section-container">
        <div className="cta__inner" ref={ctaRef}>
          <motion.h2
            initial={{ opacity: 0, y: 40, filter: 'blur(10px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            Take Control of Your Career
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            Get your personalized AI vulnerability score and reskilling roadmap powered by NPTEL &amp; SWAYAM.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
          >
            <Link to="/worker" className="btn btn--primary btn--lg btn--glow">Analyze My Risk →</Link>
          </motion.div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="footer">
        <div className="footer__inner section-container">
          <motion.div
            className="footer__brand"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <span className="navbar__logo"><span className="material-symbols-outlined">auto_awesome</span></span>
            <span>SKILLS MIRAGE</span>
          </motion.div>
          <p className="footer__copy">© 2025 SKILLS MIRAGE INTELLIGENCE UNIT</p>
          <p className="footer__status">System Status: Nominal · Lat: 18.5204 N, Lon: 73.8567 E</p>
        </div>
      </footer>
    </div>
  );
}
