# SplitSmart — Shared Expenses App

Built for the Spreetail SDE Internship assignment.

## Live Demo
- App: https://split-smart-nine-rho.vercel.app
- API: https://splitsmart-production-6c7b.up.railway.app

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Database | PostgreSQL (Neon) |
| Query builder | Knex.js |
| Auth | JWT + bcryptjs |
| CSV parsing | csv-parse + multer |
| Frontend deploy | Vercel |
| Backend deploy | Railway |

## Local Setup

### Prerequisites
- Node.js 18+
- A PostgreSQL database (Neon free tier recommended)

### Backend
  cd server
  cp .env.example .env
  # Fill in DATABASE_URL, JWT_SECRET, CLIENT_URL
  npm install
  npm run migrate
  npm run dev
  # Server runs on http://localhost:5000

### Frontend
  cd client
  cp .env.example .env
  # Set VITE_API_URL=http://localhost:5000/api
  npm install
  npm run dev
  # Client runs on http://localhost:5173

## Seeding test users
  Register via POST /api/auth/register for each user.
  Create a group, add members with correct joined_at dates:
    Aisha, Rohan, Priya — joined 2026-02-01
    Meera — joined 2026-02-01, left 2026-03-31
    Sam — joined 2026-04-08

## Importing the CSV
  1. Log in as any user
  2. Open the group → Import CSV tab
  3. Upload expenses_export.csv
  4. Set USD rate (83.50 recommended)
  5. Review the anomaly report
  6. Resolve the 2 conflicting entries (Thalassa dinner)
  7. Confirm import

## AI Tools Used
See AI_USAGE.md
