import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/encryption';
import { CloudflareService } from '../services/cloudflare';
import { successResponse, errorResponse } from '../utils/response';
import { createLog } from '../services/logger';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();
const prisma = new PrismaClient();

// 所有路由都需要认证
router.use(authenticateToken);

/**
 * 获取当前用户的所有凭证
 */
router.get('/', async (req, res) => {
  try {
    const userId = (req as AuthRequest).user!.id;

    const credentials = await prisma.cfCredential.findMany({
      where: { userId },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' }
      ],
      select: {
        id: true,
        name: true,
        accountId: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return successResponse(res, { credentials }, '获取凭证列表成功');
  } catch (error: any) {
    return errorResponse(res, error.message || '获取凭证列表失败', 500);
  }
});

/**
 * 创建新凭证
 */
router.post('/', async (req, res) => {
  try {
    const userId = (req as AuthRequest).user!.id;
    const { name, apiToken, accountId } = req.body;

    if (!name || !apiToken) {
      await createLog({
        userId,
        action: 'CREATE',
        resourceType: 'CREDENTIAL',
        status: 'FAILED',
        ipAddress: req.ip,
        newValue: JSON.stringify({ name, accountId }),
        errorMessage: '账户名称和 API Token 不能为空',
      });
      return errorResponse(res, '账户名称和 API Token 不能为空', 400);
    }

    // 验证 Token 有效性
    try {
      const cfService = new CloudflareService(apiToken);
      await cfService.getDomains();
    } catch (error: any) {
      await createLog({
        userId,
        action: 'CREATE',
        resourceType: 'CREDENTIAL',
        status: 'FAILED',
        ipAddress: req.ip,
        newValue: JSON.stringify({ name, accountId }),
        errorMessage: `Token 验证失败: ${error.message}`,
      });
      return errorResponse(res, `Token 验证失败: ${error.message}`, 400);
    }

    // 加密 Token
    const encryptedToken = encrypt(apiToken);

    // 检查是否是第一个凭证
    const existingCount = await prisma.cfCredential.count({
      where: { userId },
    });

    const credential = await prisma.cfCredential.create({
      data: {
        userId,
        name,
        apiToken: encryptedToken,
        accountId,
        isDefault: existingCount === 0, // 第一个凭证设为默认
      },
      select: {
        id: true,
        name: true,
        accountId: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 记录日志
    await createLog({
      userId,
      action: 'CREATE',
      resourceType: 'CREDENTIAL',
      status: 'SUCCESS',
      ipAddress: req.ip,
      newValue: JSON.stringify({ name, accountId }),
    });

    return successResponse(res, { credential }, '凭证创建成功', 201);
  } catch (error: any) {
    try {
      const userId = (req as AuthRequest).user!.id;
      await createLog({
        userId,
        action: 'CREATE',
        resourceType: 'CREDENTIAL',
        status: 'FAILED',
        ipAddress: req.ip,
        newValue: JSON.stringify({ name: req.body?.name, accountId: req.body?.accountId }),
        errorMessage: error.message || '创建凭证失败',
      });
    } catch {}
    return errorResponse(res, error.message || '创建凭证失败', 500);
  }
});

/**
 * 更新凭证
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = (req as AuthRequest).user!.id;
    const credentialId = parseInt(req.params.id);
    const { name, apiToken, accountId, isDefault } = req.body;

    // 验证凭证归属
    const existing = await prisma.cfCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!existing) {
      await createLog({
        userId,
        action: 'UPDATE',
        resourceType: 'CREDENTIAL',
        status: 'FAILED',
        ipAddress: req.ip,
        recordName: name,
        oldValue: JSON.stringify({ id: credentialId }),
        newValue: JSON.stringify({ name, accountId, isDefault }),
        errorMessage: '凭证不存在',
      });
      return errorResponse(res, '凭证不存在', 404);
    }

    const updateData: any = {};

    if (name) updateData.name = name;
    if (accountId !== undefined) updateData.accountId = accountId;

    // 如果更新 Token，需要验证
    if (apiToken) {
      try {
        const cfService = new CloudflareService(apiToken);
        await cfService.getDomains();
        updateData.apiToken = encrypt(apiToken);
      } catch (error: any) {
        await createLog({
          userId,
          action: 'UPDATE',
          resourceType: 'CREDENTIAL',
          status: 'FAILED',
          ipAddress: req.ip,
          recordName: existing.name,
          oldValue: JSON.stringify({ id: existing.id, name: existing.name, accountId: existing.accountId, isDefault: existing.isDefault }),
          newValue: JSON.stringify({ name, accountId, isDefault }),
          errorMessage: `Token 验证失败: ${error.message}`,
        });
        return errorResponse(res, `Token 验证失败: ${error.message}`, 400);
      }
    }

    // 如果设置为默认，取消其他默认凭证
    if (isDefault === true) {
      await prisma.cfCredential.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      updateData.isDefault = true;
    }

    const credential = await prisma.cfCredential.update({
      where: { id: credentialId },
      data: updateData,
      select: {
        id: true,
        name: true,
        accountId: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 记录日志
    await createLog({
      userId,
      action: 'UPDATE',
      resourceType: 'CREDENTIAL',
      status: 'SUCCESS',
      ipAddress: req.ip,
      oldValue: JSON.stringify({ name: existing.name }),
      newValue: JSON.stringify({ name: credential.name }),
    });

    return successResponse(res, { credential }, '凭证更新成功');
  } catch (error: any) {
    try {
      const userId = (req as AuthRequest).user!.id;
      await createLog({
        userId,
        action: 'UPDATE',
        resourceType: 'CREDENTIAL',
        status: 'FAILED',
        ipAddress: req.ip,
        recordName: req.body?.name,
        errorMessage: error.message || '更新凭证失败',
      });
    } catch {}
    return errorResponse(res, error.message || '更新凭证失败', 500);
  }
});

/**
 * 删除凭证
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as AuthRequest).user!.id;
    const credentialId = parseInt(req.params.id);

    // 验证凭证归属
    const existing = await prisma.cfCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!existing) {
      return errorResponse(res, '凭证不存在', 404);
    }

    await prisma.cfCredential.delete({
      where: { id: credentialId },
    });

    // 如果删除的是默认凭证，将第一个凭证设为默认
    if (existing.isDefault) {
      const firstCredential = await prisma.cfCredential.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });

      if (firstCredential) {
        await prisma.cfCredential.update({
          where: { id: firstCredential.id },
          data: { isDefault: true },
        });
      }
    }

    // 记录日志
    await createLog({
      userId,
      action: 'DELETE',
      resourceType: 'CREDENTIAL',
      status: 'SUCCESS',
      ipAddress: req.ip,
      oldValue: JSON.stringify({ name: existing.name }),
    });

    return successResponse(res, null, '凭证删除成功');
  } catch (error: any) {
    try {
      const userId = (req as AuthRequest).user!.id;
      await createLog({
        userId,
        action: 'DELETE',
        resourceType: 'CREDENTIAL',
        status: 'FAILED',
        ipAddress: req.ip,
        oldValue: JSON.stringify({ id: parseInt(req.params.id) }),
        errorMessage: error.message || '删除凭证失败',
      });
    } catch {}
    return errorResponse(res, error.message || '删除凭证失败', 500);
  }
});

/**
 * 验证凭证有效性
 */
router.post('/:id/verify', async (req, res) => {
  try {
    const userId = (req as AuthRequest).user!.id;
    const credentialId = parseInt(req.params.id);

    // 验证凭证归属
    const credential = await prisma.cfCredential.findFirst({
      where: { id: credentialId, userId },
    });

    if (!credential) {
      return errorResponse(res, '凭证不存在', 404);
    }

    // 解密并验证 Token
    const apiToken = decrypt(credential.apiToken);
    const cfService = new CloudflareService(apiToken);

    try {
      await cfService.getDomains();

      await createLog({
        userId,
        action: 'UPDATE',
        resourceType: 'CREDENTIAL',
        recordName: credential.name,
        status: 'SUCCESS',
        ipAddress: req.ip,
        newValue: JSON.stringify({ id: credential.id, valid: true }),
      });

      return successResponse(res, { valid: true }, 'Token 验证成功');
    } catch (error: any) {
      await createLog({
        userId,
        action: 'UPDATE',
        resourceType: 'CREDENTIAL',
        recordName: credential.name,
        status: 'FAILED',
        ipAddress: req.ip,
        newValue: JSON.stringify({ id: credential.id, valid: false }),
        errorMessage: error?.message || 'Token 验证失败',
      });

      return successResponse(res, { valid: false, error: error.message }, 'Token 验证失败');
    }
  } catch (error: any) {
    return errorResponse(res, error.message || '验证凭证失败', 500);
  }
});

export default router;
