# Suggested Commands

## Development Commands

### Frontend Development
```bash
# Navigate to client directory
cd E:\APP\CF\client

# Install dependencies
npm install

# Start development server (http://localhost:5173)
npm run dev

# Run linting
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview
```

### Backend Development
```bash
# Navigate to server directory
cd E:\APP\CF\server

# Install dependencies
npm install

# Start development server with hot reload (http://localhost:3000)
npm run dev

# Build TypeScript to JavaScript
npm run build

# Start production server (runs prisma db push first)
npm start
```

### Database Operations
```bash
# Navigate to server directory
cd E:\APP\CF\server

# Generate Prisma client (after schema changes)
npm run prisma:generate

# Create and apply database migration
npm run prisma:migrate

# Open Prisma Studio (database GUI)
npm run prisma:studio

# Push schema changes without migration (development)
npx prisma db push

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

## Git Commands (Windows)
```bash
# Check status
git status

# View changes
git diff

# Stage changes
git add .

# Commit changes
git commit -m "commit message"

# Push to remote
git push

# Pull from remote
git pull

# View commit history
git log --oneline -10
```

## Windows System Commands
```bash
# List directory contents (Git Bash)
ls -la

# List directory contents (CMD)
dir

# Find files (Git Bash)
find . -name "*.ts"

# Search in files (Git Bash)
grep -r "searchterm" ./src

# Check Node.js version
node --version

# Check npm version
npm --version
```

## Testing and Debugging

### Frontend
```bash
cd E:\APP\CF\client

# Check for TypeScript errors
npx tsc --noEmit

# Run linter with auto-fix
npm run lint -- --fix
```

### Backend
```bash
cd E:\APP\CF\server

# Check for TypeScript errors
npx tsc --noEmit

# View application logs (if using PM2)
pm2 logs cf-dns-api

# Restart application (if using PM2)
pm2 restart cf-dns-api
```

## Production Deployment

### Build and Deploy
```bash
# Build frontend
cd E:\APP\CF\client
npm install
npm run build
# Output: client/dist/

# Build backend
cd E:\APP\CF\server
npm install --production
npm run build
# Output: server/dist/

# Run database migrations
cd E:\APP\CF\server
npx prisma migrate deploy

# Start with PM2
pm2 start dist/index.js --name cf-dns-api
pm2 save
```

## Useful Shortcuts

### Quick Start (Development)
```bash
# Terminal 1: Start backend
cd E:\APP\CF\server && npm run dev

# Terminal 2: Start frontend
cd E:\APP\CF\client && npm run dev
```

### Quick Check (Before Commit)
```bash
# Check frontend
cd E:\APP\CF\client && npm run lint && npx tsc --noEmit

# Check backend
cd E:\APP\CF\server && npx tsc --noEmit
```

## Environment Setup
```bash
# Copy environment template
cd E:\APP\CF
cp .env.example server/.env

# Edit environment variables (use your preferred editor)
notepad server\.env
# or
code server\.env
```

## Common Troubleshooting Commands
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Prisma generated files
rm -rf node_modules/.prisma
npm run prisma:generate

# Check port usage (Windows CMD)
netstat -ano | findstr :3000
netstat -ano | findstr :5173

# Kill process by PID (Windows CMD)
taskkill /PID <pid> /F
```
