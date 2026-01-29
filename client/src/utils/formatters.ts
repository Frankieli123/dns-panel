/**
 * 格式化日期时间
 */
export const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

/**
 * 格式化相对时间
 */
export const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} 天前`;
  if (hours > 0) return `${hours} 小时前`;
  if (minutes > 0) return `${minutes} 分钟前`;
  return '刚刚';
};

/**
 * 格式化 TTL
 */
export const formatTTL = (ttl: number): string => {
  if (ttl === 1) return '自动';
  if (ttl < 60) return `${ttl} 秒`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)} 分钟`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)} 小时`;
  return `${Math.floor(ttl / 86400)} 天`;
};

/**
 * 截断文本
 */
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};
