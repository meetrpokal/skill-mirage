/**
 * Live data simulator — inserts random job postings every few seconds
 * so the dashboard shows actual real-time changes.
 *
 * Usage:  node backend/seed/simulate.js
 * Stop:   Ctrl+C
 */
import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://mirage:mirage123@localhost:5433/jobmarket',
});

/* ── Reference data (same as seedData.js) ── */
const CITIES = [
  // Tier 1: Metros (8)
  'Bengaluru', 'Mumbai', 'Delhi', 'Pune', 'Hyderabad',
  'Chennai', 'Kolkata', 'Ahmedabad',
  // Tier 2: Major IT / Business hubs (18)
  'Noida', 'Gurugram', 'Jaipur', 'Lucknow', 'Chandigarh',
  'Indore', 'Coimbatore', 'Kochi', 'Thiruvananthapuram',
  'Nagpur', 'Vadodara', 'Bhopal', 'Visakhapatnam',
  'Mysuru', 'Surat', 'Patna', 'Nashik', 'Madurai',
  // Tier 3: Emerging & smaller cities (17)
  'Mangaluru', 'Hubli', 'Dehradun', 'Ranchi', 'Raipur',
  'Guwahati', 'Agra', 'Varanasi', 'Jabalpur', 'Siliguri',
  'Jodhpur', 'Rajkot', 'Tiruchirappalli', 'Kozhikode',
  'Ludhiana', 'Bhubaneswar', 'Udaipur',
];

const ROLES = [
  { role: 'BPO Voice Support', sector: 'BPO', skills: ['voice support', 'communication', 'English'] },
  { role: 'Data Entry Operator', sector: 'Admin', skills: ['data entry', 'Excel', 'typing'] },
  { role: 'Customer Support', sector: 'BPO', skills: ['customer service', 'CRM', 'communication'] },
  { role: 'Content Moderator', sector: 'Tech', skills: ['content review', 'guidelines', 'English'] },
  { role: 'Accountant', sector: 'Finance', skills: ['Tally', 'Excel', 'GST', 'accounting'] },
  { role: 'HR Executive', sector: 'HR', skills: ['recruitment', 'HR management', 'communication'] },
  { role: 'Sales Executive', sector: 'Sales', skills: ['sales', 'negotiation', 'CRM'] },
  { role: 'Quality Analyst', sector: 'Tech', skills: ['testing', 'quality assurance', 'documentation'] },
  { role: 'Digital Marketing', sector: 'Marketing', skills: ['SEO', 'social media', 'Google Ads', 'analytics'] },
  { role: 'AI Content Reviewer', sector: 'Tech', skills: ['AI', 'content review', 'prompt engineering'] },
  { role: 'Data Analyst', sector: 'Tech', skills: ['Python', 'SQL', 'Tableau', 'data analysis'] },
  { role: 'Software Engineer', sector: 'Tech', skills: ['JavaScript', 'React', 'Node.js', 'Python'] },
  { role: 'UI/UX Designer', sector: 'Design', skills: ['Figma', 'design thinking', 'prototyping'] },
  { role: 'DevOps Engineer', sector: 'Tech', skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD'] },
  { role: 'Full Stack Developer', sector: 'Tech', skills: ['React', 'Node.js', 'MongoDB', 'TypeScript'] },
  { role: 'Product Manager', sector: 'Tech', skills: ['product strategy', 'Jira', 'analytics', 'leadership'] },
  { role: 'Training Coordinator', sector: 'Education', skills: ['training', 'coordination', 'documentation'] },
  { role: 'Business Analyst', sector: 'Consulting', skills: ['SQL', 'Excel', 'requirements analysis'] },
  { role: 'Cloud Engineer', sector: 'Tech', skills: ['AWS', 'Azure', 'GCP', 'Terraform'] },
  { role: 'Graphic Designer', sector: 'Design', skills: ['Photoshop', 'Illustrator', 'Canva'] },
];

const COMPANIES = [
  'TCS', 'Infosys', 'Wipro', 'HCL', 'Tech Mahindra', 'Cognizant',
  'Concentrix', 'Genpact', 'WNS', 'EXL Service', 'Teleperformance',
  'Amazon', 'Flipkart', 'Swiggy', 'Zomato', 'Paytm', 'PhonePe',
  'Deloitte', 'Accenture', 'KPMG', 'PwC', 'EY',
  'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank',
  'Reliance', 'Tata Group', 'Mahindra', 'Bajaj', 'L&T',
];

const PREFIXES = ['Senior', 'Junior', '', 'Lead', 'Associate'];
const AI_KEYWORDS = ['ChatGPT', 'Copilot', 'AI', 'automation', 'machine learning', 'GenAI', 'LLM'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/* ── Insert a single job on a uniformly random day within the visible range ── */
async function insertOne() {
  const sql = `INSERT INTO jobs
    (job_id, title, canonical_role, company, city, sector, skills_list,
     salary_min, salary_max, posted_date, ai_tool_mentions, ai_mention_rate, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;

  const r = pick(ROLES);
  const aiMentions = AI_KEYWORDS.filter(() => Math.random() > 0.7);
  const title = `${pick(PREFIXES)} ${r.role}`.trim();

  // Spread uniformly across the full visible range (30 days = default filter).
  // This way EVERY day on the chart grows proportionally — no single-day spike.
  // Each day gets ~1 new job every (30 × INTERVAL) seconds ≈ 15 min.
  const daysBack = rand(0, 29);
  const postedDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  postedDate.setDate(postedDate.getDate() - daysBack);
  postedDate.setHours(rand(6, 22), rand(0, 59), rand(0, 59));

  await pool.query(sql, [
    `live-${Date.now()}-${rand(0, 99999)}`,
    title,
    r.role,
    pick(COMPANIES),
    pick(CITIES),
    r.sector,
    `{${r.skills.map(s => `"${s}"`).join(',')}}`,
    rand(15000, 80000),
    rand(80000, 200000),
    postedDate.toISOString(),
    `{${aiMentions.map(s => `"${s}"`).join(',')}}`,
    aiMentions.length > 0 ? Math.round((aiMentions.length / AI_KEYWORDS.length) * 100) : 0,
    'live',
  ]);
}

/* ── Main loop ── */
// Seed baseline ≈ 25 jobs/day. Insert 1 job every 30s → spread over 30 days →
// each day grows by ~1 job every 15 min (~4 jobs/hr per day visible).
// Slow enough for natural curve, fast enough to see card numbers tick up.
const INTERVAL_MS = 30_000;

console.log(`[simulator] Starting — inserting 1 job every ${INTERVAL_MS / 1000}s (spread across last 30 days)`);
console.log('[simulator] Curve stays proportional, no single-day spike.');
console.log('[simulator] Press Ctrl+C to stop.\n');

async function tick() {
  try {
    await insertOne();
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM jobs");
    console.log(`[simulator] +1 job  (total: ${rows[0].c})  ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error('[simulator] insert error:', err.message);
  }
}

// Run first tick immediately, then every INTERVAL_MS
tick();
const timer = setInterval(tick, INTERVAL_MS);

// Graceful shutdown
process.on('SIGINT', async () => {
  clearInterval(timer);
  console.log('\n[simulator] Stopped. Cleaning up live data...');
  try {
    const { rows } = await pool.query("DELETE FROM jobs WHERE source = 'live' RETURNING job_id");
    console.log(`[simulator] Removed ${rows.length} live jobs.`);
  } catch (err) {
    console.error('[simulator] cleanup error:', err.message);
  }
  await pool.end();
  process.exit(0);
});
