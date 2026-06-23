import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://mirage:mirage123@localhost:5433/jobmarket',
});

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
  { role: 'BPO Voice Support', sector: 'BPO', aiVulnerability: 85, skills: ['voice support', 'communication', 'English'] },
  { role: 'Data Entry Operator', sector: 'Admin', aiVulnerability: 74, skills: ['data entry', 'Excel', 'typing'] },
  { role: 'Customer Support', sector: 'BPO', aiVulnerability: 72, skills: ['customer service', 'CRM', 'communication'] },
  { role: 'Content Moderator', sector: 'Tech', aiVulnerability: 65, skills: ['content review', 'guidelines', 'English'] },
  { role: 'Accountant', sector: 'Finance', aiVulnerability: 55, skills: ['Tally', 'Excel', 'GST', 'accounting'] },
  { role: 'HR Executive', sector: 'HR', aiVulnerability: 45, skills: ['recruitment', 'HR management', 'communication'] },
  { role: 'Sales Executive', sector: 'Sales', aiVulnerability: 40, skills: ['sales', 'negotiation', 'CRM'] },
  { role: 'Quality Analyst', sector: 'Tech', aiVulnerability: 38, skills: ['testing', 'quality assurance', 'documentation'] },
  { role: 'Digital Marketing', sector: 'Marketing', aiVulnerability: 35, skills: ['SEO', 'social media', 'Google Ads', 'analytics'] },
  { role: 'AI Content Reviewer', sector: 'Tech', aiVulnerability: 22, skills: ['AI', 'content review', 'prompt engineering'] },
  { role: 'Data Analyst', sector: 'Tech', aiVulnerability: 18, skills: ['Python', 'SQL', 'Tableau', 'data analysis'] },
  { role: 'Software Engineer', sector: 'Tech', aiVulnerability: 15, skills: ['JavaScript', 'React', 'Node.js', 'Python'] },
  { role: 'UI/UX Designer', sector: 'Design', aiVulnerability: 28, skills: ['Figma', 'design thinking', 'prototyping'] },
  { role: 'DevOps Engineer', sector: 'Tech', aiVulnerability: 12, skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD'] },
  { role: 'Full Stack Developer', sector: 'Tech', aiVulnerability: 14, skills: ['React', 'Node.js', 'MongoDB', 'TypeScript'] },
  { role: 'Product Manager', sector: 'Tech', aiVulnerability: 20, skills: ['product strategy', 'Jira', 'analytics', 'leadership'] },
  { role: 'Training Coordinator', sector: 'Education', aiVulnerability: 31, skills: ['training', 'coordination', 'documentation'] },
  { role: 'Business Analyst', sector: 'Consulting', aiVulnerability: 30, skills: ['SQL', 'Excel', 'requirements analysis'] },
  { role: 'Cloud Engineer', sector: 'Tech', aiVulnerability: 10, skills: ['AWS', 'Azure', 'GCP', 'Terraform'] },
  { role: 'Graphic Designer', sector: 'Design', aiVulnerability: 48, skills: ['Photoshop', 'Illustrator', 'Canva'] },
];

const COMPANIES = [
  'TCS', 'Infosys', 'Wipro', 'HCL', 'Tech Mahindra', 'Cognizant',
  'Concentrix', 'Genpact', 'WNS', 'EXL Service', 'Teleperformance',
  'Amazon', 'Flipkart', 'Swiggy', 'Zomato', 'Paytm', 'PhonePe',
  'Deloitte', 'Accenture', 'KPMG', 'PwC', 'EY', 'McKinsey',
  'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Mahindra',
  'Reliance', 'Tata Group', 'Mahindra', 'Bajaj', 'L&T',
];

const AI_KEYWORDS = ['ChatGPT', 'Copilot', 'AI', 'automation', 'machine learning', 'GenAI', 'LLM'];

function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomDate(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - randomBetween(0, daysBack));
  return d;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function seedJobPostings() {
  const text = `INSERT INTO jobs (job_id, title, canonical_role, company, city, sector, skills_list, salary_min, salary_max, posted_date, ai_tool_mentions, ai_mention_rate, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;
  let count = 0;
  for (let i = 0; i < 3000; i++) {
    const roleObj = pick(ROLES);
    const city = pick(CITIES);
    const hasAi = Math.random() < (roleObj.aiVulnerability / 200);
    const aiMentions = hasAi ? AI_KEYWORDS.filter(() => Math.random() > 0.6) : [];
    const title = `${['Senior', 'Junior', '', 'Lead', 'Associate'][randomBetween(0, 4)]} ${roleObj.role}`.trim();
    const jobId = `demo-${Date.now()}-${i}`;

    await pool.query(text, [
      jobId, title, roleObj.role, pick(COMPANIES), city, roleObj.sector,
      `{${roleObj.skills.map(s => `"${s}"`).join(',')}}`,
      randomBetween(15000, 80000), randomBetween(80000, 200000),
      randomDate(120).toISOString(),
      `{${aiMentions.map(s => `"${s}"`).join(',')}}`,
      aiMentions.length > 0 ? Math.round((aiMentions.length / AI_KEYWORDS.length) * 100) : 0,
      'demo',
    ]);
    count++;
  }
  console.log(`Seeded ${count} job postings`);
}

async function seedSkillMentions() {
  const skills = [
    { skill: 'Prompt Engineering', direction: 'rising', wow: 42, hasGov: false },
    { skill: 'AI Quality Review', direction: 'rising', wow: 38, hasGov: false },
    { skill: 'Python for Data', direction: 'rising', wow: 29, hasGov: true },
    { skill: 'Cloud Computing (AWS)', direction: 'rising', wow: 25, hasGov: true },
    { skill: 'Machine Learning', direction: 'rising', wow: 34, hasGov: true },
    { skill: 'LLM Fine-Tuning', direction: 'rising', wow: 31, hasGov: false },
    { skill: 'Computer Vision', direction: 'rising', wow: 22, hasGov: false },
    { skill: 'DevOps/CI-CD', direction: 'rising', wow: 20, hasGov: true },
    { skill: 'React/Next.js', direction: 'rising', wow: 18, hasGov: true },
    { skill: 'Cybersecurity', direction: 'rising', wow: 27, hasGov: true },
    { skill: 'AI-assisted Content Moderation', direction: 'rising', wow: 80, hasGov: false },
    { skill: 'Natural Language Processing', direction: 'rising', wow: 35, hasGov: false },
    { skill: 'Data Engineering', direction: 'rising', wow: 24, hasGov: true },
    { skill: 'Kubernetes/Docker', direction: 'rising', wow: 19, hasGov: false },
    { skill: 'Tableau/Power BI', direction: 'rising', wow: 16, hasGov: true },
    { skill: 'UI/UX Design', direction: 'rising', wow: 15, hasGov: true },
    { skill: 'Product Management', direction: 'rising', wow: 14, hasGov: false },
    { skill: 'Agile/Scrum', direction: 'rising', wow: 12, hasGov: true },
    { skill: 'Salesforce', direction: 'rising', wow: 11, hasGov: true },
    { skill: 'Blockchain', direction: 'rising', wow: 10, hasGov: false },
    { skill: 'Voice Support', direction: 'declining', wow: -31, hasGov: false },
    { skill: 'Data Entry', direction: 'declining', wow: -22, hasGov: false },
    { skill: 'Manual Testing', direction: 'declining', wow: -18, hasGov: false },
    { skill: 'Basic Excel', direction: 'declining', wow: -15, hasGov: false },
    { skill: 'Tally Accounting', direction: 'declining', wow: -12, hasGov: false },
    { skill: 'PHP Development', direction: 'declining', wow: -14, hasGov: false },
    { skill: 'Cold Calling', direction: 'declining', wow: -20, hasGov: false },
    { skill: 'Copy Typing', direction: 'declining', wow: -28, hasGov: false },
    { skill: 'Manual Bookkeeping', direction: 'declining', wow: -16, hasGov: false },
    { skill: 'Traditional SEO', direction: 'declining', wow: -10, hasGov: false },
    { skill: 'Print Media Design', direction: 'declining', wow: -13, hasGov: false },
    { skill: 'Desktop Publishing', direction: 'declining', wow: -17, hasGov: false },
    { skill: 'Telemarketing', direction: 'declining', wow: -25, hasGov: false },
    { skill: 'Filing/Clerical', direction: 'declining', wow: -19, hasGov: false },
    { skill: 'Legacy COBOL', direction: 'declining', wow: -8, hasGov: false },
    { skill: 'Hardware Troubleshooting', direction: 'declining', wow: -9, hasGov: false },
    { skill: 'Network Cabling', direction: 'declining', wow: -7, hasGov: false },
    { skill: 'Shorthand', direction: 'declining', wow: -30, hasGov: false },
    { skill: 'VB.NET', direction: 'declining', wow: -11, hasGov: false },
    { skill: 'Dreamweaver', direction: 'declining', wow: -6, hasGov: false },
  ];

  const mentions = [];
  for (const city of CITIES) {
    for (const s of skills) {
      const variation = randomBetween(-5, 5);
      mentions.push([
        s.skill, city, 'All',
        randomBetween(50, 500),
        s.wow + variation,
        Math.round(s.wow * 3.5 + variation),
        s.direction,
        s.hasGov ? randomBetween(100, 5000) : 0,
        s.hasGov ? JSON.stringify([{ name: `${s.skill} Basics`, provider: 'NPTEL', url: 'https://nptel.ac.in' }]) : '[]',
        s.hasGov,
      ]);
    }
  }
  const text = `INSERT INTO skill_mentions (skill, city, sector, mention_count, week_over_week_change, month_over_month_change, direction, gov_training_seats, gov_courses, has_gov_course)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
  for (const m of mentions) {
    await pool.query(text, m);
  }
  console.log(`Seeded ${mentions.length} skill mentions`);
}

async function seedVulnerabilityScores() {
  const text = `INSERT INTO vulnerability_scores (canonical_role, city, score, risk_band, hiring_decline, ai_mention_rate, displacement_ratio, trend_direction, delta_30d)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
  let count = 0;
  for (const roleObj of ROLES) {
    for (const city of CITIES) {
      const variation = randomBetween(-8, 8);
      const score = Math.max(0, Math.min(100, roleObj.aiVulnerability + variation));
      const delta = randomBetween(-5, 8);
      let riskBand;
      if (score <= 30) riskBand = 'Low';
      else if (score <= 60) riskBand = 'Medium';
      else if (score <= 80) riskBand = 'High';
      else riskBand = 'Critical';
      await pool.query(text, [
        roleObj.role, city, score, riskBand,
        roleObj.aiVulnerability > 60 ? -randomBetween(10, 40) : randomBetween(-5, 20),
        Math.min(100, randomBetween(5, roleObj.aiVulnerability)),
        Math.min(100, randomBetween(0, Math.round(roleObj.aiVulnerability * 0.6))),
        delta > 2 ? 'rising' : delta < -2 ? 'falling' : 'stable',
        delta,
      ]);
      count++;
    }
  }
  console.log(`Seeded ${count} vulnerability scores`);
}

async function seedWatchlistAlerts() {
  const alerts = [
    { canonicalRole: 'BPO Voice Support', city: 'Pune', declineHistory: [{ month: 'Jan 2026', declinePercent: 12 }, { month: 'Feb 2026', declinePercent: 14 }, { month: 'Mar 2026', declinePercent: 18 }], consecutiveDeclineMonths: 3, affectedWorkers: 3200, severity: 'critical' },
    { canonicalRole: 'Data Entry Operator', city: 'Jaipur', declineHistory: [{ month: 'Jan 2026', declinePercent: 10 }, { month: 'Feb 2026', declinePercent: 13 }, { month: 'Mar 2026', declinePercent: 15 }], consecutiveDeclineMonths: 3, affectedWorkers: 1800, severity: 'critical' },
    { canonicalRole: 'BPO Voice Support', city: 'Nagpur', declineHistory: [{ month: 'Feb 2026', declinePercent: 11 }, { month: 'Mar 2026', declinePercent: 16 }], consecutiveDeclineMonths: 2, affectedWorkers: 1200, severity: 'warning' },
    { canonicalRole: 'Customer Support', city: 'Indore', declineHistory: [{ month: 'Jan 2026', declinePercent: 10 }, { month: 'Feb 2026', declinePercent: 12 }, { month: 'Mar 2026', declinePercent: 14 }], consecutiveDeclineMonths: 3, affectedWorkers: 950, severity: 'critical' },
    { canonicalRole: 'Content Moderator', city: 'Bangalore', declineHistory: [{ month: 'Feb 2026', declinePercent: 10 }, { month: 'Mar 2026', declinePercent: 13 }], consecutiveDeclineMonths: 2, affectedWorkers: 600, severity: 'warning' },
    { canonicalRole: 'Accountant', city: 'Lucknow', declineHistory: [{ month: 'Jan 2026', declinePercent: 8 }, { month: 'Feb 2026', declinePercent: 11 }, { month: 'Mar 2026', declinePercent: 10 }], consecutiveDeclineMonths: 3, affectedWorkers: 450, severity: 'warning' },
  ];
  const text = `INSERT INTO watchlist_alerts (canonical_role, city, decline_history, consecutive_decline_months, affected_workers, severity)
    VALUES ($1,$2,$3,$4,$5,$6)`;
  for (const a of alerts) {
    await pool.query(text, [a.canonicalRole, a.city, JSON.stringify(a.declineHistory), a.consecutiveDeclineMonths, a.affectedWorkers, a.severity]);
  }
  console.log(`Seeded ${alerts.length} watchlist alerts`);
}

async function seedCourses() {
  const courses = [
    { name: 'Data Analytics with Python', provider: 'NPTEL', institution: 'IIT Madras', skillCluster: ['Python', 'data analysis', 'analytics'], duration: '8 weeks', hoursPerWeek: 6, totalHours: 48, url: 'https://nptel.ac.in/courses/106106212', level: 'beginner' },
    { name: 'Introduction to Machine Learning', provider: 'NPTEL', institution: 'IIT Kharagpur', skillCluster: ['machine learning', 'Python', 'AI'], duration: '12 weeks', hoursPerWeek: 8, totalHours: 96, url: 'https://nptel.ac.in/courses/106105152', level: 'intermediate' },
    { name: 'Data Science for Engineers', provider: 'NPTEL', institution: 'IIT Madras', skillCluster: ['data analysis', 'Python', 'statistics'], duration: '8 weeks', hoursPerWeek: 6, totalHours: 48, url: 'https://nptel.ac.in/courses/106106179', level: 'beginner' },
    { name: 'Deep Learning', provider: 'NPTEL', institution: 'IIT Ropar', skillCluster: ['deep learning', 'AI', 'neural network', 'Python'], duration: '12 weeks', hoursPerWeek: 8, totalHours: 96, url: 'https://nptel.ac.in/courses/106106184', level: 'advanced' },
    { name: 'Cloud Computing', provider: 'NPTEL', institution: 'IIT Kharagpur', skillCluster: ['cloud', 'AWS', 'Azure', 'GCP'], duration: '8 weeks', hoursPerWeek: 6, totalHours: 48, url: 'https://nptel.ac.in/courses/106105167', level: 'intermediate' },
    { name: 'AI for Everyone', provider: 'SWAYAM', institution: 'IIT Delhi', skillCluster: ['AI', 'ChatGPT', 'automation'], duration: '4 weeks', hoursPerWeek: 4, totalHours: 16, url: 'https://swayam.gov.in/nd2_cec20_cs16/', level: 'beginner' },
    { name: 'Digital Marketing Fundamentals', provider: 'SWAYAM', institution: 'Savitribai Phule Pune University', skillCluster: ['digital marketing', 'SEO', 'social media'], duration: '6 weeks', hoursPerWeek: 4, totalHours: 24, url: 'https://swayam.gov.in/nd2_ugc19_hs22/', level: 'beginner' },
    { name: 'Database Management Systems', provider: 'NPTEL', institution: 'IIT Kharagpur', skillCluster: ['SQL', 'database', 'data management'], duration: '8 weeks', hoursPerWeek: 8, totalHours: 64, url: 'https://nptel.ac.in/courses/106105175', level: 'intermediate' },
    { name: 'Cyber Security', provider: 'NPTEL', institution: 'IIT Kanpur', skillCluster: ['cybersecurity', 'network security', 'ethical hacking'], duration: '8 weeks', hoursPerWeek: 6, totalHours: 48, url: 'https://nptel.ac.in/courses/106104220', level: 'intermediate' },
    { name: 'Web Development with React', provider: 'SWAYAM', institution: 'IGNOU', skillCluster: ['React', 'JavaScript', 'web development', 'HTML', 'CSS'], duration: '8 weeks', hoursPerWeek: 6, totalHours: 48, url: 'https://swayam.gov.in/nd2_ignou20_cs01/', level: 'beginner' },
    { name: 'Digital Marketing with AI Tools', provider: 'PMKVY', institution: 'PMKVY Nagpur Centre', skillCluster: ['digital marketing', 'AI', 'content creation'], duration: '3 weeks', hoursPerWeek: 6, totalHours: 18, modality: 'in-person', centreAddress: 'PMKVY Centre, Wardha Road, Nagpur', city: 'Nagpur', url: 'https://www.pmkvyofficial.org/', level: 'beginner' },
    { name: 'Data Entry and Computer Operator', provider: 'PMKVY', institution: 'PMKVY Jaipur Centre', skillCluster: ['data entry', 'Excel', 'typing'], duration: '4 weeks', hoursPerWeek: 8, totalHours: 32, modality: 'in-person', centreAddress: 'PMKVY Centre, MI Road, Jaipur', city: 'Jaipur', url: 'https://www.pmkvyofficial.org/', level: 'beginner' },
    { name: 'AI Fundamentals', provider: 'SWAYAM', institution: 'IIT Bombay', skillCluster: ['AI', 'machine learning', 'GenAI', 'LLM'], duration: '6 weeks', hoursPerWeek: 4, totalHours: 24, url: 'https://swayam.gov.in/nd2_iitb20_cs01/', level: 'beginner' },
    { name: 'Business Analytics', provider: 'NPTEL', institution: 'IIT Kharagpur', skillCluster: ['business analytics', 'data analysis', 'Excel', 'Tableau'], duration: '8 weeks', hoursPerWeek: 6, totalHours: 48, url: 'https://nptel.ac.in/courses/110105089', level: 'beginner' },
    { name: 'Python for Everybody', provider: 'SWAYAM', institution: 'University of Michigan (translated)', skillCluster: ['Python', 'programming', 'data analysis'], duration: '10 weeks', hoursPerWeek: 4, totalHours: 40, url: 'https://swayam.gov.in/nd2_ugc20_cs06/', level: 'beginner' },
  ];
  const text = `INSERT INTO courses (name, provider, institution, skill_cluster, duration, hours_per_week, total_hours, url, level, modality, centre_address, city)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;
  for (const c of courses) {
    await pool.query(text, [
      c.name, c.provider, c.institution,
      `{${c.skillCluster.map(s => `"${s}"`).join(',')}}`,
      c.duration, c.hoursPerWeek, c.totalHours, c.url, c.level,
      c.modality || 'online', c.centreAddress || null, c.city || null,
    ]);
  }
  console.log(`Seeded ${courses.length} courses`);
}

async function main() {
  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL');
    client.release();

    // Clear existing data
    await pool.query('DELETE FROM worker_profiles');
    await pool.query('DELETE FROM courses');
    await pool.query('DELETE FROM watchlist_alerts');
    await pool.query('DELETE FROM vulnerability_scores');
    await pool.query('DELETE FROM skill_mentions');
    await pool.query('DELETE FROM jobs');
    await pool.query('DELETE FROM aggregates');
    console.log('Cleared existing data');

    await seedJobPostings();
    await seedSkillMentions();
    await seedVulnerabilityScores();
    await seedWatchlistAlerts();
    await seedCourses();

    console.log('\nSeeding complete!');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

main();
