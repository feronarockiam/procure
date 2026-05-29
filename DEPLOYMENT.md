# Deployment Guide - Precise Procure

## Pre-Deployment Checklist

- [ ] All environment variables configured (see `.env.example`)
- [ ] MongoDB Atlas database accessible from deployment environment
- [ ] CORS_ORIGIN set to production domain(s)
- [ ] JWT_SECRET set to a strong random value (minimum 32 characters)
- [ ] NODE_ENV set to `production`
- [ ] PORT configured (default: 5000)

## Environment Variables

Create a `.env` file (never commit to git) with the following:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname
JWT_SECRET=your_very_long_random_secret_key_here
PORT=5000
NODE_ENV=production
CORS_ORIGIN=https://yourdomain.com,https://app.yourdomain.com
```

## Deployment Platforms

### Vercel
The application includes `vercel.json` configuration. Deploy with:
```bash
vercel --prod
```

Ensure environment variables are set in Vercel project settings.

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

### Other Platforms (Heroku, AWS, GCP, DigitalOcean)
1. Set all environment variables in platform's config
2. Run: `npm install && npm start`
3. Ensure Node.js 18+ is available

## Security Notes

### Known Vulnerabilities

**xlsx** (used for Excel import):
- Prototype Pollution vulnerability (GHSA-4r6h-8v6p-xvw6)
- ReDoS vulnerability (GHSA-5pgg-2g8v-p4x9)
- Status: No fix available from maintainer

**Mitigation**: 
- Validate and sanitize all uploaded Excel files
- Limit file size to prevent ReDoS attacks
- Monitor xlsx package for security updates
- Consider alternative: `exceljs` or `sheetjs-pro`

All other vulnerabilities were patched via `npm audit fix`.

## Performance Recommendations

1. **Database Connection Pooling**: Already configured (min 2, max 10 connections)
2. **Request Logging**: Enabled by default
3. **Graceful Shutdown**: Implemented for SIGTERM signals
4. **Payload Limit**: Set to 50MB

## Monitoring

Health check endpoint: `GET /api/health`

Example:
```bash
curl https://yourdomain.com/api/health
```

Response:
```json
{
  "status": "OK",
  "message": "Precise Procure API is running"
}
```

## Logs

Logs are printed to stdout. Ensure your deployment platform captures and aggregates logs.

Key log patterns:
- `✅ MongoDB connected` - successful DB connection
- `SIGTERM received` - graceful shutdown initiated
- `[METHOD] [PATH] [STATUS] [TIME]ms` - request log

## Database Backups

MongoDB Atlas on cloud automatically handles backups. For self-hosted MongoDB:
- Configure regular automated backups
- Test restore procedures
- Keep backups in secure location

## Next Steps

1. Add comprehensive test suite
2. Implement request rate limiting
3. Add API request validation middleware
4. Set up monitoring/alerting (DataDog, Sentry, etc.)
5. Consider CDN for static assets
6. Implement API versioning
