# Technology Stack

## Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 6.0.1
- **UI Library**: Material-UI (MUI) v6.1.9
  - @emotion/react and @emotion/styled for styling
  - @mui/icons-material for icons
- **State Management**: 
  - React Context API (AccountContext, ProviderContext, BreadcrumbContext)
  - @tanstack/react-query v5.62.7 for server state and caching
- **HTTP Client**: Axios v1.7.9
- **Routing**: React Router v6.28.0
- **Form Handling**: React Hook Form v7.54.2
- **Language**: TypeScript 5.6.3
- **Linting**: ESLint 9.15.0 with TypeScript support

## Backend
- **Runtime**: Node.js 18+
- **Framework**: Express 4.21.1 with TypeScript
- **Database**: SQLite (via Prisma)
- **ORM**: Prisma 5.22.0
  - Binary targets: native, linux-musl-openssl-3.0.x
- **Authentication**: 
  - jsonwebtoken v9.0.2 (JWT)
  - bcrypt v5.1.1 (password hashing)
- **Security**:
  - AES-256 encryption for API tokens/secrets
  - express-rate-limit v7.4.1 for rate limiting
  - cors v2.8.5 for CORS handling
- **Caching**: node-cache v5.1.2 (in-memory)
- **DNS Provider SDKs**:
  - cloudflare v3.5.0
  - Various provider-specific implementations
- **Development**: tsx v4.19.2 (TypeScript execution)
- **Utilities**: 
  - dotenv v16.4.5 (environment variables)
  - iconv-lite v0.6.3 (character encoding)

## Development Tools
- **TypeScript**: v5.6.3 (both frontend and backend)
- **Package Manager**: npm
- **Version Control**: Git
- **Code Quality**: ESLint (frontend)

## Infrastructure
- **Database**: SQLite (file-based, suitable for single-server deployment)
- **Reverse Proxy**: Nginx (recommended for production)
- **Process Manager**: PM2 (recommended for production)
- **SSL**: Let's Encrypt (recommended)
