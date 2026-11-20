# Deploying Precise Procure on cPanel

> **Check this first.** The steps below need cPanel's **Setup Node.js App** (CloudLinux Node.js Selector). Many shared plans do not have it,
> and then this app cannot run there. To check: in cPanel's search box type "Node". If nothing appears, use `DEPLOY-VERCEL.md` instead
> (or a VPS). Example: BigRock's "Business SSD" cloud hosting does not include it (confirmed by their support, Oct 2026).

Works on any cPanel host that has **Setup Node.js App** (CloudLinux / Passenger). You need Node 18 or newer.
The data stays in MongoDB Atlas, so the same accounts and records work on the new site.

## 1. Before you start (5 minutes)

1. **Make the zip** on your computer: `npm run package` → `procure-cpanel.zip`. It has no secrets and no `node_modules`.
2. **Make a secret**: `npm run generate-secret` → copy the long line it prints.
3. **Let the host reach Atlas**: Atlas → *Network Access* → *Add IP address*. Add your hosting server's IP
   (cPanel's right-hand panel shows "Shared IP Address"; or ask your host). Without this the site loads but sign-in says the database is unavailable.
   (`0.0.0.0/0` also works; it is less strict, so use it only if the host's IP can change.)
4. Have your Atlas connection string ready (Atlas → *Connect* → *Drivers*).

## 2. Put the files on the server

1. Create a subdomain, e.g. `procure.yourcompany.com` (cPanel → *Domains*). Note its folder.
2. File Manager → make a folder **outside** the public web folder, e.g. `/home/USER/procure-app`.
3. Upload `procure-cpanel.zip` there and **Extract**. You should see `app.js` and `package.json` directly inside it (not one folder deeper).

## 3. Create the Node.js app

cPanel → **Setup Node.js App** → *Create Application*:

| Field | Value |
|---|---|
| Node.js version | 18 or newer (20 / 22 are fine) |
| Application mode | **Production** |
| Application root | `procure-app` (the folder from step 2) |
| Application URL | your subdomain |
| Application startup file | **`app.js`** |

Then, on the same screen, add **Environment variables** (see `.env.production.example`):
`NODE_ENV` = `production`, `MONGODB_URI`, `MONGODB_DB_NAME`, `JWT_SECRET`. Click **Save**, then **Run NPM Install**, then **Restart**.

## 4. Check it works

Open the site: you should see the sign-in page (without the demo buttons). Then run the built-in check from any computer:

```
npm run smoke -- https://procure.yourcompany.com
```

It checks the page, the database connection, that private data is refused without a login, security headers, https and compression,
and prints what to fix if anything fails.

If the app won't start, the reason is printed in the app's log (Setup Node.js App → *Open log*, or `stderr.log` in the app folder). Typical causes:

| Message | Fix |
|---|---|
| `JWT_SECRET is not set` / `too short` | add it (step 1.2) |
| `Could not reach the database` / sign-in says "Database is unavailable" | Atlas Network Access (step 1.3), or a wrong password in `MONGODB_URI` |
| `Cannot find module 'express'` | click *Run NPM Install* |
| 503 / "Incomplete response" right after changing settings | click *Restart* |

## 5. The first administrator (only for a brand-new, empty database)

If you are using the existing database, people already exist: sign in as before. For an empty one, in cPanel → *Terminal* (or the
Node.js app screen's "Enter to the virtual environment" command), inside the app folder:

```
node scripts/create-admin.js you@company.com "a-strong-password" "Your Name"
```

Then sign in, go to **Roles & Access** and **Employees** to set up everyone else. The built-in Admin role is brought up to date
automatically each time the app starts.

## 6. Updating later

Upload the new zip, extract over the old files (don't delete `node_modules`), click *Run NPM Install* if `package.json` changed, then *Restart*.
Roll back by extracting the previous zip.

## What is protected

- Passwords are stored hashed; sign-in is limited to 8 wrong attempts per 15 minutes per person and computer.
- The sign-in page only shows demo accounts if you set `SHOW_DEMO_LOGIN=true`.
- Everyone's access follows their role; every change is in **Activity log** (kept; sign-in events are kept for 90 days).
- Turn people off (Employees → *Turn off*) instead of deleting them so their history stays.
- Use HTTPS (cPanel → *SSL/TLS Status* → *Run AutoSSL*).
