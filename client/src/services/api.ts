import axios from 'axios';

/**
 * Axios 实例配置
 */
const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 请求拦截器 - 添加 Token
 */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * 响应拦截器 - 统一错误处理
 */
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (error.response) {
      const { status, data } = error.response;

      // 401 未授权 - 清除 Token 并跳转登录
      if (status === 401) {
        const message = String(data?.message || '');
        const authMessages = ['未提供认证令牌', '无效或过期的令牌', '认证失败'];
        const shouldLogout = authMessages.some(m => message.includes(m));

        if (shouldLogout) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = '/login';
        }
      }

      // 返回错误信息
      return Promise.reject(`${status}: ${data?.message || '请求失败'}`);
    }

    // 网络错误
    if (error.request) {
      return Promise.reject('网络连接失败，请检查网络');
    }

    return Promise.reject(error.message || '未知错误');
  }
);

export default api;
