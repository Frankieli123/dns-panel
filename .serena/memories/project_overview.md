# Project Overview

## Project Name
**CF** - Multi-Provider DNS Management System

## Purpose
A comprehensive web application for managing DNS records across multiple DNS providers. Originally designed for Cloudflare DNS management, it has evolved into a multi-provider platform supporting 12+ DNS providers including Cloudflare, Aliyun, DNSPod, Huawei Cloud, and more.

## Key Features
- **User Authentication**: JWT-based authentication with bcrypt password encryption
- **Multi-Provider Support**: Unified interface for managing DNS across different providers
- **Multi-Account Management**: Support for multiple accounts per provider with account aliases
- **Domain Management**: View and manage domains/zones across all providers
- **DNS Record Operations**: Create, read, update, delete DNS records with quick-add functionality
- **Custom Hostname Management**: Manage custom hostnames (primarily for Cloudflare)
- **Operation Logging**: Comprehensive audit trail of all operations with IP tracking
- **Secure Credential Storage**: AES-256 encrypted storage of API tokens and secrets

## Target Users
- DevOps engineers managing DNS across multiple cloud providers
- System administrators handling multi-tenant DNS configurations
- Organizations using multiple DNS providers for redundancy or regional requirements

## Deployment Context
- Single-server deployment with SQLite database
- Lightweight and suitable for private server hosting
- Development on Windows (E:\APP\CF)
- Production deployment typically on Linux servers

## Current Status
The project is actively developed with recent commits focused on navigation optimization and DNS management features. The codebase shows evidence of migration from single-provider (Cloudflare) to multi-provider architecture.
