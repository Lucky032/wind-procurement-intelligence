
# backend/main.py

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from math import sqrt

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(title="Wind Procurement Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
LONDON = ZoneInfo("Europe/London")
UTC = ZoneInfo("UTC")

REQUEST_TIMEOUT = 25
SUPPORTED_START = date(2026, 1, 1)
SUPPORTED_END = date(2026, 1, 31)


def fetch_dataset(dataset: str, start: str, end: str):
    """Fetch records from an Elexon BMRS dataset stream."""
    url = f"{BASE_URL}/datasets/{dataset}/stream"

    if dataset == "FUELHH":
        end_datetime = datetime.fromisoformat(
            end.replace("Z", "+00:00")
        )

        params = {
            "settlementDateFrom": start[:10],
            "settlementDateTo": (
                end_datetime - timedelta(days=1)
            ).date().isoformat(),
        }
    else:
        params = {
            "publishDateTimeFrom": start,
            "publishDateTimeTo": end,
        }

    response = requests.get(
        url,
        params=params,
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    payload = response.json()

    if isinstance(payload, dict):
        payload = payload.get(
            "data",
            payload.get("results", []),
        )

    if not isinstance(payload, list):
        raise ValueError(
            f"Unexpected response from {dataset}"
        )

    return payload


def as_utc(value):
    """Convert an ISO datetime to UTC; return None if invalid."""
    if not value or not isinstance(value, str):
        return None

    try:
        parsed = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=LONDON)

    return parsed.astimezone(UTC)


def get_date_range(start_date: date, end_date: date):
    """Convert the selected London delivery dates into a UTC window."""
    start = datetime.combine(
        start_date,
        time.min,
        tzinfo=LONDON,
    ).astimezone(UTC)

    end = datetime.combine(
        end_date + timedelta(days=1),
        time.min,
        tzinfo=LONDON,
    ).astimezone(UTC)

    return start, end


def parse_generation(value):
    """Convert a generation value to float when possible."""
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def collect_half_hourly_actuals(rows, start, end):
    """
    Collect wind actuals by their original half-hour timestamp.
    Duplicate timestamps are ignored after the first valid value.
    """
    actuals = {}

    for row in rows:
        if str(row.get("fuelType", "")).upper() != "WIND":
            continue

        ts = as_utc(row.get("startTime"))
        generation = parse_generation(row.get("generation"))

        if ts is None or generation is None:
            continue

        if not (start <= ts < end):
            continue

        actuals.setdefault(ts, generation)

    return actuals


def aggregate_actuals_hourly(half_hour_actuals):
    """
    Average two half-hour actual readings within each UTC hour.

    Hours with fewer than two readings are excluded so that an
    incomplete hour is not incorrectly treated as a full-hour average.
    This assumes FUELHH generation values are comparable MW readings.
    """
    grouped = {}

    for ts, generation in half_hour_actuals.items():
        hour = ts.replace(
            minute=0,
            second=0,
            microsecond=0,
        )

        grouped.setdefault(hour, []).append(
            (ts.minute, generation)
        )

    hourly_actuals = {}
    incomplete_hours = 0

    for hour, readings in grouped.items():
        # Require readings at both :00 and :30.
        minutes_present = {
            minute for minute, _ in readings
        }

        if (
            len(readings) != 2
            or minutes_present != {0, 30}
        ):
            incomplete_hours += 1
            continue

        hourly_actuals[hour] = (
            sum(value for _, value in readings) / 2
        )

    return hourly_actuals, incomplete_hours


def collect_eligible_forecasts(rows, start, end):
    """
    Select the latest forecast published before the assumed
    day-ahead cutoff of 10:00 Europe/London on the previous day.
    """
    forecasts = {}

    for row in rows:
        ts = as_utc(row.get("startTime"))
        published = as_utc(row.get("publishTime"))
        generation = parse_generation(row.get("generation"))

        if (
            ts is None
            or published is None
            or generation is None
        ):
            continue

        if not (start <= ts < end):
            continue

        delivery_local = ts.astimezone(LONDON)

        cutoff_local = datetime.combine(
            delivery_local.date() - timedelta(days=1),
            time(10, 0),
            tzinfo=LONDON,
        )
        cutoff = cutoff_local.astimezone(UTC)

        if published > cutoff:
            continue

        previous = forecasts.get(ts)

        if (
            previous is None
            or published > previous["published"]
        ):
            forecasts[ts] = {
                "generation": generation,
                "published": published,
            }

    return forecasts


def calculate_metrics(points):
    """Calculate MAE, RMSE and forecast bias."""
    errors = [point["error"] for point in points]
    absolute_errors = [
        point["absoluteError"] for point in points
    ]

    count = len(points)

    return {
        "matchedPeriods": count,
        "mae": sum(absolute_errors) / count,
        "rmse": sqrt(
            sum(error ** 2 for error in errors) / count
        ),
        "bias": sum(errors) / count,
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "Wind Procurement Intelligence",
    }


@app.get("/api/debug")
def debug():
    """Inspect raw API response counts and sample records."""
    start = "2026-01-01T00:00:00Z"
    end = "2026-02-01T00:00:00Z"

    try:
        actual_rows = fetch_dataset(
            "FUELHH",
            start,
            end,
        )

        forecast_start = (
            datetime.fromisoformat(
                start.replace("Z", "+00:00")
            ) - timedelta(days=1)
        ).isoformat().replace("+00:00", "Z")

        forecast_rows = fetch_dataset(
            "WINDFOR",
            forecast_start,
            end,
        )

        return {
            "actual_count": len(actual_rows),
            "forecast_count": len(forecast_rows),
            "actual_sample": actual_rows[:3],
            "forecast_sample": forecast_rows[:3],
        }

    except (
        requests.RequestException,
        ValueError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Elexon API request failed: {exc}",
        ) from exc


@app.get("/api/wind-analysis")
def wind_analysis(
    start_date: date = Query(
        default=date(2026, 1, 1)
    ),
    end_date: date = Query(
        default=date(2026, 1, 31)
    ),
):
    """Compare day-ahead wind forecasts with hourly actual generation."""

    if start_date > end_date:
        raise HTTPException(
            status_code=400,
            detail="start_date must not be after end_date.",
        )

    if (
        start_date < SUPPORTED_START
        or end_date > SUPPORTED_END
    ):
        raise HTTPException(
            status_code=400,
            detail="This MVP supports January 2026 only.",
        )

    start, end = get_date_range(
        start_date,
        end_date,
    )

    from_param = start.isoformat().replace(
        "+00:00",
        "Z",
    )
    to_param = end.isoformat().replace(
        "+00:00",
        "Z",
    )

    # Forecasts for the first delivery day may have been
    # published on the previous calendar day.
    forecast_start = start - timedelta(days=1)
    forecast_from_param = forecast_start.isoformat().replace(
        "+00:00",
        "Z",
    )

    try:
        actual_rows = fetch_dataset(
            "FUELHH",
            from_param,
            to_param,
        )

        forecast_rows = fetch_dataset(
            "WINDFOR",
            forecast_from_param,
            to_param,
        )

    except (
        requests.RequestException,
        ValueError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Elexon API request failed: {exc}",
        ) from exc

    # 1. Read half-hourly wind actuals.
    half_hour_actuals = collect_half_hourly_actuals(
        actual_rows,
        start,
        end,
    )

    # 2. Aggregate complete pairs into hourly averages.
    actuals, incomplete_hours = aggregate_actuals_hourly(
        half_hour_actuals
    )

    # 3. Select forecasts available before the cutoff.
    forecasts = collect_eligible_forecasts(
        forecast_rows,
        start,
        end,
    )

    # 4. Match actuals and forecasts by hourly timestamp.
    points = []

    for ts, actual in sorted(actuals.items()):
        forecast = forecasts.get(ts)

        if forecast is None:
            continue

        predicted = forecast["generation"]
        error = predicted - actual

        points.append({
            "startTime": ts.isoformat(),
            "publishTime": forecast["published"].isoformat(),
            "actual": actual,
            "forecast": predicted,
            "error": error,
            "absoluteError": abs(error),
        })

    response_data = {
        "points": points,
        "actualRecords": len(half_hour_actuals),
        "hourlyActualPeriods": len(actuals),
        "incompleteActualHours": incomplete_hours,
        "forecastPeriods": len(forecasts),
        "requestedStart": start.isoformat(),
        "requestedEndExclusive": end.isoformat(),
        "cutoffRule": (
            "Assumption: 10:00 Europe/London "
            "on the day before delivery"
        ),
        "actualAggregation": (
            "Hourly mean of two half-hourly readings; "
            "incomplete hours excluded"
        ),
    }

    if not points:
        response_data.update({
            "metrics": None,
            "message": (
                "No matched hourly data returned. Check Elexon "
                "responses, timestamp alignment, data coverage, "
                "and the assumed forecast cutoff."
            ),
        })

        return response_data

    # 5. Calculate accuracy metrics from matched hourly periods.
    response_data["metrics"] = calculate_metrics(points)

    return response_data
