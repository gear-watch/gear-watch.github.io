# GearWatch price helper

Lets every GearWatch user get fresh prices, not just the links in watchlist.json.

1. Make a free account at https://dash.cloudflare.com.
2. Workers & Pages → Create → Create Worker → name it `gearwatch-prices` → Deploy.
3. Edit code → delete what's there → paste all of `worker.js` → Deploy.
4. Copy the address it shows (like `https://gearwatch-prices.yourname.workers.dev`).
5. In the GearWatch repo, open `config.js` and paste it between the quotes. Commit.

The app then asks the helper for prices whenever someone opens it (at most every 6 hours per item).
Free tier: 100,000 requests a day.
