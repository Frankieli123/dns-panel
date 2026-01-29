import { Router } from 'express';
import { AuthService } from '../services/auth';
import { TwoFactorService } from '../services/twoFactor';
import { LoggerService } from '../services/logger';
import { successResponse, errorResponse } from '../utils/response';
import { authenticateToken } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';
import { getClientIp } from '../middleware/logger';
import { AuthRequest } from '../types';

const router = Router();

/**
 * POST /api/auth/register
 * 用户注册
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, cfApiToken, cfAccountId } = req.body;

    if (!username || !password) {
      return errorResponse(res, '缺少必需参数', 400);
    }

    const user = await AuthService.register({
      username,
      email,
      password,
      cfApiToken,
      cfAccountId,
    });

    return successResponse(res, { user }, '注册成功', 201);
  } catch (error: any) {
    return errorResponse(res, error.message, 400);
  }
});

/**
 * POST /api/auth/login
 * 用户登录（支持 2FA）
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return errorResponse(res, '缺少用户名或密码', 400);
    }

    const result = await AuthService.login({ username, password });

    if (result.requires2FA) {
      return successResponse(res, {
        requires2FA: true,
        tempToken: result.tempToken,
      }, '请输入两步验证码');
    }

    return successResponse(res, {
      token: result.token,
      user: result.user,
    }, '登录成功');
  } catch (error: any) {
    return errorResponse(res, error.message, 401);
  }
});

/**
 * POST /api/auth/2fa/verify
 * 验证 2FA 码完成登录
 */
router.post('/2fa/verify', loginLimiter, async (req, res) => {
  try {
    const { tempToken, code } = req.body;

    if (!tempToken || !code) {
      return errorResponse(res, '缺少验证参数', 400);
    }

    const result = await TwoFactorService.verifyAndGenerateToken(tempToken, code);

    return successResponse(res, {
      token: result.token,
      user: result.user,
    }, '登录成功');
  } catch (error: any) {
    return errorResponse(res, error.message, 401);
  }
});

/**
 * GET /api/auth/2fa/status
 * 获取当前用户的 2FA 状态
 */
router.get('/2fa/status', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const status = await TwoFactorService.getStatus(req.user!.id);
    return successResponse(res, status, '获取 2FA 状态成功');
  } catch (error: any) {
    return errorResponse(res, error.message, 400);
  }
});

/**
 * POST /api/auth/2fa/setup
 * 生成 2FA 密钥和 QR 码
 */
router.post('/2fa/setup', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const result = await TwoFactorService.generateSecret(req.user!.id);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'USER',
      recordName: req.user?.username,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ action: '2fa_setup' }),
    });

    return successResponse(res, result, '2FA 密钥生成成功');
  } catch (error: any) {
    return errorResponse(res, error.message, 400);
  }
});

/**
 * POST /api/auth/2fa/enable
 * 启用 2FA（需要验证 TOTP 码和密码）
 */
router.post('/2fa/enable', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { code, password } = req.body;

    if (!code) {
      return errorResponse(res, '请输入验证码', 400);
    }

    if (!password) {
      return errorResponse(res, '请输入密码', 400);
    }

    await TwoFactorService.enable(req.user!.id, code, password);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'USER',
      recordName: req.user?.username,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ twoFactorEnabled: true }),
    });

    return successResponse(res, null, '2FA 已启用');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'UPDATE',
        resourceType: 'USER',
        recordName: req.user?.username,
        status: 'FAILED',
        ipAddress: getClientIp(req),
        errorMessage: error?.message || '2FA 启用失败',
      });
    } catch {}
    return errorResponse(res, error.message, 400);
  }
});

/**
 * POST /api/auth/2fa/disable
 * 禁用 2FA（需要验证密码）
 */
router.post('/2fa/disable', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return errorResponse(res, '请输入密码', 400);
    }

    await TwoFactorService.disable(req.user!.id, password);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'USER',
      recordName: req.user?.username,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ twoFactorEnabled: false }),
    });

    return successResponse(res, null, '2FA 已禁用');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'UPDATE',
        resourceType: 'USER',
        recordName: req.user?.username,
        status: 'FAILED',
        ipAddress: getClientIp(req),
        errorMessage: error?.message || '2FA 禁用失败',
      });
    } catch {}
    return errorResponse(res, error.message, 400);
  }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await AuthService.getUserById(req.user!.id);
    return successResponse(res, { user }, '获取用户信息成功');
  } catch (error: any) {
    return errorResponse(res, error.message, 400);
  }
});

/**
 * PUT /api/auth/domain-expiry-settings
 * 更新域名到期展示/阈值/通知设置
 */
router.put('/domain-expiry-settings', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const {
      displayMode,
      thresholdDays,
      notifyEnabled,
      webhookUrl,
      notifyEmailEnabled,
      emailTo,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      smtpFrom,
    } = req.body || {};

    if (displayMode !== undefined && displayMode !== 'date' && displayMode !== 'days') {
      return errorResponse(res, 'displayMode 仅支持 date 或 days', 400);
    }

    const user = await AuthService.updateDomainExpirySettings(req.user!.id, {
      displayMode,
      thresholdDays,
      notifyEnabled,
      webhookUrl,
      notifyEmailEnabled,
      emailTo,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      smtpFrom,
    });

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'USER',
      recordName: req.user?.username,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({
        action: 'domain_expiry_settings',
        displayMode: user.domainExpiryDisplayMode,
        thresholdDays: user.domainExpiryThresholdDays,
        notifyEnabled: user.domainExpiryNotifyEnabled,
        webhookUrl: user.domainExpiryNotifyWebhookUrl ? 'set' : null,
        notifyEmailEnabled: (user as any).domainExpiryNotifyEmailEnabled ?? false,
        emailTo: (user as any).domainExpiryNotifyEmailTo ? 'set' : null,
        smtpHost: (user as any).smtpHost ? 'set' : null,
        smtpPort: (user as any).smtpPort ?? null,
        smtpSecure: (user as any).smtpSecure ?? null,
        smtpUser: (user as any).smtpUser ? 'set' : null,
        smtpFrom: (user as any).smtpFrom ? 'set' : null,
        smtpPassConfigured: (user as any).smtpPassConfigured ?? false,
      }),
    });

    return successResponse(res, { user }, '设置已保存');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'UPDATE',
        resourceType: 'USER',
        recordName: req.user?.username,
        status: 'FAILED',
        ipAddress: getClientIp(req),
        errorMessage: error?.message || '设置保存失败',
      });
    } catch {}
    return errorResponse(res, error.message, 400);
  }
});

/**
 * PUT /api/auth/password
 * 修改密码
 */
router.put('/password', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return errorResponse(res, '缺少必需参数', 400);
    }

    await AuthService.updatePassword(req.user!.id, oldPassword, newPassword);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'USER',
      recordName: req.user?.username,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ passwordUpdated: true }),
    });

    return successResponse(res, null, '密码修改成功');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'UPDATE',
        resourceType: 'USER',
        recordName: req.user?.username,
        status: 'FAILED',
        ipAddress: getClientIp(req),
        errorMessage: error?.message || '密码修改失败',
      });
    } catch {}
    return errorResponse(res, error.message, 400);
  }
});

/**
 * PUT /api/auth/cf-token
 * 更新 Cloudflare API Token
 */
router.put('/cf-token', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { cfApiToken } = req.body;

    if (!cfApiToken) {
      return errorResponse(res, '缺少 API Token', 400);
    }

    await AuthService.updateCfToken(req.user!.id, cfApiToken);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'USER',
      recordName: req.user?.username,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ cfTokenUpdated: true }),
    });

    return successResponse(res, null, 'API Token 更新成功');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'UPDATE',
        resourceType: 'USER',
        recordName: req.user?.username,
        status: 'FAILED',
        ipAddress: getClientIp(req),
        errorMessage: error?.message || 'API Token 更新失败',
      });
    } catch {}
    return errorResponse(res, error.message, 400);
  }
});

export default router;
