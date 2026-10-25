@'
# Wind Procurement Intelligence

## Overview
A data-driven MVP for UK wind energy procurement intelligence using Elexon BMRS data.

The application compares wind generation forecasts with actual generation and calculates forecast error metrics to support procurement decisions.

## Features
- Wind generation forecast vs actual comparison
- Date-range analysis
- Mean Absolute Error (MAE)
- Root Mean Squared Error (RMSE)
- Forecast bias
- Interactive React dashboard
- FastAPI backend
- Docker Compose deployment

## Tech Stack
- Frontend: React, Vite, Recharts
- Backend: Python, FastAPI
- Data Source: Elexon BMRS
- Deployment: Docker, Docker Compose

## Run with Docker

```bash
docker compose up --build -d