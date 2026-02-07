import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Plus, X, Info } from 'lucide-react';

// ============================================================================
// FREE PUBLIC API INTEGRATION - NO SIGNUP REQUIRED
// Uses Yahoo Finance unofficial API via proxy
// ============================================================================

// CORS proxy wrapper (Yahoo blocks direct browser requests)
const corsProxy = (url) =>
  `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

const fetchYahooFinanceData = async (ticker) => {
  try {
    const range = '1mo';      // 1 month of data
    const interval = '5m';    // 5-minute intervals

    // --- Chart data (sparklines / recent candles) ---
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}`;
    const chartResponse = await fetch(corsProxy(chartUrl));
    const chartJson = await chartResponse.json();

    if (!chartJson.chart || !chartJson.chart.result || chartJson.chart.result.length === 0) {
      throw new Error('No chart data available for this ticker');
    }

    const result = chartJson.chart.result[0];
    const timestamps = result.timestamp || [];
    const quote0 = result.indicators?.quote?.[0] || {};
    const closes = quote0.close || [];
    const opens = quote0.open || [];

    const priceData = timestamps
      .map((timestamp, i) => {
        const p = closes[i] ?? opens[i] ?? 0;
        return {
          time: new Date(timestamp * 1000),
          price: Number.isFinite(p) ? parseFloat(p.toFixed(2)) : 0,
          isExtendedHours: false, // Yahoo doesn't clearly distinguish here
        };
      })
      .filter((d) => d.price > 0);

    const currentPriceFromChart = priceData[priceData.length - 1]?.price || 0;

    // --- Quote data (name, fallback price, etc.) ---
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`;
    const quoteResponse = await fetch(corsProxy(quoteUrl));
    const quoteJson = await quoteResponse.json();
    const quote = quoteJson.quoteResponse?.result?.[0] || {};

    // NOTE: Yahoo doesn't provide IV Percentile directly here.
    // Placeholder random value (as per your original note)
    const ivPercentile = Math.floor(Math.random() * 100);

    return {
      ticker,
      currentPrice: currentPriceFromChart || quote.regularMarketPrice || 0,
      priceData: priceData.slice(-500), // Last ~2 days of 5min data (approx)
      ivPercentile,
      symbol: quote.symbol || ticker,
      name: quote.longName || quote.shortName || ticker,
    };
  } catch (error) {
    console.error(`Error fetching ${ticker}:`, error);
    throw error;
  }
};

// ============================================================================
// SIGNAL LOGIC (Same as before)
// ============================================================================

const calculateSMA = (prices, period) => {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
};

const calculateMomentum = (prices, period = 5) => {
  if (prices.length < period) return 0;
  const recent = prices.slice(-period);
  let upCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) upCount++;
  }
  return upCount / (period - 1);
};

const generateSignal = (priceData, ivPercentile) => {
  const prices = priceData.map((d) => d.price);
  const currentPrice = prices[prices.length - 1];
  const sma20 = calculateSMA(prices, 20);
  const momentum = calculateMomentum(prices);

  const isUptrend = sma20 && currentPrice > sma20;
  const hasPositiveMomentum = momentum > 0.6;
  const hasLowIV = ivPercentile < 50;

  const isDowntrend = sma20 && currentPrice < sma20;
  const hasNegativeMomentum = momentum < 0.4;

  if (isUptrend && hasPositiveMomentum && hasLowIV) {
    return {
      signal: 'buy',
      reasons: [
        `Price above 20-SMA ($${sma20?.toFixed(2)}) - uptrend confirmed`,
        `Strong momentum (${(momentum * 100).toFixed(0)}% up moves)`,
        `Low IV Percentile (${ivPercentile}%) - favorable for long positions`,
      ],
      strategyHint: 'Low IV favors buying stock or long options',
    };
  }

  if (isDowntrend && hasNegativeMomentum) {
    return {
      signal: 'avoid',
      reasons: [
        `Price below 20-SMA ($${sma20?.toFixed(2)}) - downtrend`,
        `Weak momentum (${(momentum * 100).toFixed(0)}% up moves)`,
        'Unfavorable technical setup',
      ],
      strategyHint:
        ivPercentile > 70
          ? 'High IV: Consider waiting or selling premium if experienced'
          : 'Wait for better entry',
    };
  }

  return {
    signal: 'hold',
    reasons: [
      'Mixed technical signals',
      sma20 ? `Price near 20-SMA ($${sma20.toFixed(2)})` : 'Consolidating',
      `Moderate momentum (${(momentum * 100).toFixed(0)}% up moves)`,
    ],
    strategyHint: ivPercentile > 70 ? 'High IV: Premium selling may be favorable' : 'Wait for clearer direction',
  };
};

// ============================================================================
// SPARKLINE CHART
// ============================================================================

const Sparkline = ({ data, signal }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !data.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    const prices = data.map((d) => d.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice || 1;

    const padding = height * 0.1;

    const colorMap = {
      buy: '#10b981',
      hold: '#f59e0b',
      avoid: '#ef4444',
    };
    const color = colorMap[signal] || '#6b7280';

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    data.forEach((point, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - padding - ((point.price - minPrice) / range) * (height - 2 * padding);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = `${color}15`;
    ctx.fill();
  }, [data, signal]);

  return <canvas ref={canvasRef} className="sparkline-canvas" style={{ width: '100%', height: '100%' }} />;
};

// ============================================================================
// TICKER ROW
// ============================================================================

const TickerRow = ({ tickerData, onRemove }) => {
  const [expanded, setExpanded] = useState(false);
  const { ticker, currentPrice, priceData, ivPercentile, signal, reasons, strategyHint } = tickerData;

  const signalConfig = {
    buy: { icon: TrendingUp, label: 'BUY', color: 'signal-buy', bgColor: 'bg-buy' },
    hold: { icon: Minus, label: 'HOLD', color: 'signal-hold', bgColor: 'bg-hold' },
    avoid: { icon: TrendingDown, label: 'AVOID', color: 'signal-avoid', bgColor: 'bg-avoid' },
  };

  const config = signalConfig[signal];
  const SignalIcon = config.icon;

  const getIVColor = (iv) => {
    if (iv < 30) return 'iv-low';
    if (iv < 70) return 'iv-mid';
    return 'iv-high';
  };

  return (
    <div className="ticker-row">
      <div className="ticker-main">
        <div className="ticker-header">
          <div className="ticker-symbol">{ticker}</div>
          <button onClick={onRemove} className="remove-btn" aria-label="Remove ticker">
            <X size={16} />
          </button>
        </div>

        <div className={`signal-badge ${config.color}`}>
          <SignalIcon size={16} />
          <span>{config.label}</span>
        </div>

        <div className="sparkline-container">
          <Sparkline data={priceData} signal={signal} />
        </div>

        <div className="metrics">
          <div className="metric">
            <div className="metric-label">Price</div>
            <div className="metric-value price">${currentPrice.toFixed(2)}</div>
          </div>

          <div className="metric">
            <div className="metric-label">
              IV %ile
              <div className="tooltip">
                <Info size={12} />
                <div className="tooltip-content">
                  IV Percentile: Where current implied volatility ranks vs. past year. Low = cheaper options, High = expensive
                  options.
                </div>
              </div>
            </div>
            <div className={`metric-value iv ${getIVColor(ivPercentile)}`}>{ivPercentile}%</div>
          </div>
        </div>

        <button
          className="expand-btn"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <span>Why?</span>
        </button>
      </div>

      {expanded && (
        <div className="ticker-details">
          <div className="details-section">
            <h4>Signal Factors</h4>
            <ul>
              {reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>

          <div className="strategy-hint">
            <strong>Strategy Context:</strong> {strategyHint}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN APP
// ============================================================================

const StockScreener = () => {
  const [watchlist, setWatchlist] = useState([]);
  const [tickerInput, setTickerInput] = useState('');
  const [tickerData, setTickerData] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState({});

  useEffect(() => {
    const saved = localStorage.getItem('stockScreenerWatchlist');
    if (saved) {
      try {
        const tickers = JSON.parse(saved);
        setWatchlist(tickers);
      } catch (e) {
        console.error('Failed to load watchlist:', e);
      }
    }
  }, []);

  // Always persist, even if empty (so removing last ticker clears storage)
  useEffect(() => {
    localStorage.setItem('stockScreenerWatchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    const fetchData = async () => {
      for (const ticker of watchlist) {
        if (tickerData[ticker]) continue; // Skip if already loaded

        setLoading((prev) => ({ ...prev, [ticker]: true }));

        try {
          const data = await fetchYahooFinanceData(ticker);
          const signalData = generateSignal(data.priceData, data.ivPercentile);

          setTickerData((prev) => ({
            ...prev,
            [ticker]: {
              ...data,
              ...signalData,
            },
          }));
        } catch (err) {
          console.error(`Failed to fetch ${ticker}:`, err);
          setError(`Failed to load ${ticker}. Please check the ticker symbol.`);
        } finally {
          setLoading((prev) => ({ ...prev, [ticker]: false }));
        }
      }
    };

    if (watchlist.length > 0) {
      fetchData();

      // Refresh every 5 minutes
      const interval = setInterval(fetchData, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist]);

  const addTicker = async (e) => {
    e.preventDefault();
    const ticker = tickerInput.trim().toUpperCase();

    if (!ticker) {
      setError('Please enter a ticker symbol');
      return;
    }

    if (!/^[A-Z]{1,5}$/.test(ticker)) {
      setError('Invalid ticker format (1-5 letters)');
      return;
    }

    if (watchlist.includes(ticker)) {
      setError('Ticker already in watchlist');
      return;
    }

    // Fetch first so we only add if it works (prevents "failed but already exists")
    setError('');
    setLoading((prev) => ({ ...prev, [ticker]: true }));

    try {
      const data = await fetchYahooFinanceData(ticker);
      const signalData = generateSignal(data.priceData, data.ivPercentile);

      setTickerData((prev) => ({
        ...prev,
        [ticker]: { ...data, ...signalData },
      }));

      setWatchlist((prev) => [...prev, ticker]);
      setTickerInput('');
    } catch (err) {
      console.error(`Failed to add ${ticker}:`, err);
      setError(`Failed to add ${ticker}. Please check the symbol or try again.`);
    } finally {
      setLoading((prev) => ({ ...prev, [ticker]: false }));
    }
  };

  const removeTicker = (ticker) => {
    setWatchlist(watchlist.filter((t) => t !== ticker));
    const newData = { ...tickerData };
    delete newData[ticker];
    setTickerData(newData);
  };

  const sortedWatchlist = [...watchlist].sort((a, b) => {
    const priority = { buy: 0, hold: 1, avoid: 2 };
    const signalA = tickerData[a]?.signal || 'hold';
    const signalB = tickerData[b]?.signal || 'hold';
    return priority[signalA] - priority[signalB];
  });

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1 className="app-title">SCREENER</h1>
          <p className="app-subtitle">Live market data • Rules-based signals</p>
        </div>
      </header>

      <main className="main-content">
        <div className="add-ticker-section">
          <form onSubmit={addTicker} className="add-ticker-form">
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setError('');
              }}
              placeholder="Add ticker (e.g., AAPL)"
              className="ticker-input"
              maxLength={5}
            />
            <button type="submit" className="add-btn" aria-label="Add ticker">
              <Plus size={20} />
            </button>
          </form>
          {error && <div className="error-message">{error}</div>}
        </div>

        {watchlist.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h2>No tickers in watchlist</h2>
            <p>Add a ticker symbol above to start screening with live data</p>
            <p className="hint">Try: AAPL, TSLA, MSFT, GOOGL, NVDA</p>
          </div>
        ) : (
          <div className="ticker-list">
            {sortedWatchlist.map((ticker) => {
              if (loading[ticker]) {
                return (
                  <div key={ticker} className="ticker-row loading">
                    <div className="loading-content">
                      <div className="ticker-symbol">{ticker}</div>
                      <div className="loading-spinner">Loading...</div>
                    </div>
                  </div>
                );
              }

              return (
                tickerData[ticker] && (
                  <TickerRow key={ticker} tickerData={tickerData[ticker]} onRemove={() => removeTicker(ticker)} />
                )
              );
            })}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Live data from Yahoo Finance • Signals are rules-based, not predictions • Not financial advice</p>
      </footer>

      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .app {
          min-height: 100vh;
          background: linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 100%);
          color: #e5e7eb;
        }

        .header {
          background: rgba(15, 23, 42, 0.8);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding: 2rem 1.5rem 1.5rem;
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-content {
          max-width: 1200px;
          margin: 0 auto;
        }

        .app-title {
          font-size: 2.5rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 0.25rem;
        }

        .app-subtitle {
          color: #9ca3af;
          font-size: 0.875rem;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .main-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1.5rem;
        }

        .add-ticker-section {
          margin-bottom: 2rem;
        }

        .add-ticker-form {
          display: flex;
          gap: 0.75rem;
          max-width: 400px;
        }

        .ticker-input {
          flex: 1;
          background: rgba(30, 41, 59, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 0.75rem 1rem;
          color: #e5e7eb;
          font-size: 1rem;
          text-transform: uppercase;
          transition: all 0.2s;
        }

        .ticker-input:focus {
          outline: none;
          border-color: #60a5fa;
          background: rgba(30, 41, 59, 0.8);
        }

        .ticker-input::placeholder {
          color: #6b7280;
        }

        .add-btn {
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          border: none;
          border-radius: 8px;
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          cursor: pointer;
          transition: all 0.2s;
        }

        .add-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(59, 130, 246, 0.3);
        }

        .add-btn:active {
          transform: translateY(0);
        }

        .error-message {
          color: #ef4444;
          font-size: 0.875rem;
          margin-top: 0.5rem;
        }

        .empty-state {
          text-align: center;
          padding: 4rem 2rem;
          color: #6b7280;
        }

        .empty-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }

        .empty-state h2 {
          font-size: 1.5rem;
          color: #9ca3af;
          margin-bottom: 0.5rem;
        }

        .hint {
          margin-top: 1rem;
          color: #60a5fa;
          font-size: 0.875rem;
        }

        .ticker-list {
          display: grid;
          gap: 1rem;
        }

        .ticker-row {
          background: rgba(30, 41, 59, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          overflow: hidden;
          transition: all 0.3s;
        }

        .ticker-row:hover {
          border-color: rgba(96, 165, 250, 0.3);
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
        }

        .ticker-row.loading {
          padding: 1.5rem;
        }

        .loading-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .loading-spinner {
          color: #60a5fa;
          font-size: 0.875rem;
        }

        .ticker-main {
          display: grid;
          grid-template-columns: 120px 100px 1fr auto auto auto;
          align-items: center;
          gap: 1.5rem;
          padding: 1.5rem;
        }

        @media (max-width: 1024px) {
          .ticker-main {
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
          }

          .sparkline-container {
            grid-column: 1 / -1;
          }

          .metrics {
            grid-column: 1 / -1;
            display: flex;
            gap: 2rem;
          }
        }

        .ticker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .ticker-symbol {
          font-size: 1.5rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: #f3f4f6;
        }

        .remove-btn {
          background: none;
          border: none;
          color: #6b7280;
          cursor: pointer;
          padding: 0.25rem;
          opacity: 0.5;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .remove-btn:hover {
          opacity: 1;
          color: #ef4444;
        }

        .signal-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-weight: 600;
          font-size: 0.875rem;
          letter-spacing: 0.05em;
          width: fit-content;
        }

        .signal-buy {
          background: rgba(16, 185, 129, 0.15);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .signal-hold {
          background: rgba(245, 158, 11, 0.15);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }

        .signal-avoid {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .sparkline-container {
          height: 60px;
          min-width: 200px;
          position: relative;
        }

        .sparkline-canvas {
          display: block;
        }

        .metrics {
          display: flex;
          gap: 2rem;
        }

        .metric {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .metric-label {
          font-size: 0.75rem;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .metric-value {
          font-size: 1.125rem;
          font-weight: 600;
        }

        .metric-value.price {
          color: #f3f4f6;
        }

        .metric-value.iv {
          font-family: 'Courier New', monospace;
        }

        .iv-low {
          color: #60a5fa;
        }

        .iv-mid {
          color: #f59e0b;
        }

        .iv-high {
          color: #ef4444;
        }

        .tooltip {
          position: relative;
          display: inline-flex;
          cursor: help;
        }

        .tooltip-content {
          display: none;
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          padding: 0.75rem;
          font-size: 0.75rem;
          white-space: nowrap;
          z-index: 1000;
          margin-bottom: 0.5rem;
          color: #e5e7eb;
          font-weight: normal;
          text-transform: none;
          letter-spacing: normal;
        }

        .tooltip:hover .tooltip-content {
          display: block;
        }

        .expand-btn {
          background: none;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 0.5rem 1rem;
          color: #9ca3af;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          transition: all 0.2s;
        }

        .expand-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.2);
          color: #e5e7eb;
        }

        .ticker-details {
          padding: 1.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(15, 23, 42, 0.3);
          animation: slideDown 0.3s ease-out;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .details-section {
          margin-bottom: 1rem;
        }

        .details-section h4 {
          font-size: 0.875rem;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.75rem;
        }

        .details-section ul {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .details-section li {
          padding-left: 1.5rem;
          position: relative;
          color: #d1d5db;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .details-section li:before {
          content: '→';
          position: absolute;
          left: 0;
          color: #60a5fa;
        }

        .strategy-hint {
          background: rgba(96, 165, 250, 0.1);
          border-left: 3px solid #60a5fa;
          padding: 0.75rem 1rem;
          border-radius: 4px;
          font-size: 0.875rem;
          color: #d1d5db;
        }

        .strategy-hint strong {
          color: #60a5fa;
        }

        .footer {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          text-align: center;
          color: #6b7280;
          font-size: 0.75rem;
        }
      `}</style>
    </div>
  );
};

export default StockScreener;
