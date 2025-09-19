// pages/index.tsx
import Head from 'next/head';
import RsiLive from '../components/RsiLive';

export default function Home() {
  return (
    <>
      <Head>
        <title>Pump.fun — RSI Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main style={{ padding: 24, fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>Pump.fun — Real-time RSI Dashboard</h1>
            <p style={{ margin: '6px 0 0', color: '#666' }}>Live price & RSI from Redpanda → Rust → Broadcaster → Dashboard</p>
          </div>
          <div style={{ textAlign: 'right', color: '#444', fontSize: 12 }}>
            <div>Redpanda Console: <a href="http://localhost:8080" target="_blank" rel="noreferrer">http://localhost:8080</a></div>
            <div>Broadcaster: <span style={{ fontWeight: 600 }}>http://localhost:4000</span></div>
          </div>
        </header>

        <RsiLive />

        <footer style={{ marginTop: 28, color: '#888', fontSize: 13 }}>
          Tip: If charts are empty, ensure the broadcaster is running and that `/events` SSE is reachable at <code>http://localhost:4000/events</code>.
        </footer>
      </main>
    </>
  );
}
