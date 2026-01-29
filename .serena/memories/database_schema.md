# Database Schema

## Overview
The application uses SQLite as the database with Prisma as the ORM. The schema supports multi-provider DNS management with secure credential storage and comprehensive operation logging.

## Database Models

### User
Stores user account information and authentication credentials.

```prisma
model User {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  email        String?  @unique
  password     String   // bcrypt encrypted
  cfApiToken   String?  // DEPRECATED: Legacy Cloudflare token
  cfAccountId  String?  // DEPRECATED: Legacy Cloudflare account ID
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  // Relations
  logs              Log[]
  dnsCredentials    DnsCredential[]
  cfCredentials     CfCredential[]  // DEPRECATED: For migration only
}
```

**Key Points:**
- `password`: Encrypted with bcrypt (salt rounds: 10)
- `cfApiToken` and `cfAccountId`: Kept for backward compatibility during migration
- `email`: Optional field
- Cascading deletes for related records

### DnsCredential
Stores encrypted credentials for multiple DNS providers and accounts.

```prisma
model DnsCredential {
  id          Int      @id @default(autoincrement())
  userId      Int
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String   // Account alias (e.g., "Personal Account", "Company Account")
  provider    String   // Provider type: cloudflare, aliyun, dnspod, huawei, etc.
  secrets     String   // JSON-formatted credentials (AES-256 encrypted)
  accountId   String?  // Provider account ID (optional)
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([userId])
  @@index([provider])
}
```

**Secrets Format (encrypted JSON):**
- **Cloudflare**: `{"apiToken": "..."}`
- **Aliyun**: `{"accessKeyId": "...", "accessKeySecret": "..."}`
- **DNSPod**: `{"secretId": "...", "secretKey": "..."}`
- **Huawei**: `{"accessKeyId": "...", "secretAccessKey": "..."}`
- Other providers follow similar patterns

**Key Points:**
- `secrets`: AES-256 encrypted JSON string
- `name`: User-friendly alias for the account
- `isDefault`: Marks the default account for a provider
- Indexed on `userId` and `provider` for performance

### CfCredential (DEPRECATED)
Legacy table for Cloudflare-only credentials. Kept for data migration purposes.

```prisma
model CfCredential {
  id          Int      @id @default(autoincrement())
  userId      Int
  user        User     @relation("CfCredentials", fields: [userId], references: [id], onDelete: Cascade)
  name        String
  apiToken    String
  accountId   String?
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([userId])
}
```

**Migration Status:**
- This table is deprecated and should not be used for new features
- Migration scripts exist to move data to `DnsCredential`
- Will be removed in future versions

### Log
Comprehensive audit trail of all operations performed in the system.

```prisma
model Log {
  id            Int      @id @default(autoincrement())
  userId        Int
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  timestamp     DateTime @default(now())
  action        String   // CREATE, UPDATE, DELETE
  resourceType  String   // DNS, ZONE, HOSTNAME, USER
  domain        String?
  recordName    String?
  recordType    String?  // A, AAAA, CNAME, MX, TXT, etc.
  oldValue      String?  // JSON format
  newValue      String?  // JSON format
  status        String   // SUCCESS, FAILED
  errorMessage  String?
  ipAddress     String?  // Operator IP address
  
  @@index([userId])
  @@index([timestamp])
  @@index([action])
  @@index([resourceType])
  @@index([status])
}
```

**Action Types:**
- `CREATE`: New resource created
- `UPDATE`: Existing resource modified
- `DELETE`: Resource deleted

**Resource Types:**
- `DNS`: DNS record operations
- `ZONE`: Domain/zone operations
- `HOSTNAME`: Custom hostname operations
- `USER`: User account operations

**Status Values:**
- `SUCCESS`: Operation completed successfully
- `FAILED`: Operation failed (see errorMessage)

**Key Points:**
- Multiple indexes for efficient querying
- `oldValue` and `newValue`: JSON strings for detailed change tracking
- `ipAddress`: Captured for security audit
- Retention period configurable via LOG_RETENTION_DAYS env variable (default: 90 days)

### Cache
Optional caching table to reduce API calls to DNS providers.

```prisma
model Cache {
  id        Int      @id @default(autoincrement())
  key       String   @unique
  value     String   // JSON format
  expiresAt DateTime
  createdAt DateTime @default(now())
  
  @@index([expiresAt])
}
```

**Key Points:**
- `key`: Unique cache key (e.g., "zones:cloudflare:account123")
- `value`: JSON-serialized cached data
- `expiresAt`: Automatic expiration timestamp
- Indexed on `expiresAt` for efficient cleanup

## Relationships

```
User (1) ──< (N) DnsCredential
User (1) ──< (N) Log
User (1) ──< (N) CfCredential [DEPRECATED]
```

## Indexes

### Performance Indexes
- `DnsCredential`: `userId`, `provider`
- `Log`: `userId`, `timestamp`, `action`, `resourceType`, `status`
- `Cache`: `expiresAt`

### Unique Constraints
- `User.username`
- `User.email`
- `Cache.key`

## Migration Strategy

### From Single-Provider to Multi-Provider
1. Old data stored in `User.cfApiToken` and `CfCredential`
2. Migration scripts move data to `DnsCredential` with `provider: "cloudflare"`
3. Legacy fields kept for backward compatibility
4. Future versions will remove deprecated fields

### Database Migrations
- Located in: `server/prisma/migrations/`
- Applied with: `npx prisma migrate deploy` (production) or `npx prisma migrate dev` (development)
- Always backup before running migrations in production

## Security Considerations

### Encrypted Fields
- `User.password`: bcrypt with salt rounds 10
- `DnsCredential.secrets`: AES-256 encryption
- Encryption key stored in `ENCRYPTION_KEY` environment variable (must be 32 characters)

### Sensitive Data
- Never log decrypted credentials
- API tokens never returned in API responses
- Passwords never returned in API responses

## Maintenance

### Cleanup Operations
- **Logs**: Implement periodic cleanup based on `LOG_RETENTION_DAYS`
- **Cache**: Automatic expiration via `expiresAt` field
- **Orphaned Records**: Cascade deletes handle cleanup automatically

### Backup Recommendations
- Regular SQLite database file backups
- Before schema migrations
- Before major version upgrades
