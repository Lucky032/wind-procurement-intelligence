# Wind Procurement Intelligence

## Overview
A data-driven MVP for UK wind energy procurement intelligence using Elexon BMRS data.

This application compares wind generation forecasts with actual generation and calculates forecast error metrics to support procurement decisions.

## Features
- Wind generation forecast vs actual comparison
- Date-range analysis
- Mean Absolute Error (MAE)
- Root Mean Squared Error (RMSE)
- Forecast bias
- Interactive dashboard
- FastAPI backend
- Docker deployment

## Technology Stack
- Frontend: React, Vite, Recharts
- Backend: Python, FastAPI
- Data Source: Elexon BMRS
- Containerization: Docker, Docker Compose

## Run Locally with Docker

Run this command from the project root directory:

```bash
docker compose up --build -d
```

Dashboard: http://localhost:3000

API health check: http://localhost:8000/api/health

API documentation: http://localhost:8000/docs

## Analysis Period
January 1–31, 2026.

## Limitations
Forecast accuracy depends on data availability, forecast publication timing, timestamp alignment, and aggregation methodology. Validate these assumptions before using the results for live procurement decisions.

## Project Status
Minimum Viable Product (MVP).

## Author
Lucky Karnam
