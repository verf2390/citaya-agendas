// app/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

export default function Home() {
  const target = useMemo(() => new Date(2026, 0, 30, 0, 0, 0), []);
  const [countdown, setCountdown] = useState('⏳ Calculando...');

  useEffect(() => {
    function tick() {
      const now = new Date();
      const diff = target.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown('✅ Ya disponible');
        return;
      }

      const totalSeconds = Math.floor(diff / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);

      setCountdown(`⏳ Faltan ${days} días, ${hours}h ${mins}m`);
    }

    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [target]);

  return (
    <main style={styles.body}>
      {/* Title del navegador lo pondremos en el paso 2 */}
      <div style={styles.card}>
        <div style={styles.top}>
          <div style={styles.logo} aria-label="Logo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 12c0-3 2-6 5-6s5 3 5 6-2 6-5 6-5-3-5-6Z" stroke="white" strokeWidth="2" />
              <path d="M4 19c2-2 4-3 8-3s6 1 8 3" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>

          <div>
            <h1 style={styles.h1}>Agenda de Citas</h1>
            <h2 style={styles.h2}>FajasPaola.cl</h2>
          </div>
        </div>

        <div style={styles.pill}>🚧 Sitio en construcción</div>

        <div style={styles.dateBox}>
          <div style={styles.badge}>
            📅 Disponible desde: <b>30/01/2026</b>
          </div>
          <div style={styles.counter}>{countdown}</div>
        </div>

        <p style={styles.p}>
          Estamos preparando tu agenda online. Muy pronto podrás agendar, confirmar y administrar tus horas desde aquí.
          Mientras tanto, puedes visitar el sitio:{' '}
          <a style={styles.link} href="https://fajaspaola.cl/" target="_blank" rel="noopener noreferrer">
            https://fajaspaola.cl/
          </a>
        </p>

        <div style={styles.row}>
          <a style={styles.btn2} href="https://fajaspaola.cl/" target="_blank" rel="noopener noreferrer">
            🌐 Ir a FajasPaola.cl
          </a>

          <a
            style={styles.btn}
            href="https://wa.me/56984524248?text=Hola%20👋%20Quiero%20ver%20avances%20de%20la%20agenda%20de%20FajasPaola.cl"
            target="_blank"
            rel="noopener noreferrer"
          >
            💬 WhatsApp
          </a>

          <a
            style={styles.btn2}
            href="mailto:verf14@gmail.com?subject=Avances%20agenda%20FajasPaola.cl&body=Hola%20Victor,%20quiero%20ver%20avances%20de%20la%20agenda%20😊"
          >
            ✉️ Correo
          </a>
        </div>

        <small style={styles.small}>Soporte: WhatsApp +56 9 6142 5029 · verf14@gmail.com</small>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,Arial',
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f6f7fb',
    margin: 0,
    padding: 16,
  },
  card: {
    background: '#fff',
    padding: '30px 26px',
    borderRadius: 16,
    boxShadow: '0 10px 30px rgba(0,0,0,.08)',
    maxWidth: 640,
    width: '92%',
  },
  top: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    display: 'grid',
    placeItems: 'center',
    background: '#111827',
    color: '#fff',
    flex: '0 0 auto',
  },
  h1: { margin: 0, fontSize: 26 },
  h2: { margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#6b7280' },
  pill: {
    display: 'inline-block',
    background: '#fff7ed',
    color: '#9a3412',
    padding: '6px 10px',
    borderRadius: 999,
    fontSize: 12,
    margin: '10px 0 14px',
  },
  p: { margin: '0 0 14px', color: '#444', lineHeight: 1.45 },
  dateBox: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 18px' },
  badge: { background: '#eef2ff', color: '#3730a3', padding: '10px 12px', borderRadius: 12, fontSize: 13 },
  counter: { background: '#ecfeff', color: '#155e75', padding: '10px 12px', borderRadius: 12, fontSize: 13 },
  row: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 },
  btn: {
    display: 'inline-block',
    textDecoration: 'none',
    background: '#111827',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: 12,
    fontWeight: 700,
  },
  btn2: {
    display: 'inline-block',
    textDecoration: 'none',
    background: '#2563eb',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: 12,
    fontWeight: 700,
  },
  link: { color: '#2563eb', textDecoration: 'none', fontWeight: 600 },
  small: { color: '#777', display: 'block', marginTop: 14 },
};
