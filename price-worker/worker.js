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
// Give the browser time to get past "checking if you're human" pages. To save the reader's allowance,
// ask it for only the price area of the page (a few hundred characters instead of the whole page).
const PRICE_SEL = '[data-price-type="finalPrice"], .product-info-price, .price-box, [itemprop="price"], .product-price, .summary .price, .price';
async function readerGo(url, fmt, target) {
  const h = { 'x-return-format': fmt, accept: 'text/html,text/plain', 'x-timeout': '25', 'x-no-cache': 'true', 'x-engine': 'browser', 'x-retain-images': 'none' };
  if (target) { h['x-wait-for-selector'] = PRICE_SEL; h['x-target-selector'] = PRICE_SEL; }
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
  const was = v.compare_at_price && v.compare_at_price > v.price ? v.compare_at_price / 100 : null;
  return { price: v.price / 100, was, cur, how: 'Shopify feed' };
}
async function woo(u) {
  const m = u.pathname.match(/\/product\/([^/?#]+)/); if (!m) return null;
  const j = JSON.parse(await get(u.origin + '/wp-json/wc/store/v1/products?slug=' + encodeURIComponent(m[1]), true));
  const p = Array.isArray(j) ? j[0] : null; if (!p || !p.prices) return null;
  const pr = p.prices, d = Math.pow(10, pr.currency_minor_unit ?? 2);
  const raw = Number(pr.price) || (pr.price_range ? Number(pr.price_range.min_amount) : 0);
  if (!raw) return null;
  const reg = Number(pr.regular_price) || 0;
  return { price: raw / d, was: reg > raw ? reg / d : null, cur: pr.currency_code || null, how: 'WooCommerce feed' };
}

async function magento(u) {
  const m = u.pathname.match(/\/([^/]+)\.html$/); if (!m) return null;
  const q = '{products(filter:{url_key:{eq:"' + m[1].replace(/"/g, '') + '"}}){items{name price_range{minimum_price{final_price{value currency} regular_price{value}}}}}}';
  const j = JSON.parse(await get(u.origin + '/graphql?query=' + encodeURIComponent(q), true));
  const it = j && j.data && j.data.products && (j.data.products.items || [])[0], fp = it && it.price_range && it.price_range.minimum_price && it.price_range.minimum_price.final_price;
  if (!fp || !num(fp.value)) return null;
  const rp = it.price_range.minimum_price.regular_price, reg = rp && num(rp.value);
  return { price: num(fp.value), was: reg && reg > num(fp.value) ? reg : null, cur: fp.currency || null, how: 'Magento feed' };
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

// The original (before-sale) price, when the page shows one. Only trusted when it's above the price and not wildly off.
function wasOf(html, price) {
  if (!price) return null; const c = [];
  const mg = html.match(/data-price-amount=["']([\d.]+)["'][^>]*data-price-type=["']oldPrice/i) || html.match(/data-price-type=["']oldPrice["'][^>]*data-price-amount=["']([\d.]+)/i); if (mg) c.push(num(mg[1]));
  const lb = visible(html).match(/Regular Price\s*£\s?([\d,]+\.\d{2})\s*Special Price/i); if (lb) c.push(num(lb[1]));
  for (const m of html.matchAll(/"priceType"\s*:\s*"[^"]*(?:Strikethrough|ListPrice|SRP)[^"]*"[^{}]{0,200}?"price"\s*:\s*"?([\d.]+)/gi)) c.push(num(m[1]));
  for (const m of html.matchAll(/"price"\s*:\s*"?([\d.]+)"?[^{}]{0,200}?"priceType"\s*:\s*"[^"]*(?:Strikethrough|ListPrice|SRP)/gi)) c.push(num(m[1]));
  const wc = html.match(/class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]{0,800}?)<\/(?:p|div)>/i);
  if (wc) { const d = wc[1].match(/<(del|s|strike)\b[\s\S]*?<\/\1>/i); if (d) { const b = visible(d[0]).match(/[$€£]\s?([\d.,]+)|([\d.,]+)\s?[$€£]/); if (b) c.push(num(b[1] || b[2])); } }
  const ej = html.match(/"(?:compareAtPrice|compare_at_price|regularPrice|regular_price|originalPrice|oldPrice|listPrice|wasPrice)"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)/); if (ej) c.push(num(ej[1]));
  // Markdown from the page reader (~~€310~~), struck-out prices anywhere, "Was US $310.00", and "25% off" next to a matching price.
  const st = html.match(/~~\s*(?:US\s*)?[$€£]\s?([\d.,]+)\s*~~/); if (st) c.push(num(st[1]));
  const dl = html.match(/<(del|s|strike)\b[^>]*>\s*(?:<[^>]+>\s*)*(?:US\s*)?[$€£]\s?([\d.,]+)/i); if (dl) c.push(num(dl[2]));
  const wp = html.match(/\b(?:was|regular price|original price|compare at)\s*:?\s*(?:US\s*)?[$€£]\s?([\d.,]+)/i); if (wp) c.push(num(wp[1]));
  const pc = html.match(/(\d{1,2})\s?%\s*off/i); if (pc) { const g = price / (1 - Number(pc[1]) / 100); for (const m of html.matchAll(/[$€£]\s?([\d.,]+)/g)) { const v = num(m[1]); if (v && Math.abs(v - g) / g < 0.02) { c.push(v); break; } } }
  const ok = c.filter(x => x && x > price * 1.01 && x <= price * 4);
  return ok.length ? ok[0] : null;
}
function parse(html, u) { const r = parse0(html, u); if (r && r.was == null) r.was = wasOf(html, r.price); return r; }
function parse0(html, u) {
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
  // Cheapest first: just the price area as text, then as HTML, and only then the whole page.
  for (const [fmt, target] of [['text', true], ['html', true], ['text', false]]) {
    const name = 'reader ' + fmt + (target ? ' (price area)' : ' (whole page)');
    try { const h = await readerGo(entry.url, fmt, target); const r = parse(h, u); if (r) return Object.assign(r, { via: 'reader' }); tried.push(name + ': no price found'); }
    catch (e) { tried.push(name + ': ' + e.message); if (/429/.test(e.message)) break; }
  }
  const err = new Error(blocked ? 'Shop blocked the check' : 'No price found on the page'); err.detail = tried.join(' · '); throw err;
}
// Libidex labels amounts in the visitor's currency but charges in pounds; trust what the user saved.
const curFor = (entry, r) => /libidex\.com/.test(entry.url) ? entry.currency : (SYM[codeOf(r.cur)] || codeOf(r.cur) || entry.currency);
// ---- end core ----


// ---- looking up a new product: name, brand, price and photos (used once, when adding an item) ----
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&#8217;/g, '’').replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—').replace(/&nbsp;|&#160;/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const abs = (s, base) => { try { return new URL(String(s).trim().replace(/^\/\//, 'https://'), base).href; } catch { return null; } };
const BADIMG = /logo|icon|sprite|favicon|placeholder|swatch|payment|badge|banner|avatar|flag|loader|spinner|trustpilot|newsletter|megamenu|wysiwyg|\.svg(\?|$)|\.gif(\?|$)|^data:/i;
function cleanImgs(list, base) {
  const seen = new Set(), out = [];
  for (const s of list) {
    if (!s) continue; const u = abs(s, base); if (!u || !/^https?:/.test(u) || BADIMG.test(u)) continue;
    const k = u.replace(/\/cache\/[a-f0-9]{16,}\//, '/').replace(/[?#].*$/, '').replace(/(-\d+x\d+|_\d+x\d*)(?=\.\w+$)/, '');
    if (seen.has(k)) continue; seen.add(k); out.push(u); if (out.length >= 8) break;
  }
  return out;
}
function ldProduct(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = [j];
    while (stack.length) { const o = stack.pop(); if (!o || typeof o !== 'object') continue; if (Array.isArray(o)) { stack.push(...o); continue; }
      if (/Product/i.test([].concat(o['@type'] || []).join(' '))) return o; for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v); }
  }
  return null;
}
const trimSite = (name, site, host) => { const parts = name.split(/\s+[|–—-]\s+/); if (parts.length > 1) { const last = parts[parts.length - 1].toLowerCase(); if ((site && last.includes(site.toLowerCase())) || last.includes(host.split('.')[0]) || last.length < 25) return parts.slice(0, -1).join(' – '); } return name; };
function fromPage(html, u) {
  const p = ldProduct(html) || {}, pr = parse(html, u), imgs = [];
  [].concat(p.image || []).forEach(x => imgs.push(typeof x === 'string' ? x : x && (x.url || x.contentUrl)));
  for (const m of html.matchAll(/data-large_image=["']([^"']+)/g)) imgs.push(m[1]);
  for (const m of html.matchAll(/"full"\s*:\s*"(https?:[^"]+)"/g)) imgs.push(m[1].replace(/\\\//g, '/'));
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)/gi)) imgs.push(m[1]);
  const site = meta(html, 'og:site_name'), brand = p.brand ? decode(typeof p.brand === 'string' ? p.brand : p.brand.name) : null;
  const raw = decode(p.name || meta(html, 'og:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  return { name: trimSite(raw, site, u.hostname.replace(/^www\./, '')), brand: brand || site || null, price: pr ? pr.price : null, was: pr ? pr.was : null, cur: pr ? pr.cur : null, images: cleanImgs(imgs, u.href) };
}
function fromMarkdown(md, u) {
  const site = u.hostname.replace(/^www\./, '').split('.')[0].toLowerCase(), bad = t => !t || t.trim().toLowerCase() === site || /^(home|menu|search|cart|shop|log ?in|sign ?in|account)$/i.test(t.trim());
  let title = decode((md.match(/^Title:\s*(.+)$/m) || [])[1] || '');
  if (bad(title)) { const hs = Array.from(md.matchAll(/^#{1,3}\s+(.+)$/gm)).map(m => decode(m[1].replace(/[*_\x60]/g, ''))).filter(t => !bad(t) && t.length > 3 && !/^\W*$/.test(t)); title = hs[0] || ''; }
  if (bad(title)) { const bs = Array.from(md.matchAll(/\*\*([^*\n]{4,120})\*\*/g)).map(m => decode(m[1])).filter(t => !bad(t) && !/[$€£]\s?\d/.test(t)); title = bs[0] || title; }
  let imgs = Array.from(md.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)/g)).map(m => m[1]);
  const prod = imgs.filter(s => /product|catalog|uploads|cdn\.shopify|wixstatic/i.test(s)); if (prod.length) imgs = prod;
  const pr = parse(md, u);
  return { name: trimSite(title, '', u.hostname.replace(/^www\./, '')), brand: null, price: pr ? pr.price : null, was: pr ? pr.was : null, cur: pr ? pr.cur : null, images: cleanImgs(imgs, u.href) };
}
async function readerMd(url) {
  const h = { 'x-return-format': 'markdown', accept: 'text/plain', 'x-timeout': '25', 'x-no-cache': 'true', 'x-engine': 'browser' };
  if (READER_KEY) h.authorization = 'Bearer ' + READER_KEY;
  const r = await fetch('https://r.jina.ai/' + url, { headers: h });
  if (!r.ok) throw new Error('reader HTTP ' + r.status);
  const t = await r.text(); if (t.length < 20000 && BOT.test(t)) throw new Error('reader got the bot check too'); return t;
}
// Colour and size choices from a shop feed: [{ name: 'Color', values: [...] }, ...]
function optsFrom(list) { const o = { colors: [], sizes: [] };
  for (const x of list || []) { const n = String(x && x.name || ''), vals = (x.values || []).map(v => decode(typeof v === 'string' ? v : v && v.name)).filter(Boolean).slice(0, 30);
    if (/colou?r|kleur|farbe|couleur/i.test(n)) o.colors = vals.map(name => ({ name })); else if (/size|maat|größe|taille/i.test(n)) o.sizes = vals; }
  return o.colors.length || o.sizes.length ? o : null; }
async function lookup(url) {
  const u = new URL(url), tried = [];
  if (/\/products\/[^/?#]+/.test(u.pathname)) {
    try { const j = JSON.parse(await get(u.origin + u.pathname.replace(/\/+$/, '') + '.js', true)), variant = u.searchParams.get('variant'), vs = j.variants || [];
      const v = vs.find(x => String(x.id) === variant) || vs.find(x => x.available) || vs[0];
      let cur = null; try { cur = JSON.parse(await get(u.origin + '/cart.js', true)).currency || null; } catch {}
      return { name: decode(j.title), brand: decode(j.vendor) || null, price: v && v.price ? v.price / 100 : j.price ? j.price / 100 : null, was: v && v.compare_at_price && v.compare_at_price > v.price ? v.compare_at_price / 100 : null, cur, images: cleanImgs([v && v.featured_image && v.featured_image.src].concat(j.images || []), u.href), desc: j.description || '', options: optsFrom((j.options || []).map(x => typeof x === 'string' ? null : x).filter(Boolean)), how: 'Shopify feed' };
    } catch (e) { tried.push('shopify: ' + e.message); }
  }
  const wm = u.pathname.match(/\/product\/([^/?#]+)/);
  if (wm) {
    try { const j = JSON.parse(await get(u.origin + '/wp-json/wc/store/v1/products?slug=' + encodeURIComponent(wm[1]), true)), p = Array.isArray(j) ? j[0] : null;
      if (p) { const pr = p.prices || {}, d = Math.pow(10, pr.currency_minor_unit ?? 2), raw = Number(pr.price) || (pr.price_range ? Number(pr.price_range.min_amount) : 0);
        return { name: decode(p.name), brand: (p.brands && p.brands[0] && decode(p.brands[0].name)) || null, price: raw ? raw / d : null, was: Number(pr.regular_price) > raw ? Number(pr.regular_price) / d : null, cur: pr.currency_code || null, images: cleanImgs((p.images || []).map(x => x.src), u.href), desc: (p.short_description || '') + ' ' + (p.description || ''), options: optsFrom((p.attributes || []).map(a => ({ name: a.name, values: (a.terms || []).map(t => t.name) }))), how: 'WooCommerce feed' }; }
    } catch (e) { tried.push('woocommerce: ' + e.message); }
  }
  let siteBrand = null;
  try { const html = await get(url), r = fromPage(html, u), site = String(meta(html, 'og:site_name') || '').trim(), host = u.hostname.replace(/^www\./, '').split('.')[0].toLowerCase();
    const gen = !r.name || r.name.trim().toLowerCase() === site.toLowerCase() || r.name.trim().toLowerCase() === host;
    if (gen) { siteBrand = site || null; r.name = ''; r.images = r.images.filter(x => !/og|banner|share|social/i.test(x)); if (/og:image:width" content="3[0-9]{3}/.test(html)) r.images = []; }
    if (r.name && (r.images.length || r.price)) { const md = html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)/i); return Object.assign(r, { desc: r.desc || (md ? md[1] : ''), how: 'product page' }); } tried.push('page: not enough found'); }
  catch (e) { tried.push('page: ' + e.message); }
  try { const md = await readerMd(url), r = fromMarkdown(md, u); if (r.name || r.images.length) return Object.assign(r, { brand: r.brand || siteBrand, desc: r.desc || md.slice(0, 3000), how: 'page reader' }); tried.push('reader: nothing found'); }
  catch (e) { tried.push('reader: ' + e.message); }
  const err = new Error('Couldn’t read that page'); err.detail = tried.join(' · '); throw err;
}
async function lookupOne(url, ctx) {
  const key = normUrl(url); if (!key) return { ok: false, error: 'Not a valid link' };
  const cache = caches.default, ck = new Request('https://gearwatch-cache/lookup5/' + encodeURIComponent(key));
  const hit = await cache.match(ck); if (hit) return hit.json();
  let out;
  try { const r = await lookup(url), code = codeOf(r.cur); out = { ok: true, name: r.name || '', brand: r.brand || '', price: r.price ?? null, was: r.was ?? null, options: r.options || null, currency: /libidex\.com/.test(url) ? '£' : (SYM[code] || code || null), images: r.images || [], desc: decode(String(r.desc || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 1500), how: r.how }; }
  catch (e) { out = { ok: false, error: String(e.message || e), detail: e.detail || '' }; }
  ctx.waitUntil(cache.put(ck, new Response(JSON.stringify(out), { headers: { 'cache-control': 'max-age=' + (out.ok ? 86400 : 600) } })));
  return out;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'vary': 'origin' };
function sameKey(a, b) { a = String(a || ''); b = String(b || ''); if (!a || !b) return false; let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
function corsFor(req, env) {
  const o = req.headers.get('origin') || '', fixed = String((env && env.APP_URL) || '').trim();
  let ok = '';
  try { if (fixed && o === new URL(fixed).origin) ok = o; } catch (e) {}
  if (!ok && (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))) ok = o;
  CORS['access-control-allow-origin'] = ok || (fixed ? (() => { try { return new URL(fixed).origin; } catch (e) { return 'null'; } })() : 'null');
}
// Only signed-in GearWatch users can use the price helper. Checked with Supabase, remembered for 10 minutes.
async function signedIn(req, env, ctx) {
  const SB = String((env && env.SUPABASE_URL) || '').trim().replace(/\/+$/, ''), K = String((env && env.SUPABASE_ANON_KEY) || '').trim();
  if (!SB || !K) return { error: 'The price helper isn’t set up yet: add SUPABASE_URL and SUPABASE_ANON_KEY to the worker.', status: 503 };
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!tok || tok === K) return { error: 'Sign in to use price checks.', status: 401 };
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok))), b => b.toString(16).padStart(2, '0')).join('');
  const cache = caches.default, ck = new Request('https://gearwatch-cache/auth/' + h), hit = await cache.match(ck);
  if (hit) return { uid: await hit.text() };
  const r = await fetch(SB + '/auth/v1/user', { headers: { apikey: K, Authorization: 'Bearer ' + tok } });
  if (!r.ok) return { error: 'Your sign-in has expired. Open GearWatch again.', status: 401 };
  const u = await r.json(); if (!u || !u.id) return { error: 'Sign in to use price checks.', status: 401 };
  ctx.waitUntil(cache.put(ck, new Response(u.id, { headers: { 'cache-control': 'max-age=300' } })));
  return { uid: u.id };
}
// Rough per-person limits so one account can't burn the quota: 150 links per 10 minutes, 1500 a day.
async function underLimit(uid, n, ctx) {
  const cache = caches.default, now = Date.now();
  const slots = [['m', Math.floor(now / 6e5), 150, 660], ['d', Math.floor(now / 864e5), 1500, 90000]];
  const used = await Promise.all(slots.map(async ([k, s]) => { const h = await cache.match(new Request('https://gearwatch-cache/rate/' + uid + '/' + k + s)); return h ? parseInt(await h.text(), 10) || 0 : 0; }));
  if (slots.some(([, , max], i) => used[i] + n > max)) return false;
  slots.forEach(([k, s, , ttl], i) => ctx.waitUntil(cache.put(new Request('https://gearwatch-cache/rate/' + uid + '/' + k + s), new Response(String(used[i] + n), { headers: { 'cache-control': 'max-age=' + ttl } }))));
  return true;
}
const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, CORS) });

async function one(entry, ctx, force) {
  const key = normUrl(entry.url); if (!key) return null;
  const cache = caches.default, ck = new Request('https://gearwatch-cache/v2/' + encodeURIComponent(key));
  if (!force) { const hit = await cache.match(ck); if (hit) return [key, await hit.json()]; }
  let out; const now = new Date().toISOString(), lk = new Request('https://gearwatch-cache/last-ok/' + encodeURIComponent(key));
  try { const r = await check(entry); out = { ok: true, price: r.price, was: r.was ?? null, currency: curFor(entry, r), checked: now, okAt: now, how: r.how, via: r.via };
    ctx.waitUntil(cache.put(lk, new Response(JSON.stringify(out), { headers: { 'cache-control': 'max-age=' + 7 * 86400 } }))); }
  catch (e) {
    // Shops like Libidex let the check through only some of the time. Keep the last price that was read (up to a week old).
    const last = await cache.match(lk).then(x => (x ? x.json() : null)).catch(() => null);
    out = last ? Object.assign({}, last, { checked: now, stale: true, error: String(e.message || e), detail: e.detail || '' })
      : { ok: false, price: null, currency: entry.currency, checked: now, error: String(e.message || e), detail: e.detail || '' }; }
  // Remember results so shops (and the reader allowance) aren't used on every app open:
  // 6 hours for normal checks, 24 hours when the reader was needed, 6 hours for blocked checks.
  const ttl = out.stale ? 21600 : out.ok ? (out.via === 'reader' ? 86400 : 21600) : 3600;
  ctx.waitUntil(cache.put(ck, new Response(JSON.stringify(out), { headers: { 'cache-control': 'max-age=' + ttl } })));
  return [key, out];
}

async function imgProxy(u) {
  if (!/^https?:\/\//.test(u)) return json({ error: 'Not a valid link' }, 400);
  try { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }, cf: { cacheTtl: 86400, cacheEverything: true } });
    const ct = r.headers.get('content-type') || ''; if (!r.ok || !/^image\//.test(ct)) return json({ error: 'Not an image' }, 502);
    return new Response(r.body, { headers: Object.assign({ 'content-type': ct, 'cache-control': 'public, max-age=86400' }, CORS) });
  } catch (e) { return json({ error: String(e.message || e) }, 502); }
}

// ===== Share link previews =====
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function shareRow(id, env) {
  const SB = String((env && env.SUPABASE_URL) || '').trim().replace(/\/+$/, ''), K = String((env && env.SUPABASE_ANON_KEY) || '').trim();
  if (!SB || !K) return null;
  try { const r = await fetch(SB + '/rest/v1/rpc/get_share', { method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' }, body: JSON.stringify({ sid: id }) }); if (r.ok) { const j = await r.json(); return (Array.isArray(j) ? j[0] : j) || null; } } catch (e) {}
  return null;
}
async function sharePage(id, env) {
  const SB = String((env && env.SUPABASE_URL) || '').trim().replace(/\/+$/, ''), K = String((env && env.SUPABASE_ANON_KEY) || '').trim();
  let row = null;
  if (SB && K) { try { const r = await fetch(SB + '/rest/v1/rpc/get_share', { method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' }, body: JSON.stringify({ sid: id }) }); if (r.ok) { const j = await r.json(); row = (Array.isArray(j) ? j[0] : j) || null; } } catch (e) {} }
  const d = (row && row.data) || {}, fixed = String((env && env.APP_URL) || '').trim();
  const app = /^https:\/\//i.test(fixed) ? fixed : ''; // links only ever go to your own app (APP_URL)
  const dest = app && row ? app.split('#')[0] + '#s=' + id : app;
  const who = d.un ? '@' + d.un : (d.f && /^@/.test(d.f) ? d.f : 'Someone');
  let title = 'GearWatch', desc = 'Gear wishlist, collection and outfits.';
  if (d.t === 'p') { title = who + ' on GearWatch'; desc = [d.w != null ? d.w + ' wanted' : '', d.c != null ? d.c + ' in collection' : '', d.o != null ? d.o + (d.o === 1 ? ' outfit' : ' outfits') : ''].filter(Boolean).join(' · ') + '. Add ' + who + ' as a friend.'; }
  else if (d.t === 'o') { const its = d.it || []; title = (d.n || 'Outfit') + ' · by ' + who; desc = its.length + (its.length === 1 ? ' piece: ' : ' pieces: ') + its.map(i => i.n || '').filter(Boolean).slice(0, 5).join(', ') + '.'; }
  else if (d.n) { title = d.n + (d.b ? ' · ' + d.b : ''); desc = who + (d.st === 'owned' ? ' owns this.' : d.st === 'ordered' ? ' ordered this.' : ' wants this.') + (d.p != null && !d.st ? ' ' + (d.c || '€') + d.p + '.' : ''); }
  let img = '', big = false;
  if (row && row.owner && SB) { const cu = SB + '/storage/v1/object/public/cards/' + row.owner + '/' + id + '.png'; try { const h = await fetch(cu, { method: 'HEAD' }); if (h.ok) { img = cu; big = true; } } catch (e) {} }
  if (!img) img = (d.ph || [])[0] || ((d.it || []).find(i => i.ph) || {}).ph || d.av || (app ? new URL('icons/icon-512.png', app).href : '');
  const go = dest ? JSON.stringify(dest).replace(/</g, '\\u003c') : '';
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>' +
    '<meta property="og:site_name" content="GearWatch"><meta property="og:type" content="website"><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
    (img ? '<meta property="og:image" content="' + esc(img) + '">' + (big ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : '') + '<meta name="twitter:image" content="' + esc(img) + '">' : '') +
    '<meta name="twitter:card" content="' + (big ? 'summary_large_image' : 'summary') + '"><meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:description" content="' + esc(desc) + '"><meta name="theme-color" content="#000000">' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font:17px -apple-system,system-ui,sans-serif}a{color:#ffd60a}</style></head><body>' +
    (row ? (dest ? '<a href="' + esc(dest) + '">Open in GearWatch</a><script>location.replace(' + go + ')</script>' : '<p>' + esc(title) + '</p>') : '<p>This link has expired or doesn’t exist.' + (dest ? ' <a href="' + esc(dest) + '">Open GearWatch</a>' : '') + '</p>') + '</body></html>';
  return new Response(html, { status: row ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

// ===== Push notifications (Web Push, RFC 8291 + VAPID) =====
// Only the database calls this, with PUSH_KEY. Each push is end-to-end encrypted to the phone's own key.
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const b64uE = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uD = s => { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; a.forEach(x => { o.set(x, i); i += x.length; }); return o; };
async function hkdf(salt, ikm, info, len) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8)); }
let VAPID_KEY = null;
let VAPID_SUB = '';
async function vapidJwt(aud, env) {
  if (!VAPID_KEY) { const p = b64uD(env.VAPID_PUBLIC); VAPID_KEY = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64uE(p.slice(1, 33)), y: b64uE(p.slice(33, 65)), ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); }
  const te = new TextEncoder(), h = b64uE(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), b = b64uE(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 3600, sub: VAPID_SUB })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, VAPID_KEY, te.encode(h + '.' + b)); return h + '.' + b + '.' + b64uE(sig);
}
async function pushEncrypt(sub, text) {
  const te = new TextEncoder(), ua = b64uD(sub.p256dh), auth = b64uD(sub.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []), secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(te.encode('WebPush: info\0'), ua, asPub), 32), salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(te.encode(text), new Uint8Array([2]))));
  const hd = new Uint8Array(21 + asPub.length); hd.set(salt, 0); new DataView(hd.buffer).setUint32(16, 4096); hd[20] = asPub.length; hd.set(asPub, 21); return cat(hd, ct);
}
async function pushRoute(req, env) {
  const H = { 'content-type': 'application/json' };
  if (!env || !env.PUSH_KEY || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return new Response(JSON.stringify({ error: 'Push isn’t set up' }), { status: 503, headers: H });
  if (!sameKey(req.headers.get('x-push-key') || '', env.PUSH_KEY)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: H });
  { const s = String(env.VAPID_SUBJECT || '').trim(); VAPID_SUB = /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s) && !/@(localhost|example\.|.*\.(local|invalid|test))/i.test(s) || /^https:\/\/[^\s/]+\.[a-z]{2,}/i.test(s) ? s : new URL(req.url).origin; }
  let d; try { d = await req.json(); } catch (e) { return new Response('{"error":"Bad JSON"}', { status: 400, headers: H }); }
  const msg = JSON.stringify({ title: String(d.title || 'GearWatch').slice(0, 80), body: String(d.body || '').slice(0, 180), url: /^#[a-z0-9=&-]{0,40}$/i.test(d.url || '') ? d.url : '#notifs', tag: String(d.tag || '').slice(0, 20) });
  const subs = (Array.isArray(d.subs) ? d.subs : []).slice(0, 20), out = { sent: 0, gone: [], failed: 0, errors: [] };
  await Promise.all(subs.map(async s => { try { const u = new URL(s.endpoint); if (u.protocol !== 'https:' || !PUSH_HOSTS.test(u.hostname)) { out.failed++; out.errors.push({ host: u.hostname, why: 'not an allowed push service' }); return; }
    const body = await pushEncrypt(s, msg), jwt = await vapidJwt(u.origin, env);
    const r = await fetch(s.endpoint, { method: 'POST', headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC }, body });
    if (r.status === 404 || r.status === 410) out.gone.push(s.endpoint); else if (r.ok) out.sent++; else { out.failed++; let why = ''; try { why = (await r.text()).slice(0, 200); } catch (er) {} out.errors.push({ host: u.hostname, status: r.status, why }); } } catch (e) { out.failed++; out.errors.push({ why: String((e && e.message) || e).slice(0, 200) }); } }));
  return new Response(JSON.stringify(out), { headers: H });
}

export default {
  async fetch(req, env, ctx) {
    READER_KEY = (env && env.JINA_KEY) || '';
    if (req.method === 'POST' && new URL(req.url).pathname === '/push') return pushRoute(req, env);
    const sm = req.method === 'GET' && new URL(req.url).pathname.match(/^\/s\/([A-Za-z0-9]{5,12})\/?$/);
    if (sm) return sharePage(sm[1], env);
    const sj = req.method === 'GET' && new URL(req.url).pathname.match(/^\/s\/([A-Za-z0-9]{5,12})\.json$/);
    if (sj) { const row = await shareRow(sj[1], env); return new Response(JSON.stringify({ data: row ? row.data : null }), { status: row ? 200 : 404, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' } }); }
    corsFor(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const sp0 = new URL(req.url).searchParams, admin = !!(env && env.ADMIN_KEY) && sameKey(req.headers.get('x-admin-key') || sp0.get('key'), env.ADMIN_KEY);
    if (req.method === 'GET' && !sp0.get('url') && !sp0.get('lookup')) return json({ ok: true, about: 'GearWatch price helper. Only signed-in GearWatch users can use it.' });
    if (req.method === 'GET' && !admin) return json({ error: 'Testing links from the address bar needs your ADMIN_KEY.' }, 403);
    let who = { uid: 'admin' };
    if (!admin) { who = await signedIn(req, env, ctx); if (!who.uid) return json({ error: who.error, auth: true }, who.status || 401); }
    if (req.method === 'GET') {
      const sp = sp0, url = sp.get('url');
      if (sp.get('lookup')) return json(await lookupOne(sp.get('lookup'), ctx));
      if (!url) return json({ ok: true, about: 'GearWatch price helper. Add ?url=<product link> to test a price, or ?lookup=<product link> to test filling in a new item.' });
      const r = await one({ url, currency: new URL(req.url).searchParams.get('cur') || '€' }, ctx, true);
      return json(r ? Object.assign({ key: r[0] }, r[1]) : { error: 'Not a valid link' });
    }
    if (req.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);
    let body; try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    const list = (body.items || []).filter(x => x && /^https?:\/\//.test(x.url || '')).slice(0, 40), force = !!body.force;
    if (!admin && !(await underLimit(who.uid, body.lookup ? 1 : Math.max(1, list.length), ctx))) return json({ error: 'Too many checks. Try again in a few minutes.' }, 429);
    if (body.lookup) return json(await lookupOne(String(body.lookup), ctx));
    const items = {};
    for (let i = 0; i < list.length; i += 5) {
      const res = await Promise.all(list.slice(i, i + 5).map(e => one(e, ctx, force)));
      res.forEach(r => { if (r) items[r[0]] = r[1]; });
    }
    return json({ items });
  }
};
