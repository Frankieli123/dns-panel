# Task Completion Checklist

## When a Task is Completed

### 1. Code Quality Checks
- [ ] **Linting**: Run `npm run lint` in the client directory
- [ ] **TypeScript**: Check for type errors with `npx tsc --noEmit` in both client and server
- [ ] **Code Review**: Review your changes for:
  - Security vulnerabilities (XSS, SQL injection, exposed secrets)
  - Proper error handling
  - Consistent code style
  - Appropriate comments for complex logic

### 2. Functional Testing
- [ ] **Manual Testing**: Test the feature/fix in development environment
  - Start both frontend (`npm run dev` in client) and backend (`npm run dev` in server)
  - Test all affected functionality
  - Test edge cases and error scenarios
- [ ] **Multi-Provider Testing**: If DNS operations are involved, test with multiple providers
- [ ] **Authentication**: Verify JWT authentication still works
- [ ] **Rate Limiting**: Check that rate limiting doesn't block legitimate requests

### 3. Database Changes
- [ ] **Schema Changes**: If Prisma schema was modified:
  - Run `npm run prisma:generate` to regenerate client
  - Run `npm run prisma:migrate` to create migration
  - Test migration on a copy of production data if available
- [ ] **Data Migration**: If data migration is needed:
  - Create migration script in `server/src/scripts/`
  - Test thoroughly before production deployment
  - Document the migration process

### 4. Security Review
- [ ] **Credentials**: Ensure no API tokens, passwords, or secrets are committed
- [ ] **Encryption**: Verify sensitive data is encrypted (API tokens, secrets)
- [ ] **Input Validation**: Check that user inputs are validated and sanitized
- [ ] **Authentication**: Ensure protected routes require JWT
- [ ] **Logging**: Verify operation logs are created for audit trail

### 5. Documentation
- [ ] **Code Comments**: Add comments for complex or non-obvious logic
- [ ] **API Changes**: Document any API endpoint changes
- [ ] **Environment Variables**: Update `.env.example` if new variables are added
- [ ] **Memory Updates**: Update relevant memory files if architecture changes

### 6. Git Workflow
- [ ] **Stage Changes**: `git add .` (or specific files)
- [ ] **Review Diff**: `git diff --staged` to review what will be committed
- [ ] **Commit**: `git commit -m "descriptive message"`
  - Use clear, descriptive commit messages
  - Reference issue numbers if applicable
- [ ] **Push**: `git push` to remote repository

### 7. Build Verification
- [ ] **Frontend Build**: Run `npm run build` in client directory
  - Verify no build errors
  - Check bundle size if performance is a concern
- [ ] **Backend Build**: Run `npm run build` in server directory
  - Verify TypeScript compiles without errors
  - Check that dist/ directory is created

### 8. Deployment Preparation (if applicable)
- [ ] **Environment Config**: Verify production environment variables are set
- [ ] **Database Backup**: Backup production database before schema changes
- [ ] **Rollback Plan**: Have a plan to rollback if deployment fails
- [ ] **Monitoring**: Plan to monitor logs after deployment

## Quick Checklist (Minimal)
For small changes, at minimum:
1. ✓ Run linting (`npm run lint` in client)
2. ✓ Test manually in development
3. ✓ Review git diff
4. ✓ Commit with clear message

## Common Issues to Check
- **CORS errors**: Verify CORS_ORIGIN in .env matches frontend URL
- **JWT errors**: Check JWT_SECRET is set and consistent
- **Database errors**: Ensure DATABASE_URL is correct
- **Port conflicts**: Check ports 3000 and 5173 are available
- **Missing dependencies**: Run `npm install` if package.json changed
- **Prisma client**: Regenerate if schema changed (`npm run prisma:generate`)
