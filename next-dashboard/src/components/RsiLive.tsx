// components/RsiLive.tsx
import { useEffect, useState } from 'react';

type RsiPayload = {
  token: string;
  rsi: number;
  price: number;
  timestamp_ms: number;
};

export default function RsiLive() {
  const [data, setData] = useState<Record<string, RsiPayload>>({});
  const [selectedToken, setSelectedToken] = useState<string | null>(null);

  useEffect(() => {
    // Poll initial snapshot
    fetch('http://localhost:4000/api/latest-rsi')
      .then(res => res.json())
      .then(json => {
        const map: Record<string, RsiPayload> = {};
        for (const item of json.snapshot) {
          map[item.token] = item;
        }
        setData(map);
        if (!selectedToken && json.snapshot.length) setSelectedToken(json.snapshot[0].token);
      })
      .catch(console.error);

    // SSE subscription
    const es = new EventSource('http://localhost:4000/events');
    es.onmessage = (ev) => {
      try {
        const obj: RsiPayload = JSON.parse(ev.data);
        setData(prev => ({ ...prev, [obj.token]: obj }));
      } catch (e) { console.error(e); }
    };
    es.onerror = (err) => {
      console.error('SSE error', err);
      es.close();
    };
    return () => { es.close(); };
  }, []);

  const tokens = Object.keys(data);
  const current = selectedToken ? data[selectedToken] : undefined;

  return (
    <div>
      <h3>Live RSI Dashboard</h3>
      <select value={selectedToken ?? ''} onChange={(e) => setSelectedToken(e.target.value)}>
        {tokens.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {current ? (
        <div>
          <p>Price: {current.price}</p>
          <p>RSI: {current.rsi}</p>
          <p>Time: {new Date(current.timestamp_ms).toLocaleString()}</p>
          {/* Replace below with your Chart.js / Recharts component to plot history */}
        </div>
      ) : (
        <p>No token selected / no data yet.</p>
      )}
    </div>
  );
}
