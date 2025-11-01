# Security Guide

## JWT Authentication

All API endpoints (except static files and auth endpoints) are protected with JWT authentication.

### Configuration

Add these environment variables to your `.env` file:

```env
# JWT Secret (CHANGE THIS!)
JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters-long

# Token expiration (default: 7 days)
JWT_EXPIRES_IN=7d

# Admin credentials
ADMIN_USERNAME=your-username
ADMIN_PASSWORD=your-strong-password
```

**⚠️ IMPORTANT:** Change these values in production!

### Getting a Token

**Endpoint:** `POST /api/auth/login`

**Request:**
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "7d",
  "message": "Login successful"
}
```

### Using the Token

Include the token in the `Authorization` header for all API requests:

```bash
curl http://localhost:3001/api/account \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Verifying Token

**Endpoint:** `GET /api/auth/verify`

```bash
curl http://localhost:3001/api/auth/verify \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Protected Endpoints

All `/api/*` endpoints require authentication:

- `GET /api/account` - Account information
- `GET /api/positions` - Current positions
- `GET /api/trades` - Trade history
- `GET /api/logs` - AI decision logs
- `GET /api/stats` - Trading statistics
- `GET /api/prices` - Market prices
- `GET /api/history` - Account history

### Public Endpoints

These endpoints do NOT require authentication:

- `POST /api/auth/login` - Login to get token
- `GET /api/auth/verify` - Verify token validity
- `/*` - Static files (HTML, CSS, JS)

## Frontend Integration

Update your frontend to include the JWT token in all API requests:

```javascript
// Store token after login
localStorage.setItem('token', response.token);

// Include token in API requests
fetch('/api/account', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
})
```

## Security Best Practices

1. **Change default credentials** - Never use default username/password
2. **Use strong JWT secret** - At least 32 characters, random
3. **Use HTTPS in production** - Never send tokens over HTTP
4. **Rotate secrets regularly** - Change JWT_SECRET periodically
5. **Set appropriate expiration** - Balance security vs convenience
6. **Store tokens securely** - Use httpOnly cookies in production
7. **Validate all inputs** - Additional validation layer recommended

## Token Expiration

Tokens expire based on `JWT_EXPIRES_IN` setting:
- `7d` = 7 days
- `24h` = 24 hours
- `30m` = 30 minutes

When a token expires, you'll receive a `401 Unauthorized` response. Re-login to get a new token.

## Troubleshooting

**401 Unauthorized:**
- Token is missing, invalid, or expired
- Check Authorization header format: `Bearer TOKEN`
- Verify credentials are correct

**400 Bad Request:**
- Request body is malformed
- Check JSON formatting

## Additional Security

For enhanced security, consider:

1. **Rate Limiting** - Prevent brute force attacks
2. **IP Whitelist** - Restrict access to known IPs
3. **2FA** - Add two-factor authentication
4. **Audit Logs** - Track all API access
5. **CORS Configuration** - Restrict allowed origins
