// GearWatch price helper — a Cloudflare Worker.
// POST { items: [{ url, currency }], force } → { items: { <key>: { ok, price, currency, checked, how, via, error, detail } } }
// GET  ?url=<product link>                   → test one link and see exactly what was found (or why not).
// Deploy: dash.cloudflare.com → Workers & Pages → your worker → Edit code → paste this file → Deploy.

// ---- core (shared with scripts/check-prices.mjs) ----
const SYM = { EUR: '€', USD: '$', GBP: '£' };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const HEAD = { 'user-agent': UA, 'accept-language': 'en-GB,en;q=0.9', accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'cache-control': 'no-cache' };

// Must match normUrl() in the app.
const normUrl = u => {
  try {
    const x = new URL(u);
    const q = ['product_id', 'variant'].filter(k => x.searchParams.get(k)).map(k => k + '=' + x.searchParams.get(k)).join('&');
    return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (q ? '?' + q : '');
  } catch { return null; }
};

// "1.234,56" "1,234.56" "391,00" "€ 112" → number
const num = s => {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) && s > 0 ? s : null;
  let t = String(s).replace(/[^\d.,]/g, ''); if (!t) return null;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lc > -1) t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\.(?=.*\.)/g, '');
  const n = parseFloat(t); return Number.isFinite(n) && n > 0 ? n : null;
};
const codeOf = c => { if (!c) return null; c = String(c).trim(); return ({ '€': 'EUR', '$': 'USD', '£': 'GBP' })[c] || (/^[A-Z]{3}$/.test(c) ? c : null); };

const BOT = /cf-chl|challenge-platform|Just a moment\.\.\.|Attention Required|captcha-delivery|Access denied|Human verification|Checking if you(?:'|’)re human|security check to protect|Verify you are human|Pardon Our Interruption/i;
async function get(url, json) {
  const r = await fetch(url, { headers: json ? Object.assign({}, HEAD, { accept: 'application/json' }) : HEAD, redirect: 'follow' });
  const text = await r.text();
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.blocked = [401, 403, 429, 503].includes(r.status); throw e; }
  if (json && /^\s*</.test(text) && BOT.test(text.slice(0, 20000))) { const e = new Error('bot check page'); e.blocked = true; throw e; }
  if (!json && text.length < 40000 && BOT.test(text)) { const e = new Error('bot check page'); e.blocked = true; throw e; }
  return text;
}
// A public page reader that loads the page in a real browser. Used when a shop blocks us.
let READER_KEY = ''; // optional free key from jina.ai for a higher limit (set JINA_KEY on the worker)
async function reader(url, fmt, wait) {
  // Give the browser time to get past "checking if you're human" pages and wait until a price shows.
  const h = { 'x-return-format': fmt || 'html', accept: 'text/html,text/plain', 'x-timeout': '25', 'x-no-cache': 'true', 'x-engine': 'browser' };
  if (wait) h['x-wait-for-selector'] = '[data-price-type="finalPrice"], [itemprop="price"], .price, .product-price, .price-box';
  if (READER_KEY) h.authorization = 'Bearer ' + READER_KEY;
  const r = await fetch('https://r.jina.ai/' + url, { headers: h });
  if (!r.ok) throw new Error('reader HTTP ' + r.status + (r.status === 429 && !READER_KEY ? ' (too many requests, add a JINA_KEY)' : ''));
  const t = await r.text(); if (t.length < 40000 && BOT.test(t)) throw new Error('reader got the bot check too');
  return t;
}

// ---- shop platforms with a clean product feed ----
async function shopify(u) {
  if (!/\/products\/[^/?#]+/.test(u.pathname)) return null;
  const base = u.origin + u.pathname.replace(/\/+$/, ''), variant = u.searchParams.get('variant');
  const j = JSON.parse(await get(base + '.js', true)), vs = j.variants || [];
  const v = vs.find(x => String(x.id) === variant) || vs.find(x => x.available) || vs[0];
  if (!v || !v.price) return null;
  let cur = null; try { cur = JSON.parse(await get(u.origin + '/cart.js', true)).currency || null; } catch {}
  return { price: v.price / 100, cur, how: 'Shopify feed' };
}
async function woo(u) {
  const m = u.pathname.match(/\/product\/([^/?#]+)/); if (!m) return null;
  const j = JSON.parse(await get(u.origin + '/wp-json/wc/store/v1/products?slug=' + encodeURIComponent(m[1]), true));
  const p = Array.isArray(j) ? j[0] : null; if (!p || !p.prices) return null;
  const pr = p.prices, d = Math.pow(10, pr.currency_minor_unit ?? 2);
  const raw = Number(pr.price) || (pr.price_range ? Number(pr.price_range.min_amount) : 0);
  if (!raw) return null;
  return { price: raw / d, cur: pr.currency_code || null, how: 'WooCommerce feed' };
}

async function magento(u) {
  const m = u.pathname.match(/\/([^/]+)\.html$/); if (!m) return null;
  const q = '{products(filter:{url_key:{eq:"' + m[1].replace(/"/g, '') + '"}}){items{name price_range{minimum_price{final_price{value currency}}}}}}';
  const j = JSON.parse(await get(u.origin + '/graphql?query=' + encodeURIComponent(q), true));
  const it = j && j.data && j.data.products && (j.data.products.items || [])[0], fp = it && it.price_range && it.price_range.minimum_price && it.price_range.minimum_price.final_price;
  if (!fp || !num(fp.value)) return null;
  return { price: num(fp.value), cur: fp.currency || null, how: 'Magento feed' };
}

// ---- reading a product page ----
function fromJsonLd(html, u) {
  const found = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, '')); } catch { continue; }
    const stack = [j];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { stack.push(...o); continue; }
      const type = [].concat(o['@type'] || []).join(' ');
      if (/Product/i.test(type) && o.offers) {
        for (const of of [].concat(o.offers)) {
          if (!of) continue;
          for (const x of [of].concat(of.offers || [])) {
            const specs = [].concat(x.priceSpecification || []).filter(s => s && !/ListPrice|StrikethroughPrice/i.test(s.priceType || ''));
            const price = num(x.price ?? x.lowPrice ?? (specs[0] && specs[0].price));
            if (price) found.push({ price, cur: x.priceCurrency || (specs[0] && specs[0].priceCurrency) || null, url: x.url || '' });
          }
        }
      }
      for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  if (!found.length) return null;
  const variant = u.searchParams.get('variant'), pick = (variant && found.find(f => f.url.includes(variant))) || found.slice().sort((a, b) => a.price - b.price)[0];
  return { price: pick.price, cur: pick.cur, how: 'product data on the page' };
}
const meta = (html, prop) => {
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]*content=["']([^"']+)`, 'i'));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${prop}["']`, 'i'));
  return (a || b || [])[1] || null;
};
const visible = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&euro;/g, '€').replace(/&pound;/g, '£').replace(/&#36;|&dollar;/g, '$').replace(/\s+/g, ' ');
// Libidex: "£119.95 ($160.4 approx )" or "Regular Price £84.95 Special Price £76.46 (... approx)". The first one is the product's own.
const LIBI = /(?:Regular Price\s*£\s?[\d,]+\.\d{2}\s*Special Price\s*)?£\s?([\d,]+\.\d{2})\s*\([^)]*approx/i;
const PRICE = /([$€£])\s?(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\s*(USD|EUR|GBP)?|(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\s?(€|EUR|USD|GBP|£)/g;

function parse(html, u) {
  // Magento (Libidex): the final (sale) price. Amount is in the store currency.
  const mg = html.match(/data-price-amount=["']([\d.]+)["'][^>]*data-price-type=["']finalPrice/i) || html.match(/data-price-type=["']finalPrice["'][^>]*data-price-amount=["']([\d.]+)/i);
  if (mg && num(mg[1])) return { price: num(mg[1]), cur: null, how: 'Magento price' };
  const ld = fromJsonLd(html, u); if (ld) return ld;
  const ip = meta(html, 'price'); if (num(ip)) return { price: num(ip), cur: meta(html, 'priceCurrency'), how: 'price tag on the page' };
  const mp = meta(html, 'product:price:amount') || meta(html, 'og:price:amount');
  if (num(mp)) return { price: num(mp), cur: meta(html, 'product:price:currency') || meta(html, 'og:price:currency'), how: 'page preview tags' };
  // WooCommerce theme markup: <p class="price"> … <ins> sale … <bdi>€112,00</bdi>
  const wc = html.match(/class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]{0,800}?)<\/(?:p|div)>/i);
  if (wc) { const block = (wc[1].match(/<ins[\s\S]*?<\/ins>/i) || [wc[1]])[0], b = visible(block).match(/([$€£])\s?([\d.,]+)|([\d.,]+)\s?([$€£])/);
    if (b && num(b[2] || b[3])) return { price: num(b[2] || b[3]), cur: codeOf(b[1] || b[4]), how: 'shop price box' }; }
  // Prices embedded in the page's own scripts (Wix, custom shops)
  const ej = html.match(/"(?:price|formattedPrice|finalPrice|salePrice|discountedPrice)"\s*:\s*"?[^\d"]{0,4}(\d+(?:[.,]\d{1,2})?)"?[^{}]{0,160}?"(?:priceCurrency|currency|currencyCode)"\s*:\s*"([A-Z]{3})"/)
    || html.match(/"(?:priceCurrency|currency|currencyCode)"\s*:\s*"([A-Z]{3})"[^{}]{0,160}?"(?:price|finalPrice|salePrice|discountedPrice)"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)/);
  if (ej) { const a = /^[A-Z]{3}$/.test(ej[1]) ? { c: ej[1], p: ej[2] } : { c: ej[2], p: ej[1] }; if (num(a.p)) return { price: num(a.p), cur: a.c, how: 'shop page data' }; }
  const text = visible(html);
  const lb = text.match(LIBI); if (lb) return { price: num(lb[1]), cur: 'GBP', how: 'Libidex price' };
  // Latex Catfish (OpenCart): "$29.00 USD BASE PRICE"
  const cf = text.match(/[$€£]\s?([\d,]+\.\d{2})\s*(USD|EUR|GBP)\s*(?:[$€£]\s?[\d,]+\.\d{2}\s*(?:USD|EUR|GBP)\s*)?BASE PRICE/i);
  if (cf) return { price: num(cf[1]), cur: cf[2], how: 'Latex Catfish price' };
  // Last resort: the first real price in the visible text, skipping cart totals and shipping thresholds.
  for (const t of text.matchAll(PRICE)) {
    const before = text.slice(Math.max(0, t.index - 30), t.index);
    if (/(free (shipping|delivery)[^€$£]*|over|above|orders? from|spend|cart|subtotal|total|basket)\s*:?\s*$/i.test(before)) continue;
    const p = num(t[2] || t[4]); if (!p) continue;
    return { price: p, cur: codeOf(t[3] || t[1] || t[5]), how: 'first price on the page (a guess)' };
  }
  return null;
}

async function check(entry) {
  const u = new URL(entry.url), tried = [];
  for (const fn of [shopify, woo, magento]) {
    try { const r = await fn(u); if (r) return Object.assign(r, { via: 'feed' }); } catch (e) { tried.push(fn.name + ': ' + e.message); }
  }
  let blocked = false;
  try { const html = await get(entry.url); const r = parse(html, u); if (r) return Object.assign(r, { via: 'page' });
    const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim().slice(0, 80);
    tried.push('page: no price found (' + Math.round(html.length / 1024) + ' KB, title "' + title + '", starts "' + visible(html).trim().slice(0, 140) + '")'); }
  catch (e) { blocked = !!e.blocked; tried.push('page: ' + e.message); }
  for (const [fmt, wait] of [['html', true], ['html', false], ['text', false]]) {
    const name = 'reader ' + fmt + (wait ? ' (waiting for price)' : '');
    try { const h = await reader(entry.url, fmt, wait); const r = parse(h, u); if (r) return Object.assign(r, { via: 'reader' }); tried.push(name + ': no price found'); }
    catch (e) { tried.push(name + ': ' + e.message); if (/429/.test(e.message)) break; }
  }
  const err = new Error(blocked ? 'Shop blocked the check' : 'No price found on the page'); err.detail = tried.join(' · '); throw err;
}
// Libidex labels amounts in the visitor's currency but charges in pounds; trust what the user saved.
const curFor = (entry, r) => /libidex\.com/.test(entry.url) ? entry.currency : (SYM[codeOf(r.cur)] || codeOf(r.cur) || entry.currency);
// ---- end core ----

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, CORS) });

async function one(entry, ctx, force) {
  const key = normUrl(entry.url); if (!key) return null;
  const cache = caches.default, ck = new Request('https://gearwatch-cache/v2/' + encodeURIComponent(key));
  if (!force) { const hit = await cache.match(ck); if (hit) return [key, await hit.json()]; }
  let out; const now = new Date().toISOString(), lk = new Request('https://gearwatch-cache/last-ok/' + encodeURIComponent(key));
  try { const r = await check(entry); out = { ok: true, price: r.price, currency: curFor(entry, r), checked: now, okAt: now, how: r.how, via: r.via };
    ctx.waitUntil(cache.put(lk, new Response(JSON.stringify(out), { headers: { 'cache-control': 'max-age=' + 7 * 86400 } }))); }
  catch (e) {
    // Shops like Libidex let the check through only some of the time. Keep the last price that was read (up to a week old).
    const last = await cache.match(lk).then(x => (x ? x.json() : null)).catch(() => null);
    out = last ? Object.assign({}, last, { checked: now, stale: true, error: String(e.message || e), detail: e.detail || '' })
      : { ok: false, price: null, currency: entry.currency, checked: now, error: String(e.message || e), detail: e.detail || '' }; }
  // Remember each result for 6 hours (failures for 1) so shops aren't hit on every app open.
  ctx.waitUntil(cache.put(ck, new Response(JSON.stringify(out), { headers: { 'cache-control': 'max-age=' + (out.ok ? 21600 : 3600) } })));
  return [key, out];
}

export default {
  async fetch(req, env, ctx) {
    READER_KEY = (env && env.JINA_KEY) || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method === 'GET') {
      const url = new URL(req.url).searchParams.get('url');
      if (!url) return json({ ok: true, about: 'GearWatch price helper. Add ?url=<product link> to test a link.' });
      const r = await one({ url, currency: new URL(req.url).searchParams.get('cur') || '€' }, ctx, true);
      return json(r ? Object.assign({ key: r[0] }, r[1]) : { error: 'Not a valid link' });
    }
    if (req.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);
    let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    const list = (body.items || []).filter(x => x && /^https?:\/\//.test(x.url || '')).slice(0, 40), force = !!body.force;
    const items = {};
    for (let i = 0; i < list.length; i += 5) {
      const res = await Promise.all(list.slice(i, i + 5).map(e => one(e, ctx, force)));
      res.forEach(r => { if (r) items[r[0]] = r[1]; });
    }
    return json({ items });
  }
};
