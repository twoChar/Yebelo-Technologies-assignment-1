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
  token: string;
  rsi: number | null;
  price: number | null;
  timestamp_ms: number;
};

const BROADCASTER_BASE =
  process.env.NEXT_PUBLIC_BROADCASTER_URL || 'http://localhost:4001';
const EVENTS_URL = `${BROADCASTER_BASE}/events`;
const SNAPSHOT_URL = `${BROADCASTER_BASE}/api/latest-rsi`;

const MAX_HISTORY = 500;
const MAX_RENDER_POINTS = 300;

export default function RsiLive() {
  const [latestMap, setLatestMap] = useState<Record<string, RsiPayload>>({});
  const [historyMap, setHistoryMap] = useState<Record<string, RsiPayload[]>>({});
  const [tokens, setTokens] = useState<string[]>([]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // helper to normalize incoming raw item into RsiPayload
  function normalizeItem(item: any): RsiPayload | null {
    if (!item) return null;
    const token = item.token || item.token_address || item.tokenAddress || item.tokenAddr;
    if (!token) return null;
    const rsiVal = typeof item.rsi === 'number' ? item.rsi : item.rsi ? parseFloat(item.rsi) : null;
    const priceVal =
      typeof item.price === 'number'
        ? item.price
        : item.price ?? item.price_in_sol ?? item.price_sol ?? item.amount_in_sol
        ? parseFloat(item.price ?? item.price_in_sol ?? item.price_sol ?? item.amount_in_sol)
        : null;
    const ts = item.timestamp_ms ? Number(item.timestamp_ms) : Date.now();
    return {
      token,
      rsi: isNaN(Number(rsiVal)) ? null : (rsiVal as number | null),
      price: isNaN(Number(priceVal)) ? null : (priceVal as number | null),
      timestamp_ms: ts,
    };
  }

  // fetch initial snapshot (one-off)
  useEffect(() => {
    let mounted = true;
    fetch(SNAPSHOT_URL)
      .then((r) => r.json())
      .then((json) => {
        if (!mounted) return;
        const snapshot = json.snapshot || [];
        if (!Array.isArray(snapshot) || snapshot.length === 0) return;

        const map: Record<string, RsiPayload> = {};
        const hist: Record<string, RsiPayload[]> = {};
        snapshot.forEach((item: any) => {
          const entry = normalizeItem(item);
          if (!entry) return;
          map[entry.token] = entry;
          hist[entry.token] = [entry];
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

  // helper to push a new point into maps (bounded)
  function pushPoint(point: RsiPayload) {
    if (!point || !point.token) return;
    setLatestMap((prev) => ({ ...prev, [point.token]: point }));
    setHistoryMap((prev) => {
      const prevArr = prev[point.token] ?? [];
      // ensure strictly increasing timestamps (small correction if equal)
      const lastTs = prevArr.length ? prevArr[prevArr.length - 1].timestamp_ms : -1;
      const safePoint = { ...point, timestamp_ms: point.timestamp_ms <= lastTs ? lastTs + 1 : point.timestamp_ms };
      const nextArr = [...prevArr, safePoint].slice(-MAX_HISTORY);
      return { ...prev, [point.token]: nextArr };
    });
    setTokens((prev) => (prev.includes(point.token) ? prev : [...prev, point.token]));
    setSelectedToken((cur) => cur ?? point.token);
  }

  // connect to SSE and handle messages (snapshot / update / single)
  useEffect(() => {
    const es = new EventSource(EVENTS_URL);
    es.onopen = () => {
      console.debug('SSE connected to', EVENTS_URL);
      setConnected(true);
    };

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        console.debug('SSE msg:', msg);

        if (msg.type === 'snapshot' && Array.isArray(msg.snapshot)) {
          const map: Record<string, RsiPayload> = {};
          const hist: Record<string, RsiPayload[]> = {};
          msg.snapshot.forEach((raw: any) => {
            const entry = normalizeItem(raw);
            if (!entry) return;
            map[entry.token] = entry;
            hist[entry.token] = [entry];
          });
          setLatestMap(map);
          setHistoryMap(hist);
          const keys = Object.keys(map);
          setTokens(keys);
          setSelectedToken((cur) => cur ?? keys[0] ?? null);
          return;
        }

        if (msg.type === 'update' && msg.payload) {
          const entry = normalizeItem(msg.payload);
          if (entry) pushPoint(entry);
          return;
        }

        // fallback: handle raw single object (in case broadcaster changes)
        const maybe = normalizeItem(msg);
        if (maybe) pushPoint(maybe);
      } catch (err) {
        console.warn('Invalid SSE event data', err, ev.data);
      }
    };


    es.onerror = (err) => {
      console.warn('SSE connection error', err);
      setConnected(false);
      try {
        es.close();
      } catch (e) {}
      // do not implement custom reconnect logic here — the browser EventSource auto-reconnects by default.
      // If you want exponential backoff with fetch fallback, implement separate logic.
    };

    return () => {
      try {
        es.close();
      } catch (e) {}
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // derived arrays for charting
  const current = selectedToken ? latestMap[selectedToken] ?? null : null;
  const historyForSelected = useMemo(() => {
    if (!selectedToken) return [];
    return historyMap[selectedToken] ?? [];
  }, [historyMap, selectedToken]);

  // prepare data for charts (sample if too many points)
  const chartData = useMemo(() => {
    if (!historyForSelected.length) return [];

    const mapped = historyForSelected.map((p) => ({
      timeLabel: new Date(p.timestamp_ms).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      price: p.price ?? null,
      rsi: p.rsi ?? null,
      ts: Number(p.timestamp_ms),
    }));

    // ensure strictly increasing ts
    for (let i = 1; i < mapped.length; i++) {
      if (mapped[i].ts <= mapped[i - 1].ts) {
        mapped[i].ts = mapped[i - 1].ts + 1;
      }
    }

    if (mapped.length > MAX_RENDER_POINTS) {
      const sampled: typeof mapped = [];
      const step = (mapped.length - 1) / (MAX_RENDER_POINTS - 1);
      for (let i = 0; i < MAX_RENDER_POINTS; i++) {
        const idx = Math.round(i * step);
        sampled.push(mapped[idx]);
      }
      return sampled;
    }

    return mapped;
  }, [historyForSelected]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>
      {/* Left panel */}
      <div style={{ padding: 16, borderRadius: 8, border: '1px solid #eee', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
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
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Connection</div>
          <div style={{ marginTop: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 10,
                background: connected ? '#16a34a' : '#e11d48',
                marginRight: 8,
              }}
            ></span>
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
              <div style={{ color: '#aaa', fontSize: 12 }}>Updated: {new Date(current.timestamp_ms).toLocaleString()}</div>
            </>
          ) : (
            <div style={{ color: '#999' }}>No data for selected token yet.</div>
          )}
        </div>
      </div>

      {/* Right: charts */}
      <div>
        {/* Price chart */}
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: '1px solid #eee',
            boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
            marginBottom: 16,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Price</h3>
          <div style={{ height: 260 }}>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toLocaleTimeString()} tick={{ fontSize: 11 }} />
                  <YAxis domain={['auto', 'auto']} />
                  <Tooltip formatter={(v: any) => (typeof v === 'number' ? v.toLocaleString() : v)} />
                  <Line type="monotone" dataKey="price" stroke="#2563eb" dot={{ r: 2 }} strokeWidth={2} isAnimationActive={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ color: '#999', padding: 24 }}>No price history yet for the selected token.</div>
            )}
          </div>
        </div>

        {/* RSI chart */}
        <div style={{ padding: 16, borderRadius: 8, border: '1px solid #eee', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
          <h3 style={{ marginTop: 0 }}>RSI (14)</h3>
          <div style={{ height: 240 }}>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toLocaleTimeString()} tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(v: any) => (typeof v === 'number' ? v.toFixed(2) : v)} />
                  <ReferenceLine y={70} label="70" stroke="#ff7b7b" strokeDasharray="3 3" />
                  <ReferenceLine y={30} label="30" stroke="#7bffb8" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="rsi" stroke="#f59e0b" dot={{ r: 2 }} strokeWidth={2} isAnimationActive={false} connectNulls />
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
