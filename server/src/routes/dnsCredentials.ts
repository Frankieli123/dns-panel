/**
 * DNS 凭证路由 - 支持多提供商
 * 替代原有的 credentials.ts (仅支持 Cloudflare)
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/encryption';
import { successResponse, errorResponse } from '../utils/response';
import { createLog } from '../services/logger';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ProviderType } from '../providers/base/types';
import { dnsService } from '../services/dns/DnsService';
import { CloudflareService } from '../services/cloudflare';

const router = Router();
const prisma = new PrismaClient();

const normalizeSecretsMeta = (secrets: any) => {
  if (!secrets || typeof secrets !== 'object') {
    return { secretsUpdated: false, secretsKeys: [] as string[] };
  }

  return {
    secretsUpdated: true,
    secretsKeys: Object.keys(secrets).sort(),
  };
};

const buildCredentialLogValue = (value: {
  id?: number;
  name?: string;
  provider?: string;
  accountId?: any;
  isDefault?: boolean;
  secrets?: any;
}) => {
  const meta = normalizeSecretsMeta(value.secrets);
  return {
    id: value.id,
    name: value.name,
    provider: value.provider,
    accountId: value.accountId,
    isDefault: value.isDefault,
    secretsUpdated: meta.secretsUpdated,
    secretsKeys: meta.secretsKeys,
  };
};

router.use(authenticateToken);

/**
 * GET /api/dns-credentials/providers
 * 获取所有支持的提供商及其配置
 */
router.get('/providers', async (_req, res) => {
  try {
    const capabilities = ProviderRegistry.getAllCapabilities();
    return successResponse(res, { providers: capabilities }, '获取提供商列表成功');
  } catch (error: any) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/dns-credentials
 * 获取当前用户的所有凭证
 */
router.get('/', async (req, res) => {
  try {
    const userId = (req as AuthRequest).user!.id;

    const credentials = await prisma.dnsCredential.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        provider: true,
        accountId: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 添加提供商显示名称
    const credentialsWithMeta = credentials.map(cred => {
      const caps = ProviderRegistry.getCapabilities(cred.provider as ProviderType);
      return {
        ...cred,
        providerName: caps?.name || cred.provider,
      };
    });

    return successResponse(res, { credentials: credentialsWithMeta }, '获取凭证列表成功');
  } catch (error: any) {
    return errorResponse(res, error.message || '获取凭证列表失败', 500);
  }
});

/**
 * POST /api/dns-credentials
 * 创建新凭证
 */
router.post('/', async (req, res) => {
  const userId = (req as AuthRequest).user!.id;
  const { name, provider, secrets, accountId } = req.body || {};

  try {
    if (!name || !provider || !secrets) {
      await createLog({
        userId,
        action: 'CREATE',
        resourceType: 'CREDENTIAL',
        domain: provider,
        recordName: name,
        status: 'FAILED',
        ipAddress: req.ip,
        newValue: JSON.stringify(buildCredentialLogValue({ name, provider, accountId, secrets })),
        errorMessage: '缺少必需参数: name, provider, secrets',
      });
      return errorResponse(res, '缺少必需参数: name, provider, secrets', 400);
    }

    if (!ProviderRegistry.isSupported(provider as ProviderType)) {
      await createLog({
        userId,
        action: 'CREATE',
        resourceType: 'CREDENTIAL',
        domain: provider,
        recordName: name,
        status: 'FAILED',
        ipAddress: req.ip,
        newValue: JSON.stringify(buildCredentialLogValue({ name, provider, accountId, secrets })),
        errorMessage: `不支持的提供商: ${provider}`,
      });
      return errorResponse(res, `不支持的提供商: ${provider}`, 400);
    }

    let resolvedAccountId = accountId;
    if (provider === 'cloudflare' && !String(resolvedAccountId || '').trim()) {
      const apiToken = (secrets as any)?.apiToken;
      if (typeof apiToken === 'string' && apiToken.trim()) {
        try {
          resolvedAccountId = await new CloudflareService(apiToken).getDefaultAccountId();
        } catch {
          // ignore: allow credential creation without accountId, add zone will fail with a clear permission error
        }
      }
    }

    const encryptedSecrets = encrypt(JSON.stringify(secrets));

    const existingCount = await prisma.dnsCredential.count({ where: { userId } });
    const isDefault = existingCount === 0;

    const credential = await prisma.dnsCredential.create({
      data: {
        userId,
        name,
        provider,
        secrets: encryptedSecrets,
        accountId: resolvedAccountId,
        isDefault,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        accountId: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await createLog({
      userId,
      action: 'CREATE',
      resourceType: 'CREDENTIAL',
      domain: credential.provider,
      recordName: credential.name,
      status: 'SUCCESS',
      ipAddress: req.ip,
      newValue: JSON.stringify(buildCredentialLogValue({
        id: credential.id,
        name: credential.name,
        provider: credential.provider,
        accountId: credential.accountId,
        isDefault: credential.isDefault,
        secrets,
      })),
    });

    const caps = ProviderRegistry.getCapabilities(provider as ProviderType);
    return successResponse(res, {
      credential: { ...credential, providerName: caps?.name || provider },
    }, '凭证创建成功', 201);
  } catch (error: any) {
    await createLog({
      userId,
      action: 'CREATE',
      resourceType: 'CREDENTIAL',
      domain: provider,
      recordName: name,
      status: 'FAILED',
      ipAddress: req.ip,
      newValue: JSON.stringify(buildCredentialLogValue({ name, provider, accountId, secrets })),
      errorMessage: error?.message || '创建凭证失败',
    });
    return errorResponse(res, error.message || '创建凭证失败', 500);
  }
});

/**
 * PUT /api/dns-credentials/:id
 * 更新凭证
 */
router.put('/:id', async (req, res) => {
  const userId = (req as AuthRequest).user!.id;
  const credentialId = parseInt(req.params.id);
  const { name, secrets, accountId, isDefault } = req.body || {};

  try {
    const existing = await prisma.dnsCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!existing) {
      await createLog({
        userId,
        action: 'UPDATE',
        resourceType: 'CREDENTIAL',
        recordName: name,
        status: 'FAILED',
        ipAddress: req.ip,
        oldValue: JSON.stringify(buildCredentialLogValue({ id: credentialId })),
        newValue: JSON.stringify(buildCredentialLogValue({ id: credentialId, name, accountId, secrets, isDefault })),
        errorMessage: '凭证不存在',
      });
      return errorResponse(res, '凭证不存在', 404);
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (accountId !== undefined) updateData.accountId = accountId;
    if (secrets) {
      updateData.secrets = encrypt(JSON.stringify(secrets));
    }

    if (isDefault === true) {
      await prisma.dnsCredential.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      updateData.isDefault = true;
    }

    const credential = await prisma.dnsCredential.update({
      where: { id: credentialId },
      data: updateData,
      select: {
        id: true,
        name: true,
        provider: true,
        accountId: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (secrets) {
      dnsService.clearAllCache();
    }

    const changes: Record<string, any> = {};
    if (name !== undefined && existing.name !== credential.name) {
      changes.name = { from: existing.name, to: credential.name };
    }
    if (accountId !== undefined && existing.accountId !== credential.accountId) {
      changes.accountId = { from: existing.accountId, to: credential.accountId };
    }
    if (isDefault === true && existing.isDefault !== credential.isDefault) {
      changes.isDefault = { from: existing.isDefault, to: credential.isDefault };
    }
    if (secrets) {
      changes.secrets = { updated: true, keys: normalizeSecretsMeta(secrets).secretsKeys };
    }

    await createLog({
      userId,
      action: 'UPDATE',
      resourceType: 'CREDENTIAL',
      domain: credential.provider,
      recordName: credential.name,
      status: 'SUCCESS',
      ipAddress: req.ip,
      oldValue: JSON.stringify({ credential: buildCredentialLogValue({
        id: existing.id,
        name: existing.name,
        provider: existing.provider,
        accountId: existing.accountId,
        isDefault: existing.isDefault,
      }) }),
      newValue: JSON.stringify({
        credential: buildCredentialLogValue({
          id: credential.id,
          name: credential.name,
          provider: credential.provider,
          accountId: credential.accountId,
          isDefault: credential.isDefault,
          secrets,
        }),
        changes,
      }),
    });

    const caps = ProviderRegistry.getCapabilities(credential.provider as ProviderType);
    return successResponse(res, {
      credential: { ...credential, providerName: caps?.name || credential.provider },
    }, '凭证更新成功');
  } catch (error: any) {
    await createLog({
      userId,
      action: 'UPDATE',
      resourceType: 'CREDENTIAL',
      recordName: name,
      status: 'FAILED',
      ipAddress: req.ip,
      oldValue: JSON.stringify(buildCredentialLogValue({ id: credentialId })),
      newValue: JSON.stringify(buildCredentialLogValue({ id: credentialId, name, accountId, secrets, isDefault })),
      errorMessage: error?.message || '更新凭证失败',
    });
    return errorResponse(res, error.message || '更新凭证失败', 500);
  }
});

/**
 * DELETE /api/dns-credentials/:id
 * 删除凭证
 */
router.delete('/:id', async (req, res) => {
  const userId = (req as AuthRequest).user!.id;
  const credentialId = parseInt(req.params.id);

  try {
    const existing = await prisma.dnsCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!existing) {
      await createLog({
        userId,
        action: 'DELETE',
        resourceType: 'CREDENTIAL',
        status: 'FAILED',
        ipAddress: req.ip,
        oldValue: JSON.stringify(buildCredentialLogValue({ id: credentialId })),
        errorMessage: '凭证不存在',
      });
      return errorResponse(res, '凭证不存在', 404);
    }

    await prisma.dnsCredential.delete({ where: { id: credentialId } });

    if (existing.isDefault) {
      const first = await prisma.dnsCredential.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      if (first) {
        await prisma.dnsCredential.update({
          where: { id: first.id },
          data: { isDefault: true },
        });
      }
    }

    await createLog({
      userId,
      action: 'DELETE',
      resourceType: 'CREDENTIAL',
      domain: existing.provider,
      recordName: existing.name,
      status: 'SUCCESS',
      ipAddress: req.ip,
      oldValue: JSON.stringify(buildCredentialLogValue({
        id: existing.id,
        name: existing.name,
        provider: existing.provider,
        accountId: existing.accountId,
        isDefault: existing.isDefault,
      })),
    });

    return successResponse(res, null, '凭证删除成功');
  } catch (error: any) {
    await createLog({
      userId,
      action: 'DELETE',
      resourceType: 'CREDENTIAL',
      status: 'FAILED',
      ipAddress: req.ip,
      oldValue: JSON.stringify(buildCredentialLogValue({ id: credentialId })),
      errorMessage: error?.message || '删除凭证失败',
    });
    return errorResponse(res, error.message || '删除凭证失败', 500);
  }
});

/**
 * POST /api/dns-credentials/:id/verify
 * 验证凭证有效性
 */
router.post('/:id/verify', async (req, res) => {
  try {
    const userId = (req as AuthRequest).user!.id;
    const credentialId = parseInt(req.params.id);

    const credential = await prisma.dnsCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!credential) {
      return errorResponse(res, '凭证不存在', 404);
    }

    const secrets = JSON.parse(decrypt(credential.secrets));
    const providerInstance = ProviderRegistry.createProvider({
      provider: credential.provider as ProviderType,
      secrets,
      accountId: credential.accountId || undefined,
      encrypted: false,
    });

    const isValid = await providerInstance.checkAuth();

    await createLog({
      userId,
      action: 'UPDATE',
      resourceType: 'CREDENTIAL',
      domain: credential.provider,
      recordName: credential.name,
      status: isValid ? 'SUCCESS' : 'FAILED',
      ipAddress: req.ip,
      newValue: JSON.stringify({ id: credential.id, provider: credential.provider, valid: isValid }),
      errorMessage: isValid ? undefined : '凭证无效',
    });

    return successResponse(res, { valid: isValid }, isValid ? '凭证验证成功' : '凭证验证失败');
  } catch (error: any) {
    try {
      await createLog({
        userId: (req as AuthRequest).user!.id,
        action: 'UPDATE',
        resourceType: 'CREDENTIAL',
        recordName: req.params.id,
        status: 'FAILED',
        ipAddress: req.ip,
        errorMessage: error?.message || '凭证验证失败',
      });
    } catch {}
    return successResponse(res, { valid: false, error: error.message }, '凭证验证失败');
  }
});

export default router;
