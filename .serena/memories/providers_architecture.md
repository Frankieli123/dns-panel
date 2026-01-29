# DNS Providers Architecture

## Overview
The application uses a provider pattern to support multiple DNS providers through a unified interface. This architecture allows adding new DNS providers without modifying core application logic.

## Supported Providers

### Currently Implemented
1. **Cloudflare** - Full support
2. **Aliyun** (Alibaba Cloud DNS) - Full support
3. **DNSPod** (Tencent Cloud) - Full support
4. **Huawei Cloud DNS** - Full support
5. **Baidu Cloud DNS** - Full support
6. **Huoshan** (ByteDance) - Full support
7. **JDCloud** (JD Cloud) - Full support
8. **West.cn** - Full support
9. **Namesilo** - Full support
10. **DNSLA** - Full support
11. **Spaceship** - Full support
12. **PowerDNS** - Full support

## Architecture Components

### 1. BaseProvider (Abstract Class)
Location: `server/src/providers/base/BaseProvider.ts`

The abstract base class that all DNS providers must extend.

**Required Methods:**
```typescript
abstract class BaseProvider {
  // List all zones/domains
  abstract listZones(): Promise<Zone[]>;
  
  // List DNS records for a zone
  abstract listRecords(zoneId: string): Promise<DnsRecord[]>;
  
  // Create a new DNS record
  abstract createRecord(zoneId: string, record: CreateRecordInput): Promise<DnsRecord>;
  
  // Update an existing DNS record
  abstract updateRecord(zoneId: string, recordId: string, record: UpdateRecordInput): Promise<DnsRecord>;
  
  // Delete a DNS record
  abstract deleteRecord(zoneId: string, recordId: string): Promise<void>;
}
```

**Common Properties:**
- `providerName`: String identifier for the provider
- `credentials`: Decrypted provider credentials
- `client`: Provider-specific API client (if applicable)

### 2. ProviderRegistry
Location: `server/src/providers/ProviderRegistry.ts`

Central registry for managing provider instances and factory functions.

**Key Functions:**
```typescript
class ProviderRegistry {
  // Register a new provider
  static register(name: string, factory: ProviderFactory): void;
  
  // Get a provider instance
  static getProvider(name: string, credentials: any): BaseProvider;
  
  // List all registered providers
  static listProviders(): string[];
}
```

**Usage:**
```typescript
// Register provider
ProviderRegistry.register('cloudflare', (credentials) => new CloudflareProvider(credentials));

// Get provider instance
const provider = ProviderRegistry.getProvider('cloudflare', credentials);
```

### 3. Provider-Specific Implementations
Each provider has its own directory under `server/src/providers/[provider-name]/`

**Typical Structure:**
```
providers/
├── cloudflare/
│   └── index.ts          # CloudflareProvider implementation
├── aliyun/
│   ├── index.ts          # AliyunProvider implementation
│   ├── auth.ts           # Authentication helpers
│   └── lines.ts          # Line/region mappings
├── dnspod/
│   ├── index.ts
│   ├── auth.ts
│   └── lines.ts
└── ...
```

## Provider Implementation Guide

### Step 1: Create Provider Class
```typescript
// server/src/providers/newprovider/index.ts
import { BaseProvider } from '../base/BaseProvider';
import { Zone, DnsRecord } from '../base/types';

export class NewProvider extends BaseProvider {
  private apiClient: any;
  
  constructor(credentials: { apiKey: string; apiSecret: string }) {
    super('newprovider', credentials);
    this.apiClient = this.initializeClient();
  }
  
  private initializeClient() {
    // Initialize provider's API client
    return new ProviderAPIClient(this.credentials);
  }
  
  async listZones(): Promise<Zone[]> {
    // Implementation
    const response = await this.apiClient.getZones();
    return this.transformZones(response);
  }
  
  async listRecords(zoneId: string): Promise<DnsRecord[]> {
    // Implementation
  }
  
  async createRecord(zoneId: string, record: CreateRecordInput): Promise<DnsRecord> {
    // Implementation
  }
  
  async updateRecord(zoneId: string, recordId: string, record: UpdateRecordInput): Promise<DnsRecord> {
    // Implementation
  }
  
  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    // Implementation
  }
}
```

### Step 2: Register Provider
```typescript
// server/src/providers/ProviderRegistry.ts
import { NewProvider } from './newprovider';

ProviderRegistry.register('newprovider', (credentials) => {
  return new NewProvider(credentials);
});
```

### Step 3: Add Credential Schema
Update the DnsCredential secrets format documentation:
```typescript
// For NewProvider
// secrets (encrypted JSON): {"apiKey": "...", "apiSecret": "..."}
```

## Data Flow

### 1. User Request
```
Frontend → API Route → DnsService → Provider → External API
```

### 2. Provider Selection
```typescript
// In DnsService or route handler
const credential = await getDnsCredential(userId, provider);
const decryptedSecrets = decrypt(credential.secrets);
const provider = ProviderRegistry.getProvider(credential.provider, decryptedSecrets);
const zones = await provider.listZones();
```

### 3. Response Transformation
Each provider transforms its API responses to match the common interface:
```typescript
interface Zone {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'paused';
  // ... other common fields
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  // ... other common fields
}
```

## Provider-Specific Features

### Authentication Methods
- **API Token**: Cloudflare, Namesilo
- **Access Key + Secret**: Aliyun, Huawei, Baidu
- **Secret ID + Key**: DNSPod
- **Username + Password**: PowerDNS
- **Custom**: Provider-specific authentication

### Line/Region Support
Some providers (Aliyun, DNSPod, Huawei) support DNS resolution lines/regions:
- Default line
- Telecom, Unicom, Mobile (China)
- Overseas
- Search engine specific
- Custom lines

**Implementation:**
```typescript
// providers/aliyun/lines.ts
export const ALIYUN_LINES = {
  default: '默认',
  telecom: '电信',
  unicom: '联通',
  mobile: '移动',
  // ...
};
```

### Record Type Support
Different providers support different DNS record types:
- **Common**: A, AAAA, CNAME, MX, TXT, NS
- **Extended**: SRV, CAA, PTR, NAPTR
- **Provider-specific**: Cloudflare's proxied records, Aliyun's explicit lines

## Error Handling

### Provider Errors
```typescript
try {
  const records = await provider.listRecords(zoneId);
} catch (error) {
  if (error.code === 'AUTHENTICATION_FAILED') {
    // Handle auth error
  } else if (error.code === 'RATE_LIMIT_EXCEEDED') {
    // Handle rate limit
  } else {
    // Generic error handling
  }
}
```

### Common Error Types
- Authentication failures
- Rate limiting
- Invalid zone/record IDs
- Unsupported record types
- Network errors
- API quota exceeded

## Caching Strategy

### Zone Caching
- Cache duration: 5 minutes
- Cache key: `zones:{provider}:{accountId}`
- Invalidation: Manual refresh or on zone operations

### Record Caching
- Cache duration: 2 minutes
- Cache key: `records:{provider}:{zoneId}`
- Invalidation: On record create/update/delete

## Testing Considerations

### Provider Testing
- Test with real credentials in development
- Mock API responses for unit tests
- Test error scenarios (auth failures, rate limits)
- Verify data transformation correctness
- Test with multiple accounts per provider

### Multi-Provider Testing
- Ensure consistent behavior across providers
- Test provider switching
- Verify credential isolation
- Test default account selection

## Future Enhancements

### Planned Features
- Batch operations support
- Webhook notifications
- Provider health monitoring
- Automatic failover between providers
- Provider-specific advanced features

### Adding New Providers
Priority list for future provider support:
- Route53 (AWS)
- Google Cloud DNS
- Azure DNS
- Vultr DNS
- Linode DNS
- DigitalOcean DNS
