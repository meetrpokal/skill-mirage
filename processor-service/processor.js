/**
 * processor.js – Subscribes to "layer1.jobs" from Redis,
 * inserts into Postgres, computes aggregates, caches in Redis,
 * and publishes "layer1.aggregates" for the backend to pick up.
 *
 * Env vars:
 *   REDIS_URL    – default redis://localhost:6379
 *   DATABASE_URL – default postgres://mirage:mirage123@localhost:5432/jobmarket
 */

const Redis = require("ioredis");
const { Pool } = require("pg");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://mirage:mirage123@localhost:5432/jobmarket";

const JOBS_CHANNEL = "layer1.jobs";
const AGG_CHANNEL = "layer1.aggregates";
const CACHE_KEY = "layer1:aggregates";     // Redis hash for latest aggregates
const JOBS_CACHE = "layer1:recent_jobs";   // Redis list of recent jobs

// ── Canonical 43-city list & alias map ────────────────────────────────
const VALID_CITIES = new Set([
  "Bengaluru", "Mumbai", "Delhi", "Pune", "Hyderabad",
  "Chennai", "Kolkata", "Ahmedabad",
  "Noida", "Gurugram", "Jaipur", "Lucknow", "Chandigarh",
  "Indore", "Coimbatore", "Kochi", "Thiruvananthapuram",
  "Nagpur", "Vadodara", "Bhopal", "Visakhapatnam",
  "Mysuru", "Surat", "Patna", "Nashik", "Madurai",
  "Mangaluru", "Hubli", "Dehradun", "Ranchi", "Raipur",
  "Guwahati", "Agra", "Varanasi", "Jabalpur", "Siliguri",
  "Jodhpur", "Rajkot", "Tiruchirappalli", "Kozhikode",
  "Ludhiana", "Bhubaneswar", "Udaipur",
]);

const CITY_ALIAS = {
  bangalore: "Bengaluru", bengaluru: "Bengaluru",
  gurgaon: "Gurugram", gurugram: "Gurugram",
  "navi mumbai": "Mumbai", thane: "Mumbai", bombay: "Mumbai",
  "greater noida": "Noida", ghaziabad: "Noida",
  faridabad: "Gurugram",
  vizag: "Visakhapatnam", visakhapatnam: "Visakhapatnam",
  trivandrum: "Thiruvananthapuram", thiruvananthapuram: "Thiruvananthapuram",
  calicut: "Kozhikode", kozhikode: "Kozhikode",
  cochin: "Kochi", kochi: "Kochi",
  mangalore: "Mangaluru", mangaluru: "Mangaluru",
  mysore: "Mysuru", mysuru: "Mysuru",
  trichy: "Tiruchirappalli", tiruchirappalli: "Tiruchirappalli",
  "new delhi": "Delhi", delhi: "Delhi",
  calcutta: "Kolkata", kolkata: "Kolkata",
  secunderabad: "Hyderabad", hyderabad: "Hyderabad",
  madras: "Chennai", chennai: "Chennai",
};

function normalizeCity(rawCity) {
  if (!rawCity) return null;
  // Strip parenthetical suffixes: "Mumbai( SEEPZ" → "Mumbai"
  let city = rawCity.replace(/\s*\(.*$/, "").trim();
  const key = city.toLowerCase().replace(/[\s-]+/g, " ").trim();
  city = CITY_ALIAS[key] || city;
  return VALID_CITIES.has(city) ? city : null;
}

// ── Postgres pool ────────────────────────────────────────────────────
const pool = new Pool({ connectionString: DATABASE_URL });

async function waitForPostgres() {
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query("SELECT 1");
      console.log("[processor] postgres ready");
      return;
    } catch {
      console.log("[processor] waiting for postgres...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("postgres not reachable after 60s");
}

// ── Insert job into Postgres (upsert) ────────────────────────────────
async function insertJob(job) {
  const q = `
    INSERT INTO jobs (job_id, job_url, title, company, city, state, country, skills_list, posted_date, job_description, source, scrape_timestamp)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (job_id) DO UPDATE SET
      title = EXCLUDED.title,
      company = EXCLUDED.company,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      skills_list = EXCLUDED.skills_list,
      scrape_timestamp = EXCLUDED.scrape_timestamp
  `;
  await pool.query(q, [
    job.job_id,
    job.job_url || null,
    job.title,
    job.company,
    job.city,
    job.state || null,
    job.country || 'India',
    job.skills_list,
    job.posted_date || null,
    job.job_description,
    job.source,
    job.scrape_timestamp,
  ]);
}

// ── Compute aggregates from Postgres ─────────────────────────────────
async function computeAggregates() {
  // Top skills (case-insensitive grouping, pick most common casing for display)
  const skillsRes = await pool.query(`
    SELECT MODE() WITHIN GROUP (ORDER BY skill) AS skill, COUNT(*) AS cnt
    FROM (SELECT unnest(skills_list) AS skill FROM jobs) s
    GROUP BY LOWER(skill) ORDER BY cnt DESC LIMIT 20
  `);

  // Top cities
  const citiesRes = await pool.query(`
    SELECT city, COUNT(*) AS cnt
    FROM jobs WHERE city IS NOT NULL AND city <> ''
    GROUP BY city ORDER BY cnt DESC LIMIT 15
  `);

  // Top companies
  const companiesRes = await pool.query(`
    SELECT company, COUNT(*) AS cnt
    FROM jobs WHERE company IS NOT NULL AND company <> ''
    GROUP BY company ORDER BY cnt DESC LIMIT 15
  `);

  // Total count
  const totalRes = await pool.query(`SELECT COUNT(*) AS total FROM jobs`);

  // Skill co-occurrence: pairs of skills that appear together in the same job posting
  // We only care about co-occurrence among the top 25 skills for performance
  const topSkillNames = skillsRes.rows.slice(0, 25).map(r => r.skill);
  const cooccurrenceMap = {};

  if (topSkillNames.length > 1) {
    const lowered = topSkillNames.map(s => s.toLowerCase());
    const coRes = await pool.query(`
      SELECT s1.lskill AS skill_a, s2.lskill AS skill_b, COUNT(DISTINCT s1.job_id) AS cnt
      FROM (SELECT job_id, LOWER(unnest(skills_list)) AS lskill FROM jobs) s1
      JOIN (SELECT job_id, LOWER(unnest(skills_list)) AS lskill FROM jobs) s2
        ON s1.job_id = s2.job_id AND s1.lskill < s2.lskill
      WHERE s1.lskill = ANY($1) AND s2.lskill = ANY($1)
      GROUP BY s1.lskill, s2.lskill
      HAVING COUNT(DISTINCT s1.job_id) >= 2
      ORDER BY cnt DESC
      LIMIT 60
    `, [lowered]);

    for (const row of coRes.rows) {
      const key = `${row.skill_a}||${row.skill_b}`;
      cooccurrenceMap[key] = parseInt(row.cnt, 10);
    }
  }

  // Convert to array of { source, target, weight }
  const skill_cooccurrence = Object.entries(cooccurrenceMap).map(([key, weight]) => {
    const [source, target] = key.split('||');
    return { source, target, weight };
  });

  // Map co-occurrence lowercase keys back to display names from top skills
  const displayNameMap = new Map(skillsRes.rows.map(r => [r.skill.toLowerCase(), r.skill]));
  const skill_cooccurrence_named = skill_cooccurrence.map(({ source, target, weight }) => ({
    source: displayNameMap.get(source) || source,
    target: displayNameMap.get(target) || target,
    weight,
  }));

  return {
    total_jobs: parseInt(totalRes.rows[0].total, 10),
    top_skills: skillsRes.rows.map((r) => ({ name: r.skill, count: parseInt(r.cnt, 10) })),
    top_cities: citiesRes.rows.map((r) => ({ name: r.city, count: parseInt(r.cnt, 10) })),
    top_companies: companiesRes.rows.map((r) => ({ name: r.company, count: parseInt(r.cnt, 10) })),
    skill_cooccurrence: skill_cooccurrence_named,
    updated_at: new Date().toISOString(),
  };
}

// ── Persist aggregates to Postgres (replace) ─────────────────────────
async function persistAggregates(agg) {
  await pool.query("DELETE FROM aggregates");

  const inserts = [];
  for (const s of agg.top_skills) inserts.push(["skills", s.name, s.count]);
  for (const c of agg.top_cities) inserts.push(["cities", c.name, c.count]);
  for (const c of agg.top_companies) inserts.push(["companies", c.name, c.count]);

  for (const [type, key, val] of inserts) {
    await pool.query(
      "INSERT INTO aggregates (agg_type, agg_key, agg_value) VALUES ($1,$2,$3)",
      [type, key, val]
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  await waitForPostgres();

  // Two Redis clients: one for sub, one for pub + cache writes
  const sub = new Redis(REDIS_URL, { retryStrategy: (t) => Math.min(t * 500, 5000) });
  const pub = new Redis(REDIS_URL, { retryStrategy: (t) => Math.min(t * 500, 5000) });

  await new Promise((resolve) => {
    if (sub.status === "ready") return resolve();
    sub.once("ready", resolve);
  });
  console.log("[processor] redis connected, subscribing to", JOBS_CHANNEL);

  let pendingCount = 0;
  const AGG_INTERVAL = 5000; // recompute aggregates every 5s if new data

  // Recompute + broadcast aggregates periodically
  setInterval(async () => {
    if (pendingCount === 0) return;
    try {
      const agg = await computeAggregates();
      await persistAggregates(agg);
      // Cache in Redis for backend quick reads
      await pub.set(CACHE_KEY, JSON.stringify(agg), "EX", 300);
      // Publish for Socket.IO live push
      await pub.publish(AGG_CHANNEL, JSON.stringify(agg));
      console.log(`[processor] aggregates updated (${agg.total_jobs} jobs total)`);
      pendingCount = 0;
    } catch (err) {
      console.error("[processor] aggregate error:", err.message);
    }
  }, AGG_INTERVAL);

  // Subscribe and process incoming jobs
  sub.subscribe(JOBS_CHANNEL);
  sub.on("message", async (_channel, message) => {
    try {
      const job = JSON.parse(message);
      // Normalize city to canonical 43-city list
      const canonical = normalizeCity(job.city);
      if (!canonical) {
        console.log(`[processor] skip non-canonical city: "${job.city}"`);
        return;
      }
      job.city = canonical;
      await insertJob(job);
      // Keep last 50 jobs in a Redis list for "recent jobs" API
      await pub.lpush(JOBS_CACHE, JSON.stringify(job));
      await pub.ltrim(JOBS_CACHE, 0, 49);
      pendingCount++;
      console.log(`\n========== [SCRAPED JOB DATA] ==========`);
      console.log(`Title       : ${job.title}`);
      console.log(`Company     : ${job.company}`);
      console.log(`Location    : ${job.city || 'N/A'}, ${job.state || 'N/A'}, ${job.country || 'India'}`);
      console.log(`Skills      : ${Array.isArray(job.skills_list) ? job.skills_list.join(', ') : job.skills_list}`);
      console.log(`Posted      : ${job.posted_date || 'N/A'}`);
      console.log(`Source      : ${job.source || 'N/A'}`);
      console.log(`Job URL     : ${job.job_url || 'N/A'}`);
      console.log(`Job ID      : ${job.job_id}`);
      console.log(`Scraped At  : ${job.scrape_timestamp}`);
      console.log(`Description : ${(job.job_description || '').substring(0, 200)}${(job.job_description || '').length > 200 ? '...' : ''}`);
      console.log(`========================================\n`);
    } catch (err) {
      console.error("[processor] message error:", err.message);
    }
  });

  console.log("[processor] ready – waiting for jobs...");
}

main().catch((err) => {
  console.error("[processor] fatal:", err);
  process.exit(1);
});
