# GearWatch price helper

Lets every GearWatch user get fresh prices, not just the links in watchlist.json.

1. Make a free account at https://dash.cloudflare.com.
2. Workers & Pages → Create → Create Worker → name it `gearwatch-prices` → Deploy.
3. Edit code → delete what's there → paste all of `worker.js` → Deploy.
4. Copy the address it shows (like `https://gearwatch-prices.yourname.workers.dev`).
5. In the GearWatch repo, open `config.js` and paste it between the quotes. Commit.

The app then asks the helper for prices whenever someone opens it (at most every 6 hours per item).
Free tier: 100,000 requests a day.

## Who can use it

Only people signed in to GearWatch. The app sends their sign-in with each check, and the helper asks Supabase if it's real.
Each person can check up to 300 links per 10 minutes. Share link previews (`/s/…`) stay open, so chats can read them.

Set these in the worker → Settings → Variables and Secrets:
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`: the same values as in config.js. Without them the helper refuses every price check.
- `APP_URL` (optional): your app address. Only that site (or any github.io site if it's not set) can call the helper from a browser.
- `ADMIN_KEY` (optional, as a secret): any long password, so you can test links yourself.

## Testing a link

Open this in a browser, with your product link after `?url=` and your ADMIN_KEY after `&key=`:

    https://gearwatch-prices.awooplanet.workers.dev/?url=https://kinkfox.com/product/alpha-pup-latex-suit&key=YOUR_ADMIN_KEY

It shows the price it found and how (`how`, `via`), or why it failed (`error`, `detail`).
Send me the result for any link that still doesn't work.

## How prices are found, in order

1. Shopify and WooCommerce shops: their product feed (most reliable).
2. The product page: Magento prices, product data, price tags, the shop's price box, prices in the page's own data.
3. If the shop blocks the check, the page is loaded through a public reader (r.jina.ai) and read again.
4. Last resort: the first real price on the page, marked as a guess.

## Optional: a free reader key (fewer "reader HTTP 429" errors)

The page reader used for blocked shops limits how often it can be used without a key.
1. Make a free account at https://jina.ai and copy your API key.
2. Cloudflare → your worker → Settings → Variables and secrets → Add → name `JINA_KEY`, paste the key, type Secret → Deploy.


## Share link previews

Share links (`…workers.dev/s/k7Pq2Xa`) show a preview card in Telegram, Discord and WhatsApp, then send people on to the app.
The helper needs to read shares from your database:

1. In Cloudflare, open the worker → Settings → Variables and Secrets → Add.
2. Add `SUPABASE_URL` with the same value as `GW_SUPABASE_URL` in config.js.
3. Add `SUPABASE_ANON_KEY` with the same value as `GW_SUPABASE_ANON_KEY` in config.js.
4. Optional: add `APP_URL` with your app address (like `https://yourname.github.io/gearwatch/`). Without it, links go to the app address they were made from, as long as it's on github.io.
5. Deploy.

Test: open `https://gearwatch-prices.awooplanet.workers.dev/s/<code>` with a code from a share link. It should open the app.
