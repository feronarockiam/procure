# Deploying Precise Procure on Vercel (with your own domain name)

Works with no server to manage. The data stays in MongoDB Atlas.

## 1. Settings (Vercel project -> Settings -> Environment Variables, Production)

| Name | Value |
|---|---|
| `MONGODB_URI` | the Atlas connection string (without a database name) |
| `MONGODB_DB_NAME` | `precise-procure` |
| `JWT_SECRET` | 32+ random characters: `npm run generate-secret` |
| `NODE_ENV` | `production` |
| `SHOW_DEMO_LOGIN` | leave unset (the sign-in page hides demo accounts in production) |

Atlas -> Network Access must allow Vercel. Vercel has no fixed IP on normal plans, so allow `0.0.0.0/0` and rely on the database password.

## 2. Deploy

From the project folder, signed in to the right Vercel account: `vercel --prod`. Then `npm run smoke -- https://your-project.vercel.app`.

## 3. Use a subdomain of your own domain (e.g. procure.example.com)

1. Vercel -> the project -> Settings -> Domains -> add `procure.example.com`. Vercel shows a CNAME target (usually `cname.vercel-dns.com`).
2. At whoever hosts your DNS (cPanel -> Zone Editor, or the registrar): add a `CNAME` record, name `procure`, target = the value Vercel shows.
3. Wait a few minutes. Vercel issues the https certificate by itself.

This adds one DNS record; the main website is not touched.

## Things that behave differently on Vercel

- The sign-in attempt limit (8 wrong passwords per 15 minutes) is counted in each running instance's memory, so a determined attacker spread over several instances gets more tries. It still stops casual guessing; keep passwords strong.
- Each instance keeps small short-lived caches (people for 10 s, roles for 15 s), so a role change can take up to ~15 s to reach every instance. Password changes and turning someone off take effect within about 10 s.
- The built-in Admin role is brought up to date automatically on the first request after a deploy.
