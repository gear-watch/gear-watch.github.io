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
   - **Site URL**: your app address **without** a slash at the end, e.g. `https://gear-watch.github.io/gearwatch` (the email uses it to show the logo)
   - **Redirect URLs**: add every address the app runs on (both versions), e.g. `https://gear-watch.github.io/**`
2. **Authentication** → **Emails** → **Templates**. Do this for both **Magic Link** and **Confirm signup** (new accounts get the second one):
   - **Subject**: `Your GearWatch code`
   - **Body**: copy everything in the box below (from `<!DOCTYPE html>` to `</html>`) and paste it over the existing body. Press **Save**.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Your GearWatch code</title>
<style>
  @media (max-width: 620px) { .px { padding-left: 20px !important; padding-right: 20px !important; } .code { font-size: 34px !important; letter-spacing: 8px !important; } }
  :root { color-scheme: light dark; }
</style>
</head>
<body style="margin:0;padding:0;background-color:#0b0b0c;-webkit-text-size-adjust:100%;">
<span style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0b0b0c;">Your GearWatch sign-in code is {{ .Token }}. It works once and expires in an hour.&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0b0b0c" style="background-color:#0b0b0c;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <tr>
          <td class="px" style="padding:8px 40px 28px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="48" style="width:48px;"><img src="{{ .SiteURL }}/icons/apple-touch-icon.png" width="48" height="48" alt="GearWatch" style="display:block;width:48px;height:48px;border:0;border-radius:12px;"></td>
                <td style="padding-left:12px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:21px;font-weight:600;letter-spacing:-0.3px;color:#f5f5f7;mso-line-height-rule:exactly;line-height:24px;">GearWatch</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td bgcolor="#1c1c1e" style="background-color:#1c1c1e;border-radius:18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td height="4" bgcolor="#ffd60a" style="height:4px;background-color:#ffd60a;border-radius:18px 18px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr>
                <td class="px" style="padding:36px 40px 8px 40px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;">
                  <div style="font-size:13px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#ffd60a;mso-line-height-rule:exactly;line-height:18px;">Sign in</div>
                  <div style="padding-top:8px;font-size:34px;font-weight:600;letter-spacing:-0.6px;color:#f5f5f7;mso-line-height-rule:exactly;line-height:40px;">Your code.</div>
                  <div style="padding-top:10px;font-size:17px;color:#a1a1a6;mso-line-height-rule:exactly;line-height:25px;">Type it in GearWatch to get your wishlist, collection and outfits on this device.</div>
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:24px 40px 8px 40px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="#2c2c2e" style="background-color:#2c2c2e;border-radius:14px;padding:22px 12px;">
                        <div class="code" style="font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:12px;color:#ffd60a;mso-line-height-rule:exactly;line-height:48px;">{{ .Token }}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:12px 40px 32px 40px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:#8e8e93;mso-line-height-rule:exactly;line-height:20px;">Works once. Expires in an hour.</td>
              </tr>
              <tr><td class="px" style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="#2c2c2e" style="height:1px;background-color:#2c2c2e;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
              <tr>
                <td class="px" style="padding:28px 40px 8px 40px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;">
                  <div style="font-size:17px;font-weight:600;color:#f5f5f7;mso-line-height-rule:exactly;line-height:24px;">Opening this in Safari?</div>
                  <div style="padding-top:4px;font-size:14px;color:#a1a1a6;mso-line-height-rule:exactly;line-height:20px;">Tap the button instead. It doesn’t work in the home-screen app, so use the code there.</div>
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:16px 40px 36px 40px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="#ffd60a" style="background-color:#ffd60a;border-radius:9999px;">
                        <a href="{{ .ConfirmationURL }}" style="display:block;padding:12px 24px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:17px;font-weight:600;color:#000000;text-decoration:none;border-radius:9999px;mso-line-height-rule:exactly;line-height:22px;">Sign in with a link</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:24px 40px 8px 40px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;color:#6e6e73;mso-line-height-rule:exactly;line-height:18px;">
            Didn’t ask for this? Ignore it. Nobody can sign in without the code.<br>
            Sent to {{ .Email }} by GearWatch.
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>
```
   
   It shows the 6-digit code big in yellow, with your logo. The iPhone home-screen app can't receive sign-in links, so the code is what you type in; the button in the email is a backup for Safari.
3. **Friends need real email sending.** Supabase's built-in sender only mails people on your Supabase team, 2 emails an hour. Fine while it's just you. Before friends sign up, do section 5 below.

## 4. Connect the app
1. Left menu → **Project Settings** → **API**. Copy the **Project URL** and the **anon public** key.
2. Open `config.js` and fill them in:
   ```js
   window.GW_SUPABASE_URL = 'https://xxxx.supabase.co';
   window.GW_SUPABASE_ANON_KEY = 'eyJ...';
   ```
   The anon key is meant to be public; the table rules in `setup.sql` keep each account private.
3. Upload `config.js`, `sync.js` and `index.html` to the repo.

## 5. Email sending for friends (custom SMTP)

Pick **one**. Brevo works without owning a website domain. Resend needs a domain you own (github.io doesn't count).

### Option A: Brevo (no domain needed, free 300 emails a day)
1. Sign up at **brevo.com** (free plan). Confirm your email.
2. Add a sender: top-right menu → **Senders, Domains & Dedicated IPs** → **Senders** → **Add a sender**.
   - From name: `GearWatch`
   - From email: an address you own, e.g. your Gmail.
   - Brevo emails that address a code or link. Confirm it.
3. Get the SMTP details: top-right menu → **SMTP & API** → tab **SMTP**.
   - **SMTP server**: `smtp-relay.brevo.com`
   - **Port**: `587`
   - **Login**: shown on that page. Often your Brevo email, on newer accounts something like `8a1b2c001@smtp-brevo.com`. Copy exactly what's shown.
   - Click **Generate a new SMTP key**, name it `supabase`, and copy it straight away (it's only shown once). This is the password. Use the **SMTP key**, not an API key.
4. In Supabase: **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**, then fill in:
   - **Sender email**: the address you confirmed in step 2
   - **Sender name**: `GearWatch`
   - **Host**: `smtp-relay.brevo.com`
   - **Port number**: `587`
   - **Username**: the Login from step 3
   - **Password**: the SMTP key from step 3
   - **Minimum interval between emails**: leave as is
   - Press **Save**.
5. Note: with a Gmail/Outlook sender, Brevo may show the sender as an `@brevosend.com` address and emails can land in spam the first time. Tell friends to check spam and mark it "Not spam". A domain of your own (Option B, or add it in Brevo under Domains) fixes this.

### Option B: Resend (needs your own domain, free 3,000 emails a month)
1. Buy a domain if you don't have one (about €10 a year, e.g. at Cloudflare, Porkbun or TransIP).
2. Sign up at **resend.com** → **Domains** → **Add domain** → type your domain (or a subdomain like `mail.yourdomain.com`), region **Ireland (eu-west-1)**.
3. Resend shows 3–4 DNS records (TXT and MX). Add each one at your domain provider under DNS, copying name and value exactly. Back in Resend press **Verify**. It can take from a few minutes to a few hours to turn green.
4. **API Keys** → **Create API key** → name `supabase`, permission **Sending access**, your domain → copy the key (starts with `re_`, only shown once).
5. In Supabase: **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP**:
   - **Sender email**: `login@yourdomain.com` (any name, but on the verified domain)
   - **Sender name**: `GearWatch`
   - **Host**: `smtp.resend.com`
   - **Port number**: `465`
   - **Username**: `resend` (always this word)
   - **Password**: the `re_` key
   - Press **Save**.

### After either option
- **Authentication** → **Rate Limits**: "Rate limit for sending emails" starts at 30 an hour. That's plenty; raise it if many friends join at once.
- Test it: open the app in a private browser window, sign in with a different email address, and check the code arrives.
- If it doesn't arrive: look in spam, then check the provider's logs (Brevo: **Transactional** → **Logs**; Resend: **Emails**). A wrong password shows as an authentication error there or in Supabase under **Logs** → **Auth**.

## What happens next
- Opening the app asks for your email, then a 6-digit code, then a username.
- First sign-in uploads what's already on the phone. On a new device you get your list from the account.
- Changes sync in the background and wait while you're offline.
- Followers only see your wishlist, collection and outfits. Not what you paid, sizes or measurements. You approve each follower.

## Profile photos (update)

Profile photos need one new database column. Open Supabase → SQL Editor, paste all of `setup.sql` again and press Run. It's safe to run more than once. Until then the app works as before, but saving a profile photo shows a message asking for this update.
