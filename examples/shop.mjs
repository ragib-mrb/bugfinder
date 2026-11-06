// A small shop with planted bugs. Run: npm run example
// Then open http://localhost:3078 and click around, and watch http://localhost:3078/__bugfinder
import { bugfinder } from '../dist/index.js';
import express from 'express';
import mysql from 'mysql2';

const app = express();
app.use(bugfinder(app));
app.use(express.json());

const products = [
  { id: 1, name: 'Notebook', price: 120 },
  { id: 2, name: 'Pen', price: 20 },
];

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Demo shop</title>
<style>body{font:15px system-ui;max-width:640px;margin:40px auto;padding:0 16px}button{margin:4px 6px 4px 0;padding:8px 12px}pre{background:#f4f4f4;padding:8px;white-space:pre-wrap}</style></head>
<body>
<h1>Demo shop</h1>
<p>Each button has a different kind of bug. Watch <a href="/__bugfinder" target="_blank">bugfinder</a> while you click.</p>
<button id="load">Load products</button>
<button id="pay">Pay now</button>
<form id="profile" aria-label="Profile" novalidate><input name="email" type="text" placeholder="email" value="not-an-email"><input name="password" type="password" value="hunter2"><button>Save profile</button></form>
<button id="broken">Show discount</button>
<button id="report">Sales report</button>
<button id="stock">Check stock</button>
<pre id="out"></pre>
<script>
const out = document.getElementById('out');
const show = async (res) => { out.textContent = res.status + ' ' + await res.text(); };
document.getElementById('load').onclick = () => fetch('/api/products').then(show);
document.getElementById('pay').onclick = () => fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 1, qty: 2, card: '4242424242424242' }) }).then(show);
document.getElementById('profile').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(f)) }).then(show); };
document.getElementById('broken').onclick = () => { const discount = undefined; out.textContent = discount.percent + '% off'; };
document.getElementById('report').onclick = () => fetch('/api/report').then(show);
document.getElementById('stock').onclick = () => fetch('/api/stock/1').then(show);
</script>
</body></html>`);
});

app.get('/api/products', (_req, res) => res.json(products));

function chargeCard(amount) {
  console.log('charging card', { amount });
  throw Object.assign(new Error('payment provider timed out after 3000ms'), { name: 'TimeoutError' });
}

app.post('/api/orders', (req, res) => {
  const product = products.find((p) => p.id === req.body.productId);
  chargeCard(product.price * req.body.qty);
  res.status(201).json({ ok: true });
});

app.post('/api/profile', (req, res) => {
  if (!/^\S+@\S+$/.test(req.body.email ?? '')) {
    return res
      .status(422)
      .json({ error: { code: 'invalid_email', message: 'Please enter a valid email address.' } });
  }
  res.json({ ok: true });
});

app.get('/api/report', async (_req, res) => {
  console.log('building sales report');
  await new Promise((r) => setTimeout(r, 900));
  res.json({ total: 1440 });
});

// Points at a MySQL server that isn't running, so the query fails on purpose.
const db = mysql.createPool({
  host: '127.0.0.1',
  port: 3399,
  user: 'shop',
  database: 'shop',
  connectTimeout: 1500,
});
app.get('/api/stock/:id', (req, res, next) => {
  db.query('SELECT qty FROM stock WHERE product_id = ?', [req.params.id], (err, rows) => {
    if (err) return next(err);
    res.json(rows[0] ?? { qty: 0 });
  });
});

// The app's own error handler: hides details from users, like a real app would.
app.use((err, _req, res, _next) => {
  res
    .status(502)
    .json({ error: { code: 'upstream_failed', message: 'Something went wrong. Please try again.' } });
});

const port = Number(process.env.PORT ?? 3078);
app.listen(port, '127.0.0.1', () => {
  console.log(`Demo shop on http://localhost:${port}  ·  bugfinder: http://localhost:${port}/__bugfinder`);
});
