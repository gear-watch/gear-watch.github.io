# GearWatch

Gear wishlist with budget, measurements (Fitlog) and daily price checks.

## Publish

1. Create a new GitHub repository and upload everything in this folder (keep the `.github` folder and the `.nojekyll` file).
2. Settings → Pages → Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)**. Save.
3. Settings → Actions → General → Workflow permissions: **Read and write permissions**. Save.
4. Open `https://<your-user>.github.io/<repo>/`.

## Price checks

- `.github/workflows/check-prices.yml` runs every day at 06:17 UTC. Run it any time from **Actions → Check prices → Run workflow**.
- It reads the links in `watchlist.json`, writes current prices to `prices.json` and commits it. The app reads `prices.json` when it opens.
- New item in the app? Profiles → **Copy watch list**, paste over `watchlist.json`, commit.

Your wishlist itself is stored in your browser (localStorage), not in the repo.
