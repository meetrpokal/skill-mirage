// NLP utilities for skill extraction and role normalisation

const ROLE_MAP = {
  'bpo': 'BPO Voice Support',
  'bpo voice': 'BPO Voice Support',
  'bpo executive': 'BPO Voice Support',
  'customer support': 'Customer Support',
  'customer service': 'Customer Support',
  'call center': 'BPO Voice Support',
  'data entry': 'Data Entry Operator',
  'data analyst': 'Data Analyst',
  'data science': 'Data Scientist',
  'software engineer': 'Software Engineer',
  'software developer': 'Software Engineer',
  'web developer': 'Web Developer',
  'full stack': 'Full Stack Developer',
  'frontend': 'Frontend Developer',
  'backend': 'Backend Developer',
  'ai content reviewer': 'AI Content Reviewer',
  'content moderator': 'Content Moderator',
  'digital marketing': 'Digital Marketing',
  'hr': 'HR Executive',
  'human resource': 'HR Executive',
  'accountant': 'Accountant',
  'accounts': 'Accountant',
  'tally': 'Accountant',
  'sales': 'Sales Executive',
  'training coordinator': 'Training Coordinator',
  'project manager': 'Project Manager',
  'quality analyst': 'Quality Analyst',
  'qa': 'Quality Analyst',
  'testing': 'QA Engineer',
  'devops': 'DevOps Engineer',
  'cloud': 'Cloud Engineer',
  'product manager': 'Product Manager',
  'ui designer': 'UI/UX Designer',
  'ux designer': 'UI/UX Designer',
  'graphic designer': 'Graphic Designer',
  'business analyst': 'Business Analyst',
  'supply chain': 'Supply Chain Manager',
  'logistics': 'Logistics Coordinator',
};

const EXPLICIT_SKILLS = [
  'excel', 'python', 'java', 'javascript', 'react', 'node', 'sql', 'mongodb',
  'tableau', 'power bi', 'sap', 'tally', 'salesforce', 'chatgpt', 'copilot',
  'midjourney', 'dall-e', 'gemini', 'claude', 'tensorflow', 'pytorch',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'git', 'linux',
  'figma', 'photoshop', 'illustrator', 'canva', 'html', 'css',
  'typescript', 'angular', 'vue', 'django', 'flask', 'spring boot',
  'c++', 'c#', 'rust', 'go', 'kotlin', 'swift', 'php', 'ruby',
  'r programming', 'matlab', 'spss', 'stata', 'hadoop', 'spark',
];

const IMPLICIT_SKILL_MAP = {
  'report': 'data analysis',
  'sla': 'SLA management',
  'dashboard': 'data visualization',
  'excel sheet': 'Excel proficiency',
  'spreadsheet': 'spreadsheet management',
  'presentation': 'presentation skills',
  'client call': 'client communication',
  'escalat': 'escalation handling',
  'billing': 'billing operations',
  'invoice': 'invoice processing',
  'payroll': 'payroll management',
  'recruit': 'recruitment',
  'interview': 'interviewing',
  'train': 'training delivery',
  'onboard': 'onboarding',
  'code review': 'code review',
  'deploy': 'deployment',
  'debug': 'debugging',
  'api': 'API development',
  'database': 'database management',
  'testing': 'software testing',
  'automat': 'process automation',
  'script': 'scripting',
  'analy': 'analytical thinking',
  'research': 'research skills',
};

const SOFT_SKILLS_KEYWORDS = {
  'lead': 'leadership',
  'team': 'team management',
  'mentor': 'mentoring',
  'communicat': 'communication',
  'negotiat': 'negotiation',
  'problem solv': 'problem solving',
  'critical think': 'critical thinking',
  'time manage': 'time management',
  'organiz': 'organization',
  'collaborat': 'collaboration',
  'adapt': 'adaptability',
  'creative': 'creativity',
  'presentation': 'presentation',
  'conflict': 'conflict resolution',
  'decision': 'decision making',
};

const AI_READINESS_KEYWORDS = ['chatgpt', 'ai', 'copilot', 'machine learning', 'genai', 'llm', 'automation', 'gemini', 'claude', 'midjourney', 'dall-e', 'artificial intelligence', 'deep learning', 'neural network', 'prompt engineering'];

const ASPIRATION_KEYWORDS = ['want to', 'aspire', 'goal', 'dream', 'move into', 'transition', 'become', 'future', 'plan to', 'looking for', 'interested in', 'hoping to', 'stable', 'growth', 'better role'];

export function normaliseRole(title) {
  const lower = title.toLowerCase().trim();
  for (const [key, value] of Object.entries(ROLE_MAP)) {
    if (lower.includes(key)) return value;
  }
  // Return title-cased input as fallback
  return title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

export function extractSkills(writeUp) {
  const lower = writeUp.toLowerCase();

  const explicit = EXPLICIT_SKILLS.filter(s => lower.includes(s));

  const implicit = [];
  for (const [keyword, skill] of Object.entries(IMPLICIT_SKILL_MAP)) {
    if (lower.includes(keyword) && !implicit.includes(skill)) implicit.push(skill);
  }

  const soft = [];
  for (const [keyword, skill] of Object.entries(SOFT_SKILLS_KEYWORDS)) {
    if (lower.includes(keyword) && !soft.includes(skill)) soft.push(skill);
  }

  const aiReadiness = AI_READINESS_KEYWORDS.filter(k => lower.includes(k));

  const aspirations = [];
  for (const keyword of ASPIRATION_KEYWORDS) {
    const idx = lower.indexOf(keyword);
    if (idx !== -1) {
      const snippet = writeUp.substring(idx, Math.min(idx + 80, writeUp.length));
      aspirations.push(snippet);
    }
  }

  return { explicit, implicit, soft, aiReadiness, aspirations };
}
