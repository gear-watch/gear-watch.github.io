// Reads watchlist.json, fetches each product page, writes prices.json.
// Run by .github/workflows/check-prices.yml once a day (or by hand from the Actions tab).
import fs from 'node:fs/promises';

const SYM = { EUR: '€', USD: '$', GBP: '£' };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Must match normUrl() in GearWatch.dc.html.
const normUrl = u => {
  try {
    const x = new URL(u);
    const q = ['product_id', 'variant'].filter(k => x.searchParams.get(k)).map(k => k + '=' + x.searchParams.get(k)).join('&');
    return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (q ? '?' + q : '');
  } catch { return null; }
};
const num = s => { let t = String(s).trim(); t = /^\d{1,3}(\.\d{3})*,\d{2}$|^\d+,\d{2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''); const n = parseFloat(t); return Number.isFinite(n) ? n : null; };
const meta = (html, prop) => {
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, 'i'));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
  return (a || b || [])[1] || null;
};

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-GB,en;q=0.9', accept: 'text/html,application/json' }, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function fromJsonLd(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = [j];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { stack.push(...o); continue; }
      if (o.offers) {
        const offers = [].concat(o.offers);
        for (const of of offers) {
          const spec = of.priceSpecification ? [].concat(of.priceSpecification)[0] : null;
          const price = num(of.price ?? of.lowPrice ?? spec?.price);
          const cur = of.priceCurrency ?? spec?.priceCurrency;
          if (price != null) return { price, cur };
        }
      }
      Object.values(o).forEach(v => { if (v && typeof v === 'object') stack.push(v); });
    }
  }
  return null;
}

async function check(entry) {
  const url = entry.url, host = new URL(url).hostname;
  // Shopify stores expose a JSON feed per product.
  if (/\/products\//.test(url)) {
    try {
      const x = new URL(url), variant = x.searchParams.get('variant');
      const j = JSON.parse(await get(x.origin + x.pathname.replace(/\/+$/, '') + '.js'));
      const v = (j.variants || []).find(v => String(v.id) === variant) || (j.variants || [])[0];
      if (v) {
        const html = await get(url).catch(() => '');
        return { price: v.price / 100, cur: meta(html, 'og:price:currency') || meta(html, 'product:price:currency') || null };
      }
    } catch { /* fall through to the page */ }
  }
  let html = '', blocked = null;
  try { html = await get(url); } catch (e) { blocked = e; }
  const found = html ? parse(html) : null; if (found) return found;
  // Some shops (Libidex, behind Cloudflare) block server requests. Retry through a public page reader.
  const txt = await fetch('https://r.jina.ai/' + url, { headers: { 'x-return-format': 'text', 'user-agent': UA } }).then(r => (r.ok ? r.text() : '')).catch(() => '');
  if (txt) { const lb = txt.match(LIBI); if (lb) return { price: num(lb[1]), cur: 'GBP' }; const f2 = parse(txt); if (f2) return f2; }
  throw new Error(blocked ? 'Shop blocked the check (' + blocked.message + ')' : 'No price found on ' + host);
}

// Libidex text: "£119.95 ($160.4 approx )", or "Regular Price £84.95 Special Price £76.46 (...approx)". The first one is the product's own price.
const LIBI = /(?:Regular Price\s*£\s?[\d,]+\.\d{2}\s*Special Price\s*)?£\s?([\d,]+\.\d{2})\s*\([^)]*approx/i;
function parse(html) {
  // Magento (Libidex): the final (sale) price. Amount is in the store currency.
  const mg = html.match(/data-price-amount=["']([\d.]+)["'][^>]*data-price-type=["']finalPrice/i) || html.match(/data-price-type=["']finalPrice["'][^>]*data-price-amount=["']([\d.]+)/i);
  if (mg) return { price: num(mg[1]), cur: null };
  const ld = fromJsonLd(html);
  if (ld) return ld;
  const m = meta(html, 'product:price:amount') || meta(html, 'og:price:amount');
  if (m) return { price: num(m), cur: meta(html, 'product:price:currency') || meta(html, 'og:price:currency') };
  // Latex Catfish (OpenCart): "$29.00 USD BASE PRICE".
  const cf = html.replace(/<[^>]+>/g, ' ').match(/[$€£]\s?([\d,]+\.\d{2})\s*(USD|EUR|GBP)\s*(?:[$€£]\s?[\d,]+\.\d{2}\s*(?:USD|EUR|GBP)\s*)?BASE PRICE/i);
  if (cf) return { price: num(cf[1]), cur: cf[2] };
  const lt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(LIBI); if (lt) return { price: num(lt[1]), cur: 'GBP' };
  // Plain-text fallback: first non-zero price on the page (skips an empty "$0.00" cart).
  for (const t of html.replace(/<[^>]+>/g, ' ').matchAll(/([$€£])\s?([\d,]+\.\d{2})\s*(USD|EUR|GBP)?/g)) {
    if (num(t[2]) > 0) return { price: num(t[2]), cur: t[3] || ({ '$': 'USD', '€': 'EUR', '£': 'GBP' })[t[1]] };
  }
  return null;
}

const list = JSON.parse(await fs.readFile('watchlist.json', 'utf8'));
let prev = { items: {} };
try { prev = JSON.parse(await fs.readFile('prices.json', 'utf8')); } catch {}
const now = new Date().toISOString(), items = {};

for (const entry of list) {
  const key = normUrl(entry.url);
  if (!key) continue;
  try {
    const r = await check(entry);
    // Libidex and similar label the amount in the visitor's currency but charge in their own; trust the watch list.
    const cur = /libidex\.com/.test(entry.url) ? entry.currency : (SYM[r.cur] || r.cur || entry.currency);
    items[key] = { ok: true, price: r.price, currency: cur, checked: now };
    console.log('ok  ', key, cur + r.price);
  } catch (e) {
    const old = prev.items?.[key];
    items[key] = { ok: false, price: old?.price ?? null, currency: old?.currency ?? entry.currency, checked: now, error: String(e.message || e) };
    console.log('fail', key, e.message);
  }
  await new Promise(r => setTimeout(r, 1500));
}

await fs.writeFile('prices.json', JSON.stringify({ updated: now, items }, null, 2) + '\n');
