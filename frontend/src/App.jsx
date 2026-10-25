
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wind,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || ""
).replace(/\/+$/, "");

const DEFAULT_START = "2026-01-01";
const DEFAULT_END = "2026-01-31";
const MIN_DATE = "2026-01-01";
const MAX_DATE = "2026-01-31";
const TABLE_PAGE_SIZE = 25;

const numberFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 1,
});

function formatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }

  return numberFormatter.format(Number(value));
}

function formatDateTime(value, includeDate = true) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-GB", {
    ...(includeDate
      ? { day: "2-digit", month: "short", year: "numeric" }
      : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function MetricCard({ title, value, unit, icon: Icon, tone = "teal" }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className="metric-label">{title}</span>
        <span className={`metric-icon ${tone}`}>
          <Icon size={19} />
        </span>
      </div>

      <div className="metric-value">{value}</div>
      <p className="metric-unit">{unit}</p>
    </article>
  );
}

function LoadingPanel() {
  return (
    <div className="loading-panel">
      <span className="spinner" />
      <div>
        <strong>Loading wind analysis</strong>
        <p>Fetching actual generation and forecast records...</p>
      </div>
    </div>
  );
}

function EmptyPanel({ children }) {
  return (
    <div className="empty-panel">
      <Activity size={25} />
      <p>{children}</p>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [start, setStart] = useState(DEFAULT_START);
  const [end, setEnd] = useState(DEFAULT_END);

  const [page, setPage] = useState(0);
  const [chartMode, setChartMode] = useState("all");

  const loadData = useCallback(async () => {
    if (!start || !end) {
      setError("Please select both delivery dates.");
      return;
    }

    if (start < MIN_DATE || end > MAX_DATE || start > end) {
      setError("Select a valid date range within January 2026.");
      return;
    }

    setLoading(true);
    setError("");
    setPage(0);

    try {
      const params = new URLSearchParams({
        start_date: start,
        end_date: end,
      });

      const response = await fetch(
        `${API_BASE_URL}/api/wind-analysis?${params.toString()}`
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.detail ||
            result.message ||
            `Request failed with status ${response.status}.`
        );
      }

      setData(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load analysis. Check the backend connection."
      );
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const metrics = data?.metrics ?? {};

  const points = useMemo(() => {
    return (data?.points ?? [])
      .map((point) => {
        const timestamp = point.startTime
          ? new Date(point.startTime).getTime()
          : NaN;

        return {
          ...point,
          timestamp,
          timeLabel: formatDateTime(point.startTime, false),
          dateLabel: formatDateTime(point.startTime, true),
          actual: Number(point.actual),
          forecast: Number(point.forecast),
          error:
            point.error !== null && point.error !== undefined
              ? Number(point.error)
              : Number(point.forecast) - Number(point.actual),
        };
      })
      .filter(
        (point) =>
          Number.isFinite(point.timestamp) &&
          Number.isFinite(point.actual) &&
          Number.isFinite(point.forecast)
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [data]);

  const chartData = useMemo(() => {
    if (chartMode === "daily") {
      const daily = new Map();

      for (const point of points) {
        const dateKey = new Date(point.timestamp).toLocaleDateString(
          "en-CA",
          { timeZone: "Europe/London" }
        );

        if (!daily.has(dateKey)) {
          daily.set(dateKey, {
            date: dateKey,
            actualTotal: 0,
            forecastTotal: 0,
            count: 0,
          });
        }

        const item = daily.get(dateKey);
        item.actualTotal += point.actual;
        item.forecastTotal += point.forecast;
        item.count += 1;
      }

      return Array.from(daily.values()).map((item) => ({
        ...item,
        time: new Date(`${item.date}T12:00:00Z`).toLocaleDateString(
          "en-GB",
          { day: "2-digit", month: "short", timeZone: "Europe/London" }
        ),
        actual: item.actualTotal / item.count,
        forecast: item.forecastTotal / item.count,
      }));
    }

    return points.map((point) => ({
      ...point,
      time: point.timeLabel,
    }));
  }, [points, chartMode]);

  const totalPages = Math.max(
    1,
    Math.ceil(points.length / TABLE_PAGE_SIZE)
  );

  const visibleRows = points.slice(
    page * TABLE_PAGE_SIZE,
    (page + 1) * TABLE_PAGE_SIZE
  );

  const overForecastCount = points.filter((point) => point.error > 0).length;

  function exportCsv() {
    if (!points.length) return;

    const headers = [
      "Delivery time (UTC)",
      "Forecast published",
      "Actual (MW)",
      "Forecast (MW)",
      "Forecast error (MW)",
    ];

    const rows = points.map((point) => [
      point.startTime ?? "",
      point.publishTime ?? "",
      point.actual,
      point.forecast,
      point.error,
    ]);

    const escapeCsv = (value) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;

    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n");

    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `wind-analysis-${start}-to-${end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#dashboard" aria-label="Wind Intelligence home">
          <span className="brand-mark">
            <Wind size={25} />
          </span>

          <span className="brand-copy">
            <strong>Wind Intelligence</strong>
            <small>PROCUREMENT ANALYTICS</small>
          </span>
        </a>

        <div className="topbar-right">
          <span className="status-dot" />
          <span>UK National Wind</span>
          <span className="period-pill">JAN 2026</span>
        </div>
      </header>

      <div className="main-content" id="dashboard">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="eyebrow-line" />
              RENEWABLE FORECAST MONITOR
            </span>

            <h1>
              Turn wind forecasts
              <br />
              into <span>better decisions.</span>
            </h1>

            <p>
              Compare forecast generation with actual output, understand
              forecast error, and support more informed electricity
              procurement decisions.
            </p>

            <div className="hero-meta">
              <span>
                <CalendarDays size={15} />
                Historical analysis
              </span>
              <span>
                <Clock3 size={15} />
                UK delivery time
              </span>
              <span>
                <Zap size={15} />
                Elexon BMRS data
              </span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="visual-orbit orbit-one" />
            <div className="visual-orbit orbit-two" />
            <div className="visual-center">
              <Wind size={54} strokeWidth={1.25} />
            </div>
            <span className="visual-point point-one" />
            <span className="visual-point point-two" />
            <span className="visual-point point-three" />
            <div className="visual-caption">
              <span>WIND</span>
              <strong>Forecast intelligence</strong>
            </div>
          </div>
        </section>

        <section className="filter-panel">
          <div className="filter-title">
            <div className="section-icon">
              <CalendarDays size={19} />
            </div>
            <div>
              <h2>Analysis period</h2>
              <p>Choose a delivery window within January 2026</p>
            </div>
          </div>

          <div className="filter-controls">
            <label className="date-field">
              <span>START DATE</span>
              <input
                type="date"
                min={MIN_DATE}
                max={MAX_DATE}
                value={start}
                onChange={(event) => {
                  const nextStart = event.target.value;
                  setStart(nextStart);
                  if (nextStart > end) setEnd(nextStart);
                }}
              />
            </label>

            <span className="date-separator">to</span>

            <label className="date-field">
              <span>END DATE</span>
              <input
                type="date"
                min={start}
                max={MAX_DATE}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>

            <button
              className="primary-button"
              onClick={loadData}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                className={loading ? "spin-icon" : ""}
              />
              {loading ? "Refreshing..." : "Refresh analysis"}
            </button>
          </div>
        </section>

        {error && (
          <div className="alert" role="alert">
            <AlertCircle size={19} />
            <div>
              <strong>Unable to load analysis</strong>
              <p>{error}</p>
              <span>
                Check that the backend is running and the API URL is correct.
              </span>
            </div>
          </div>
        )}

        {loading && !data && <LoadingPanel />}

        {data && !error && (
          <>
            {data.message && (
              <div className="notice">
                <AlertCircle size={17} />
                <span>{data.message}</span>
              </div>
            )}

            <section className="section-block">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">PERFORMANCE OVERVIEW</span>
                  <h2>Forecast performance</h2>
                  <p>Key indicators for the selected delivery period.</p>
                </div>
                <span className="data-badge">
                  <CheckCircle2 size={15} />
                  API response received
                </span>
              </div>

              <div className="metrics-grid">
                <MetricCard
                  title="Matched periods"
                  value={formatNumber(
                    metrics.matchedPeriods ?? points.length
                  )}
                  unit="Hourly delivery periods"
                  icon={Activity}
                  tone="teal"
                />

                <MetricCard
                  title="Mean absolute error"
                  value={formatNumber(metrics.mae)}
                  unit="MW · Lower is better"
                  icon={TrendingDown}
                  tone="blue"
                />

                <MetricCard
                  title="Root mean square error"
                  value={formatNumber(metrics.rmse)}
                  unit="MW · Penalises large errors"
                  icon={Activity}
                  tone="violet"
                />

                <MetricCard
                  title="Forecast bias"
                  value={formatNumber(metrics.bias)}
                  unit="MW · Positive means overforecast"
                  icon={TrendingUp}
                  tone="amber"
                />
              </div>
            </section>

            <section className="panel chart-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">GENERATION PROFILE</span>
                  <h2>Forecast vs actual generation</h2>
                  <p>
                    {chartMode === "all"
                      ? "Hourly generation values across the selected period."
                      : "Daily average generation across the selected period."}
                  </p>
                </div>

                <div className="chart-mode" aria-label="Chart display mode">
                  <button
                    className={chartMode === "all" ? "selected" : ""}
                    onClick={() => setChartMode("all")}
                  >
                    Hourly
                  </button>
                  <button
                    className={chartMode === "daily" ? "selected" : ""}
                    onClick={() => setChartMode("daily")}
                  >
                    Daily average
                  </button>
                </div>
              </div>

              <div className="chart-legend">
                <span>
                  <i className="legend-dot actual-dot" />
                  Actual generation
                </span>
                <span>
                  <i className="legend-dot forecast-dot" />
                  Forecast generation
                </span>
              </div>

              <div className="chart-container">
                {loading ? (
                  <LoadingPanel />
                ) : chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{ top: 12, right: 18, left: 4, bottom: 8 }}
                    >
                      <CartesianGrid
                        stroke="#243348"
                        strokeDasharray="4 5"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="time"
                        tick={{ fill: "#8fa0b6", fontSize: 11 }}
                        axisLine={{ stroke: "#34445a" }}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fill: "#8fa0b6", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={58}
                        tickFormatter={(value) =>
                          Number(value).toLocaleString("en-GB")
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#101c2b",
                          border: "1px solid #34445a",
                          borderRadius: 12,
                          color: "#f1f5f9",
                        }}
                        labelStyle={{ color: "#a7b7ca" }}
                        formatter={(value, name) => [
                          `${formatNumber(value)} MW`,
                          name,
                        ]}
                      />
                      <Legend
                        wrapperStyle={{
                          color: "#b7c4d5",
                          fontSize: 12,
                          paddingTop: 14,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="actual"
                        name="Actual"
                        stroke="#35d6b0"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="forecast"
                        name="Forecast"
                        stroke="#8197ff"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyPanel>
                    No matched actual and forecast records for this period.
                  </EmptyPanel>
                )}
              </div>

              <div className="chart-footnote">
                <span>All times are displayed in Europe/London time.</span>
                <span>{formatNumber(points.length)} matched records</span>
              </div>
            </section>

            <section className="panel table-panel">
              <div className="panel-header table-header">
                <div>
                  <span className="eyebrow">PERIOD-LEVEL DETAIL</span>
                  <h2>Delivery period analysis</h2>
                  <p>
                    Actual output, selected forecast and forecast error.
                  </p>
                </div>

                <button
                  className="secondary-button"
                  onClick={exportCsv}
                  disabled={!points.length}
                >
                  <Download size={16} />
                  Export CSV
                </button>
              </div>

              <div className="table-summary">
                <span>
                  <strong>{formatNumber(points.length)}</strong> matched rows
                </span>
                <span>
                  <strong>{formatNumber(overForecastCount)}</strong> periods
                  with forecast above actual
                </span>
              </div>

              {visibleRows.length ? (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Delivery time (UK)</th>
                          <th>Forecast published</th>
                          <th>Actual MW</th>
                          <th>Forecast MW</th>
                          <th>Error MW</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((point, index) => (
                          <tr key={point.startTime ?? `${page}-${index}`}>
                            <td className="time-cell">{point.dateLabel}</td>
                            <td>
                              {formatDateTime(point.publishTime)}
                            </td>
                            <td>{formatNumber(point.actual)}</td>
                            <td>{formatNumber(point.forecast)}</td>
                            <td
                              className={
                                point.error > 0
                                  ? "error-positive"
                                  : point.error < 0
                                    ? "error-negative"
                                    : ""
                              }
                            >
                              {point.error > 0 ? "+" : ""}
                              {formatNumber(point.error)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="pagination">
                    <span>
                      Showing {page * TABLE_PAGE_SIZE + 1}–
                      {Math.min(
                        (page + 1) * TABLE_PAGE_SIZE,
                        points.length
                      )}{" "}
                      of {points.length}
                    </span>

                    <div className="pagination-actions">
                      <button
                        className="secondary-button"
                        onClick={() => setPage((current) => current - 1)}
                        disabled={page === 0}
                      >
                        Previous
                      </button>
                      <span>
                        Page {page + 1} of {totalPages}
                      </span>
                      <button
                        className="secondary-button"
                        onClick={() => setPage((current) => current + 1)}
                        disabled={page >= totalPages - 1}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyPanel>No data is available for this date range.</EmptyPanel>
              )}
            </section>

            <section className="methodology-panel">
              <div className="methodology-icon">
                <Activity size={21} />
              </div>
              <div>
                <h3>How to interpret these results</h3>
                <p>
                  <strong>MAE</strong> shows average absolute forecast error.
                  <strong> RMSE</strong> gives more weight to large errors.
                  <strong> Bias</strong> is forecast minus actual: a positive
                  value indicates overforecasting and a negative value
                  indicates underforecasting.
                </p>
                <p>
                  Actual output is aggregated from half-hourly observations
                  into hourly averages; incomplete hours are excluded.
                  Forecast selection uses the configured publication cutoff.
                  Review the methodology and assumptions before using these
                  results for commercial decisions.
                </p>
              </div>
            </section>

            <footer className="page-footer">
              <span>WIND INTELLIGENCE · ANALYTICS PILOT</span>
              <span>Historical analysis · Not a live trading signal</span>
            </footer>
          </>
        )}

        {!data && !loading && !error && (
          <EmptyPanel>Choose a delivery period to load the analysis.</EmptyPanel>
        )}
      </div>
    </main>
  );
}
