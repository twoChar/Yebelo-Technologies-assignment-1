// components/RsiLive.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

type RsiPayload = {
  token: string; // broadcaster uses { token, rsi, price, timestamp_ms } shape
  rsi: number | null;
  price: number | null;
  timestamp_ms: number;
};

const BROADCASTER_BASE = process.env.NEXT_PUBLIC_BROADCASTER_URL || 'http://localhost:4001';
const EVENTS_URL = `${BROADCASTER_BASE}/events`;
const SNAPSHOT_URL = `${BROADCASTER_BASE}/api/latest-rsi`;

// keep this many points per token for charting
const MAX_HISTORY = 500;

export default function RsiLive() {
  const [latestMap, setLatestMap] = useState<Record<string, RsiPayload>>({});
  const [historyMap, setHistoryMap] = useState<Record<string, RsiPayload[]>>({});
  const [tokens, setTokens] = useState<string[]>([]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // fetch initial snapshot
  useEffect(() => {
    let mounted = true;
    fetch(SNAPSHOT_URL)
      .then((r) => r.json())
      .then((json) => {
        if (!mounted) return;
        const snapshot = json.snapshot || [];
        const map: Record<string, RsiPayload> = {};
        const hist: Record<string, RsiPayload[]> = {};
        snapshot.forEach((item: any) => {
          const token = item.token;
          const entry: RsiPayload = {
            token,
            rsi: item.rsi ?? null,
            price: item.price ?? null,
            timestamp_ms: item.timestamp_ms ?? Date.now(),
          };
          map[token] = entry;
          hist[token] = [entry];
        });
        setLatestMap(map);
        setHistoryMap(hist);
        const tlist = Object.keys(map);
        setTokens(tlist);
        if (!selectedToken && tlist.length) setSelectedToken(tlist[0]);
      })
      .catch((err) => {
        console.warn('Snapshot fetch failed:', err);
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // connect to SSE
  useEffect(() => {
    const es = new EventSource(EVENTS_URL);
    setConnected(true);

    es.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data) as RsiPayload;
        const token = obj.token;
        // update latest map
        setLatestMap((prev) => {
          const next = { ...prev, [token]: obj };
          return next;
        });
        // update history
        setHistoryMap((prev) => {
          const prevArr = prev[token] ?? [];
          const nextArr = [...prevArr, obj].slice(-MAX_HISTORY);
          return { ...prev, [token]: nextArr };
        });
        setTokens((prevTokens) => {
          if (prevTokens.includes(token)) return prevTokens;
          return [...prevTokens, token];
        });
        // select first token if none selected
        setSelectedToken((cur) => cur ?? token);
      } catch (err) {
        console.error('Invalid SSE event data', err);
      }
    };

    es.onerror = (err) => {
      console.error('SSE error', err);
      // if the connection fails, setConnected false (browser may auto-retry)
      setConnected(false);
      // don't close here; browser will attempt auto-reconnect
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  // derived arrays for charting
  const current = selectedToken ? latestMap[selectedToken] ?? null : null;
  const historyForSelected = useMemo(() => {
    if (!selectedToken) return [];
    return historyMap[selectedToken] ?? [];
  }, [historyMap, selectedToken]);

  // prepare data arrays for charts: map timestamp to readable label
  const chartData = historyForSelected.map((p) => ({
    time: new Date(p.timestamp_ms).toLocaleTimeString(),
    price: p.price ?? null,
    rsi: p.rsi ?? null,
    ts: p.timestamp_ms,
  }));

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '320px 1fr',
      gap: 20,
      alignItems: 'start'
    }}>
      {/* Left panel */}
      <div style={{
        padding: 16,
        borderRadius: 8,
        border: '1px solid #eee',
        boxShadow: '0 1px 6px rgba(0,0,0,0.04)'
      }}>
        <h3 style={{ marginTop: 0 }}>Tokens</h3>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 6, color: '#555' }}>Select token</label>
          <select
            value={selectedToken ?? ''}
            onChange={(e) => setSelectedToken(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd' }}
          >
            {tokens.length === 0 && <option value="">(no tokens)</option>}
            {tokens.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Connection</div>
          <div style={{ marginTop: 6 }}>
            <span style={{
              display: 'inline-block',
              width: 10, height: 10, borderRadius: 10,
              background: connected ? '#16a34a' : '#e11d48', marginRight: 8
            }}></span>
            {connected ? 'Connected (SSE)' : 'Disconnected'}
          </div>
        </div>

        <hr style={{ margin: '14px 0', border: 'none', borderTop: '1px solid #eee' }} />

        <div style={{ fontSize: 13 }}>
          <div style={{ marginBottom: 8, color: '#666' }}>Latest</div>
          {current ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ color: '#888' }}>Price</div>
                <div style={{ fontWeight: 600 }}>{current.price !== null ? current.price : '—'}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ color: '#888' }}>RSI</div>
                <div style={{ fontWeight: 600 }}>{current.rsi !== null ? current.rsi.toFixed(2) : '—'}</div>
              </div>
              <div style={{ color: '#aaa', fontSize: 12 }}>
                Updated: {new Date(current.timestamp_ms).toLocaleString()}
              </div>
            </>
          ) : (
            <div style={{ color: '#999' }}>No data for selected token yet.</div>
          )}
        </div>

        <hr style={{ margin: '14px 0', border: 'none', borderTop: '1px solid #eee' }} />

        <div style={{ color: '#666', fontSize: 13 }}>
          <strong>Legend</strong>
          <ul style={{ paddingLeft: 18, marginTop: 8 }}>
            <li>Price — absolute token price</li>
            <li>RSI — Relative Strength Index (14-period)</li>
            <li>RSI lines in chart: 70 (overbought), 30 (oversold)</li>
          </ul>
        </div>
      </div>

      {/* Right: charts */}
      <div>
        <div style={{
          padding: 16,
          borderRadius: 8,
          border: '1px solid #eee',
          boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
          marginBottom: 16
        }}>
          <h3 style={{ marginTop: 0 }}>Price</h3>
          <div style={{ height: 260 }}>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" minTickGap={20} />
                  <YAxis domain={['auto', 'auto']} />
                  <Tooltip formatter={(value: any) => (typeof value === 'number' ? value.toLocaleString() : value)} />
                  <Line type="monotone" dataKey="price" stroke="#2563eb" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: '#999', padding: 24 }}>No price history yet for the selected token.</div>
            )}
          </div>
        </div>

        <div style={{
          padding: 16,
          borderRadius: 8,
          border: '1px solid #eee',
          boxShadow: '0 1px 6px rgba(0,0,0,0.04)'
        }}>
          <h3 style={{ marginTop: 0 }}>RSI (14)</h3>
          <div style={{ height: 240 }}>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" minTickGap={20} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(value: any) => (typeof value === 'number' ? value.toFixed(2) : value)} />
                  <ReferenceLine y={70} label="70" stroke="#ff7b7b" strokeDasharray="3 3" />
                  <ReferenceLine y={30} label="30" stroke="#7bffb8" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="rsi" stroke="#f59e0b" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: '#999', padding: 24 }}>No RSI history yet for the selected token.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
