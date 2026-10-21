# Accounts for GearWatch (Supabase)

About 10 minutes, once. Free plan is enough.

## 1. Create the project
1. Go to supabase.com → sign up → **New project**. Pick a name (e.g. `gearwatch`), a database password (save it somewhere), region **West EU**.
2. Wait until it says the project is ready.

## 2. Create the tables
1. Left menu → **SQL Editor** → **New query**.
2. Open `setup.sql` from this folder, copy everything, paste, press **Run**. It should say "Success".

## 3. Sign-in emails
1. Left menu → **Authentication** → **URL Configuration**.
   - **Site URL**: your app address, e.g. `https://gear-watch.github.io/`
   - **Redirect URLs**: add every address the app runs on (both versions), e.g. `https://gear-watch.github.io/**`
2. **Authentication** → **Emails** → **Magic Link** template. Replace the body with:
   ```
   <h2>Your GearWatch code</h2>
   <p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
   <p>Or <a href="{{ .ConfirmationURL }}">tap here to sign in</a> (works in Safari, not in the home-screen app).</p>
   ```
   The home-screen app on iPhone can't receive the link, so the code is what you type in.
3. **Friends need real email sending.** Supabase's built-in sender only mails addresses on your Supabase team, and only a few per hour. That's fine for you alone. Before friends sign up, connect a free sender: create an account at resend.com, then **Authentication** → **Emails** → **SMTP Settings** → enable custom SMTP with Resend's details.

## 4. Connect the app
1. Left menu → **Project Settings** → **API**. Copy the **Project URL** and the **anon public** key.
2. Open `config.js` and fill them in:
   ```js
   window.GW_SUPABASE_URL = 'https://xxxx.supabase.co';
   window.GW_SUPABASE_ANON_KEY = 'eyJ...';
   ```
   The anon key is meant to be public; the table rules in `setup.sql` keep each account private.
3. Upload `config.js`, `sync.js` and `index.html` to the repo.

## What happens next
- Opening the app asks for your email, then a 6-digit code, then a username.
- First sign-in uploads what's already on the phone. On a new device you get your list from the account.
- Changes sync in the background and wait while you're offline.
- Followers only see your wishlist, collection and outfits. Not what you paid, sizes or measurements. You approve each follower.
