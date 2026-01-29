import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * 数据迁移脚本：将用户的单个 Token 迁移到 CfCredential 表
 */
async function migrateTokens() {
  try {
    console.log('开始迁移用户 Token...');

    // 查找所有有 cfApiToken 的用户
    const users = await prisma.user.findMany({
      where: {
        cfApiToken: {
          not: null,
        },
      },
    });

    console.log(`找到 ${users.length} 个需要迁移的用户`);

    for (const user of users) {
      // 检查是否已经迁移过
      const existingCredential = await prisma.cfCredential.findFirst({
        where: { userId: user.id },
      });

      if (existingCredential) {
        console.log(`用户 ${user.username} 已经迁移过，跳过`);
        continue;
      }

      // 创建默认凭证
      await prisma.cfCredential.create({
        data: {
          userId: user.id,
          name: '默认账户',
          apiToken: user.cfApiToken!,
          accountId: user.cfAccountId,
          isDefault: true,
        },
      });

      console.log(`✓ 用户 ${user.username} 的 Token 已迁移`);
    }

    console.log('迁移完成！');
  } catch (error) {
    console.error('迁移失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行迁移
migrateTokens();
