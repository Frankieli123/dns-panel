# Code Style and Conventions

## TypeScript Configuration

### Frontend (Client)
- **Target**: ES2020
- **Module System**: ESNext
- **Strict Mode**: Enabled
- **JSX**: react-jsx
- **Module Resolution**: bundler
- **Unused Checks**: Enabled (noUnusedLocals, noUnusedParameters)
- **Path Aliases**: `@/*` maps to `src/*`

### Backend (Server)
- **Target**: ES2022
- **Module System**: CommonJS
- **Strict Mode**: Disabled (intentional for flexibility)
- **Output Directory**: `./dist`
- **Source Maps**: Enabled
- **Declaration Files**: Generated

## Naming Conventions

### Files and Directories
- **React Components**: PascalCase (e.g., `DnsManagement.tsx`, `QuickAddForm.tsx`)
- **Services**: camelCase (e.g., `auth.ts`, `dnsCredentials.ts`)
- **Utilities**: camelCase (e.g., `validators.ts`, `formatters.ts`)
- **Types**: camelCase (e.g., `index.ts`, `dns.ts`)
- **Directories**: PascalCase for component folders, camelCase for others

### Code
- **Variables/Functions**: camelCase (e.g., `getUserData`, `apiToken`)
- **Classes**: PascalCase (e.g., `BaseProvider`, `DnsService`)
- **Interfaces/Types**: PascalCase (e.g., `User`, `DnsRecord`)
- **Constants**: UPPER_SNAKE_CASE or camelCase (e.g., `JWT_SECRET`, `defaultTimeout`)
- **Private Members**: Prefix with underscore (e.g., `_internalMethod`)

## Code Organization

### Import Order
1. External dependencies (React, third-party libraries)
2. Internal absolute imports (using @ alias)
3. Relative imports
4. Type imports (if separated)

### Component Structure (React)
```typescript
// 1. Imports
import React from 'react';
import { Box, Button } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

// 2. Type definitions
interface ComponentProps {
  // ...
}

// 3. Component definition
export const Component: React.FC<ComponentProps> = ({ prop1, prop2 }) => {
  // 4. Hooks
  const { data } = useQuery(/* ... */);
  
  // 5. Event handlers
  const handleClick = () => {
    // ...
  };
  
  // 6. Render
  return (
    // JSX
  );
};
```

### Service/API Structure
```typescript
// 1. Imports
import axios from 'axios';
import { apiClient } from './api';

// 2. Type definitions
interface ServiceResponse {
  // ...
}

// 3. Service functions
export const serviceName = {
  async getData(): Promise<ServiceResponse> {
    // ...
  },
  
  async updateData(data: any): Promise<void> {
    // ...
  }
};
```

## Security Practices

### Sensitive Data
- **Never commit**: `.env` files, API tokens, passwords
- **Always encrypt**: API tokens, secrets (use AES-256)
- **Use bcrypt**: For password hashing (salt rounds: 10)
- **JWT tokens**: 7-day expiration, signed with secret

### Input Validation
- Validate all user inputs on both frontend and backend
- Use React Hook Form for form validation
- Sanitize inputs to prevent XSS and SQL injection
- Use Prisma's parameterized queries (automatic protection)

### API Security
- All endpoints require JWT authentication (except login/register)
- Rate limiting applied to all routes
- CORS configured to allow only frontend origin
- IP addresses logged for audit trail

## Database Conventions

### Prisma Schema
- **Model Names**: PascalCase, singular (e.g., `User`, `DnsCredential`)
- **Field Names**: camelCase (e.g., `userId`, `createdAt`)
- **Table Names**: snake_case via `@@map` (e.g., `@@map("dns_credentials")`)
- **Indexes**: Applied to foreign keys and frequently queried fields
- **Timestamps**: Use `@default(now())` and `@updatedAt`

### Relationships
- Use `onDelete: Cascade` for dependent records
- Always define both sides of relationships
- Use descriptive relation names for clarity

## Provider Pattern

### Creating New Providers
1. Extend `BaseProvider` class
2. Implement required methods: `listZones`, `listRecords`, `createRecord`, `updateRecord`, `deleteRecord`
3. Register in `ProviderRegistry`
4. Add provider-specific types and authentication

### Provider Structure
```typescript
export class NewProvider extends BaseProvider {
  constructor(credentials: ProviderCredentials) {
    super('providername', credentials);
  }
  
  async listZones(): Promise<Zone[]> {
    // Implementation
  }
  
  // ... other methods
}
```

## Error Handling

### Frontend
- Use try-catch blocks for async operations
- Display user-friendly error messages via MUI Snackbar
- Log errors to console in development
- Use React Query's error handling for API calls

### Backend
- Use centralized error handler middleware
- Return consistent error response format
- Log errors with appropriate severity levels
- Include error details in operation logs

### Error Response Format
```typescript
{
  success: false,
  message: "User-friendly error message",
  error: "Technical error details (development only)"
}
```

## Comments and Documentation

### When to Comment
- Complex business logic
- Non-obvious algorithms
- Provider-specific quirks or limitations
- Security-sensitive code
- Deprecated code (with migration path)

### When NOT to Comment
- Self-explanatory code
- Obvious variable names
- Standard patterns

### Comment Style
```typescript
// Single-line comments for brief explanations

/**
 * Multi-line JSDoc comments for functions/classes
 * @param param1 - Description
 * @returns Description
 */
```

## Testing Considerations
- Manual testing required (no automated tests currently)
- Test with multiple providers
- Verify operation logging
- Check rate limiting behavior
- Test with invalid credentials

## Performance Guidelines
- Use React Query for caching API responses
- Implement pagination for large datasets
- Use indexes on database queries
- Cache DNS provider responses (node-cache)
- Lazy load components where appropriate
- Optimize bundle size with code splitting

## Accessibility
- Use semantic HTML elements
- Provide proper ARIA labels
- Ensure keyboard navigation works
- Use MUI's built-in accessibility features
