# Code Structure

## Root Directory
```
E:\APP\CF/
├── client/          # React frontend application
├── server/          # Node.js backend API
├── .env.example     # Environment variable template
└── 项目规划.md      # Project planning document (Chinese)
```

## Client Structure (E:\APP\CF\client)
```
client/
├── src/
│   ├── pages/                      # Page components
│   │   ├── Login.tsx               # Login page
│   │   ├── Register.tsx            # Registration page
│   │   ├── Dashboard.tsx           # Main dashboard
│   │   ├── DomainDetail.tsx        # Domain detail view
│   │   ├── CustomHostnames.tsx     # Custom hostname management
│   │   ├── Logs.tsx                # Operation logs viewer
│   │   └── Settings.tsx            # User settings
│   │
│   ├── components/                 # Reusable components
│   │   ├── Layout/                 # Layout components
│   │   │   ├── Layout.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── Dashboard/              # Dashboard-specific components
│   │   │   ├── ProviderAccountTabs.tsx
│   │   │   └── ProviderSidebar.tsx
│   │   ├── DnsManagement/          # DNS management components
│   │   │   └── DnsManagement.tsx
│   │   ├── DNSRecordTable/         # DNS record table
│   │   │   └── DNSRecordTable.tsx
│   │   ├── QuickAddForm/           # Quick add form
│   │   │   └── QuickAddForm.tsx
│   │   ├── CustomHostnameList/     # Custom hostname list
│   │   │   └── CustomHostnameList.tsx
│   │   ├── AccountSwitcher/        # Account switching
│   │   │   └── AccountTabs.tsx
│   │   └── Settings/               # Settings components
│   │       ├── TokenManagement.tsx
│   │       ├── ProviderSelector.tsx
│   │       └── DnsCredentialManagement.tsx
│   │
│   ├── services/                   # API service layer
│   │   ├── api.ts                  # Axios configuration
│   │   ├── auth.ts                 # Authentication services
│   │   ├── domains.ts              # Domain operations
│   │   ├── dns.ts                  # DNS record operations
│   │   ├── logs.ts                 # Log retrieval
│   │   ├── hostnames.ts            # Custom hostname operations
│   │   ├── credentials.ts          # Credential management
│   │   └── dnsCredentials.ts       # DNS credential operations
│   │
│   ├── contexts/                   # React contexts
│   │   ├── AccountContext.tsx      # Account state management
│   │   ├── ProviderContext.tsx     # Provider state management
│   │   └── BreadcrumbContext.tsx   # Breadcrumb navigation
│   │
│   ├── utils/                      # Utility functions
│   │   ├── validators.ts           # Input validation
│   │   ├── formatters.ts           # Data formatting
│   │   └── constants.ts            # Constants
│   │
│   ├── types/                      # TypeScript type definitions
│   │   ├── index.ts                # General types
│   │   └── dns.ts                  # DNS-specific types
│   │
│   ├── theme.ts                    # MUI theme configuration
│   ├── App.tsx                     # Root component
│   └── main.tsx                    # Application entry point
│
├── public/                         # Static assets
├── tsconfig.json                   # TypeScript configuration
├── tsconfig.node.json              # Node-specific TS config
├── vite.config.ts                  # Vite configuration
└── package.json                    # Dependencies and scripts
```

## Server Structure (E:\APP\CF\server)
```
server/
├── src/
│   ├── routes/                     # API route handlers
│   │   ├── auth.ts                 # Authentication endpoints
│   │   ├── domains.ts              # Domain management endpoints
│   │   ├── dns.ts                  # DNS record endpoints
│   │   ├── dnsRecords.ts           # DNS record operations
│   │   ├── logs.ts                 # Log retrieval endpoints
│   │   ├── hostnames.ts            # Custom hostname endpoints
│   │   ├── credentials.ts          # Credential management
│   │   └── dnsCredentials.ts       # DNS credential endpoints
│   │
│   ├── services/                   # Business logic layer
│   │   ├── auth.ts                 # Authentication service
│   │   ├── cloudflare.ts           # Cloudflare API wrapper
│   │   ├── logger.ts               # Logging service
│   │   └── dns/
│   │       └── DnsService.ts       # DNS service abstraction
│   │
│   ├── providers/                  # DNS provider implementations
│   │   ├── base/                   # Base provider classes
│   │   │   ├── BaseProvider.ts     # Abstract base provider
│   │   │   └── types.ts            # Provider type definitions
│   │   ├── ProviderRegistry.ts     # Provider registration system
│   │   ├── cloudflare/             # Cloudflare provider
│   │   ├── aliyun/                 # Alibaba Cloud DNS
│   │   ├── dnspod/                 # Tencent DNSPod
│   │   ├── huawei/                 # Huawei Cloud DNS
│   │   ├── baidu/                  # Baidu Cloud DNS
│   │   ├── huoshan/                # ByteDance Huoshan
│   │   ├── jdcloud/                # JD Cloud DNS
│   │   ├── west/                   # West.cn
│   │   ├── namesilo/               # Namesilo
│   │   ├── dnsla/                  # DNSLA
│   │   ├── spaceship/              # Spaceship
│   │   └── powerdns/               # PowerDNS
│   │
│   ├── middleware/                 # Express middleware
│   │   ├── auth.ts                 # JWT authentication
│   │   ├── errorHandler.ts         # Global error handler
│   │   ├── rateLimit.ts            # Rate limiting
│   │   └── logger.ts               # Request logging
│   │
│   ├── utils/                      # Utility functions
│   │   ├── encryption.ts           # AES-256 encryption
│   │   └── response.ts             # Response formatting
│   │
│   ├── config/                     # Configuration management
│   │   └── index.ts                # Config loader
│   │
│   ├── types/                      # TypeScript type definitions
│   │   └── index.ts
│   │
│   ├── scripts/                    # Utility scripts
│   │   ├── migrate-tokens.ts       # Token migration script
│   │   └── migrate-to-dns-credentials.ts
│   │
│   └── index.ts                    # Application entry point
│
├── prisma/
│   ├── schema.prisma               # Database schema
│   └── migrations/                 # Database migrations
│
├── .env                            # Environment variables (not in git)
├── tsconfig.json                   # TypeScript configuration
└── package.json                    # Dependencies and scripts
```

## Key Architectural Patterns
- **Provider Pattern**: Extensible DNS provider system with BaseProvider and ProviderRegistry
- **Service Layer**: Business logic separated from route handlers
- **Middleware Pipeline**: Authentication, rate limiting, error handling, logging
- **Context API**: Frontend state management without Redux
- **React Query**: Server state caching and synchronization
