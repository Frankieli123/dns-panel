import { PrismaClient } from '@prisma/client';
import { LogCreateParams } from '../types';

const prisma = new PrismaClient();

export async function createLog(params: LogCreateParams) {
  return LoggerService.createLog(params);
}

/**
 * 日志服务
 */
export class LoggerService {
  /**
   * 创建操作日志
   */
  static async createLog(params: LogCreateParams) {
    try {
      await prisma.log.create({
        data: {
          userId: params.userId,
          action: params.action,
          resourceType: params.resourceType,
          domain: params.domain,
          recordName: params.recordName,
          recordType: params.recordType,
          oldValue: params.oldValue,
          newValue: params.newValue,
          status: params.status,
          errorMessage: params.errorMessage,
          ipAddress: params.ipAddress,
        },
      });
    } catch (error) {
      console.error('创建日志失败:', error);
    }
  }

  /**
   * 获取日志列表
   */
  static async getLogs(params: {
    userId: number;
    page?: number;
    limit?: number;
    startDate?: Date;
    endDate?: Date;
    action?: string;
    resourceType?: string;
    domain?: string;
    status?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      userId: params.userId,
    };

    if (params.startDate || params.endDate) {
      where.timestamp = {};
      if (params.startDate) where.timestamp.gte = params.startDate;
      if (params.endDate) where.timestamp.lte = params.endDate;
    }

    if (params.action) where.action = params.action;
    if (params.resourceType) where.resourceType = params.resourceType;
    if (params.domain) where.domain = { contains: params.domain };
    if (params.status) where.status = params.status;

    const [logs, total] = await Promise.all([
      prisma.log.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.log.count({ where }),
    ]);

    return { logs, total, page, limit };
  }

  /**
   * 清理过期日志
   */
  static async cleanupOldLogs(retentionDays: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.log.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    console.log(`清理了 ${result.count} 条过期日志`);
    return result.count;
  }
}
