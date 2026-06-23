import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const api = axios.create({ baseURL: API_BASE });

// Layer 1 - Hiring
export const getHiringTrends = (params) => api.get('/hiring/trends', { params });
export const getHiringSummary = (params) => api.get('/hiring/summary', { params });
export const getCities = () => api.get('/hiring/cities');
export const getRoles = () => api.get('/hiring/roles');
export const getSectors = () => api.get('/hiring/sectors');
export const getHiringCount = (params) => api.get('/hiring/count', { params });
export const getJobsByState = (params) => api.get('/hiring/by-state', { params });
export const getJobHierarchy = (params) => api.get('/hiring/hierarchy', { params });

// Layer 1 - Skills
export const getTrendingSkills = (params) => api.get('/skills/trending', { params });
export const getSkillGaps = (params) => api.get('/skills/gap', { params });

// Layer 1 - Vulnerability
export const getVulnerabilityScores = (params) => api.get('/vulnerability/scores', { params });
export const getVulnerabilityHeatmap = () => api.get('/vulnerability/heatmap');
export const getMethodology = () => api.get('/vulnerability/methodology');

// Layer 1 - Watchlist
export const getWatchlistAlerts = () => api.get('/watchlist');

// ML Scoring
export const getMLScore = (data) => api.post('/vulnerability/score', data);

// Layer 2 - Worker
export const submitWorkerProfile = (data) => api.post('/worker/profile', data);
export const getWorkerProfile = (id) => api.get(`/worker/profile/${id}`);

// Chatbot
export const sendChatMessage = (data) => api.post('/chatbot/message', data);
export const sendAIChat = (data) => api.post('/chatbot/chat', data);
export const generateReskillPlan = (data) => api.post('/chatbot/plan', data);

// Auth
export const signup = (data) => api.post('/auth/signup', data);
export const login = (data) => api.post('/auth/login', data);
export const getMe = (id) => api.get(`/auth/me/${id}`);
export const getDropdownJobTitles = () => api.get('/auth/dropdown/job-titles');
export const getDropdownCities = () => api.get('/auth/dropdown/cities');
export const getDropdownSkills = () => api.get('/auth/dropdown/skills');

// Refresh
export const triggerRefresh = () => api.post('/refresh');

// Aggregates (from scraper pipeline)
export const getAggregates = () => api.get('/aggregates');
export const getRecentJobs = () => api.get('/jobs');
export const searchJobs = (params) => api.get('/jobs/search', { params });

export default api;
