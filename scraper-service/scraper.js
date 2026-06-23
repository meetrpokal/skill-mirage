/**
 * scraper.js – Robust Naukri job scraper using Puppeteer
 * Publishes normalized job records to Redis channel "layer1.jobs"
 *
 * Iterates over multiple Indian cities, opens each job detail page for
 * canonical field extraction, deduplicates by URL, and extracts a stable
 * job_id from the Naukri URL slug.
 *
 * Env vars:
 *   REDIS_URL         – Redis connection (default: redis://localhost:6379)
 *   SCRAPE_QUERY      – Search keyword (default: "software engineer")
 *   SCRAPE_PAGES      – Pages per city (default: 2)
 *   SCRAPE_INTERVAL   – Seconds between full scrape cycles (default: 300)
 *   SCRAPE_CITIES     – Comma-separated city list (overrides default list)
 *   RATE_LIMIT_MS     – Delay between page navigations (default: 800)
 *
 * CLI usage:
 *   node scraper.js --query "data engineer" --cities "Pune,Mumbai"
 *   node scraper.js --query "software engineer" --city "Bengaluru"
 *
 * Expected published JSON (1 sample):
 * {
 *   "job_id": "naukri-3928475612",
 *   "job_url": "https://www.naukri.com/job-listings/senior-react-dev-...",
 *   "title": "Senior React Developer",
 *   "company": "Infosys Ltd",
 *   "city": "Pune",
 *   "state": "Maharashtra",
 *   "country": "India",
 *   "skills_list": ["react", "javascript", "node.js", "redux"],
 *   "posted_date": "2026-03-04",
 *   "job_description": "We are looking for a senior React developer...",
 *   "source": "naukri",
 *   "scrape_timestamp": "2026-03-05T15:22:00.000Z"
 * }
 */

const puppeteer = require("puppeteer");
const Redis = require("ioredis");
const crypto = require("crypto");

// ── CLI arg parsing (minimal, no deps) ───────────────────────────────
function parseCliArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--query" && argv[i + 1]) args.query = argv[++i];
    else if (argv[i] === "--cities" && argv[i + 1]) args.cities = argv[++i];
    else if (argv[i] === "--city" && argv[i + 1]) args.cities = argv[++i]; // alias
    else if (argv[i] === "--pages" && argv[i + 1]) args.pages = argv[++i];
  }
  return args;
}

const CLI = parseCliArgs();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUERY = CLI.query || process.env.SCRAPE_QUERY || "";
const PAGES = parseInt(CLI.pages || process.env.SCRAPE_PAGES || "2", 10);
const INTERVAL = parseInt(process.env.SCRAPE_INTERVAL || "300", 10) * 1000;
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_MS || "800", 10);
const CHANNEL = "layer1.jobs";
const CONFIG_CHANNEL = "scraper.config";
const SEEN_KEY = "scraper:seen_ids"; // Redis set of known job_ids

// Current dynamic job age filter (days, 0 = no filter)
let currentJobAge = 30;

// ── Multiple job categories to scrape ────────────────────────────────
const DEFAULT_QUERIES = [
  "software engineer", "data scientist", "product manager",
  "devops engineer", "frontend developer", "backend developer",
  "full stack developer", "machine learning engineer",
  "business analyst", "ui ux designer", "cloud engineer",
  "data analyst", "project manager", "qa engineer",
  "mobile developer", "cybersecurity", "system administrator",
];

function getQueries() {
  if (QUERY) return QUERY.split(",").map((q) => q.trim()).filter(Boolean);
  const envQ = process.env.SCRAPE_QUERIES;
  if (envQ) return envQ.split(",").map((q) => q.trim()).filter(Boolean);
  return DEFAULT_QUERIES;
}

// ── Canonical 43-city list (FIXED — never add/remove without updating
//    processor, seed, backend routes, and scoring-service) ────────────
const VALID_CITIES = [
  // Tier 1: Metros (8)
  "Bengaluru", "Mumbai", "Delhi", "Pune", "Hyderabad",
  "Chennai", "Kolkata", "Ahmedabad",
  // Tier 2: Major IT / Business hubs (18)
  "Noida", "Gurugram", "Jaipur", "Lucknow", "Chandigarh",
  "Indore", "Coimbatore", "Kochi", "Thiruvananthapuram",
  "Nagpur", "Vadodara", "Bhopal", "Visakhapatnam",
  "Mysuru", "Surat", "Patna", "Nashik", "Madurai",
  // Tier 3: Emerging & smaller cities (17)
  "Mangaluru", "Hubli", "Dehradun", "Ranchi", "Raipur",
  "Guwahati", "Agra", "Varanasi", "Jabalpur", "Siliguri",
  "Jodhpur", "Rajkot", "Tiruchirappalli", "Kozhikode",
  "Ludhiana", "Bhubaneswar", "Udaipur",
];
const VALID_CITIES_SET = new Set(VALID_CITIES);

// Aliases map (lowercase key → canonical name)
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

function getCities() {
  return VALID_CITIES;
}

// ── City → State mapping (matches TopoJSON state names exactly) ──────
const CITY_STATE_MAP = {
  // Karnataka
  bengaluru: "Karnataka", bangalore: "Karnataka", mysuru: "Karnataka", mysore: "Karnataka",
  mangalore: "Karnataka", mangaluru: "Karnataka", hubli: "Karnataka", belgaum: "Karnataka",
  belagavi: "Karnataka", dharwad: "Karnataka", gulbarga: "Karnataka", davangere: "Karnataka",
  shimoga: "Karnataka", tumkur: "Karnataka", udupi: "Karnataka", hospet: "Karnataka",

  // Maharashtra
  mumbai: "Maharashtra", pune: "Maharashtra", nagpur: "Maharashtra", nashik: "Maharashtra",
  thane: "Maharashtra", "navi mumbai": "Maharashtra", aurangabad: "Maharashtra",
  solapur: "Maharashtra", kolhapur: "Maharashtra", sangli: "Maharashtra",
  amravati: "Maharashtra", akola: "Maharashtra", latur: "Maharashtra", jalgaon: "Maharashtra",
  nanded: "Maharashtra", ahmednagar: "Maharashtra", satara: "Maharashtra",

  // Delhi / NCR
  delhi: "Delhi", "new delhi": "Delhi",

  // Uttar Pradesh
  noida: "Uttar Pradesh", lucknow: "Uttar Pradesh", agra: "Uttar Pradesh",
  "greater noida": "Uttar Pradesh", ghaziabad: "Uttar Pradesh",
  kanpur: "Uttar Pradesh", varanasi: "Uttar Pradesh", allahabad: "Uttar Pradesh",
  prayagraj: "Uttar Pradesh", meerut: "Uttar Pradesh", aligarh: "Uttar Pradesh",
  bareilly: "Uttar Pradesh", moradabad: "Uttar Pradesh", gorakhpur: "Uttar Pradesh",
  mathura: "Uttar Pradesh", jhansi: "Uttar Pradesh", saharanpur: "Uttar Pradesh",

  // Haryana
  gurgaon: "Haryana", gurugram: "Haryana", faridabad: "Haryana",
  karnal: "Haryana", panipat: "Haryana", ambala: "Haryana",
  hisar: "Haryana", rohtak: "Haryana", sonipat: "Haryana",

  // Telangana (TopoJSON predates 2014 split, mapped to "Andhra Pradesh")
  hyderabad: "Andhra Pradesh", secunderabad: "Andhra Pradesh", warangal: "Andhra Pradesh",
  karimnagar: "Andhra Pradesh", nizamabad: "Andhra Pradesh", khammam: "Andhra Pradesh",

  // Andhra Pradesh
  vizag: "Andhra Pradesh", visakhapatnam: "Andhra Pradesh", vijayawada: "Andhra Pradesh",
  tirupati: "Andhra Pradesh", guntur: "Andhra Pradesh", nellore: "Andhra Pradesh",
  rajahmundry: "Andhra Pradesh", kakinada: "Andhra Pradesh", kurnool: "Andhra Pradesh",
  anantapur: "Andhra Pradesh", kadapa: "Andhra Pradesh", ongole: "Andhra Pradesh",

  // Tamil Nadu
  chennai: "Tamil Nadu", coimbatore: "Tamil Nadu", madurai: "Tamil Nadu",
  trichy: "Tamil Nadu", tiruchirappalli: "Tamil Nadu", salem: "Tamil Nadu",
  tirunelveli: "Tamil Nadu", erode: "Tamil Nadu", vellore: "Tamil Nadu",
  thoothukudi: "Tamil Nadu", thanjavur: "Tamil Nadu", dindigul: "Tamil Nadu",
  hosur: "Tamil Nadu", tirupur: "Tamil Nadu", nagercoil: "Tamil Nadu",

  // West Bengal
  kolkata: "West Bengal", howrah: "West Bengal", siliguri: "West Bengal",
  durgapur: "West Bengal", asansol: "West Bengal", bardhaman: "West Bengal",
  kharagpur: "West Bengal", haldia: "West Bengal", kalyani: "West Bengal",

  // Gujarat
  ahmedabad: "Gujarat", surat: "Gujarat", vadodara: "Gujarat", rajkot: "Gujarat",
  gandhinagar: "Gujarat", bhavnagar: "Gujarat", jamnagar: "Gujarat", junagadh: "Gujarat",
  anand: "Gujarat", bharuch: "Gujarat", mehsana: "Gujarat", morbi: "Gujarat",

  // Rajasthan
  jaipur: "Rajasthan", udaipur: "Rajasthan", jodhpur: "Rajasthan",
  ajmer: "Rajasthan", kota: "Rajasthan", bikaner: "Rajasthan",
  alwar: "Rajasthan", bhilwara: "Rajasthan", sikar: "Rajasthan",

  // Chandigarh
  chandigarh: "Chandigarh",

  // Madhya Pradesh
  indore: "Madhya Pradesh", bhopal: "Madhya Pradesh",
  gwalior: "Madhya Pradesh", jabalpur: "Madhya Pradesh",
  ujjain: "Madhya Pradesh", sagar: "Madhya Pradesh", dewas: "Madhya Pradesh",

  // Kerala
  kochi: "Kerala", cochin: "Kerala", thiruvananthapuram: "Kerala",
  trivandrum: "Kerala", kozhikode: "Kerala", calicut: "Kerala",
  thrissur: "Kerala", kollam: "Kerala", palakkad: "Kerala",
  kannur: "Kerala", alappuzha: "Kerala", malappuram: "Kerala",

  // Bihar
  patna: "Bihar", gaya: "Bihar", muzaffarpur: "Bihar",
  bhagalpur: "Bihar", darbhanga: "Bihar", purnia: "Bihar",

  // Jharkhand
  ranchi: "Jharkhand", jamshedpur: "Jharkhand", dhanbad: "Jharkhand",
  bokaro: "Jharkhand", hazaribagh: "Jharkhand", deoghar: "Jharkhand",

  // Odisha (TopoJSON uses "Orissa")
  bhubaneswar: "Orissa", cuttack: "Orissa", rourkela: "Orissa",
  berhampur: "Orissa", sambalpur: "Orissa", puri: "Orissa",

  // Assam
  guwahati: "Assam", dibrugarh: "Assam", silchar: "Assam",
  jorhat: "Assam", tezpur: "Assam", nagaon: "Assam",

  // Uttarakhand (TopoJSON uses "Uttaranchal")
  dehradun: "Uttaranchal", haridwar: "Uttaranchal", rishikesh: "Uttaranchal",
  haldwani: "Uttaranchal", roorkee: "Uttaranchal", nainital: "Uttaranchal",
  rudrapur: "Uttaranchal", kashipur: "Uttaranchal",

  // Punjab
  ludhiana: "Punjab", amritsar: "Punjab", jalandhar: "Punjab",
  patiala: "Punjab", bathinda: "Punjab", mohali: "Punjab",
  pathankot: "Punjab", hoshiarpur: "Punjab",

  // Chhattisgarh
  raipur: "Chhattisgarh", bilaspur: "Chhattisgarh", bhilai: "Chhattisgarh",
  durg: "Chhattisgarh", korba: "Chhattisgarh", jagdalpur: "Chhattisgarh",

  // Goa
  panaji: "Goa", margao: "Goa", vasco: "Goa", mapusa: "Goa",
  "vasco da gama": "Goa",

  // Himachal Pradesh
  shimla: "Himachal Pradesh", dharamshala: "Himachal Pradesh",
  manali: "Himachal Pradesh", solan: "Himachal Pradesh", mandi: "Himachal Pradesh",
  kullu: "Himachal Pradesh", hamirpur: "Himachal Pradesh",

  // Jammu and Kashmir
  jammu: "Jammu and Kashmir", srinagar: "Jammu and Kashmir",
  anantnag: "Jammu and Kashmir", baramulla: "Jammu and Kashmir",

  // Puducherry
  puducherry: "Puducherry", pondicherry: "Puducherry",

  // Sikkim
  gangtok: "Sikkim",

  // Manipur
  imphal: "Manipur",

  // Meghalaya
  shillong: "Meghalaya",

  // Mizoram
  aizawl: "Mizoram",

  // Nagaland
  kohima: "Nagaland", dimapur: "Nagaland",

  // Tripura
  agartala: "Tripura",

  // Arunachal Pradesh
  itanagar: "Arunachal Pradesh",

};

function normalizeLocation(rawLocation, fallbackCity) {
  const text = (rawLocation || fallbackCity || "").trim();
  const parts = text.split(/[,/|]/).map((p) => p.trim()).filter(Boolean);
  let city = parts[0] || fallbackCity || "Unknown";
  // Strip parenthetical suffixes, e.g. "Mumbai( SEEPZ" → "Mumbai"
  city = city.replace(/\s*\(.*$/, "").trim();
  const key = city.toLowerCase().replace(/[\s-]+/g, " ").trim();
  // Map alias → canonical, then validate against the fixed 43-city list
  city = CITY_ALIAS[key] || city;
  if (!VALID_CITIES_SET.has(city)) {
    // Try title-cased version as last resort
    const titled = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
    city = VALID_CITIES_SET.has(titled) ? titled : null;
  }
  if (!city) return null; // skip jobs outside canonical cities
  const state = CITY_STATE_MAP[key] || (parts[1] ? parts[1].trim() : "Unknown");
  return { city, state, country: "India" };
}

// ── User-agent rotation ──────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Strip Naukri rating/review suffix from company names
// e.g. "Barclays3.81156 Reviews" → "Barclays", "JPMorgan Chase Bank3.87691 Reviews" → "JPMorgan Chase Bank"
function cleanCompany(raw) {
  if (!raw) return "Unknown";
  // The rating digit can be glued right onto the company name (no space)
  return raw.replace(/\d[\d.]*\s*Reviews?.*$/i, "").replace(/\s+$/, "").trim() || raw;
}

// ── Helpers ──────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// helper: normalize text (safe)
function norm(s) {
  return (s || "").toString().toLowerCase().trim();
}

// helper: detect job type from text
function detectTypeFromText(text) {
  text = norm(text);
  if (!text) return "unknown";
  if (/\bintern(ship)?\b/.test(text)) return "internship";
  if (/\b(full[\s-]*time|permanent)\b/.test(text)) return "full-time";
  if (/\b(part[\s-]*time)\b/.test(text)) return "part-time";
  if (/\b(contract|temporary|freelance)\b/.test(text)) return "contract";
  return "unknown";
}

const KNOWN_SKILLS = [
  "javascript", "typescript", "python", "java", "c++", "c#", "go", "rust", "scala",
  "react", "angular", "vue", "next.js", "node.js", "nodejs", "express", "django",
  "flask", "spring", "spring boot", "docker", "kubernetes", "aws", "azure",
  "gcp", "sql", "nosql", "mongodb", "postgres", "postgresql", "redis",
  "kafka", "rabbitmq", "graphql", "rest", "html", "css", "sass", "tailwind",
  "machine learning", "deep learning", "nlp", "tensorflow", "pytorch",
  "git", "ci/cd", "jenkins", "terraform", "linux", "agile", "scrum",
  "data structures", "algorithms", ".net", "ruby", "php", "swift", "kotlin",
  "power bi", "tableau", "spark", "hadoop", "airflow", "snowflake", "databricks",
  "figma", "jira", "confluence", "devops", "microservices", "api",
];

function extractSkills(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return [...new Set(KNOWN_SKILLS.filter((s) => lower.includes(s)))];
}

/** Return "YYYY-MM-DD" for the current instant in IST (UTC+5:30). */
function todayIST(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseRelativeDate(text) {
  if (!text) return todayIST();
  const t = text.toLowerCase().trim();
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  if (t.includes("today") || t.includes("just now") || t.includes("few hours"))
    return now.toISOString().slice(0, 10);
  if (t.includes("yesterday")) {
    now.setDate(now.getDate() - 1);
    return now.toISOString().slice(0, 10);
  }
  const m = t.match(/(\d+)\s*day/);
  if (m) { now.setDate(now.getDate() - parseInt(m[1], 10)); return now.toISOString().slice(0, 10); }
  const mw = t.match(/(\d+)\s*week/);
  if (mw) { now.setDate(now.getDate() - parseInt(mw[1], 10) * 7); return now.toISOString().slice(0, 10); }
  return now.toISOString().slice(0, 10);
}

/**
 * Extract a stable job_id from a Naukri URL.
 * Naukri URLs look like: /job-listings/...-<numeric_id> or /jobs/<slug>/<numeric_id>
 * We parse the trailing numeric ID; if not found, SHA256 the URL.
 */
function extractJobId(url) {
  if (!url) return `naukri-${crypto.randomUUID()}`;
  const m = url.match(/[-/](\d{5,})(?:\?|$|&)/);
  if (m) return `naukri-${m[1]}`;
  const m2 = url.match(/(\d{7,})/);
  if (m2) return `naukri-${m2[1]}`;
  return `naukri-${crypto.createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

/** Retry wrapper with exponential backoff */
async function withRetry(fn, label, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[scraper] ${label} attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
}

// ── Scrape a single listing page: collect cards + extract detail pages ─
async function scrapeListingPage(page, city, pageNum, query) {
  const slug = query.replace(/\s+/g, "-").toLowerCase();
  const citySlug = city.toLowerCase().replace(/\s+/g, "-");
  let url = `https://www.naukri.com/${slug}-jobs-in-${citySlug}?k=${encodeURIComponent(query)}&l=${encodeURIComponent(city)}&pageNo=${pageNum}`;
  if (currentJobAge > 0) {
    url += `&jobAge=${currentJobAge}`;
  }

  console.log(`[scraper] [${city}] listing page ${pageNum}: ${url}`);

  await withRetry(async () => {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 35000 });
  }, `goto listing ${city} p${pageNum}`);

  await sleep(RATE_LIMIT + Math.random() * 1000);

  // Extract job cards directly from the listing page (hybrid approach).
  // We grab both the card-level data AND the detail URL for each card.
  // Naukri renders job cards with various class names depending on A/B tests.
  const cards = await page.evaluate(() => {
    const results = [];

    // Broad selector: any element that looks like a job card
    const cardSelectors = [
      ".srp-jobtuple-wrapper",
      ".cust-job-tuple",
      'article[class*="jobTuple"]',
      "[data-job-id]",
      '[class*="jobTupleHeader"]',
    ];

    let cardEls = [];
    for (const sel of cardSelectors) {
      cardEls = document.querySelectorAll(sel);
      if (cardEls.length > 0) break;
    }

    // If no cards found via specific selectors, try finding any container with
    // multiple links to /job-listings/
    if (cardEls.length === 0) {
      const allJobLinks = document.querySelectorAll('a[href*="/job-listings/"], a[href*="/job/"]');
      // Deduplicate by href and treat each link as a "card"
      const seen = new Set();
      allJobLinks.forEach((a) => {
        const href = a.href ? a.href.split("?")[0] : "";
        if (href && !seen.has(href) && href.includes("naukri.com")) {
          seen.add(href);
          results.push({
            url: href,
            title: a.textContent.trim(),
            company: "",
            city: "",
            posted_raw: "",
            description: "",
            skills_raw: [],
          });
        }
      });
      return results;
    }

    Array.from(cardEls).forEach((card) => {
      // Skip promoted / sponsored cards
      const promoEl = card.querySelector(
        '[class*="promoted"], [class*="sponsored"], [class*="Promoted"], [class*="Sponsored"], .naukri-promoted, .featuredLbl'
      );
      const cardText = card.textContent || "";
      if (promoEl || /\b(promoted|sponsored)\b/i.test(cardText.slice(0, 200))) {
        return; // skip promoted card
      }

      // Find the main link (title link with job URL)
      const linkEl = card.querySelector(
        'a.title, .title a, a[href*="/job-listings/"], a[href*="/job/"], a.subTitle, .row1 a'
      );
      const href = linkEl ? (linkEl.href || "").split("?")[0] : "";

      // Title from link text or dedicated element
      const titleEl = card.querySelector("a.title, .title a, .row1 a, a.subTitle, h2, [class*='title']");
      const title = titleEl ? titleEl.textContent.trim() : "";

      // Company
      const compEl = card.querySelector(
        ".comp-name, a.comp-name, .companyInfo a, [class*='comp-name'], [class*='company'] a"
      );
      const company = compEl ? compEl.textContent.trim() : "";

      // Location
      const locEl = card.querySelector(
        ".loc, .locWdth, .location, [class*='loc'], [class*='location'] span"
      );
      const city = locEl ? locEl.textContent.trim() : "";

      // Posted date
      const dateEl = card.querySelector(
        ".job-post-day, .freshness, [class*='date'], [class*='freshness']"
      );
      const posted_raw = dateEl ? dateEl.textContent.trim() : "";

      // Description snippet
      const descEl = card.querySelector(
        ".job-desc, .ellipsis.job-desc, .row6, [class*='job-desc']"
      );
      const description = descEl ? descEl.textContent.trim() : "";

      // Skills tags
      const skillEls = card.querySelectorAll(
        ".tag-li, .skill, li.tag-li, [class*='tag'] li, [class*='chip']"
      );
      const skills_raw = Array.from(skillEls)
        .map((s) => s.textContent.trim())
        .filter(Boolean);

      if (title || href) {
        results.push({ url: href, title, company, city, posted_raw, description, skills_raw });
      }
    });

    return results;
  });

  console.log(`[scraper] [${city}] page ${pageNum}: found ${cards.length} job cards`);

  // Debug: if 0 cards, log what the page actually has
  if (cards.length === 0) {
    const debug = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.href)
        .filter((h) => h.includes("/job"))
        .slice(0, 10);
      const bodyText = document.body ? document.body.innerText.slice(0, 500) : "";
      return { linkSample: allLinks, bodySnippet: bodyText };
    });
    console.warn(`[scraper] [${city}] p${pageNum} debug – job links on page:`, JSON.stringify(debug.linkSample));
    console.warn(`[scraper] [${city}] p${pageNum} debug – body snippet:`, debug.bodySnippet.slice(0, 200));
  }

  return cards;
}

// ── Open a detail page and extract canonical fields ──────────────────
async function scrapeDetailPage(page, jobUrl, fallbackCity) {
  await withRetry(async () => {
    await page.goto(jobUrl, { waitUntil: "networkidle2", timeout: 30000 });
  }, `goto detail ${jobUrl.slice(-60)}`);

  await sleep(RATE_LIMIT + Math.random() * 400);

  const detail = await page.evaluate(() => {
    function getText(...selectors) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      }
      return "";
    }

    const title = getText(
      "h1", 'h1[class*="jdHeader"]', 'h1[class*="title"]',
      "header h1", ".jd-header-title"
    );
    const company = getText(
      'a[class*="companyName"]', 'div[class*="company"] a',
      'a[href*="/company/"]', '.jd-header-comp-name a',
      '[class*="comp-name"]'
    );
    const location = getText(
      'div[class*="loc"]', 'span[class*="location"]',
      '[class*="locWdth"]', ".location", 'a[href*="/jobs-in-"]'
    );
    const skillEls = document.querySelectorAll(
      'ul[class*="tags"] li, div[class*="keyskills"] a, div[class*="keyskills"] span.chip, ' +
      '.key-skill a, .keyskills-chip, a[class*="chip"], span[class*="chip"], .tag-li'
    );
    const skills = [...new Set(
      Array.from(skillEls).map((el) => el.textContent.trim().toLowerCase())
        .filter((s) => s.length > 0 && s.length < 40)
    )];
    const posted = getText(
      'div[class*="posted"]', 'span[class*="date"]',
      ".job-post-day", ".freshness"
    );
    const descEl = document.querySelector(
      '.job-desc, [class*="job-desc"], [class*="dang-inner-html"], .jd-desc, section[class*="description"]'
    );
    const description = descEl ? descEl.textContent.trim() : "";
    const ogUrl = document.querySelector('meta[property="og:url"]');
    const canonicalUrl = ogUrl ? ogUrl.content : "";

    return { title, company, location, skills, posted, description, canonicalUrl };
  });

  return detail;
}

// ── Build a normalized record from card data (no detail page visit) ───
function buildRecord(card, fallbackCity) {
  const title = card.title || "Untitled";
  const company = cleanCompany(card.company || "Unknown");
  const rawLocation = card.city || "";
  const postedRaw = card.posted_raw || "";
  const description = card.description || "";

  // Skills: card tags first, then extract from description
  let skills = [];
  if (card.skills_raw && card.skills_raw.length > 0) {
    skills = card.skills_raw.map((s) => s.toLowerCase());
  }
  if (skills.length === 0) {
    skills = extractSkills(description);
  }

  const jobId = extractJobId(card.url);
  const loc = normalizeLocation(rawLocation, fallbackCity);
  if (!loc) return null; // city outside canonical 43 — skip

  const record = {
    job_id: jobId,
    job_url: card.url || "",
    title,
    company,
    city: loc.city,
    state: loc.state,
    country: loc.country,
    skills_list: [...new Set(skills)],
    posted_date: parseRelativeDate(postedRaw),
    job_description: description.slice(0, 3000),
    source: "naukri",
    scrape_timestamp: new Date().toISOString(),
  };

  record.inferredType = detectTypeFromText(record.title);
  return record;
}

// ── Main scrape cycle: iterate cities × pages ────────────────────────
async function scrapeCycle(browser, redis) {
  const cities = getCities();
  const queries = getQueries();
  const seenIds = new Set(); // in-memory dedup for this cycle
  const seenTitleCompany = new Set();
  let totalPublished = 0;
  let totalSkipped = 0;

  // Titles to always skip (known promoted / generic / placeholder)
  const SKIP_TITLES = new Set([
    "custom software engineer",
    "untitled",
  ]);

  // URL patterns to skip (promoted Accenture listings etc.)
  const SKIP_URL_PATTERNS = [
    /custom-software-engineer/i,
  ];

  console.log(`[scraper] ── cycle start: queries=${queries.length} cities=${cities.length} pages=${PAGES} ──`);
  console.log(`[scraper] queries: ${queries.join(", ")}`);

  for (const query of queries) {
    console.log(`[scraper] ── category: "${query}" ──`);
    for (const city of cities) {
      const page = await browser.newPage();
      await page.setUserAgent(randomUA());
      await page.setViewport({ width: 1280, height: 900 });

      let cityCount = 0;
      try {
        for (let pg = 1; pg <= PAGES; pg++) {
          try {
            const cards = await scrapeListingPage(page, city, pg, query);

            for (const card of cards) {
              try {
                // Early skip: filter out known generic/promoted cards
                if (SKIP_TITLES.has(norm(card.title))) continue;
                if (card.url && SKIP_URL_PATTERNS.some((p) => p.test(card.url))) continue;

                // Extract job_id early from the URL to check Redis BEFORE detail page
                const earlyJobId = extractJobId(card.url);

                // In-cycle dedup
                if (seenIds.has(earlyJobId)) { totalSkipped++; continue; }

                // Check Redis for already-processed jobs — skip detail page visit
                const alreadySeen = await redis.sismember(SEEN_KEY, earlyJobId);
                if (alreadySeen) {
                  seenIds.add(earlyJobId);
                  totalSkipped++;
                  continue;
                }

                const record = buildRecord(card, city);
                if (!record) continue; // city outside canonical list

                if (SKIP_TITLES.has(norm(record.title))) continue;

                seenIds.add(record.job_id);

                // Dedup by title+company (skip repeated promoted listings)
                const titleCompanyKey = norm(record.title) + "|||" + norm(record.company);
                if (seenTitleCompany.has(titleCompanyKey)) {
                  console.log(`[scraper] skip dup title+company: "${record.title}" @ ${record.company}`);
                  totalSkipped++;
                  continue;
                }
                seenTitleCompany.add(titleCompanyKey);

                // Mark as seen in Redis (expire after 7 days to rediscover eventually)
                await redis.sadd(SEEN_KEY, record.job_id);

                await redis.publish(CHANNEL, JSON.stringify(record));
                totalPublished++;
                cityCount++;
                console.log(
                  `[scraper] ✓ NEW ${record.job_id} | ${record.title.slice(0, 50)} @ ${record.company.slice(0, 30)} | ${record.city}, ${record.state}`
                );
              } catch (err) {
                console.error(`[scraper] record build error: ${err.message}`);
              }
            }
          } catch (err) {
            console.error(`[scraper] [${city}] listing page ${pg} error: ${err.message}`);
          }
        }
        if (cityCount > 0) console.log(`[scraper] [${query}][${city}] published ${cityCount} jobs`);
      } catch (err) {
        console.error(`[scraper] [${city}] city-level error: ${err.message}`);
      } finally {
        await page.close();
      }

      // Politeness: pause between cities
      await sleep(RATE_LIMIT * 2);
    }
  }

  console.log(`[scraper] ── cycle done: ${totalPublished} NEW jobs published, ${totalSkipped} skipped (already seen) across ${queries.length} categories × ${cities.length} cities ──`);
  return totalPublished;
}

// ── main loop ────────────────────────────────────────────────────────
async function main() {
  const queries = getQueries();
  console.log("[scraper] config:", {
    redis: REDIS_URL, queries: queries.length, pages: PAGES,
    cities: getCities().length, rateLimit: RATE_LIMIT, interval: INTERVAL / 1000 + "s",
  });
  console.log("[scraper] categories:", queries.join(", "));

  const redis = new Redis(REDIS_URL, { retryStrategy: (times) => Math.min(times * 500, 5000) });
  await new Promise((resolve) => {
    if (redis.status === "ready") return resolve();
    redis.once("ready", resolve);
  });
  console.log("[scraper] redis connected");

  // Subscribe to config channel for dynamic time-period changes
  const redisSub = new Redis(REDIS_URL, { retryStrategy: (times) => Math.min(times * 500, 5000) });
  redisSub.subscribe(CONFIG_CHANNEL);
  let pendingCycle = null;
  redisSub.on("message", (_ch, message) => {
    try {
      const config = JSON.parse(message);
      if (config.jobAge !== undefined) {
        const newAge = parseInt(config.jobAge, 10);
        if (newAge !== currentJobAge) {
          currentJobAge = newAge;
          console.log(`[scraper] ⚡ jobAge changed to ${currentJobAge} days — triggering new cycle`);
          // Trigger immediate scrape with new filter (debounce 2s)
          if (pendingCycle) clearTimeout(pendingCycle);
          pendingCycle = setTimeout(() => {
            pendingCycle = null;
            scrapeCycle(browser, redis).catch(err => console.error("[scraper] triggered cycle error:", err.message));
          }, 2000);
        }
      }
    } catch (err) {
      console.error("[scraper] config parse error:", err.message);
    }
  });
  console.log(`[scraper] listening for config on ${CONFIG_CHANNEL}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
           "--disable-gpu", "--disable-extensions"],
  });
  console.log("[scraper] browser launched");

  // First cycle immediately
  await scrapeCycle(browser, redis);
  // Set TTL on the seen-ids set so jobs can be rediscovered after 7 days
  await redis.expire(SEEN_KEY, 7 * 86400);

  // Subsequent cycles on interval
  setInterval(async () => {
    await scrapeCycle(browser, redis);
    await redis.expire(SEEN_KEY, 7 * 86400);
  }, INTERVAL);
  console.log(`[scraper] next cycle in ${INTERVAL / 1000}s`);
}

main().catch((err) => {
  console.error("[scraper] fatal:", err);
  process.exit(1);
});
