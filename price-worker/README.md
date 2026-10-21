# GearWatch price helper

Lets every GearWatch user get fresh prices, not just the links in watchlist.json.

1. Make a free account at https://dash.cloudflare.com.
2. Workers & Pages → Create → Create Worker → name it `gearwatch-prices` → Deploy.
3. Edit code → delete what's there → paste all of `worker.js` → Deploy.
4. Copy the address it shows (like `https://gearwatch-prices.yourname.workers.dev`).
5. In the GearWatch repo, open `config.js` and paste it between the quotes. Commit.

The app then asks the helper for prices whenever someone opens it (at most every 6 hours per item).
Free tier: 100,000 requests a day.

## Testing a link

Open this in a browser, with your product link after `?url=`:

    https://gearwatch-prices.awooplanet.workers.dev/?url=https://kinkfox.com/product/alpha-pup-latex-suit

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
