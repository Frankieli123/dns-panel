/**
 * 数据迁移脚本：CfCredential → DnsCredential
 *
 * 将旧的 Cloudflare 专用凭证表迁移到新的多提供商凭证表
 *
 * 使用方法：
 *   npx ts-node src/scripts/migrate-to-dns-credentials.ts
 *
 * 注意：
 *   1. 运行前请先备份数据库
 *   2. 确保已运行 prisma migrate 创建新表
 *   3. 迁移完成后，旧表数据保留，可手动删除
 */

import { PrismaClient } from '@prisma/client';
import { encrypt } from '../utils/encryption';

const prisma = new PrismaClient();

interface MigrationStats {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
}

async function migrateCredentials(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
  };

  console.log('🚀 开始迁移 CfCredential → DnsCredential...\n');

  try {
    // 获取所有旧凭证
    const oldCredentials = await prisma.cfCredential.findMany({
      include: { user: true },
    });

    stats.total = oldCredentials.length;
    console.log(`📊 找到 ${stats.total} 条旧凭证记录\n`);

    for (const oldCred of oldCredentials) {
      try {
        // 检查是否已迁移（通过 userId + name + provider 判断）
        const existing = await prisma.dnsCredential.findFirst({
          where: {
            userId: oldCred.userId,
            name: oldCred.name,
            provider: 'cloudflare',
          },
        });

        if (existing) {
          console.log(`⏭️  跳过: ${oldCred.name} (userId: ${oldCred.userId}) - 已存在`);
          stats.skipped++;
          continue;
        }

        // 构建新的 secrets JSON
        // 注意：旧的 apiToken 已经是加密的，需要重新加密为 JSON 格式
        const secrets = JSON.stringify({
          apiToken: oldCred.apiToken, // 保持原有加密值
        });

        // 对整个 secrets JSON 进行加密
        const encryptedSecrets = encrypt(secrets);

        // 创建新凭证
        await prisma.dnsCredential.create({
          data: {
            userId: oldCred.userId,
            name: oldCred.name,
            provider: 'cloudflare',
            secrets: encryptedSecrets,
            accountId: oldCred.accountId,
            isDefault: oldCred.isDefault,
            createdAt: oldCred.createdAt,
            updatedAt: oldCred.updatedAt,
          },
        });

        console.log(`✅ 迁移成功: ${oldCred.name} (userId: ${oldCred.userId})`);
        stats.migrated++;
      } catch (error) {
        console.error(`❌ 迁移失败: ${oldCred.name} (userId: ${oldCred.userId})`, error);
        stats.errors++;
      }
    }

    // 迁移 User 表中的旧字段（cfApiToken）
    console.log('\n📦 检查 User 表中的旧凭证字段...');

    const usersWithOldToken = await prisma.user.findMany({
      where: {
        cfApiToken: { not: null },
      },
    });

    for (const user of usersWithOldToken) {
      if (!user.cfApiToken) continue;

      try {
        // 检查是否已有默认凭证
        const existingDefault = await prisma.dnsCredential.findFirst({
          where: {
            userId: user.id,
            provider: 'cloudflare',
            isDefault: true,
          },
        });

        if (existingDefault) {
          console.log(`⏭️  跳过 User.cfApiToken: ${user.username} - 已有默认凭证`);
          continue;
        }

        // 构建 secrets
        const secrets = JSON.stringify({
          apiToken: user.cfApiToken,
        });
        const encryptedSecrets = encrypt(secrets);

        // 创建默认凭证
        await prisma.dnsCredential.create({
          data: {
            userId: user.id,
            name: '默认账户',
            provider: 'cloudflare',
            secrets: encryptedSecrets,
            accountId: user.cfAccountId,
            isDefault: true,
          },
        });

        console.log(`✅ 从 User.cfApiToken 迁移: ${user.username}`);
        stats.migrated++;
      } catch (error) {
        console.error(`❌ User.cfApiToken 迁移失败: ${user.username}`, error);
        stats.errors++;
      }
    }

    return stats;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  DNS 凭证迁移工具');
  console.log('  CfCredential → DnsCredential');
  console.log('═'.repeat(60));
  console.log();

  const stats = await migrateCredentials();

  console.log('\n' + '═'.repeat(60));
  console.log('  迁移完成');
  console.log('═'.repeat(60));
  console.log(`  总计:   ${stats.total}`);
  console.log(`  成功:   ${stats.migrated}`);
  console.log(`  跳过:   ${stats.skipped}`);
  console.log(`  失败:   ${stats.errors}`);
  console.log('═'.repeat(60));

  if (stats.errors > 0) {
    console.log('\n⚠️  存在迁移失败的记录，请检查错误日志');
    process.exit(1);
  }

  console.log('\n✨ 迁移成功完成！');
  console.log('💡 提示: 旧表数据已保留，确认无误后可手动删除');
}

main().catch((error) => {
  console.error('迁移脚本执行失败:', error);
  process.exit(1);
});
