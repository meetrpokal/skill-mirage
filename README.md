# Skills Mirage — AI Displacement Intelligence Platform

Real-time job market intelligence platform that tracks AI-driven labor displacement across India. It scrapes live job data, computes AI vulnerability scores using machine learning, and provides workers with personalized risk assessments and government-backed reskilling pathways.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Data Flow](#data-flow)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Database Schema](#database-schema)
- [Services](#services)
  - [Scraper Service](#1-scraper-service)
  - [Processor Service](#2-processor-service)
  - [Scoring Service (ML)](#3-scoring-service-ml)
  - [Backend API](#4-backend-api)
  - [Frontend](#5-frontend)
  - [ML Model Training](#6-ml-model-training)
- [API Reference](#api-reference)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)

---

## Overview

**Skills Mirage** monitors the Indian labor market to identify which job roles and cities are most vulnerable to AI-driven displacement. The platform operates in two layers:

- **Layer 1 (Macro):** Real-time market-level intelligence — hiring trends, skill demand shifts, and AI vulnerability indexes computed per (role × city) combination.
- **Layer 2 (Micro):** Individual worker risk scoring — a worker submits their profile and receives a personalized AI displacement risk score, SHAP-based explanations, and a reskilling pathway.

---

## Architecture

```
┌──────────────┐       ┌─────────────┐       ┌──────────────────┐
│   Naukri.com │──────▶│   Scraper   │──────▶│     Redis        │
│   (source)   │       │  (Puppeteer)│  pub  │  (pub/sub +      │
└──────────────┘       └─────────────┘  ───▶ │   caching)       │
                                             └───────┬──────────┘
                              ┌───────────────┐      │ subscribe
                              │               │◀─────┤
                              │   Processor   │      │
                              │  (aggregator) │      │ subscribe
                              └──────┬────────┘      │
                                     │               │
                              ┌──────▼────────┐      │
                              │  PostgreSQL   │◀─────┤
                              │  (jobmarket)  │      │
                              └──────┬────────┘      │
                                     │        ┌──────▼──────────┐
                              ┌──────▼──────┐ │ Scoring Service │
                              │   Backend   │ │  (LightGBM +    │
                              │  (Express + │ │   SHAP + FastAPI)│
                              │  Socket.IO) │ └────────┬────────┘
                              └──────┬──────┘          │
                                     │ websocket       │ publish
                                     │          ◀──────┘
                              ┌──────▼──────┐   layer1.scores
                              │  Frontend   │
                              │  (React +   │
                              │   Three.js) │
                              └─────────────┘
```

---

## Data Flow

1. **Scraper** launches headless Chromium, iterates over 17 job categories × 25 Indian cities, scrapes Naukri.com listings, extracts job details (title, company, skills, location, salary, description), and publishes each job as JSON to the Redis channel `layer1.jobs`.

2. **Processor** subscribes to `layer1.jobs`, upserts each job into PostgreSQL, maintains a Redis list of the 50 most recent jobs, and every 5 seconds recomputes aggregates (top skills, cities, companies, total count). Aggregates are persisted to the DB, cached in Redis (300s TTL), and published to `layer1.aggregates`.

3. **Scoring Service** also subscribes to `layer1.jobs`. It batches incoming jobs (up to 50 or every 5s), scores each using the trained LightGBM model (with SHAP explanations), upserts results into the `vulnerability_scores` table, and publishes scored results to `layer1.scores`. Every 30 minutes it recomputes the L1 vulnerability table from the full database.

4. **Backend** (Express + Socket.IO) subscribes to both `layer1.aggregates` and `layer1.scores`. On receiving updates, it emits WebSocket events (`aggregates`, `vulnerability:update`, `dashboard:refresh`) to all connected frontend clients. It also listens for PostgreSQL `NOTIFY` events (triggered on job INSERT) and debounces recomputation of vulnerability scores.

5. **Frontend** (React + Vite) connects via Socket.IO for real-time dashboard updates. It renders hiring trend charts, skill intelligence panels, AI vulnerability heatmaps, an India geographic heatmap (D3 + TopoJSON), a sector/role sunburst chart, a worker risk assessment form, and an AI chatbot.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Scraping** | Node.js 20, Puppeteer (headless Chromium) |
| **Message Bus** | Redis 7 (pub/sub channels + key-value caching) |
| **Processing** | Node.js 20, ioredis, pg |
| **Database** | PostgreSQL 15 (7 tables, triggers, indexes) |
| **ML Scoring** | Python 3.11, LightGBM, SHAP, FastAPI, uvicorn |
| **ML Training** | LightGBM, scikit-learn, SHAP, NLTK, pandas, numpy |
| **Backend API** | Node.js 20, Express, Socket.IO, pg, ioredis |
| **Frontend** | React 19, Vite 7, Three.js, React Three Fiber, D3.js, Recharts, Framer Motion, GSAP, Socket.IO Client |
| **Orchestration** | Docker Compose (7 services) |

---

## Features

### Layer 1 — Market Intelligence Dashboard

- **Hiring Trends:** Time-series area chart showing job posting volume over 7d / 30d / 90d / 1yr, filterable by city, role, and sector. Includes period-over-period change calculation.
- **India Heatmap:** D3 + TopoJSON geographic choropleth showing job density by state, with interactive tooltips.
- **Sector Sunburst:** D3 zoomable sunburst chart breaking down jobs by sector → role, with click-to-zoom drill-down.
- **Skills Intelligence:** Horizontal bar chart of rising skills ranked by mention count, plus an infinite-scroll skill gap map (skills declining without government training coverage).
- **AI Vulnerability Index:** Paginated table of vulnerability scores per (role × city) with risk band badges, live-updated via WebSocket as the ML scoring service processes new jobs.
- **Watchlist Alerts:** Roles/cities with consecutive monthly hiring declines flagged as warning/critical severity.
- **Real-time Updates:** All dashboard data auto-refreshes via Socket.IO events and 30-second polling fallback.

### Layer 2 — Worker Risk Assessment

- **Profile Submission:** Worker enters job title, city, years of experience, and a free-text work description.
- **NLP Skill Extraction:** Backend extracts explicit skills (50+), implicit skills, soft skills, AI readiness indicators, and career aspirations from the write-up.
- **Dual Scoring:**
  - *Rule-based score:* Computed from market vulnerability data + experience adjustment + skill signals.
  - *ML score:* LightGBM prediction with SHAP feature contributions and confidence interval.
- **Risk Gauge:** Animated SVG circular gauge showing 0–100 score with LOW / MODERATE / HIGH / CRITICAL bands.
- **Reskilling Pathway:** Recommends safer target roles in the same city and maps relevant NPTEL / SWAYAM / PMKVY courses with estimated duration.
- **Peer Percentile:** Shows where the worker stands relative to others in the same role × city.

### AI Chatbot

- **5 Response Types:** Explains risk scores, suggests safer alternative roles, generates time-constrained reskilling paths, queries live market data, and handles general questions.
- **Hindi Support:** Detects Devanagari script and responds in Hindi.
- **Worker Profile Linking:** Can be linked to a previously submitted worker profile for personalized responses.

### ML Pipeline

- **Feature Engineering:** 8 features including Base L1 Score, Experience, AI Mentions, Manual Flags, Automation Weight, Theoretical Beta, Role Seniority, Hiring Intensity.
- **L1 Vulnerability Index:** Composite formula — 55% observed AI exposure + 30% theoretical task automation potential + 15% role baseline (inspired by the Anthropic labor-exposure framework).
- **Training:** LightGBM regression with 5-fold cross-validation, monotonic constraints, early stopping. Synthesized targets from deterministic formula + noise.
- **Explainability:** SHAP TreeExplainer provides per-feature contribution breakdowns for every prediction.
- **Deterministic Fallback:** Rule-based scoring available when model artefacts are not loaded.

### UI/UX

- **3D Backgrounds:** Three.js particle systems, floating geometric shapes, and orbit rings rendered via React Three Fiber on every page.
- **Animations:** Framer Motion page transitions, GSAP scroll-triggered reveals, 3D tilt cards on hover, animated counters.
- **Dark Theme:** Full dark mode design with glassmorphism cards and gradient accents.
- **Responsive Navigation:** Mobile hamburger menu with animated transitions.

---

## Database Schema

**7 Tables** in PostgreSQL database `jobmarket`:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `jobs` | Scraped job postings | `job_id` (PK), `title`, `canonical_role`, `company`, `city`, `state`, `skills_list`, `salary_min/max`, `posted_date`, `ai_mention_rate` |
| `aggregates` | Computed market aggregates | `agg_type`, `agg_key`, `agg_value` |
| `skill_mentions` | Skill trending/declining data | `skill`, `city`, `mention_count`, `week_over_week_change`, `direction`, `gov_courses` |
| `vulnerability_scores` | AI vulnerability per role × city | `canonical_role`, `city`, `score`, `risk_band`, `ai_mention_rate`, `top_features` |
| `watchlist_alerts` | High-risk role/city alerts | `canonical_role`, `city`, `consecutive_decline_months`, `severity` |
| `courses` | Government reskilling courses | `name`, `provider` (NPTEL/SWAYAM/PMKVY), `skill_cluster`, `duration`, `url` |
| `worker_profiles` | Individual worker assessments | `job_title`, `canonical_role`, `city`, `extracted_skills`, `risk_score`, `reskilling_path` |

A PG trigger (`trg_jobs_notify`) fires on every job INSERT, sending a `NOTIFY` on the `new_data` channel to prompt real-time recomputation.

---

## Services

### 1. Scraper Service

**Location:** `scraper-service/`  
**Runtime:** Node.js 20 + Puppeteer (headless Chromium)

- Scrapes Naukri.com across 17 job categories and 25 Indian cities
- Rotates through 10 user-agent strings to avoid detection
- Rate-limited with configurable delay between requests (default 800ms)
- Deduplicates by `job_id` and `title + company`
- Extracts detail pages for enrichment (JSON-LD parsing, full description, salary)
- Publishes normalized job JSON to Redis channel `layer1.jobs`
- Configurable scrape interval (default 10 minutes)

### 2. Processor Service

**Location:** `processor-service/`  
**Runtime:** Node.js 20

- Subscribes to Redis `layer1.jobs`
- Upserts each job into PostgreSQL `jobs` table
- Maintains `layer1:recent_jobs` Redis list (last 50 jobs)
- Every 5 seconds recomputes aggregates: top 15 skills, top 10 cities, top 10 companies, total job count
- Persists aggregates to DB, caches in Redis (300s TTL), publishes to `layer1.aggregates`

### 3. Scoring Service (ML)

**Location:** `scoring-service/`  
**Runtime:** Python 3.11, FastAPI, LightGBM

- Subscribes to Redis `layer1.jobs`, batches incoming jobs (50 or every 5s)
- Scores each job using the trained LightGBM model with SHAP explanations
- Falls back to deterministic scoring if model artefacts aren't available
- Upserts results into `vulnerability_scores` table
- Publishes scored results to Redis `layer1.scores`
- Every 30 minutes recomputes L1 vulnerability table from database
- Exposes REST endpoints: `POST /score` (on-demand scoring), `GET /health`

### 4. Backend API

**Location:** `backend/`  
**Runtime:** Node.js 20, Express, Socket.IO

REST API gateway with real-time event relay:

- Subscribes to Redis channels `layer1.aggregates` and `layer1.scores`
- Emits Socket.IO events to frontend on data updates
- Listens for PostgreSQL `NOTIFY` events with 8s debounce
- 5-minute fallback recomputation interval
- NLP service for skill extraction and role normalization
- Vulnerability recomputation engine (weighted formula: 40% decline signal + 35% AI mention rate + 25% displacement ratio)
- Data seeding (3000 demo jobs, 40 skills × 37 cities, 20 roles, watchlist alerts, courses)
- Live simulator (1 random job insert every 30 seconds)

### 5. Frontend

**Location:** `frontend/`  
**Runtime:** React 19 + Vite 7

4 pages with immersive 3D visual design:

| Route | Page | Description |
|-------|------|-------------|
| `/` | Landing | 3D hero with animated sphere, particle system, scrolling ticker, feature cards, stats counters |
| `/dashboard` | Dashboard | 3 tabs (Hiring Trends, Skills Intelligence, AI Vulnerability) with charts, heatmap, sunburst |
| `/worker` | Risk Score | Profile form → dual scoring (rule-based + ML) → gauge, skills, signals, reskilling path |
| `/chatbot` | AI Chat | Conversational interface with Hindi support, suggestions, worker profile linking |

### 6. ML Model Training

**Location:** `Model/`  
**Runtime:** Python 3.11

- `pipeline.py` — End-to-end data ingestion, cleaning, feature engineering, L1 AI Vulnerability Index computation from raw Naukri CSV data
- `trainer.py` — Trains LightGBM regression model with 5-fold CV, monotonic constraints, synthesized targets. Saves artefacts (model, SHAP explainer, feature names) to `artefacts/`
- `scoring_api.py` — Personal AI Risk Scoring API with model-based and deterministic fallback modes, batch scoring, SHAP explanations, reskilling recommendations
- `Main_Naukri.csv` — Raw scraped job data used for training

---

## API Reference

### Hiring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hiring/trends` | Time-series hiring data (filterable by city, role, sector, range) |
| GET | `/api/hiring/summary` | Current vs previous period comparison with % change |
| GET | `/api/hiring/cities` | List of all cities in the database |
| GET | `/api/hiring/roles` | List of all canonical roles |
| GET | `/api/hiring/sectors` | List of all sectors |
| GET | `/api/hiring/count` | Total job count with optional filters |
| GET | `/api/hiring/by-state` | Job count grouped by state (for India heatmap) |
| GET | `/api/hiring/hierarchy` | Nested sector → role → count data (for sunburst chart) |

### Skills

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills/trending` | Rising/declining skills with week-over-week change |
| GET | `/api/skills/gap` | Skills without government course coverage |

### Vulnerability

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vulnerability/scores` | Paginated vulnerability scores per role × city |
| GET | `/api/vulnerability/heatmap` | Distinct vulnerability scores for heatmap visualization |
| GET | `/api/vulnerability/methodology` | Explanation of the scoring formula |
| POST | `/api/vulnerability/score` | Proxy to ML scoring service for on-demand scoring |

### Worker

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/worker/profile` | Submit worker profile → NLP extraction → risk scoring → reskilling path |
| GET | `/api/worker/profile/:id` | Retrieve a previously submitted worker profile |

### Chatbot

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chatbot/message` | Send message, receive AI-generated response (English/Hindi) |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/aggregates` | Latest cached aggregates from Redis |
| GET | `/api/jobs` | Recent jobs from Redis |
| GET | `/api/jobs/search` | Search jobs by keyword/city/role |
| POST | `/api/refresh` | Manually trigger full recomputation |
| GET | `/api/health` | Health check |

### Scoring Service (port 5000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/score` | Score a worker profile (returns risk score, SHAP features, reskilling) |
| GET | `/health` | Service health + model status |

---

## Getting Started

### Prerequisites

- Docker & Docker Compose
- (Optional) Node.js 20+ and Python 3.11+ for local development

### Run with Docker Compose

```bash
# Clone the repository
git clone <repository-url>
cd hackamind

# Start all services
docker compose up --build

# Services will be available at:
#   Frontend:  http://localhost:3000
#   Backend:   http://localhost:4000
#   Scoring:   http://localhost:5000
#   Postgres:  localhost:5433
#   Redis:     localhost:6379
```

### Seed Demo Data

```bash
# After services are running, seed the database with demo data
docker compose exec backend node seed/seedData.js

# Start live data simulator (1 job every 30 seconds)
docker compose exec backend node seed/simulate.js
```

### Train the ML Model (optional)

```bash
cd Model

# Install Python dependencies
pip install lightgbm shap scikit-learn pandas numpy nltk joblib

# Run the pipeline to compute L1 vulnerability index
python pipeline.py --csv Main_Naukri.csv

# Train the LightGBM model and save artefacts
python trainer.py --csv Main_Naukri.csv --save
```

---

## Environment Variables

### Scraper Service

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `SCRAPE_CITIES` | 25 Indian cities | Comma-separated list of cities to scrape |
| `SCRAPE_PAGES` | `2` | Pages to scrape per query × city |
| `SCRAPE_INTERVAL` | `600` | Seconds between scrape cycles |
| `RATE_LIMIT_MS` | `800` | Milliseconds between HTTP requests |
| `SCRAPE_QUERIES` | 17 categories | Comma-separated job search queries |

### Processor Service

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `DATABASE_URL` | `postgres://mirage:mirage123@localhost:5432/jobmarket` | PostgreSQL connection string |

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `DATABASE_URL` | `postgres://mirage:mirage123@localhost:5432/jobmarket` | PostgreSQL connection string |
| `PORT` | `4000` | Express server port |
| `SCORING_SERVICE_URL` | `http://scoring:5000` | URL of the ML scoring service |

### Scoring Service

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `DATABASE_URL` | `postgres://mirage:mirage123@localhost:5432/jobmarket` | PostgreSQL connection string |
| `SCORING_BATCH_SIZE` | `50` | Jobs to batch before scoring |
| `SCORING_FLUSH_INTERVAL` | `5` | Seconds before force-flushing batch |
| `L1_RECOMPUTE_INTERVAL` | `1800` | Seconds between L1 table recomputation |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:4000/api` | Backend API base URL |

---

## Project Structure

```
hackamind/
├── docker-compose.yml          # Orchestrates all 7 services
├── init.sql                    # PostgreSQL schema (7 tables, indexes, triggers)
├── README.md
│
├── scraper-service/            # Naukri.com web scraper
│   ├── Dockerfile
│   ├── package.json
│   └── scraper.js              # Puppeteer scraping logic (~680 lines)
│
├── processor-service/          # Job ingestion & aggregate computation
│   ├── Dockerfile
│   ├── package.json
│   └── processor.js            # Redis subscriber + PostgreSQL writer
│
├── scoring-service/            # ML scoring microservice
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── service.py              # FastAPI app + Redis subscriber + LightGBM scoring
│   └── pipeline_utils.py       # Feature extraction utilities
│
├── backend/                    # Express REST API + Socket.IO
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js               # App entry point, routes, WebSocket relay
│   ├── db/
│   │   └── index.js            # PostgreSQL pool + Redis client exports
│   ├── routes/
│   │   ├── hiring.js           # Hiring trends, summary, by-state, hierarchy
│   │   ├── skills.js           # Trending skills, skill gaps
│   │   ├── vulnerability.js    # Vulnerability scores, heatmap, methodology
│   │   ├── worker.js           # Worker profile submission + risk scoring
│   │   ├── chatbot.js          # AI chatbot with Hindi support
│   │   ├── watchlist.js        # Active watchlist alerts
│   │   └── refresh.js          # Manual recomputation trigger
│   ├── services/
│   │   ├── recompute.js        # Vulnerability score recomputation engine
│   │   └── nlp.js              # NLP skill extraction + role normalization
│   └── seed/
│       ├── seedData.js         # Seeds 3000 jobs, skills, scores, alerts, courses
│       └── simulate.js         # Live data simulator (1 job / 30 seconds)
│
├── frontend/                   # React SPA with 3D visuals
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── public/
│   │   └── india-topo.json     # TopoJSON for India state boundaries
│   └── src/
│       ├── main.jsx            # React entry point
│       ├── App.jsx             # Router (4 routes)
│       ├── api.js              # Axios API client (all endpoints)
│       ├── socket.js           # Socket.IO client
│       ├── components/
│       │   ├── Navbar.jsx      # Responsive navigation bar
│       │   ├── IndiaHeatmap.jsx # D3 choropleth map of India
│       │   └── JobSunburst.jsx  # D3 zoomable sunburst chart
│       └── pages/
│           ├── Landing.jsx     # 3D hero landing page
│           ├── Dashboard.jsx   # Market intelligence dashboard (3 tabs)
│           ├── WorkerProfile.jsx # Worker risk assessment form
│           └── Chatbot.jsx     # AI chatbot interface
│
└── Model/                      # ML training pipeline
    ├── Main_Naukri.csv         # Raw training data
    ├── pipeline.py             # Data cleaning + L1 vulnerability computation
    ├── trainer.py              # LightGBM model training with 5-fold CV
    ├── scoring_api.py          # Scoring API with SHAP explanations
    └── artefacts/              # Trained model files
        ├── lgb_risk_model.pkl
        ├── shap_explainer.pkl
        └── feature_names.pkl
```
