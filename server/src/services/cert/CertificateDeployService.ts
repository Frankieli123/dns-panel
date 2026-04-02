import { PrismaClient } from '@prisma/client';
import { exec as execCallback } from 'child_process';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import {
  ACMClient,
  ImportCertificateCommand,
} from '@aws-sdk/client-acm';
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  ListDistributionsCommand,
  UpdateDistributionCommand,
} from '@aws-sdk/client-cloudfront';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { decrypt, encrypt } from '../../utils/encryption';
import { createLog } from '../logger';
import { CertificateDeployTargetType } from '../../types';
import { listEsaSites, setEsaCertificate } from '../aliyunEsa';
import { DokployService } from './DokployService';
import { OnePanelService } from './OnePanelService';
import { NginxProxyManagerService } from './NginxProxyManagerService';
import { CertificateSettingsService } from './CertificateSettingsService';
import { CertificateNotificationService } from './CertificateNotificationService';
import { buildRemoteCertificateName, mergeBinding, parseCertificateMeta, parseTextareaList } from './deployMatrixUtils';
import { aliyunAcs3Request, aliyunOssRequest, aliyunRpcRequest, baiduCloudRequest, btwafRequest, cacheflyRequest, dogeCloudRequest, gcoreRequest, huaweiCloudRequest, qiniuRequest, tencentCloudRequest, tencentCosRequest, ucloudRequest, volcengineRequest } from './deployProviderClients';
import {
  deployIisViaSsh,
  deployPemViaSsh,
  deployPfxViaSsh,
  deployViaFtp,
  testFtpConnection,
  testSshConnection,
} from './serverTransport';
import {
  getAliyunAuthForUser,
  getBaiduAuthForUser,
  getHuaweiAuthForUser,
  getCloudflareServiceForUser,
  getDnspodTc3CredentialsForUser,
  getUcloudAuthForUser,
  getVolcengineAuthForUser,
} from './credentialHelpers';

const prisma = new PrismaClient();
const execAsync = promisify(execCallback);

export type CertificateDeployEvent = 'certificate.issued' | 'certificate.renewed';
export type CertificateDeployAuthMode = 'none' | 'bearer';
export type DeployFieldType = 'text' | 'password' | 'number' | 'switch' | 'textarea';

interface DeployFieldOption {
  value: string;
  label: string;
}

interface DeployFieldDefinition {
  name: string;
  label: string;
  type: DeployFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  options?: DeployFieldOption[];
}

interface DeployTargetTypeDefinition {
  type: CertificateDeployTargetType;
  label: string;
  supportsResourceDiscovery: boolean;
  supportsTest: boolean;
  configFields: DeployFieldDefinition[];
  bindingFields: DeployFieldDefinition[];
}

interface UpsertDeployTargetInput {
  name: string;
  type?: string;
  enabled?: boolean;
  isDefault?: boolean;
  config?: Record<string, any>;
}

interface UpsertDeployJobInput {
  certificateOrderId?: number | null;
  vendorCertificateOrderId?: number | null;
  certificateDeployTargetId: number;
  enabled?: boolean;
  triggerOnIssue?: boolean;
  triggerOnRenew?: boolean;
  binding?: Record<string, any>;
}

interface WebhookConfigStored {
  url: string;
  authMode: CertificateDeployAuthMode;
  bearerToken?: string | null;
  timeoutMs: number;
  sendPrivateKey: boolean;
}

interface CloudflareCustomHostnameConfigStored {
  dnsCredentialId: number;
}

interface AliyunEsaConfigStored {
  dnsCredentialId: number;
  defaultRegion?: string | null;
}

interface AliyunFcConfigStored {
  dnsCredentialId: number;
  accountId: string;
  defaultRegion?: string | null;
}

interface OnePanelConfigStored {
  baseUrl: string;
  apiKey: string;
  allowInsecureTls: boolean;
  timeoutMs: number;
}

interface DokployConfigStored {
  baseUrl: string;
  apiKey: string;
  serverId?: string | null;
  dynamicRoot: string;
  allowInsecureTls: boolean;
  timeoutMs: number;
  reloadTraefikAfterPush: boolean;
}

interface NginxProxyManagerConfigStored {
  baseUrl: string;
  username: string;
  password: string;
  allowInsecureTls: boolean;
  timeoutMs: number;
}

interface DnsCredentialDeployConfigStored {
  dnsCredentialId: number;
  defaultRegion?: string | null;
  defaultProjectId?: string | null;
}

interface AccessKeySecretConfigStored {
  accessKey: string;
  secretKey: string;
}

interface AwsCloudfrontConfigStored {
  accessKeyId: string;
  secretAccessKey: string;
}

interface ApiTokenConfigStored {
  apiToken: string;
}

interface BaseUrlApiKeyConfigStored {
  baseUrl: string;
  apiKey: string;
}

interface WebhookConfigResponse {
  url: string;
  authMode: CertificateDeployAuthMode;
  timeoutMs: number;
  sendPrivateKey: boolean;
  hasBearerToken: boolean;
}

interface OnePanelConfigResponse {
  baseUrl: string;
  allowInsecureTls: boolean;
  timeoutMs: number;
  hasApiKey: boolean;
}

interface DokployConfigResponse {
  baseUrl: string;
  serverId?: string | null;
  dynamicRoot: string;
  allowInsecureTls: boolean;
  timeoutMs: number;
  reloadTraefikAfterPush: boolean;
  hasApiKey: boolean;
}

interface NginxProxyManagerConfigResponse {
  baseUrl: string;
  username: string;
  allowInsecureTls: boolean;
  timeoutMs: number;
  hasPassword: boolean;
}

interface DnsCredentialDeployConfigResponse {
  dnsCredentialId: number;
  defaultRegion?: string | null;
  defaultProjectId?: string | null;
}

interface AliyunFcConfigResponse {
  dnsCredentialId: number;
  accountId: string;
  defaultRegion?: string | null;
}

interface AccessKeySecretConfigResponse {
  accessKey: string;
  hasSecretKey: boolean;
}

interface AwsCloudfrontConfigResponse {
  accessKeyId: string;
  hasSecretAccessKey: boolean;
}

interface ApiTokenConfigResponse {
  hasApiToken: boolean;
}

interface BaseUrlApiKeyConfigResponse {
  baseUrl: string;
  hasApiKey: boolean;
}

interface CloudflareCustomHostnameBinding {
  zoneId: string;
  hostname: string;
  createIfMissing: boolean;
  fallbackOrigin?: string | null;
}

interface AliyunEsaBinding {
  siteId: string;
  region?: string | null;
}

interface OnePanelBinding {
  websiteId: number;
  certificateNameTemplate: string;
}

interface DokployBinding {
  fileNamePrefix?: string | null;
}

interface NginxProxyManagerBinding {
  proxyHostId: number;
  certificateNameTemplate: string;
}

interface LocalDirectoryBinding {
  certificateFilePath: string;
  privateKeyFilePath: string;
  postCommand?: string | null;
}

interface SshServerConfigStored {
  host: string;
  port: number;
  username: string;
  authMode: 'password' | 'private_key';
  password?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
  os: 'linux' | 'windows';
  timeoutMs: number;
  allowInsecureHostKey: boolean;
}

interface FtpServerConfigStored {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  timeoutMs: number;
  allowInsecureTls: boolean;
}

interface SshServerConfigResponse {
  host: string;
  port: number;
  username: string;
  authMode: 'password' | 'private_key';
  os: 'linux' | 'windows';
  timeoutMs: number;
  allowInsecureHostKey: boolean;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
}

interface FtpServerConfigResponse {
  host: string;
  port: number;
  username: string;
  secure: boolean;
  timeoutMs: number;
  allowInsecureTls: boolean;
  hasPassword: boolean;
}

interface SshServerBinding {
  format: 'pem' | 'pfx';
  certificateFilePath?: string | null;
  privateKeyFilePath?: string | null;
  pfxFilePath?: string | null;
  pfxPassword?: string | null;
  postCommand?: string | null;
}

interface FtpServerBinding {
  format: 'pem' | 'pfx';
  certificateFilePath?: string | null;
  privateKeyFilePath?: string | null;
  pfxFilePath?: string | null;
  pfxPassword?: string | null;
}

interface IisBinding {
  siteName: string;
  bindingHost?: string | null;
  port: number;
  pfxPath: string;
  pfxPassword?: string | null;
  certStore?: string | null;
}

const EXECUTABLE_TARGET_TYPES = new Set<CertificateDeployTargetType>([
  'webhook',
  'dokploy',
  'cloudflare_custom_hostname',
  'aliyun_esa',
  'aliyun_cdn',
  'aliyun_dcdn',
  'aliyun_clb',
  'aliyun_alb',
  'aliyun_nlb',
  'aliyun_oss',
  'aliyun_waf',
  'aliyun_fc',
  'onepanel',
  'nginx_proxy_manager',
  'tencent_cdn',
  'tencent_edgeone',
  'tencent_clb',
  'tencent_cos',
  'tencent_tke',
  'tencent_scf',
  'huawei_cdn',
  'huawei_elb',
  'huawei_waf',
  'ucloud_cdn',
  'qiniu_cdn',
  'qiniu_oss',
  'baidu_cdn',
  'volcengine_cdn',
  'dogecloud_cdn',
  'aws_cloudfront',
  'gcore',
  'cachefly',
  'allwaf',
  'ssh_server',
  'ftp_server',
  'iis',
  'local_directory',
]);

const TEST_CERT = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
const TEST_KEY = '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----';

const DEPLOY_TARGET_TYPES: Record<CertificateDeployTargetType, DeployTargetTypeDefinition> = {
  webhook: {
    type: 'webhook',
    label: 'Webhook',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'url', label: 'Webhook URL', type: 'text', required: true, placeholder: 'https://example.com/webhook' },
      {
        name: 'authMode',
        label: '鉴权方式',
        type: 'text',
        required: true,
        description: '仅支持 none / bearer',
        options: [
          { value: 'none', label: '无鉴权' },
          { value: 'bearer', label: 'Bearer Token' },
        ],
      },
      { name: 'bearerToken', label: 'Bearer Token', type: 'password' },
      { name: 'timeoutMs', label: '超时(ms)', type: 'number' },
      { name: 'sendPrivateKey', label: '推送私钥', type: 'switch' },
    ],
    bindingFields: [],
  },
  dokploy: {
    type: 'dokploy',
    label: 'Dokploy',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      {
        name: 'baseUrl',
        label: 'Dokploy URL',
        type: 'text',
        required: true,
        placeholder: 'https://dokploy.example.com',
        description: '只填写 Dokploy 站点根地址，不要带 /api/settings.updateTraefikFile。',
      },
      {
        name: 'apiKey',
        label: 'Dokploy API Key',
        required: true,
        type: 'password',
        description: '在 Dokploy 后台生成；请求时会自动放到 x-api-key Header。',
      },
      {
        name: 'serverId',
        label: 'Server ID（远程可选）',
        type: 'text',
        placeholder: 'target-server-id',
        description: 'Dokploy 本机可留空；只有写入远程受管服务器时才需要填写。',
      },
      {
        name: 'dynamicRoot',
        label: 'Traefik Dynamic 目录',
        type: 'text',
        placeholder: '/etc/dokploy/traefik/dynamic',
        description: '推荐保持默认目录；会生成 <prefix>.crt / <prefix>.key / <prefix>.yml。',
      },
      { name: 'allowInsecureTls', label: '忽略 TLS 校验（仅自签名时开启）', type: 'switch' },
      {
        name: 'timeoutMs',
        label: '超时(ms)',
        type: 'number',
        description: '推荐填写 10000 或 15000。',
      },
      { name: 'reloadTraefikAfterPush', label: '推送后自动重载 Traefik', type: 'switch' },
    ],
    bindingFields: [
      {
        name: 'fileNamePrefix',
        label: '文件名前缀',
        type: 'text',
        placeholder: '{primaryDomain}',
        description: '最终会写入 <prefix>.crt / <prefix>.key / <prefix>.yml；留空默认使用主域名。',
      },
    ],
  },
  cloudflare_custom_hostname: {
    type: 'cloudflare_custom_hostname',
    label: 'Cloudflare Custom Hostname',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: 'Cloudflare DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'zoneId', label: 'Zone ID', type: 'text', required: true },
      { name: 'hostname', label: 'Hostname', type: 'text', required: true, placeholder: 'app.example.com' },
      { name: 'createIfMissing', label: '不存在时自动创建', type: 'switch' },
      { name: 'fallbackOrigin', label: 'Fallback Origin', type: 'text', placeholder: 'origin.example.com' },
    ],
  },
  aliyun_esa: {
    type: 'aliyun_esa',
    label: '阿里云 ESA',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'cn-hangzhou' },
    ],
    bindingFields: [
      { name: 'siteId', label: 'Site ID', type: 'text', required: true },
      { name: 'region', label: 'Region', type: 'text', placeholder: 'cn-hangzhou' },
    ],
  },
  aliyun_cdn: {
    type: 'aliyun_cdn',
    label: '阿里云 CDN',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'domain', label: '绑定域名', type: 'text', required: true, placeholder: 'example.com' },
    ],
  },
  aliyun_dcdn: {
    type: 'aliyun_dcdn',
    label: '阿里云 DCDN',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'domain', label: '绑定域名', type: 'text', required: true, placeholder: 'example.com' },
    ],
  },
  aliyun_clb: {
    type: 'aliyun_clb',
    label: '阿里云 CLB',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'cn-hangzhou' },
    ],
    bindingFields: [
      { name: 'loadBalancerId', label: '负载均衡实例 ID', type: 'text', required: true },
      { name: 'listenerPort', label: 'HTTPS 监听端口', type: 'number', required: true, placeholder: '443' },
    ],
  },
  aliyun_alb: {
    type: 'aliyun_alb',
    label: '阿里云 ALB',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'cn-hangzhou' },
    ],
    bindingFields: [
      { name: 'listenerId', label: '监听 ID', type: 'text', required: true },
    ],
  },
  aliyun_nlb: {
    type: 'aliyun_nlb',
    label: '阿里云 NLB',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'cn-hangzhou' },
    ],
    bindingFields: [
      { name: 'listenerId', label: '监听 ID', type: 'text', required: true },
    ],
  },
  aliyun_oss: {
    type: 'aliyun_oss',
    label: '阿里云 OSS',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'endpoint', label: 'Endpoint', type: 'text', required: true, placeholder: 'oss-cn-hangzhou.aliyuncs.com' },
      { name: 'bucket', label: 'Bucket', type: 'text', required: true },
      { name: 'domain', label: '自定义域名', type: 'text', required: true, placeholder: 'files.example.com' },
    ],
  },
  aliyun_waf: {
    type: 'aliyun_waf',
    label: '阿里云 WAF',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'cn-hangzhou' },
    ],
    bindingFields: [
      { name: 'instanceId', label: '实例 ID', type: 'text', placeholder: 'waf-instance-id' },
      { name: 'domain', label: '站点域名', type: 'text', required: true, placeholder: 'app.example.com' },
    ],
  },
  aliyun_fc: {
    type: 'aliyun_fc',
    label: '阿里云函数计算',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '阿里云 DNS 凭证 ID', type: 'number', required: true },
      {
        name: 'accountId',
        label: '账号 ID / FC Endpoint',
        type: 'text',
        required: true,
        placeholder: '1234567890123456',
        description: '推荐填写阿里云账号 ID；也兼容直接填写完整 FC endpoint。',
      },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'cn-hangzhou' },
    ],
    bindingFields: [
      { name: 'customDomain', label: '自定义域名', type: 'text', required: true, placeholder: 'api.example.com' },
      { name: 'regionId', label: 'Region', type: 'text', placeholder: 'cn-hangzhou' },
    ],
  },
  onepanel: {
    type: 'onepanel',
    label: '1Panel',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'baseUrl', label: 'Panel 地址', type: 'text', required: true, placeholder: 'https://panel.example.com' },
      { name: 'apiKey', label: 'API Key', type: 'password', required: true },
      { name: 'allowInsecureTls', label: '允许忽略 TLS 校验', type: 'switch' },
      { name: 'timeoutMs', label: '超时(ms)', type: 'number' },
    ],
    bindingFields: [
      { name: 'websiteId', label: '网站 ID', type: 'number', required: true },
      { name: 'certificateNameTemplate', label: '证书名称模板', type: 'text', required: true, placeholder: '{primaryDomain}-{date}' },
    ],
  },
  nginx_proxy_manager: {
    type: 'nginx_proxy_manager',
    label: 'Nginx Proxy Manager',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'baseUrl', label: '面板地址', type: 'text', required: true, placeholder: 'https://npm.example.com' },
      { name: 'username', label: '用户名', type: 'text', required: true },
      { name: 'password', label: '密码', type: 'password', required: true },
      { name: 'allowInsecureTls', label: '允许忽略 TLS 校验', type: 'switch' },
      { name: 'timeoutMs', label: '超时(ms)', type: 'number' },
    ],
    bindingFields: [
      { name: 'proxyHostId', label: 'Proxy Host ID', type: 'number', required: true },
      { name: 'certificateNameTemplate', label: '证书名称模板', type: 'text', required: true, placeholder: '{primaryDomain}-{date}' },
    ],
  },
  tencent_cdn: {
    type: 'tencent_cdn',
    label: '腾讯云 CDN',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '腾讯云 DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'domain', label: '绑定域名', type: 'text', required: true, placeholder: 'example.com' },
    ],
  },
  tencent_edgeone: {
    type: 'tencent_edgeone',
    label: '腾讯云 EdgeOne',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '腾讯云 DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'zoneId', label: '站点 ID', type: 'text', required: true, placeholder: 'zone-xxxx' },
      { name: 'domain', label: '绑定域名', type: 'text', required: true, placeholder: 'example.com' },
    ],
  },
  tencent_clb: {
    type: 'tencent_clb',
    label: '腾讯云 CLB',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '腾讯云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'ap-guangzhou' },
    ],
    bindingFields: [
      { name: 'loadBalancerId', label: '负载均衡 ID', type: 'text', required: true },
      { name: 'listenerId', label: '监听器 ID', type: 'text', placeholder: 'lbl-xxxx' },
      { name: 'domain', label: '绑定域名', type: 'text', placeholder: 'app.example.com' },
    ],
  },
  tencent_cos: {
    type: 'tencent_cos',
    label: '腾讯云 COS',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '腾讯云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'ap-guangzhou' },
    ],
    bindingFields: [
      { name: 'bucket', label: 'Bucket', type: 'text', required: true },
      { name: 'regionId', label: 'Region', type: 'text', required: true, placeholder: 'ap-guangzhou' },
      { name: 'domains', label: '域名列表', type: 'textarea', required: true, placeholder: 'static.example.com' },
    ],
  },
  tencent_tke: {
    type: 'tencent_tke',
    label: '腾讯云 TKE',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '腾讯云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'ap-guangzhou' },
    ],
    bindingFields: [
      { name: 'clusterId', label: '集群 ID', type: 'text', required: true },
      { name: 'namespace', label: '命名空间', type: 'text', required: true },
      { name: 'secretName', label: 'Secret 名称', type: 'text', required: true },
    ],
  },
  tencent_scf: {
    type: 'tencent_scf',
    label: '腾讯云 SCF',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '腾讯云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'ap-guangzhou' },
    ],
    bindingFields: [
      { name: 'regionId', label: 'Region', type: 'text', required: true, placeholder: 'ap-guangzhou' },
      { name: 'namespace', label: '命名空间', type: 'text', required: true, placeholder: 'default' },
      { name: 'functionName', label: '函数名称', type: 'text', required: true },
      { name: 'customDomain', label: '自定义域名', type: 'text', required: true, placeholder: 'api.example.com' },
    ],
  },
  huawei_cdn: {
    type: 'huawei_cdn',
    label: '华为云 CDN',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '华为云 DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'domain', label: '绑定域名', type: 'text', required: true, placeholder: 'example.com' },
    ],
  },
  huawei_elb: {
    type: 'huawei_elb',
    label: '华为云 ELB',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '华为云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', required: true, placeholder: 'cn-north-4' },
      { name: 'defaultProjectId', label: '默认项目 ID', type: 'text', required: true },
    ],
    bindingFields: [
      { name: 'listenerId', label: '监听器 ID', type: 'text', required: true },
      { name: 'certificateId', label: '证书 ID（可选）', type: 'text', placeholder: '已有证书可填' },
    ],
  },
  huawei_waf: {
    type: 'huawei_waf',
    label: '华为云 WAF',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '华为云 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', required: true, placeholder: 'cn-north-4' },
      { name: 'defaultProjectId', label: '默认项目 ID', type: 'text', required: true },
    ],
    bindingFields: [
      { name: 'domain', label: '站点域名', type: 'text', required: true },
      { name: 'certificateId', label: '证书 ID（可选）', type: 'text', placeholder: '已有证书可填' },
    ],
  },
  ucloud_cdn: {
    type: 'ucloud_cdn',
    label: 'UCloud CDN',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: 'UCloud DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'domainId', label: '云分发资源 ID', type: 'text', required: true },
    ],
  },
  qiniu_cdn: {
    type: 'qiniu_cdn',
    label: '七牛 CDN',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'accessKey', label: 'AccessKey', type: 'text', required: true },
      { name: 'secretKey', label: 'SecretKey', type: 'password', required: true },
    ],
    bindingFields: [
      { name: 'domains', label: '域名列表', type: 'textarea', required: true, placeholder: 'example.com' },
    ],
  },
  qiniu_oss: {
    type: 'qiniu_oss',
    label: '七牛 OSS',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'accessKey', label: 'AccessKey', type: 'text', required: true },
      { name: 'secretKey', label: 'SecretKey', type: 'password', required: true },
    ],
    bindingFields: [
      { name: 'domains', label: '域名列表', type: 'textarea', required: true, placeholder: 'files.example.com' },
    ],
  },
  baidu_cdn: {
    type: 'baidu_cdn',
    label: '百度云 CDN',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '百度云 DNS 凭证 ID', type: 'number', required: true },
    ],
    bindingFields: [
      { name: 'domains', label: '域名列表', type: 'textarea', required: true, placeholder: 'example.com' },
    ],
  },
  volcengine_cdn: {
    type: 'volcengine_cdn',
    label: '火山引擎 CDN',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'dnsCredentialId', label: '火山引擎 DNS 凭证 ID', type: 'number', required: true },
      { name: 'defaultRegion', label: '默认 Region', type: 'text', placeholder: 'cn-north-1' },
    ],
    bindingFields: [
      { name: 'domains', label: '域名列表', type: 'textarea', required: true, placeholder: 'example.com' },
    ],
  },
  dogecloud_cdn: {
    type: 'dogecloud_cdn',
    label: 'DogeCloud CDN',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'accessKey', label: 'AccessKey', type: 'text', required: true },
      { name: 'secretKey', label: 'SecretKey', type: 'password', required: true },
    ],
    bindingFields: [
      { name: 'domains', label: '域名列表', type: 'textarea', required: true, placeholder: 'example.com' },
    ],
  },
  aws_cloudfront: {
    type: 'aws_cloudfront',
    label: 'AWS CloudFront',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'accessKeyId', label: 'AccessKeyId', type: 'text', required: true },
      { name: 'secretAccessKey', label: 'SecretAccessKey', type: 'password', required: true },
    ],
    bindingFields: [
      { name: 'distributionId', label: 'Distribution ID', type: 'text', required: true },
      { name: 'acmCertificateArn', label: 'ACM Certificate ARN（可选）', type: 'text', placeholder: 'arn:aws:acm:us-east-1:...' },
    ],
  },
  gcore: {
    type: 'gcore',
    label: 'Gcore',
    supportsResourceDiscovery: true,
    supportsTest: true,
    configFields: [
      { name: 'apiToken', label: 'API Token', type: 'password', required: true },
    ],
    bindingFields: [
      { name: 'certificateId', label: '证书 ID（可选）', type: 'text', placeholder: '首次执行后会自动回写' },
      { name: 'certificateName', label: '证书名称', type: 'text', required: true },
    ],
  },
  cachefly: {
    type: 'cachefly',
    label: 'Cachefly',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'apiToken', label: 'API Token', type: 'password', required: true },
    ],
    bindingFields: [],
  },
  allwaf: {
    type: 'allwaf',
    label: 'AllWAF',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'baseUrl', label: '控制台地址', type: 'text', required: true, placeholder: 'https://waf.example.com' },
      { name: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    bindingFields: [
      { name: 'domain', label: '网站名称', type: 'text', placeholder: 'app.example.com，留空则部署面板证书' },
      { name: 'siteId', label: '站点 ID', type: 'text', placeholder: 'site-id，可选' },
    ],
  },
  ssh_server: {
    type: 'ssh_server',
    label: 'SSH Server',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'host', label: '主机地址', type: 'text', required: true, placeholder: '192.168.1.10' },
      { name: 'port', label: 'SSH 端口', type: 'number', placeholder: '22' },
      { name: 'username', label: '用户名', type: 'text', required: true },
      {
        name: 'authMode',
        label: '认证方式',
        type: 'text',
        required: true,
        options: [
          { value: 'password', label: '密码' },
          { value: 'private_key', label: '私钥' },
        ],
      },
      { name: 'password', label: '密码', type: 'password', required: true },
      { name: 'privateKey', label: '私钥', type: 'textarea', required: true },
      { name: 'passphrase', label: '私钥口令', type: 'password' },
      {
        name: 'os',
        label: '远端系统',
        type: 'text',
        options: [
          { value: 'linux', label: 'Linux' },
          { value: 'windows', label: 'Windows' },
        ],
      },
      { name: 'timeoutMs', label: '超时(ms)', type: 'number' },
      { name: 'allowInsecureHostKey', label: '忽略 Host Key 校验', type: 'switch' },
    ],
    bindingFields: [
      {
        name: 'format',
        label: '部署格式',
        type: 'text',
        required: true,
        options: [
          { value: 'pem', label: 'PEM' },
          { value: 'pfx', label: 'PFX' },
        ],
      },
      { name: 'certificateFilePath', label: '证书文件路径', type: 'text', placeholder: '/etc/ssl/example/fullchain.pem' },
      { name: 'privateKeyFilePath', label: '私钥文件路径', type: 'text', placeholder: '/etc/ssl/example/private.key' },
      { name: 'pfxFilePath', label: 'PFX 文件路径', type: 'text', placeholder: '/etc/ssl/example/cert.pfx' },
      { name: 'pfxPassword', label: 'PFX 密码', type: 'password' },
      { name: 'postCommand', label: '后置命令', type: 'textarea', placeholder: 'systemctl reload nginx' },
    ],
  },
  ftp_server: {
    type: 'ftp_server',
    label: 'FTP Server',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'host', label: '主机地址', type: 'text', required: true, placeholder: '192.168.1.10' },
      { name: 'port', label: '端口', type: 'number', placeholder: '21' },
      { name: 'username', label: '用户名', type: 'text', required: true },
      { name: 'password', label: '密码', type: 'password', required: true },
      { name: 'secure', label: '使用 FTPS', type: 'switch' },
      { name: 'timeoutMs', label: '超时(ms)', type: 'number' },
      { name: 'allowInsecureTls', label: '忽略 TLS 校验', type: 'switch' },
    ],
    bindingFields: [
      {
        name: 'format',
        label: '部署格式',
        type: 'text',
        required: true,
        options: [
          { value: 'pem', label: 'PEM' },
          { value: 'pfx', label: 'PFX' },
        ],
      },
      { name: 'certificateFilePath', label: '证书文件路径', type: 'text', placeholder: '/ssl/fullchain.pem' },
      { name: 'privateKeyFilePath', label: '私钥文件路径', type: 'text', placeholder: '/ssl/private.key' },
      { name: 'pfxFilePath', label: 'PFX 文件路径', type: 'text', placeholder: '/ssl/cert.pfx' },
      { name: 'pfxPassword', label: 'PFX 密码', type: 'password' },
    ],
  },
  iis: {
    type: 'iis',
    label: 'IIS',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [
      { name: 'host', label: 'Windows 主机地址', type: 'text', required: true, placeholder: '192.168.1.20' },
      { name: 'port', label: 'OpenSSH 端口', type: 'number', placeholder: '22' },
      { name: 'username', label: '用户名', type: 'text', required: true },
      {
        name: 'authMode',
        label: '认证方式',
        type: 'text',
        required: true,
        options: [
          { value: 'password', label: '密码' },
          { value: 'private_key', label: '私钥' },
        ],
      },
      { name: 'password', label: '密码', type: 'password', required: true },
      { name: 'privateKey', label: '私钥', type: 'textarea', required: true },
      { name: 'passphrase', label: '私钥口令', type: 'password' },
      { name: 'timeoutMs', label: '超时(ms)', type: 'number' },
      { name: 'allowInsecureHostKey', label: '忽略 Host Key 校验', type: 'switch' },
    ],
    bindingFields: [
      { name: 'siteName', label: '站点名称', type: 'text', required: true, placeholder: 'Default Web Site' },
      { name: 'bindingHost', label: '绑定 Host', type: 'text', placeholder: 'www.example.com' },
      { name: 'port', label: 'HTTPS 端口', type: 'number', placeholder: '443' },
      { name: 'pfxPath', label: '远端 PFX 路径', type: 'text', required: true, placeholder: 'C:/certs/example.pfx' },
      { name: 'pfxPassword', label: 'PFX 密码', type: 'password' },
      { name: 'certStore', label: '证书存储区', type: 'text', placeholder: 'My' },
    ],
  },
  local_directory: {
    type: 'local_directory',
    label: '本地目录',
    supportsResourceDiscovery: false,
    supportsTest: true,
    configFields: [],
    bindingFields: [
      {
        name: 'certificateFilePath',
        label: '证书文件路径',
        type: 'text',
        required: true,
        placeholder: '/etc/ssl/example/fullchain.pem',
        description: '写入 fullchain PEM。',
      },
      {
        name: 'privateKeyFilePath',
        label: '私钥文件路径',
        type: 'text',
        required: true,
        placeholder: '/etc/ssl/example/private.key',
      },
      {
        name: 'postCommand',
        label: '写入后执行命令',
        type: 'textarea',
        placeholder: 'systemctl reload nginx',
        description: '可留空；每行一条命令。',
      },
    ],
  },
};

function parseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function normalizeString(value: any): string {
  return String(value || '').trim();
}

function normalizeAuthMode(value: any): CertificateDeployAuthMode {
  return String(value || '').trim().toLowerCase() === 'bearer' ? 'bearer' : 'none';
}

function normalizeTimeoutMs(value: any, fallback = 8000): number {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1000, Math.min(120000, parsed));
}

function normalizeDirectoryPath(value: any, fallback: string): string {
  const path = normalizeString(value).replace(/\/+$/, '');
  return path || fallback;
}

function isAbsoluteLikePath(value: string) {
  return path.isAbsolute(value);
}

function normalizeFilePath(value: any, label: string) {
  const filePath = normalizeString(value);
  if (!filePath) throw new Error(`${label} 不能为空`);
  if (!isAbsoluteLikePath(filePath)) throw new Error(`${label} 必须使用绝对路径`);
  return filePath;
}

function normalizeRequiredText(value: any, label: string) {
  const text = normalizeString(value);
  if (!text) throw new Error(`${label} 不能为空`);
  return text;
}

function normalizeBoolean(value: any, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizePositiveInt(value: any, label: string, fallback?: number): number {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${label} 不能为空`);
  }
  return parsed;
}

function normalizeEnum<T extends string>(value: any, allowed: readonly T[], label: string, fallback: T): T {
  const normalized = String(value ?? '').trim().toLowerCase() as T;
  if (!normalized) return fallback;
  if (allowed.includes(normalized)) return normalized;
  throw new Error(`${label} 不合法`);
}

function normalizeRemotePath(value: any, label: string) {
  const filePath = normalizeString(value);
  if (!filePath) throw new Error(`${label} 不能为空`);
  return filePath;
}

function normalizeTargetType(value: any): CertificateDeployTargetType {
  const type = String(value || 'webhook').trim().toLowerCase() as CertificateDeployTargetType;
  if (!(type in DEPLOY_TARGET_TYPES)) throw new Error('不支持的部署目标类型');
  return type;
}

function listAvailableTargetTypes() {
  return Object.values(DEPLOY_TARGET_TYPES);
}

function normalizeBaseUrl(value: any, label: string) {
  const url = normalizeString(value).replace(/\/+$/, '');
  if (!url) throw new Error(`${label} 不能为空`);
  if (!/^https?:\/\//i.test(url)) throw new Error(`${label} 仅支持 http/https`);
  return url;
}

function decryptIfPresent(value?: string | null) {
  if (!value) return '';
  return decrypt(value);
}

function normalizeStoredSecret(
  input: Record<string, any> | undefined,
  current: Record<string, any>,
  fieldName: string,
  label: string
) {
  let encryptedValue = current[fieldName] || null;
  if (input && Object.prototype.hasOwnProperty.call(input, fieldName)) {
    const raw = normalizeString(input[fieldName]);
    encryptedValue = raw ? encrypt(raw) : null;
  }
  if (!encryptedValue) throw new Error(`${label} 不能为空`);
  return encryptedValue;
}

function normalizeVendorProvider(provider: string) {
  return provider === 'aliyun_esa_free' ? 'aliyun_ssl' : provider;
}

function renderTemplate(template: string, context: Record<string, string>) {
  const pairs = Object.entries(context);
  let output = String(template || '').trim();
  if (!output) output = '{primaryDomain}-{date}';
  for (const [key, value] of pairs) {
    output = output
      .replace(new RegExp(`\\{${key}\\}`, 'g'), value)
      .replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value)
      .replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return output;
}

const ALIYUN_CAS_REGION_ID = 'cn-hangzhou';
const ALIYUN_FC_API_VERSION = '2023-03-30';

function resolveDefaultRegion(config: { defaultRegion?: string | null }, fallback: string) {
  return normalizeString(config.defaultRegion) || fallback;
}

function normalizeAliyunFcAccountId(value: any) {
  const normalized = normalizeString(value).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!normalized) throw new Error('阿里云函数计算账号 ID 不能为空');
  return normalized;
}

function resolveAliyunFcRegion(config: AliyunFcConfigStored, preferred?: any) {
  return normalizeString(preferred) || resolveDefaultRegion(config, 'cn-hangzhou');
}

function buildAliyunFcEndpoint(accountIdOrEndpoint: string, regionId: string) {
  const normalized = normalizeAliyunFcAccountId(accountIdOrEndpoint);
  return /\.fc\.aliyuncs\.com$/i.test(normalized)
    ? normalized
    : `${normalized}.${regionId}.fc.aliyuncs.com`;
}

function extractAliyunFcCustomDomains(payload: any) {
  if (Array.isArray(payload?.customDomains)) return payload.customDomains;
  if (Array.isArray(payload?.CustomDomains)) return payload.CustomDomains;
  if (Array.isArray(payload?.domains)) return payload.domains;
  return [];
}

function buildAliyunFcUpdatePayload(current: Record<string, any>, certName: string, certificate: string, privateKey: string) {
  const payload: Record<string, any> = {};
  const protocol = normalizeString(current.protocol);
  payload.protocol = /^http$/i.test(protocol) || !protocol ? 'HTTP,HTTPS' : current.protocol;

  if (!current.routeConfig || typeof current.routeConfig !== 'object') {
    throw new Error('函数计算域名缺少 routeConfig，无法更新证书');
  }
  payload.routeConfig = JSON.parse(JSON.stringify(current.routeConfig));
  if (current.authConfig && typeof current.authConfig === 'object') payload.authConfig = JSON.parse(JSON.stringify(current.authConfig));
  if (current.tlsConfig && typeof current.tlsConfig === 'object') payload.tlsConfig = JSON.parse(JSON.stringify(current.tlsConfig));
  if (current.wafConfig && typeof current.wafConfig === 'object') payload.wafConfig = JSON.parse(JSON.stringify(current.wafConfig));
  if (current.corsConfig && typeof current.corsConfig === 'object') payload.corsConfig = JSON.parse(JSON.stringify(current.corsConfig));

  const certConfig = current.certConfig && typeof current.certConfig === 'object'
    ? JSON.parse(JSON.stringify(current.certConfig))
    : {};
  certConfig.certName = certName;
  certConfig.certificate = certificate;
  certConfig.privateKey = privateKey;
  payload.certConfig = certConfig;

  return payload;
}

async function listAliyunFcCustomDomains(params: {
  auth: Awaited<ReturnType<typeof getAliyunAuthForUser>>['auth'];
  accountId: string;
  regionId: string;
  limit?: number;
  nextToken?: string | null;
}) {
  const endpoint = buildAliyunFcEndpoint(params.accountId, params.regionId);
  const response = await aliyunAcs3Request<any>({
    auth: params.auth,
    endpoint,
    action: 'ListCustomDomains',
    version: ALIYUN_FC_API_VERSION,
    path: `/${ALIYUN_FC_API_VERSION}/custom-domains`,
    method: 'GET',
    query: {
      limit: params.limit || 100,
      ...(normalizeString(params.nextToken) ? { nextToken: normalizeString(params.nextToken) } : {}),
    },
  });
  return { endpoint, response };
}

async function getAliyunFcCustomDomain(params: {
  auth: Awaited<ReturnType<typeof getAliyunAuthForUser>>['auth'];
  accountId: string;
  regionId: string;
  customDomain: string;
}) {
  const endpoint = buildAliyunFcEndpoint(params.accountId, params.regionId);
  const response = await aliyunAcs3Request<any>({
    auth: params.auth,
    endpoint,
    action: 'GetCustomDomain',
    version: ALIYUN_FC_API_VERSION,
    path: `/${ALIYUN_FC_API_VERSION}/custom-domains/${params.customDomain}`,
    method: 'GET',
  });
  return { endpoint, response };
}

async function updateAliyunFcCustomDomain(params: {
  auth: Awaited<ReturnType<typeof getAliyunAuthForUser>>['auth'];
  accountId: string;
  regionId: string;
  customDomain: string;
  body: Record<string, any>;
}) {
  const endpoint = buildAliyunFcEndpoint(params.accountId, params.regionId);
  const response = await aliyunAcs3Request<any>({
    auth: params.auth,
    endpoint,
    action: 'UpdateCustomDomain',
    version: ALIYUN_FC_API_VERSION,
    path: `/${ALIYUN_FC_API_VERSION}/custom-domains/${params.customDomain}`,
    method: 'PUT',
    body: params.body,
  });
  return { endpoint, response };
}

function buildUcloudProjectParams(auth: Awaited<ReturnType<typeof getUcloudAuthForUser>>['auth']) {
  return auth.projectId ? { ProjectId: auth.projectId } : {};
}

function extractUcloudCdnDomains(payload: any) {
  return Array.isArray(payload?.DomainList) ? payload.DomainList : [];
}

async function listUcloudCdnDomains(params: {
  auth: Awaited<ReturnType<typeof getUcloudAuthForUser>>['auth'];
  limit?: number;
  offset?: number;
  domainId?: string | null;
}) {
  return await ucloudRequest<any>({
    auth: params.auth,
    action: 'GetUcdnDomainConfig',
    params: {
      ...buildUcloudProjectParams(params.auth),
      Offset: params.offset || 0,
      Limit: params.limit || 100,
      ...(normalizeString(params.domainId) ? { 'DomainId.0': normalizeString(params.domainId) } : {}),
    },
  });
}

async function listUcloudCertificates(params: {
  auth: Awaited<ReturnType<typeof getUcloudAuthForUser>>['auth'];
  domain?: string | null;
  limit?: number;
}) {
  return await ucloudRequest<any>({
    auth: params.auth,
    action: 'GetCertificateV2',
    params: {
      ...buildUcloudProjectParams(params.auth),
      Offset: 0,
      Limit: params.limit || 100,
      ...(normalizeString(params.domain) ? { CdnDomain: normalizeString(params.domain) } : {}),
    },
  });
}

async function ensureAliyunCasCertificate(auth: Awaited<ReturnType<typeof getAliyunAuthForUser>>['auth'], fullchainPem: string, privateKeyPem: string) {
  const meta = parseCertificateMeta(fullchainPem, 'certificate');
  const certificateName = buildRemoteCertificateName(fullchainPem, meta.commonName || 'certificate');
  const list = await aliyunRpcRequest<any>({
    auth,
    endpoint: 'cas.aliyuncs.com',
    action: 'ListUserCertificateOrder',
    version: '2020-04-07',
    params: {
      Keyword: meta.commonName || undefined,
      OrderType: 'CERT',
    },
  });
  const orders = Array.isArray(list?.CertificateOrderList) ? list.CertificateOrderList : [];
  const matched = orders.find((item: any) => {
    const serial = String(item?.SerialNo || '').toLowerCase();
    return serial === meta.serialNumber.toLowerCase() || serial.includes(meta.serialNumber.toLowerCase());
  });
  if (matched?.CertificateId) {
    return {
      certificateId: String(matched.CertificateId),
      certificateName: String(matched.Name || certificateName),
    };
  }

  const uploaded = await aliyunRpcRequest<any>({
    auth,
    endpoint: 'cas.aliyuncs.com',
    action: 'UploadUserCertificate',
    version: '2020-04-07',
    params: {
      Name: certificateName,
      Cert: fullchainPem,
      Key: privateKeyPem,
    },
  });
  const certificateId = String(uploaded?.CertId || uploaded?.CertificateId || '');
  if (!certificateId) throw new Error('阿里云 CAS 证书上传失败：未返回证书 ID');
  return { certificateId, certificateName };
}

async function ensureAliyunClbServerCertificate(params: {
  auth: Awaited<ReturnType<typeof getAliyunAuthForUser>>['auth'];
  regionId: string;
  casCertificateId: string;
  certificateName: string;
}) {
  const listed = await aliyunRpcRequest<any>({
    auth: params.auth,
    endpoint: `slb.${params.regionId}.aliyuncs.com`,
    action: 'DescribeServerCertificates',
    version: '2014-05-15',
    params: { RegionId: params.regionId },
  });

  const serverCertificates = Array.isArray(listed?.ServerCertificates?.ServerCertificate)
    ? listed.ServerCertificates.ServerCertificate
    : [];
  const matched = serverCertificates.find((item: any) =>
    Number(item?.IsAliCloudCertificate) === 1 &&
    String(item?.AliCloudCertificateId || '') === params.casCertificateId
  );
  if (matched?.ServerCertificateId) {
    return String(matched.ServerCertificateId);
  }

  const created = await aliyunRpcRequest<any>({
    auth: params.auth,
    endpoint: `slb.${params.regionId}.aliyuncs.com`,
    action: 'UploadServerCertificate',
    version: '2014-05-15',
    params: {
      RegionId: params.regionId,
      AliCloudCertificateId: params.casCertificateId,
      AliCloudCertificateName: params.certificateName,
      AliCloudCertificateRegionId: ALIYUN_CAS_REGION_ID,
    },
  });
  const serverCertificateId = String(created?.ServerCertificateId || '');
  if (!serverCertificateId) throw new Error('阿里云 CLB 服务端证书上传失败：未返回证书 ID');
  return serverCertificateId;
}

function normalizeAliyunCertReference(certificateId: string) {
  return `${certificateId}-${ALIYUN_CAS_REGION_ID}`;
}

async function resolveAliyunWafInstanceId(params: {
  auth: Awaited<ReturnType<typeof getAliyunAuthForUser>>['auth'];
  regionId: string;
  instanceId?: string | null;
}) {
  const existing = normalizeString(params.instanceId);
  if (existing) return existing;

  const response = await aliyunRpcRequest<any>({
    auth: params.auth,
    endpoint: `wafopenapi.${params.regionId}.aliyuncs.com`,
    action: 'DescribeInstance',
    version: '2021-10-01',
    method: 'GET',
    params: { RegionId: params.regionId },
  });
  const instanceId = normalizeString(response?.InstanceId)
    || normalizeString(response?.InstanceInfo?.InstanceId);
  if (!instanceId) {
    throw new Error('当前账号未找到阿里云 WAF 实例');
  }
  return instanceId;
}

async function describeAliyunWafDomainDetail(params: {
  auth: Awaited<ReturnType<typeof getAliyunAuthForUser>>['auth'];
  regionId: string;
  domain: string;
  instanceId?: string | null;
}) {
  const instanceId = await resolveAliyunWafInstanceId(params);
  const detail = await aliyunRpcRequest<any>({
    auth: params.auth,
    endpoint: `wafopenapi.${params.regionId}.aliyuncs.com`,
    action: 'DescribeDomainDetail',
    version: '2021-10-01',
    method: 'GET',
    params: {
      InstanceId: instanceId,
      Domain: params.domain,
      RegionId: params.regionId,
    },
  });
  return { instanceId, detail: detail || {} };
}

async function uploadTencentCertificate(creds: Awaited<ReturnType<typeof getDnspodTc3CredentialsForUser>>['creds'], fullchainPem: string, privateKeyPem: string) {
  const alias = buildRemoteCertificateName(fullchainPem, 'certificate');
  const uploaded = await tencentCloudRequest<any>({
    creds,
    host: 'ssl.tencentcloudapi.com',
    service: 'ssl',
    action: 'UploadCertificate',
    version: '2019-12-05',
    payload: {
      CertificatePublicKey: fullchainPem,
      CertificatePrivateKey: privateKeyPem,
      CertificateType: 'SVR',
      Alias: alias,
      Repeatable: false,
    },
  });
  const certificateId = String(uploaded?.CertificateId || '');
  if (!certificateId) throw new Error('腾讯云 SSL 证书上传失败：未返回证书 ID');
  return { certificateId, alias };
}

function parseTencentCosBuckets(xml: string) {
  const matched = String(xml || '').match(/<Bucket>[\s\S]*?<\/Bucket>/g) || [];
  return matched.map((chunk) => ({
    name: (chunk.match(/<Name>([\s\S]*?)<\/Name>/i)?.[1] || '').trim(),
    location: (chunk.match(/<Location>([\s\S]*?)<\/Location>/i)?.[1] || '').trim(),
    createdAt: (chunk.match(/<CreationDate>([\s\S]*?)<\/CreationDate>/i)?.[1] || '').trim(),
  })).filter((item) => item.name);
}

async function listTencentCosBuckets(creds: Awaited<ReturnType<typeof getDnspodTc3CredentialsForUser>>['creds'], regionId?: string | null) {
  const response = await tencentCosRequest({
    creds,
    path: '/',
    query: regionId ? { region: regionId } : {},
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`腾讯云 COS 查询 Bucket 失败: HTTP ${response.status}`);
  }
  return parseTencentCosBuckets(response.body);
}

async function listTencentTkeClusters(creds: Awaited<ReturnType<typeof getDnspodTc3CredentialsForUser>>['creds'], regionId: string, limit = 20) {
  const response = await tencentCloudRequest<any>({
    creds,
    host: 'tke.tencentcloudapi.com',
    service: 'tke',
    action: 'DescribeClusters',
    version: '2018-05-25',
    region: regionId,
    payload: { Offset: 0, Limit: limit },
  });
  return Array.isArray(response?.Clusters) ? response.Clusters : [];
}

async function listTencentScfNamespaces(creds: Awaited<ReturnType<typeof getDnspodTc3CredentialsForUser>>['creds'], regionId: string, limit = 20) {
  const response = await tencentCloudRequest<any>({
    creds,
    host: 'scf.tencentcloudapi.com',
    service: 'scf',
    action: 'ListNamespaces',
    version: '2018-04-16',
    region: regionId,
    payload: {
      Offset: 0,
      Limit: limit,
    },
  });
  return Array.isArray(response?.Namespaces) ? response.Namespaces : [];
}

async function listQiniuCertificates(accessKey: string, secretKey: string, limit = 100) {
  let marker = '';
  const certificates: any[] = [];
  do {
    const response = await qiniuRequest<any>({
      accessKey,
      secretKey,
      path: '/sslcert',
      query: {
        marker,
        limit,
      },
    });
    const items = Array.isArray(response?.certs) ? response.certs : [];
    certificates.push(...items);
    marker = normalizeString(response?.marker) || '';
    if (!items.length) break;
  } while (marker);
  return certificates;
}

async function ensureQiniuCertificate(accessKey: string, secretKey: string, fullchainPem: string, privateKeyPem: string) {
  const meta = parseCertificateMeta(fullchainPem, 'certificate');
  const certificateName = buildRemoteCertificateName(fullchainPem, meta.commonName || 'certificate');
  const certificates = await listQiniuCertificates(accessKey, secretKey, 100);
  const matched = certificates.find((item: any) => String(item?.name || '') === certificateName);
  if (matched?.certid) {
    return {
      certificateId: String(matched.certid),
      certificateName,
    };
  }
  const created = await qiniuRequest<any>({
    accessKey,
    secretKey,
    path: '/sslcert',
    method: 'POST',
    body: {
      name: certificateName,
      common_name: meta.commonName || 'certificate',
      pri: privateKeyPem,
      ca: fullchainPem,
    },
  });
  const certificateId = String(created?.certID || created?.certId || '');
  if (!certificateId) throw new Error('七牛证书上传失败：未返回证书 ID');
  return {
    certificateId,
    certificateName,
  };
}

async function listDogeCloudCertificates(accessKey: string, secretKey: string) {
  const response = await dogeCloudRequest<any>({
    accessKey,
    secretKey,
    path: '/cdn/cert/list.json',
    method: 'POST',
  });
  return Array.isArray(response?.certs) ? response.certs : [];
}

async function ensureDogeCloudCertificate(accessKey: string, secretKey: string, fullchainPem: string, privateKeyPem: string) {
  const certificateName = buildRemoteCertificateName(fullchainPem, 'certificate');
  const certificates = await listDogeCloudCertificates(accessKey, secretKey);
  const matched = certificates.find((item: any) => String(item?.note || '') === certificateName);
  if (matched?.id) {
    return {
      certificateId: String(matched.id),
      certificateName,
    };
  }
  const created = await dogeCloudRequest<any>({
    accessKey,
    secretKey,
    path: '/cdn/cert/upload.json',
    method: 'POST',
    body: {
      note: certificateName,
      cert: fullchainPem,
      private: privateKeyPem,
    },
  });
  const certificateId = String(created?.id || '');
  if (!certificateId) throw new Error('DogeCloud 证书上传失败：未返回证书 ID');
  return {
    certificateId,
    certificateName,
  };
}

async function ensureVolcengineCertificate(params: {
  creds: Awaited<ReturnType<typeof getVolcengineAuthForUser>>['creds'];
  fullchainPem: string;
  privateKeyPem: string;
  fallbackPrimaryDomain: string;
}) {
  const certificateName = buildRemoteCertificateName(params.fullchainPem, params.fallbackPrimaryDomain);
  try {
    const imported = await volcengineRequest<any>({
      creds: params.creds,
      host: 'open.volcengineapi.com',
      service: 'certificate_service',
      version: '2021-06-01',
      region: 'cn-north-1',
      action: 'ImportCertificate',
      body: {
        tag: certificateName,
        project: 'default',
        no_verify_and_fix_chain: false,
        repeatable: false,
        certificate_info: {
          certificate: params.fullchainPem,
          private_key: params.privateKeyPem,
        },
      },
    });
    const certificateId = normalizeString(imported?.id || imported?.Id || imported?.repeat_id || imported?.repeatId || imported?.RepeatId);
    if (!certificateId) {
      throw new Error('火山引擎证书导入失败：未返回证书 ID');
    }
    return {
      certificateId,
      certificateName,
    };
  } catch (error: any) {
    const fallbackId = normalizeString(String(error?.message || '').match(/cert-[a-z0-9-]+/i)?.[0]);
    if (fallbackId) {
      return {
        certificateId: fallbackId,
        certificateName,
      };
    }
    throw error;
  }
}

async function listBtWafSites(baseUrl: string, apiKey: string, siteName?: string | null) {
  const response = await btwafRequest<any>({
    baseUrl,
    apiKey,
    path: '/api/wafmastersite/get_site_list',
    body: {
      p: 1,
      p_size: 100,
      ...(siteName ? { site_name: siteName } : {}),
    },
  });
  return Array.isArray(response?.list) ? response.list : [];
}

async function resolveBtWafSite(params: {
  baseUrl: string;
  apiKey: string;
  siteId?: string | null;
  siteName?: string | null;
}) {
  const sites = await listBtWafSites(params.baseUrl, params.apiKey, params.siteName || null);
  const matched = sites.find((site: any) => (
    (params.siteId && String(site?.site_id || '') === params.siteId)
    || (params.siteName && String(site?.site_name || '').trim() === params.siteName)
  ));
  if (!matched) {
    throw new Error(params.siteId ? '堡塔云WAF站点 ID 不存在' : '堡塔云WAF网站名称不存在');
  }
  return {
    siteId: String(matched.site_id || ''),
    siteName: String(matched.site_name || '').trim(),
    listenSslPort: Array.isArray(matched?.server?.listen_ssl_port) && matched.server.listen_ssl_port.length
      ? matched.server.listen_ssl_port.map((item: any) => String(item))
      : ['443'],
  };
}

async function ensureHuaweiElbCertificate(params: {
  creds: Awaited<ReturnType<typeof getHuaweiAuthForUser>>['creds'];
  projectId: string;
  regionId: string;
  certificateId?: string | null;
  certificateName: string;
  domains: string[];
  fullchainPem: string;
  privateKeyPem: string;
}) {
  const host = `elb.${params.regionId}.myhuaweicloud.com`;
  const body = {
    certificate: {
      name: params.certificateName,
      type: 'server',
      domain: params.domains.join(','),
      certificate: params.fullchainPem,
      private_key: params.privateKeyPem,
    },
  };

  if (params.certificateId) {
    await huaweiCloudRequest({
      creds: params.creds,
      host,
      path: `/v3/${params.projectId}/elb/certificates/${params.certificateId}`,
      method: 'PUT',
      body,
    });
    return params.certificateId;
  }

  const created = await huaweiCloudRequest<any>({
    creds: params.creds,
    host,
    path: `/v3/${params.projectId}/elb/certificates`,
    method: 'POST',
    body,
  });
  const certificateId = String(created?.certificate?.id || '');
  if (!certificateId) throw new Error('华为云 ELB 证书创建失败：未返回证书 ID');
  return certificateId;
}

function isHuaweiResourceMissing(error: any) {
  const message = String(error?.message || '');
  return /not[\s-]?found|不存在|404/i.test(message);
}

async function findHuaweiWafHostIds(params: {
  creds: Awaited<ReturnType<typeof getHuaweiAuthForUser>>['creds'];
  projectId: string;
  regionId: string;
  domain: string;
}) {
  const host = `waf.${params.regionId}.myhuaweicloud.com`;
  const hostname = params.domain.trim().toLowerCase();
  const [cloudResponse, premiumResponse] = await Promise.all([
    huaweiCloudRequest<any>({
      creds: params.creds,
      host,
      path: `/v1/${params.projectId}/waf/instance`,
      method: 'GET',
      query: { page: 1, pagesize: 100, hostname },
    }).catch(() => ({ items: [] })),
    huaweiCloudRequest<any>({
      creds: params.creds,
      host,
      path: `/v1/${params.projectId}/premium-waf/host`,
      method: 'GET',
      query: { page: 1, pagesize: 100, hostname },
    }).catch(() => ({ items: [] })),
  ]);
  const cloudItems = Array.isArray(cloudResponse?.items) ? cloudResponse.items : [];
  const premiumItems = Array.isArray(premiumResponse?.items) ? premiumResponse.items : [];
  const cloudHostIds = cloudItems
    .filter((item: any) => String(item?.hostname || '').trim().toLowerCase() === hostname)
    .map((item: any) => String(item?.id || item?.hostid || ''))
    .filter(Boolean);
  const premiumHostIds = premiumItems
    .filter((item: any) => String(item?.hostname || '').trim().toLowerCase() === hostname)
    .map((item: any) => String(item?.id || item?.hostid || ''))
    .filter(Boolean);
  return { cloudHostIds, premiumHostIds };
}

async function ensureHuaweiWafCertificate(params: {
  creds: Awaited<ReturnType<typeof getHuaweiAuthForUser>>['creds'];
  projectId: string;
  regionId: string;
  domain: string;
  certificateId?: string | null;
  certificateName: string;
  fullchainPem: string;
  privateKeyPem: string;
}) {
  const host = `waf.${params.regionId}.myhuaweicloud.com`;
  const body = {
    name: params.certificateName,
    content: params.fullchainPem,
    key: params.privateKeyPem,
  };

  if (params.certificateId) {
    try {
      await huaweiCloudRequest({
        creds: params.creds,
        host,
        path: `/v1/${params.projectId}/waf/certificate/${params.certificateId}`,
        method: 'PUT',
        body,
      });
      return params.certificateId;
    } catch (error) {
      if (!isHuaweiResourceMissing(error)) throw error;
    }
  }

  const listed = await huaweiCloudRequest<any>({
    creds: params.creds,
    host,
    path: `/v1/${params.projectId}/waf/certificate`,
    method: 'GET',
    query: { page: 1, pagesize: 100, host: true },
  }).catch(() => ({ items: [] }));
  const items = Array.isArray(listed?.items) ? listed.items : [];
  const matched = items.find((item: any) => (
    Array.isArray(item?.bind_host)
      && item.bind_host.some((bind: any) => String(bind?.hostname || '').trim().toLowerCase() === params.domain.trim().toLowerCase())
  ));
  const existingId = normalizeString(matched?.id);
  if (existingId) {
    await huaweiCloudRequest({
      creds: params.creds,
      host,
      path: `/v1/${params.projectId}/waf/certificate/${existingId}`,
      method: 'PUT',
      body,
    });
    return existingId;
  }

  const created = await huaweiCloudRequest<any>({
    creds: params.creds,
    host,
    path: `/v1/${params.projectId}/waf/certificate`,
    method: 'POST',
    body,
  });
  const certificateId = String(created?.id || '');
  if (!certificateId) throw new Error('华为云 WAF 证书创建失败：未返回证书 ID');
  return certificateId;
}

function decodeXmlEntities(input: string) {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getXmlTagValue(block: string, tag: string) {
  const matched = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return matched ? decodeXmlEntities(matched[1].trim()) : null;
}

function parseAliyunOssCnameEntries(rawXml: string) {
  const items: Array<{ domain: string; status?: string | null; certId?: string | null }> = [];
  const matcher = /<Cname>([\s\S]*?)<\/Cname>/gi;
  let matched: RegExpExecArray | null;
  while ((matched = matcher.exec(rawXml))) {
    const block = matched[1];
    const domain = getXmlTagValue(block, 'Domain');
    if (!domain) continue;
    const certificateBlock = block.match(/<Certificate>([\s\S]*?)<\/Certificate>/i)?.[1] || '';
    items.push({
      domain,
      status: getXmlTagValue(block, 'Status'),
      certId: getXmlTagValue(certificateBlock, 'CertId'),
    });
  }
  return items;
}

function extractIntermediateCertificate(fullchainPem: string, certificatePem: string) {
  const chain = String(fullchainPem || '').trim();
  const leaf = String(certificatePem || '').trim();
  if (!chain || !leaf) return '';
  if (chain === leaf) return '';
  const matches = chain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (matches.length <= 1) return '';
  return matches.slice(1).join('\n');
}

function buildAwsStaticCredentials(config: AwsCloudfrontConfigStored) {
  return {
    accessKeyId: normalizeRequiredText(config.accessKeyId, 'AccessKeyId'),
    secretAccessKey: normalizeRequiredText(decryptIfPresent(config.secretAccessKey), 'SecretAccessKey'),
  };
}

function createAwsCloudFrontClient(config: AwsCloudfrontConfigStored) {
  return new CloudFrontClient({
    region: 'us-east-1',
    credentials: buildAwsStaticCredentials(config),
  });
}

function createAwsAcmClient(config: AwsCloudfrontConfigStored) {
  return new ACMClient({
    region: 'us-east-1',
    credentials: buildAwsStaticCredentials(config),
  });
}

function isAwsMissingCertificateError(error: any) {
  const message = String(error?.message || '');
  return error?.name === 'ResourceNotFoundException'
    || Number(error?.$metadata?.httpStatusCode || 0) === 404
    || /not[\s-]?found|does not exist/i.test(message);
}

async function ensureAwsAcmCertificate(params: {
  config: AwsCloudfrontConfigStored;
  certificateArn?: string | null;
  certificatePem: string;
  fullchainPem: string;
  privateKeyPem: string;
}) {
  const client = createAwsAcmClient(params.config);
  const certificateChain = extractIntermediateCertificate(params.fullchainPem, params.certificatePem);
  const payload = {
    Certificate: Buffer.from(params.certificatePem, 'utf8'),
    PrivateKey: Buffer.from(params.privateKeyPem, 'utf8'),
    ...(certificateChain ? { CertificateChain: Buffer.from(certificateChain, 'utf8') } : {}),
  };

  if (params.certificateArn) {
    try {
      const updated = await client.send(new ImportCertificateCommand({
        ...payload,
        CertificateArn: params.certificateArn,
      }));
      const certificateArn = String(updated.CertificateArn || params.certificateArn || '');
      if (!certificateArn) throw new Error('AWS ACM 证书导入失败：未返回 ARN');
      return certificateArn;
    } catch (error) {
      if (!isAwsMissingCertificateError(error)) throw error;
    }
  }

  const created = await client.send(new ImportCertificateCommand(payload));
  const certificateArn = String(created.CertificateArn || '');
  if (!certificateArn) throw new Error('AWS ACM 证书导入失败：未返回 ARN');
  return certificateArn;
}

async function bindAwsCloudFrontCertificate(params: {
  config: AwsCloudfrontConfigStored;
  distributionId: string;
  certificateArn: string;
}) {
  const client = createAwsCloudFrontClient(params.config);
  const current = await client.send(new GetDistributionConfigCommand({ Id: params.distributionId }));
  if (!current.DistributionConfig || !current.ETag) {
    throw new Error('CloudFront 分配配置读取失败');
  }
  const viewerCertificate = current.DistributionConfig.ViewerCertificate || {};
  await client.send(new UpdateDistributionCommand({
    Id: params.distributionId,
    IfMatch: current.ETag,
    DistributionConfig: {
      ...current.DistributionConfig,
      ViewerCertificate: {
        ...viewerCertificate,
        ACMCertificateArn: params.certificateArn,
        CloudFrontDefaultCertificate: false,
        SSLSupportMethod: viewerCertificate.SSLSupportMethod || 'sni-only',
        MinimumProtocolVersion: viewerCertificate.MinimumProtocolVersion || 'TLSv1.2_2021',
        Certificate: undefined,
        CertificateSource: undefined,
        IAMCertificateId: undefined,
      },
    },
  }));
}

function buildStoredConfig(type: CertificateDeployTargetType, input: Record<string, any> | undefined, existing?: Record<string, any> | null) {
  const current = existing || {};

  switch (type) {
    case 'webhook': {
      const url = normalizeString(input?.url ?? current.url);
      if (!url) throw new Error('Webhook URL 不能为空');
      if (!/^https?:\/\//i.test(url)) throw new Error('Webhook URL 仅支持 http/https');
      const authMode = normalizeAuthMode(input?.authMode ?? current.authMode);
      let bearerToken = current.bearerToken || null;
      if (input && Object.prototype.hasOwnProperty.call(input, 'bearerToken')) {
        const raw = normalizeString(input.bearerToken);
        bearerToken = raw ? encrypt(raw) : null;
      }
      if (authMode === 'bearer' && !bearerToken) throw new Error('Bearer 鉴权必须填写 token');
      return {
        url,
        authMode,
        bearerToken,
        timeoutMs: normalizeTimeoutMs(input?.timeoutMs, normalizeTimeoutMs(current.timeoutMs, 8000)),
        sendPrivateKey: normalizeBoolean(input?.sendPrivateKey, normalizeBoolean(current.sendPrivateKey, true)),
      } as WebhookConfigStored;
    }
    case 'dokploy': {
      let apiKey = current.apiKey || null;
      if (input && Object.prototype.hasOwnProperty.call(input, 'apiKey')) {
        const raw = normalizeString(input.apiKey);
        apiKey = raw ? encrypt(raw) : null;
      }

      if (!apiKey) throw new Error('Dokploy API Key 不能为空');

      return {
        baseUrl: normalizeBaseUrl(input?.baseUrl ?? current.baseUrl, 'Dokploy URL'),
        apiKey,
        serverId: normalizeString(input?.serverId ?? current.serverId) || null,
        dynamicRoot: normalizeDirectoryPath(input?.dynamicRoot ?? current.dynamicRoot, '/etc/dokploy/traefik/dynamic'),
        allowInsecureTls: normalizeBoolean(input?.allowInsecureTls, normalizeBoolean(current.allowInsecureTls, false)),
        timeoutMs: normalizeTimeoutMs(input?.timeoutMs, normalizeTimeoutMs(current.timeoutMs, 8000)),
        reloadTraefikAfterPush: normalizeBoolean(
          input?.reloadTraefikAfterPush,
          normalizeBoolean(current.reloadTraefikAfterPush, false)
        ),
      } as DokployConfigStored;
    }
    case 'cloudflare_custom_hostname':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, 'Cloudflare DNS 凭证 ID'),
      } as CloudflareCustomHostnameConfigStored;
    case 'aliyun_esa':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '阿里云 DNS 凭证 ID'),
        defaultRegion: normalizeString(input?.defaultRegion ?? current.defaultRegion) || null,
      } as AliyunEsaConfigStored;
    case 'aliyun_cdn':
    case 'aliyun_dcdn':
    case 'aliyun_clb':
    case 'aliyun_alb':
    case 'aliyun_nlb':
    case 'aliyun_oss':
    case 'aliyun_waf':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '阿里云 DNS 凭证 ID'),
        defaultRegion: normalizeString(input?.defaultRegion ?? current.defaultRegion) || null,
      } as DnsCredentialDeployConfigStored;
    case 'aliyun_fc':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '阿里云 DNS 凭证 ID'),
        accountId: normalizeAliyunFcAccountId(input?.accountId ?? current.accountId),
        defaultRegion: normalizeString(input?.defaultRegion ?? current.defaultRegion) || null,
      } as AliyunFcConfigStored;
    case 'onepanel': {
      let apiKey = current.apiKey || null;
      if (input && Object.prototype.hasOwnProperty.call(input, 'apiKey')) {
        const raw = normalizeString(input.apiKey);
        apiKey = raw ? encrypt(raw) : null;
      }
      if (!apiKey) throw new Error('1Panel API Key 不能为空');
      return {
        baseUrl: normalizeBaseUrl(input?.baseUrl ?? current.baseUrl, '1Panel 地址'),
        apiKey,
        allowInsecureTls: normalizeBoolean(input?.allowInsecureTls, normalizeBoolean(current.allowInsecureTls, false)),
        timeoutMs: normalizeTimeoutMs(input?.timeoutMs, normalizeTimeoutMs(current.timeoutMs, 8000)),
      } as OnePanelConfigStored;
    }
    case 'nginx_proxy_manager': {
      let password = current.password || null;
      if (input && Object.prototype.hasOwnProperty.call(input, 'password')) {
        const raw = normalizeString(input.password);
        password = raw ? encrypt(raw) : null;
      }
      if (!password) throw new Error('Nginx Proxy Manager 密码不能为空');
      const username = normalizeString(input?.username ?? current.username);
      if (!username) throw new Error('Nginx Proxy Manager 用户名不能为空');
      return {
        baseUrl: normalizeBaseUrl(input?.baseUrl ?? current.baseUrl, 'Nginx Proxy Manager 地址'),
        username,
        password,
        allowInsecureTls: normalizeBoolean(input?.allowInsecureTls, normalizeBoolean(current.allowInsecureTls, false)),
        timeoutMs: normalizeTimeoutMs(input?.timeoutMs, normalizeTimeoutMs(current.timeoutMs, 8000)),
      } as NginxProxyManagerConfigStored;
    }
    case 'tencent_cdn':
    case 'tencent_edgeone':
    case 'tencent_clb':
    case 'tencent_cos':
    case 'tencent_tke':
    case 'tencent_scf':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '腾讯云 DNS 凭证 ID'),
        defaultRegion: normalizeString(input?.defaultRegion ?? current.defaultRegion) || null,
      } as DnsCredentialDeployConfigStored;
    case 'huawei_cdn':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '华为云 DNS 凭证 ID'),
        defaultRegion: normalizeString(input?.defaultRegion ?? current.defaultRegion) || null,
      } as DnsCredentialDeployConfigStored;
    case 'huawei_waf':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '华为云 DNS 凭证 ID'),
        defaultRegion: normalizeRequiredText(input?.defaultRegion ?? current.defaultRegion, '默认 Region'),
        defaultProjectId: normalizeRequiredText(input?.defaultProjectId ?? current.defaultProjectId, '默认项目 ID'),
      } as DnsCredentialDeployConfigStored;
    case 'huawei_elb':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '华为云 DNS 凭证 ID'),
        defaultRegion: normalizeRequiredText(input?.defaultRegion ?? current.defaultRegion, '默认 Region'),
        defaultProjectId: normalizeRequiredText(input?.defaultProjectId ?? current.defaultProjectId, '默认项目 ID'),
      } as DnsCredentialDeployConfigStored;
    case 'ucloud_cdn':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, 'UCloud DNS 凭证 ID'),
        defaultRegion: normalizeString(input?.defaultRegion ?? current.defaultRegion) || null,
      } as DnsCredentialDeployConfigStored;
    case 'baidu_cdn':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '百度云 DNS 凭证 ID'),
        defaultRegion: normalizeString(input?.defaultRegion ?? current.defaultRegion) || null,
      } as DnsCredentialDeployConfigStored;
    case 'volcengine_cdn':
      return {
        dnsCredentialId: normalizePositiveInt(input?.dnsCredentialId ?? current.dnsCredentialId, '火山引擎 DNS 凭证 ID'),
        defaultRegion: normalizeString(input?.defaultRegion ?? current.defaultRegion) || null,
      } as DnsCredentialDeployConfigStored;
    case 'qiniu_cdn':
    case 'qiniu_oss':
    case 'dogecloud_cdn': {
      const accessKey = normalizeString(input?.accessKey ?? current.accessKey);
      if (!accessKey) throw new Error('AccessKey 不能为空');
      return {
        accessKey,
        secretKey: normalizeStoredSecret(input, current, 'secretKey', 'SecretKey'),
      } as AccessKeySecretConfigStored;
    }
    case 'aws_cloudfront': {
      const accessKeyId = normalizeString(input?.accessKeyId ?? current.accessKeyId);
      if (!accessKeyId) throw new Error('AccessKeyId 不能为空');
      return {
        accessKeyId,
        secretAccessKey: normalizeStoredSecret(input, current, 'secretAccessKey', 'SecretAccessKey'),
      } as AwsCloudfrontConfigStored;
    }
    case 'gcore':
    case 'cachefly':
      return {
        apiToken: normalizeStoredSecret(input, current, 'apiToken', 'API Token'),
      } as ApiTokenConfigStored;
    case 'allwaf':
      return {
        baseUrl: normalizeBaseUrl(input?.baseUrl ?? current.baseUrl, '控制台地址'),
        apiKey: normalizeStoredSecret(input, current, 'apiKey', 'API Key'),
      } as BaseUrlApiKeyConfigStored;
    case 'ssh_server': {
      const authMode = normalizeEnum(input?.authMode ?? current.authMode, ['password', 'private_key'] as const, '认证方式', 'password');
      const stored: SshServerConfigStored = {
        host: normalizeRequiredText(input?.host ?? current.host, '主机地址'),
        port: normalizePositiveInt(input?.port ?? current.port, 'SSH 端口', 22),
        username: normalizeRequiredText(input?.username ?? current.username, '用户名'),
        authMode,
        os: normalizeEnum(input?.os ?? current.os, ['linux', 'windows'] as const, '远端系统', 'linux'),
        timeoutMs: normalizeTimeoutMs(input?.timeoutMs, normalizeTimeoutMs(current.timeoutMs, 10000)),
        allowInsecureHostKey: normalizeBoolean(input?.allowInsecureHostKey, normalizeBoolean(current.allowInsecureHostKey, false)),
      };
      if (authMode === 'password') {
        stored.password = normalizeStoredSecret(input, current, 'password', '密码');
        stored.privateKey = null;
        stored.passphrase = null;
      } else {
        stored.privateKey = normalizeStoredSecret(input, current, 'privateKey', '私钥');
        if (input && Object.prototype.hasOwnProperty.call(input, 'passphrase')) {
          const passphrase = normalizeString(input.passphrase);
          stored.passphrase = passphrase ? encrypt(passphrase) : null;
        } else {
          stored.passphrase = current.passphrase || null;
        }
        stored.password = null;
      }
      return stored;
    }
    case 'ftp_server':
      return {
        host: normalizeRequiredText(input?.host ?? current.host, '主机地址'),
        port: normalizePositiveInt(input?.port ?? current.port, '端口', 21),
        username: normalizeRequiredText(input?.username ?? current.username, '用户名'),
        password: normalizeStoredSecret(input, current, 'password', '密码'),
        secure: normalizeBoolean(input?.secure, normalizeBoolean(current.secure, false)),
        timeoutMs: normalizeTimeoutMs(input?.timeoutMs, normalizeTimeoutMs(current.timeoutMs, 10000)),
        allowInsecureTls: normalizeBoolean(input?.allowInsecureTls, normalizeBoolean(current.allowInsecureTls, false)),
      } as FtpServerConfigStored;
    case 'iis': {
      const authMode = normalizeEnum(input?.authMode ?? current.authMode, ['password', 'private_key'] as const, '认证方式', 'password');
      const stored: SshServerConfigStored = {
        host: normalizeRequiredText(input?.host ?? current.host, 'Windows 主机地址'),
        port: normalizePositiveInt(input?.port ?? current.port, 'OpenSSH 端口', 22),
        username: normalizeRequiredText(input?.username ?? current.username, '用户名'),
        authMode,
        os: 'windows',
        timeoutMs: normalizeTimeoutMs(input?.timeoutMs, normalizeTimeoutMs(current.timeoutMs, 10000)),
        allowInsecureHostKey: normalizeBoolean(input?.allowInsecureHostKey, normalizeBoolean(current.allowInsecureHostKey, false)),
      };
      if (authMode === 'password') {
        stored.password = normalizeStoredSecret(input, current, 'password', '密码');
        stored.privateKey = null;
        stored.passphrase = null;
      } else {
        stored.privateKey = normalizeStoredSecret(input, current, 'privateKey', '私钥');
        if (input && Object.prototype.hasOwnProperty.call(input, 'passphrase')) {
          const passphrase = normalizeString(input.passphrase);
          stored.passphrase = passphrase ? encrypt(passphrase) : null;
        } else {
          stored.passphrase = current.passphrase || null;
        }
        stored.password = null;
      }
      return stored;
    }
    case 'local_directory':
      return {};
    default:
      throw new Error('不支持的部署目标类型');
  }
}

function toResponseConfig(type: CertificateDeployTargetType, configJson: string) {
  const config = parseJson<Record<string, any>>(configJson, {});
  switch (type) {
    case 'webhook':
      return {
        url: normalizeString(config.url),
        authMode: normalizeAuthMode(config.authMode),
        timeoutMs: normalizeTimeoutMs(config.timeoutMs, 8000),
        sendPrivateKey: normalizeBoolean(config.sendPrivateKey, true),
        hasBearerToken: !!config.bearerToken,
      } as WebhookConfigResponse;
    case 'dokploy':
      return {
        baseUrl: normalizeString(config.baseUrl),
        serverId: normalizeString(config.serverId) || null,
        dynamicRoot: normalizeDirectoryPath(config.dynamicRoot, '/etc/dokploy/traefik/dynamic'),
        allowInsecureTls: normalizeBoolean(config.allowInsecureTls, false),
        timeoutMs: normalizeTimeoutMs(config.timeoutMs, 8000),
        reloadTraefikAfterPush: normalizeBoolean(config.reloadTraefikAfterPush, false),
        hasApiKey: !!config.apiKey,
      } as DokployConfigResponse;
    case 'cloudflare_custom_hostname':
      return {
        dnsCredentialId: Number(config.dnsCredentialId || 0),
      };
    case 'aliyun_esa':
      return {
        dnsCredentialId: Number(config.dnsCredentialId || 0),
        defaultRegion: normalizeString(config.defaultRegion) || null,
      };
    case 'aliyun_cdn':
    case 'aliyun_dcdn':
    case 'aliyun_clb':
    case 'aliyun_alb':
    case 'aliyun_nlb':
    case 'aliyun_oss':
    case 'aliyun_waf':
    case 'tencent_cdn':
    case 'tencent_edgeone':
    case 'tencent_clb':
    case 'tencent_cos':
    case 'tencent_tke':
    case 'tencent_scf':
    case 'huawei_cdn':
    case 'ucloud_cdn':
    case 'baidu_cdn':
    case 'volcengine_cdn':
      return {
        dnsCredentialId: Number(config.dnsCredentialId || 0),
        defaultRegion: normalizeString(config.defaultRegion) || null,
      } as DnsCredentialDeployConfigResponse;
    case 'aliyun_fc':
      return {
        dnsCredentialId: Number(config.dnsCredentialId || 0),
        accountId: normalizeString(config.accountId),
        defaultRegion: normalizeString(config.defaultRegion) || null,
      } as AliyunFcConfigResponse;
    case 'huawei_waf':
      return {
        dnsCredentialId: Number(config.dnsCredentialId || 0),
        defaultRegion: normalizeString(config.defaultRegion) || null,
        defaultProjectId: normalizeString(config.defaultProjectId) || null,
      } as DnsCredentialDeployConfigResponse;
    case 'huawei_elb':
      return {
        dnsCredentialId: Number(config.dnsCredentialId || 0),
        defaultRegion: normalizeString(config.defaultRegion) || null,
        defaultProjectId: normalizeString(config.defaultProjectId) || null,
      } as DnsCredentialDeployConfigResponse;
    case 'onepanel':
      return {
        baseUrl: normalizeString(config.baseUrl),
        allowInsecureTls: normalizeBoolean(config.allowInsecureTls, false),
        timeoutMs: normalizeTimeoutMs(config.timeoutMs, 8000),
        hasApiKey: !!config.apiKey,
      } as OnePanelConfigResponse;
    case 'nginx_proxy_manager':
      return {
        baseUrl: normalizeString(config.baseUrl),
        username: normalizeString(config.username),
        allowInsecureTls: normalizeBoolean(config.allowInsecureTls, false),
        timeoutMs: normalizeTimeoutMs(config.timeoutMs, 8000),
        hasPassword: !!config.password,
      } as NginxProxyManagerConfigResponse;
    case 'qiniu_cdn':
    case 'qiniu_oss':
    case 'dogecloud_cdn':
      return {
        accessKey: normalizeString(config.accessKey),
        hasSecretKey: !!config.secretKey,
      } as AccessKeySecretConfigResponse;
    case 'aws_cloudfront':
      return {
        accessKeyId: normalizeString(config.accessKeyId),
        hasSecretAccessKey: !!config.secretAccessKey,
      } as AwsCloudfrontConfigResponse;
    case 'gcore':
    case 'cachefly':
      return {
        hasApiToken: !!config.apiToken,
      } as ApiTokenConfigResponse;
    case 'allwaf':
      return {
        baseUrl: normalizeString(config.baseUrl),
        hasApiKey: !!config.apiKey,
      } as BaseUrlApiKeyConfigResponse;
    case 'ssh_server':
    case 'iis':
      return {
        host: normalizeString(config.host),
        port: normalizePositiveInt(config.port, '端口', 22),
        username: normalizeString(config.username),
        authMode: normalizeEnum(config.authMode, ['password', 'private_key'] as const, '认证方式', 'password'),
        os: type === 'iis' ? 'windows' : normalizeEnum(config.os, ['linux', 'windows'] as const, '远端系统', 'linux'),
        timeoutMs: normalizeTimeoutMs(config.timeoutMs, 10000),
        allowInsecureHostKey: normalizeBoolean(config.allowInsecureHostKey, false),
        hasPassword: !!config.password,
        hasPrivateKey: !!config.privateKey,
        hasPassphrase: !!config.passphrase,
      } as SshServerConfigResponse;
    case 'ftp_server':
      return {
        host: normalizeString(config.host),
        port: normalizePositiveInt(config.port, '端口', 21),
        username: normalizeString(config.username),
        secure: normalizeBoolean(config.secure, false),
        timeoutMs: normalizeTimeoutMs(config.timeoutMs, 10000),
        allowInsecureTls: normalizeBoolean(config.allowInsecureTls, false),
        hasPassword: !!config.password,
      } as FtpServerConfigResponse;
    case 'local_directory':
      return {};
    default:
      return config;
  }
}

function parseStoredConfig<T>(configJson: string, fallback: T): T {
  return parseJson<T>(configJson, fallback);
}

function buildBinding(type: CertificateDeployTargetType, input: Record<string, any> | undefined, existing?: Record<string, any> | null) {
  const current = existing || {};
  switch (type) {
    case 'webhook':
      return null;
    case 'dokploy':
      return {
        fileNamePrefix: normalizeString(input?.fileNamePrefix ?? current.fileNamePrefix) || null,
      } as DokployBinding;
    case 'cloudflare_custom_hostname': {
      const hostname = normalizeString(input?.hostname ?? current.hostname).toLowerCase().replace(/\.$/, '');
      const zoneId = normalizeString(input?.zoneId ?? current.zoneId);
      if (!zoneId) throw new Error('Zone ID 不能为空');
      if (!hostname) throw new Error('Hostname 不能为空');
      return {
        zoneId,
        hostname,
        createIfMissing: normalizeBoolean(input?.createIfMissing, normalizeBoolean(current.createIfMissing, false)),
        fallbackOrigin: normalizeString(input?.fallbackOrigin ?? current.fallbackOrigin) || null,
      } as CloudflareCustomHostnameBinding;
    }
    case 'aliyun_esa': {
      const siteId = normalizeString(input?.siteId ?? current.siteId);
      if (!siteId) throw new Error('Site ID 不能为空');
      return {
        siteId,
        region: normalizeString(input?.region ?? current.region) || null,
      } as AliyunEsaBinding;
    }
    case 'aliyun_cdn':
    case 'aliyun_dcdn':
      return {
        domain: normalizeRequiredText(input?.domain ?? current.domain, '绑定域名'),
      };
    case 'tencent_cdn':
    case 'huawei_cdn':
      return {
        domain: normalizeRequiredText(input?.domain ?? current.domain, '绑定域名'),
      };
    case 'qiniu_cdn':
    case 'qiniu_oss':
    case 'baidu_cdn':
    case 'volcengine_cdn':
    case 'dogecloud_cdn':
      return {
        domains: normalizeRequiredText(input?.domains ?? current.domains, '域名列表'),
      };
    case 'aliyun_clb':
      return {
        loadBalancerId: normalizeRequiredText(input?.loadBalancerId ?? current.loadBalancerId, '负载均衡实例 ID'),
        listenerPort: normalizePositiveInt(input?.listenerPort ?? current.listenerPort, 'HTTPS 监听端口'),
      };
    case 'aliyun_alb':
    case 'aliyun_nlb':
      return {
        listenerId: normalizeRequiredText(input?.listenerId ?? current.listenerId, '监听 ID'),
      };
    case 'aliyun_oss':
      return {
        endpoint: normalizeRequiredText(input?.endpoint ?? current.endpoint, 'Endpoint'),
        bucket: normalizeRequiredText(input?.bucket ?? current.bucket, 'Bucket'),
        domain: normalizeRequiredText(input?.domain ?? current.domain, '自定义域名'),
      };
    case 'aliyun_waf':
      return {
        instanceId: normalizeString(input?.instanceId ?? current.instanceId) || null,
        domain: normalizeRequiredText(input?.domain ?? current.domain, '站点域名'),
      };
    case 'aliyun_fc':
      return {
        customDomain: normalizeRequiredText(input?.customDomain ?? current.customDomain, '自定义域名'),
        regionId: normalizeString(input?.regionId ?? current.regionId) || null,
      };
    case 'tencent_edgeone':
      return {
        zoneId: normalizeRequiredText(input?.zoneId ?? current.zoneId, '站点 ID'),
        domain: normalizeRequiredText(input?.domain ?? current.domain, '绑定域名'),
      };
    case 'tencent_clb':
      return {
        loadBalancerId: normalizeRequiredText(input?.loadBalancerId ?? current.loadBalancerId, '负载均衡 ID'),
        listenerId: normalizeString(input?.listenerId ?? current.listenerId) || null,
        domain: normalizeString(input?.domain ?? current.domain) || null,
      };
    case 'tencent_cos':
      return {
        bucket: normalizeRequiredText(input?.bucket ?? current.bucket, 'Bucket'),
        regionId: normalizeRequiredText(input?.regionId ?? current.regionId, 'Region'),
        domains: normalizeRequiredText(input?.domains ?? current.domains, '域名列表'),
      };
    case 'tencent_tke':
      return {
        clusterId: normalizeRequiredText(input?.clusterId ?? current.clusterId, '集群 ID'),
        namespace: normalizeRequiredText(input?.namespace ?? current.namespace, '命名空间'),
        secretName: normalizeRequiredText(input?.secretName ?? current.secretName, 'Secret 名称'),
      };
    case 'tencent_scf':
      return {
        regionId: normalizeRequiredText(input?.regionId ?? current.regionId, 'Region'),
        namespace: normalizeRequiredText(input?.namespace ?? current.namespace, '命名空间'),
        functionName: normalizeRequiredText(input?.functionName ?? current.functionName, '函数名称'),
        customDomain: normalizeRequiredText(input?.customDomain ?? current.customDomain, '自定义域名'),
      };
    case 'huawei_elb':
      return {
        listenerId: normalizeRequiredText(input?.listenerId ?? current.listenerId, '监听器 ID'),
        certificateId: normalizeString(input?.certificateId ?? current.certificateId) || null,
      };
    case 'huawei_waf':
      return {
        domain: normalizeRequiredText(input?.domain ?? current.domain, '站点域名'),
        certificateId: normalizeString(input?.certificateId ?? current.certificateId) || null,
      };
    case 'ucloud_cdn':
      return {
        domainId: normalizeRequiredText(input?.domainId ?? current.domainId, '云分发资源 ID'),
      };
    case 'aws_cloudfront':
      return {
        distributionId: normalizeRequiredText(input?.distributionId ?? current.distributionId, 'Distribution ID'),
        acmCertificateArn: normalizeString(input?.acmCertificateArn ?? current.acmCertificateArn) || null,
      };
    case 'gcore':
      return {
        certificateId: normalizeString(input?.certificateId ?? current.certificateId) || null,
        certificateName: normalizeRequiredText(input?.certificateName ?? current.certificateName, '证书名称'),
      };
    case 'cachefly':
      return null;
    case 'allwaf':
      return {
        domain: normalizeString(input?.domain ?? current.domain) || null,
        siteId: normalizeString(input?.siteId ?? current.siteId) || null,
      };
    case 'ssh_server': {
      const format = normalizeEnum(input?.format ?? current.format, ['pem', 'pfx'] as const, '部署格式', 'pem');
      if (format === 'pfx') {
        return {
          format,
          pfxFilePath: normalizeRemotePath(input?.pfxFilePath ?? current.pfxFilePath, 'PFX 文件路径'),
          pfxPassword: normalizeString(input?.pfxPassword ?? current.pfxPassword) || null,
          postCommand: normalizeString(input?.postCommand ?? current.postCommand) || null,
        } as SshServerBinding;
      }
      return {
        format,
        certificateFilePath: normalizeRemotePath(input?.certificateFilePath ?? current.certificateFilePath, '证书文件路径'),
        privateKeyFilePath: normalizeRemotePath(input?.privateKeyFilePath ?? current.privateKeyFilePath, '私钥文件路径'),
        postCommand: normalizeString(input?.postCommand ?? current.postCommand) || null,
      } as SshServerBinding;
    }
    case 'ftp_server': {
      const format = normalizeEnum(input?.format ?? current.format, ['pem', 'pfx'] as const, '部署格式', 'pem');
      if (format === 'pfx') {
        return {
          format,
          pfxFilePath: normalizeRemotePath(input?.pfxFilePath ?? current.pfxFilePath, 'PFX 文件路径'),
          pfxPassword: normalizeString(input?.pfxPassword ?? current.pfxPassword) || null,
        } as FtpServerBinding;
      }
      return {
        format,
        certificateFilePath: normalizeRemotePath(input?.certificateFilePath ?? current.certificateFilePath, '证书文件路径'),
        privateKeyFilePath: normalizeRemotePath(input?.privateKeyFilePath ?? current.privateKeyFilePath, '私钥文件路径'),
      } as FtpServerBinding;
    }
    case 'iis':
      return {
        siteName: normalizeRequiredText(input?.siteName ?? current.siteName, '站点名称'),
        bindingHost: normalizeString(input?.bindingHost ?? current.bindingHost) || null,
        port: normalizePositiveInt(input?.port ?? current.port, 'HTTPS 端口', 443),
        pfxPath: normalizeRemotePath(input?.pfxPath ?? current.pfxPath, '远端 PFX 路径'),
        pfxPassword: normalizeString(input?.pfxPassword ?? current.pfxPassword) || null,
        certStore: normalizeString(input?.certStore ?? current.certStore) || 'My',
      } as IisBinding;
    case 'onepanel': {
      const websiteId = normalizePositiveInt(input?.websiteId ?? current.websiteId, '1Panel 网站 ID');
      return {
        websiteId,
        certificateNameTemplate: normalizeString(input?.certificateNameTemplate ?? current.certificateNameTemplate) || '{primaryDomain}-{date}',
      } as OnePanelBinding;
    }
    case 'nginx_proxy_manager': {
      const proxyHostId = normalizePositiveInt(input?.proxyHostId ?? current.proxyHostId, 'Proxy Host ID');
      return {
        proxyHostId,
        certificateNameTemplate: normalizeString(input?.certificateNameTemplate ?? current.certificateNameTemplate) || '{primaryDomain}-{date}',
      } as NginxProxyManagerBinding;
    }
    case 'local_directory':
      return {
        certificateFilePath: normalizeFilePath(input?.certificateFilePath ?? current.certificateFilePath, '证书文件路径'),
        privateKeyFilePath: normalizeFilePath(input?.privateKeyFilePath ?? current.privateKeyFilePath, '私钥文件路径'),
        postCommand: normalizeString(input?.postCommand ?? current.postCommand) || null,
      } as LocalDirectoryBinding;
    default:
      return null;
  }
}

function mapTargetRecord(record: any) {
  const type = normalizeTargetType(record.type || 'webhook');
  return {
    id: record.id,
    name: record.name,
    type,
    enabled: !!record.enabled,
    isDefault: !!record.isDefault,
    config: toResponseConfig(type, record.configJson),
    jobCount: Number(record?._count?.jobs || 0),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapJobRecord(record: any) {
  const type = normalizeTargetType(record.certificateDeployTarget?.type || 'webhook');
  return {
    id: record.id,
    certificateOrderId: record.certificateOrderId,
    vendorCertificateOrderId: record.vendorCertificateOrderId,
    sourceType: record.certificateOrderId ? 'acme' : 'vendor',
    certificateDeployTargetId: record.certificateDeployTargetId,
    enabled: !!record.enabled,
    triggerOnIssue: !!record.triggerOnIssue,
    triggerOnRenew: !!record.triggerOnRenew,
    binding: parseJson(record.bindingJson, null),
    lastStatus: record.lastStatus || null,
    lastError: record.lastError || null,
    lastTriggeredAt: record.lastTriggeredAt,
    lastSucceededAt: record.lastSucceededAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    certificateOrder: record.certificateOrder ? {
      id: record.certificateOrder.id,
      primaryDomain: record.certificateOrder.primaryDomain,
      status: record.certificateOrder.status,
      expiresAt: record.certificateOrder.expiresAt,
      autoRenew: record.certificateOrder.autoRenew,
    } : undefined,
    vendorCertificateOrder: record.vendorCertificateOrder ? {
      id: record.vendorCertificateOrder.id,
      provider: normalizeVendorProvider(record.vendorCertificateOrder.provider),
      primaryDomain: record.vendorCertificateOrder.primaryDomain,
      status: record.vendorCertificateOrder.status,
      expiresAt: record.vendorCertificateOrder.expiresAt,
    } : undefined,
    target: record.certificateDeployTarget ? {
      id: record.certificateDeployTarget.id,
      name: record.certificateDeployTarget.name,
      type,
      enabled: !!record.certificateDeployTarget.enabled,
    } : undefined,
  };
}

async function postWebhook(config: WebhookConfigStored, payload: Record<string, any>) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'dns-panel/1.0 (certificate-webhook)',
  };

  if (config.authMode === 'bearer') {
    const token = config.bearerToken ? decrypt(config.bearerToken) : '';
    if (!token) throw new Error('Webhook Bearer Token 未配置');
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const body = await response.text().catch(() => '');
  return { status: response.status, body };
}

async function getTargetForUser(userId: number, targetId: number) {
  const target = await prisma.certificateDeployTarget.findFirst({
    where: { id: targetId, userId },
    include: { _count: { select: { jobs: true } } },
  });
  if (!target) throw new Error('部署目标不存在');
  return target;
}

async function getIssuedCertificateOrderForUser(userId: number, orderId: number) {
  const order = await prisma.certificateOrder.findFirst({
    where: { id: orderId, userId },
  });
  if (!order) throw new Error('证书订单不存在');
  if (order.status !== 'issued') throw new Error('仅已签发证书可绑定部署任务');
  return order;
}

async function getIssuedVendorOrderForUser(userId: number, vendorOrderId: number) {
  const order = await prisma.vendorCertificateOrder.findFirst({
    where: { id: vendorOrderId, userId },
  });
  if (!order) throw new Error('厂商证书订单不存在');
  if (order.status !== 'issued') throw new Error('仅已签发厂商证书可绑定部署任务');
  if (!order.certificatePem || !order.fullchainPem || !order.privateKeyPem) {
    throw new Error('当前厂商证书内容不完整，无法绑定部署任务');
  }
  return order;
}

function resolveJobSourceInput(payload: Partial<UpsertDeployJobInput>) {
  const certificateOrderId = payload.certificateOrderId == null ? null : Number(payload.certificateOrderId);
  const vendorCertificateOrderId = payload.vendorCertificateOrderId == null ? null : Number(payload.vendorCertificateOrderId);
  const hasCertificateOrder = Number.isFinite(certificateOrderId) && certificateOrderId > 0;
  const hasVendorOrder = Number.isFinite(vendorCertificateOrderId) && vendorCertificateOrderId > 0;

  if (hasCertificateOrder === hasVendorOrder) {
    throw new Error('部署任务必须且只能绑定一个证书来源');
  }

  return {
    certificateOrderId: hasCertificateOrder ? certificateOrderId : null,
    vendorCertificateOrderId: hasVendorOrder ? vendorCertificateOrderId : null,
  };
}

async function resolveIssuedSourceForUser(userId: number, payload: Partial<UpsertDeployJobInput>) {
  const source = resolveJobSourceInput(payload);
  if (source.certificateOrderId) {
    const order = await getIssuedCertificateOrderForUser(userId, source.certificateOrderId);
    return {
      ...source,
      sourceType: 'acme' as const,
      order,
      primaryDomain: order.primaryDomain,
    };
  }

  const order = await getIssuedVendorOrderForUser(userId, source.vendorCertificateOrderId!);
  return {
    ...source,
    sourceType: 'vendor' as const,
    order,
    primaryDomain: order.primaryDomain,
  };
}

async function getJobForUser(userId: number, jobId: number) {
  const job = await prisma.certificateDeployJob.findFirst({
    where: {
      id: jobId,
      certificateDeployTarget: { userId },
      OR: [
        { certificateOrder: { userId } },
        { vendorCertificateOrder: { userId } },
      ],
    },
    include: {
      certificateOrder: true,
      vendorCertificateOrder: true,
      certificateDeployTarget: true,
    },
  });
  if (!job) throw new Error('部署任务不存在');
  return job;
}

async function loadJobForExecution(jobId: number) {
  const job = await prisma.certificateDeployJob.findUnique({
    where: { id: jobId },
    include: {
      certificateOrder: {
        include: {
          certificateCredential: true,
        },
      },
      vendorCertificateOrder: true,
      certificateDeployTarget: true,
    },
  });
  if (!job) throw new Error('部署任务不存在');
  return job;
}

function resolveExecutionSource(job: any) {
  if (job.certificateOrder) {
    const order = job.certificateOrder;
    if (order.status !== 'issued') throw new Error('当前证书尚未签发，无法部署');
    if (!order.certificatePem || !order.fullchainPem || !order.privateKeyPem) throw new Error('当前证书内容不完整，无法部署');
    return {
      kind: 'acme' as const,
      id: order.id,
      userId: order.userId,
      primaryDomain: order.primaryDomain,
      domains: parseJson<string[]>(order.domainsJson, []),
      provider: order.certificateCredential?.provider || '',
      issuedAt: order.issuedAt,
      expiresAt: order.expiresAt,
      certificatePem: decrypt(order.certificatePem),
      fullchainPem: decrypt(order.fullchainPem),
      privateKeyPem: decrypt(order.privateKeyPem),
    };
  }

  if (job.vendorCertificateOrder) {
    const order = job.vendorCertificateOrder;
    if (order.status !== 'issued') throw new Error('当前厂商证书尚未签发，无法部署');
    if (!order.certificatePem || !order.fullchainPem || !order.privateKeyPem) throw new Error('当前厂商证书内容不完整，无法部署');
    return {
      kind: 'vendor' as const,
      id: order.id,
      userId: order.userId,
      primaryDomain: order.primaryDomain,
      domains: parseJson<string[]>(order.domainsJson, []),
      provider: normalizeVendorProvider(order.provider),
      issuedAt: order.issuedAt,
      expiresAt: order.expiresAt,
      certificatePem: decrypt(order.certificatePem),
      fullchainPem: decrypt(order.fullchainPem),
      privateKeyPem: decrypt(order.privateKeyPem),
    };
  }

  throw new Error('部署任务缺少证书来源');
}

function buildWebhookPayload(job: any, event: CertificateDeployEvent) {
  const source = resolveExecutionSource(job);
  const targetConfig = parseStoredConfig<WebhookConfigStored>(job.certificateDeployTarget.configJson, {
    url: '',
    authMode: 'none',
    timeoutMs: 8000,
    sendPrivateKey: true,
  } as WebhookConfigStored);

  return {
    event,
    sourceType: source.kind,
    certificateOrderId: source.kind === 'acme' ? source.id : null,
    vendorCertificateOrderId: source.kind === 'vendor' ? source.id : null,
    primaryDomain: source.primaryDomain,
    domains: source.domains,
    provider: source.provider,
    issuedAt: source.issuedAt ? new Date(source.issuedAt).toISOString() : null,
    expiresAt: source.expiresAt ? new Date(source.expiresAt).toISOString() : null,
    certPem: source.certificatePem,
    fullchainPem: source.fullchainPem,
    ...(targetConfig.sendPrivateKey ? { privateKeyPem: source.privateKeyPem } : {}),
    triggeredAt: new Date().toISOString(),
  };
}

function buildOrderCertificateData(job: any) {
  const source = resolveExecutionSource(job);
  return {
    order: source,
    domains: source.domains,
    certificatePem: source.certificatePem,
    fullchainPem: source.fullchainPem,
    privateKeyPem: source.privateKeyPem,
  };
}

async function logDeploy(userId: number, domain: string, recordName: string, status: 'SUCCESS' | 'FAILED', errorMessage?: string) {
  await createLog({
    userId,
    action: 'UPDATE',
    resourceType: 'CERTIFICATE_DEPLOY',
    domain,
    recordName,
    status,
    errorMessage,
  });
}

function formatDokployDeployLogMessage(result: { verificationMode?: 'direct' | 'readback'; crtPath?: string; keyPath?: string; ymlPath?: string } | null | undefined) {
  if (!result) return undefined;
  const base = result.verificationMode === 'readback'
    ? 'Dokploy 返回异常后，已通过回读校验确认文件完整落地'
    : 'Dokploy 已完成文件写入并通过回读校验';
  const paths = [result.crtPath, result.keyPath, result.ymlPath].filter(Boolean).join(' | ');
  return paths ? `${base}：${paths}` : base;
}

export class CertificateDeployService {
  static listTypes() {
    return listAvailableTargetTypes();
  }

  static async listTargetResources(userId: number, targetId: number, query?: Record<string, any>) {
    const target = await getTargetForUser(userId, targetId);
    const type = normalizeTargetType(target.type);
    const definition = DEPLOY_TARGET_TYPES[type];
    const configData = parseStoredConfig<any>(target.configJson, {});

    if (!definition.supportsResourceDiscovery) {
      return { type, resources: {} };
    }

    if (type === 'cloudflare_custom_hostname') {
      const cfConfig = configData as CloudflareCustomHostnameConfigStored;
      const { service } = await getCloudflareServiceForUser(userId, cfConfig.dnsCredentialId);
      const zones = await service.getDomains();
      const zoneId = normalizeString(query?.zoneId);
      const customHostnames = zoneId ? await service.getCustomHostnames(zoneId) : [];
      return {
        type,
        resources: {
          zones: zones.map((zone) => ({ id: zone.id, name: zone.name, status: zone.status })),
          customHostnames: Array.isArray(customHostnames)
            ? customHostnames.map((item: any) => ({ id: String(item?.id || ''), hostname: String(item?.hostname || ''), status: item?.ssl?.status || item?.status || '' }))
            : [],
        },
      };
    }

    if (type === 'aliyun_esa') {
      const esaConfig = configData as AliyunEsaConfigStored;
      const { auth } = await getAliyunAuthForUser(userId, esaConfig.dnsCredentialId);
      const region = normalizeString(query?.region) || normalizeString(esaConfig.defaultRegion) || undefined;
      const sites = await listEsaSites(auth, { region, pageNumber: 1, pageSize: 200 });
      return {
        type,
        resources: {
          sites: sites.sites.map((site) => ({ id: site.siteId, name: site.siteName, status: site.status, region })),
        },
      };
    }

    if (type === 'aliyun_fc') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as AliyunFcConfigStored;
      const { auth } = await getAliyunAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const regionId = resolveAliyunFcRegion(deployConfig, query?.region);
      const { endpoint, response } = await listAliyunFcCustomDomains({
        auth,
        accountId: deployConfig.accountId,
        regionId,
        limit: 100,
        nextToken: normalizeString(query?.nextToken) || null,
      });
      const customDomains = extractAliyunFcCustomDomains(response);
      return {
        type,
        resources: {
          endpoint,
          regionId,
          nextToken: normalizeString(response?.nextToken) || null,
          customDomains: customDomains.map((item: any) => ({
            id: String(item?.domainName || item?.DomainName || ''),
            name: String(item?.domainName || item?.DomainName || ''),
            protocol: String(item?.protocol || item?.Protocol || ''),
            createdTime: item?.createdTime || item?.CreatedTime || null,
          })).filter((item: any) => item.id),
        },
      };
    }

    if (type === 'onepanel') {
      const service = new OnePanelService({
        baseUrl: normalizeString(configData.baseUrl),
        apiKey: decryptIfPresent(configData.apiKey),
        allowInsecureTls: normalizeBoolean(configData.allowInsecureTls, false),
        timeoutMs: normalizeTimeoutMs(configData.timeoutMs, 8000),
      });
      const websites = await service.listWebsites();
      return {
        type,
        resources: {
          websites: websites.map((item) => ({ id: item.id, name: item.primaryDomain || item.alias || `#${item.id}`, status: item.status || '' })),
        },
      };
    }

    if (type === 'nginx_proxy_manager') {
      const service = new NginxProxyManagerService({
        baseUrl: normalizeString(configData.baseUrl),
        username: normalizeString(configData.username),
        password: decryptIfPresent(configData.password),
        allowInsecureTls: normalizeBoolean(configData.allowInsecureTls, false),
        timeoutMs: normalizeTimeoutMs(configData.timeoutMs, 8000),
      });
      const proxyHosts = await service.listProxyHosts();
      return {
        type,
        resources: {
          proxyHosts: proxyHosts.map((item) => ({ id: item.id, name: item.domainNames.join(', ') || `#${item.id}`, enabled: item.enabled })),
        },
      };
    }

    if (type === 'aliyun_cdn' || type === 'aliyun_dcdn') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { auth } = await getAliyunAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const endpoint = type === 'aliyun_cdn' ? 'cdn.aliyuncs.com' : 'dcdn.aliyuncs.com';
      const action = type === 'aliyun_cdn' ? 'DescribeUserDomains' : 'DescribeDcdnUserDomains';
      const version = type === 'aliyun_cdn' ? '2018-05-10' : '2018-01-15';
      const response = await aliyunRpcRequest<any>({
        auth,
        endpoint,
        action,
        version,
        params: { PageSize: 100, PageNumber: 1 },
      }).catch(() => ({ Domains: { PageData: [] }, DomainList: [] }));
      const pageData = Array.isArray(response?.Domains?.PageData)
        ? response.Domains.PageData
        : Array.isArray(response?.DomainList)
          ? response.DomainList
          : [];
      return {
        type,
        resources: {
          domains: pageData.map((item: any) => ({
            id: String(item?.DomainName || item?.Domain || ''),
            name: String(item?.DomainName || item?.Domain || ''),
            status: String(item?.DomainStatus || item?.Status || ''),
          })).filter((item: any) => item.id),
        },
      };
    }

    if (type === 'aliyun_clb') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { auth } = await getAliyunAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const regionId = resolveDefaultRegion(deployConfig, 'cn-hangzhou');
      const listed = await aliyunRpcRequest<any>({
        auth,
        endpoint: `slb.${regionId}.aliyuncs.com`,
        action: 'DescribeLoadBalancers',
        version: '2014-05-15',
        params: { RegionId: regionId, PageSize: 100, PageNumber: 1 },
      });
      const loadBalancers = Array.isArray(listed?.LoadBalancers?.LoadBalancer)
        ? listed.LoadBalancers.LoadBalancer
        : [];
      let listeners: Array<Record<string, any>> = [];
      const loadBalancerId = normalizeString(query?.loadBalancerId);
      if (loadBalancerId) {
        const detail = await aliyunRpcRequest<any>({
          auth,
          endpoint: `slb.${regionId}.aliyuncs.com`,
          action: 'DescribeLoadBalancerAttribute',
          version: '2014-05-15',
          params: { RegionId: regionId, LoadBalancerId: loadBalancerId },
        }).catch(() => ({}));
        const rawListeners = Array.isArray(detail?.ListenerPortsAndProtocol?.ListenerPortAndProtocol)
          ? detail.ListenerPortsAndProtocol.ListenerPortAndProtocol
          : [];
        listeners = rawListeners
          .filter((item: any) => String(item?.ListenerProtocol || '').toLowerCase() === 'https')
          .map((item: any) => ({
            id: String(item?.ListenerPort || ''),
            name: `HTTPS:${item?.ListenerPort}`,
          }));
      }
      return {
        type,
        resources: {
          loadBalancers: loadBalancers.map((item: any) => ({
            id: String(item?.LoadBalancerId || ''),
            name: String(item?.LoadBalancerName || item?.Address || item?.LoadBalancerId || ''),
            address: String(item?.Address || ''),
          })).filter((item: any) => item.id),
          listeners,
        },
      };
    }

    if (type === 'aliyun_alb' || type === 'aliyun_nlb') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { auth } = await getAliyunAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const regionId = resolveDefaultRegion(deployConfig, 'cn-hangzhou');
      const endpoint = `${type === 'aliyun_alb' ? 'alb' : 'nlb'}.${regionId}.aliyuncs.com`;
      const version = type === 'aliyun_alb' ? '2020-06-16' : '2022-04-30';
      const lbAction = 'ListLoadBalancers';
      const listenerAction = 'ListListeners';
      const lbResponse = await aliyunRpcRequest<any>({
        auth,
        endpoint,
        action: lbAction,
        version,
        params: { MaxResults: 100 },
      }).catch(() => ({ LoadBalancers: [] }));
      const listenerParams: Record<string, any> = { MaxResults: 100 };
      if (normalizeString(query?.loadBalancerId)) {
        listenerParams['LoadBalancerIds.1'] = normalizeString(query?.loadBalancerId);
      }
      const listenerResponse = await aliyunRpcRequest<any>({
        auth,
        endpoint,
        action: listenerAction,
        version,
        params: listenerParams,
      }).catch(() => ({ Listeners: [] }));
      const loadBalancers = Array.isArray(lbResponse?.LoadBalancers) ? lbResponse.LoadBalancers : [];
      const listeners = (Array.isArray(listenerResponse?.Listeners) ? listenerResponse.Listeners : [])
        .filter((item: any) => {
          const protocol = String(item?.ListenerProtocol || item?.Protocol || '').toUpperCase();
          return type === 'aliyun_alb' ? protocol === 'HTTPS' : protocol === 'TLS';
        })
        .map((item: any) => ({
          id: String(item?.ListenerId || ''),
          name: String(item?.ListenerDescription || item?.ListenerName || item?.ListenerId || ''),
          loadBalancerId: String(item?.LoadBalancerId || ''),
          protocol: String(item?.ListenerProtocol || item?.Protocol || ''),
        }))
        .filter((item: any) => item.id);
      return {
        type,
        resources: {
          loadBalancers: loadBalancers.map((item: any) => ({
            id: String(item?.LoadBalancerId || ''),
            name: String(item?.LoadBalancerName || item?.LoadBalancerId || ''),
            address: String(item?.DNSName || item?.Address || ''),
          })).filter((item: any) => item.id),
          listeners,
        },
      };
    }

    if (type === 'tencent_cdn') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { creds } = await getDnspodTc3CredentialsForUser(userId, Number(deployConfig.dnsCredentialId));
      const response = await tencentCloudRequest<any>({
        creds,
        host: 'cdn.tencentcloudapi.com',
        service: 'cdn',
        action: 'DescribeDomainsConfig',
        version: '2018-06-06',
        payload: { Offset: 0, Limit: 100 },
      });
      const domains = Array.isArray(response?.Domains) ? response.Domains : [];
      return {
        type,
        resources: {
          domains: domains.map((item: any) => ({
            id: String(item?.Domain || ''),
            name: String(item?.Domain || ''),
            status: String(item?.Status || ''),
          })).filter((item: any) => item.id),
        },
      };
    }

    if (type === 'tencent_edgeone') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { creds } = await getDnspodTc3CredentialsForUser(userId, Number(deployConfig.dnsCredentialId));
      const zones = await tencentCloudRequest<any>({
        creds,
        host: 'teo.tencentcloudapi.com',
        service: 'teo',
        action: 'DescribeZones',
        version: '2022-09-01',
        payload: { Offset: 0, Limit: 100 },
      }).catch(() => ({ Zones: [] }));
      const zoneId = normalizeString(query?.zoneId);
      let hosts: any[] = [];
      if (zoneId) {
        const hostResponse = await tencentCloudRequest<any>({
          creds,
          host: 'teo.tencentcloudapi.com',
          service: 'teo',
          action: 'DescribeHostsSetting',
          version: '2022-09-01',
          payload: { ZoneId: zoneId, Offset: 0, Limit: 100 },
        }).catch(() => ({ DetailHosts: [] }));
        hosts = Array.isArray(hostResponse?.DetailHosts)
          ? hostResponse.DetailHosts
          : Array.isArray(hostResponse?.Hosts)
            ? hostResponse.Hosts
            : [];
      }
      return {
        type,
        resources: {
          zones: (Array.isArray(zones?.Zones) ? zones.Zones : []).map((item: any) => ({
            id: String(item?.ZoneId || ''),
            name: String(item?.AliasZoneName || item?.ZoneName || item?.ZoneId || ''),
            status: String(item?.Status || ''),
          })).filter((item: any) => item.id),
          hosts: hosts.map((item: any) => ({
            id: String(item?.Host || ''),
            name: String(item?.Host || ''),
            status: String(item?.Status || ''),
          })).filter((item: any) => item.id),
        },
      };
    }

    if (type === 'tencent_clb') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { creds } = await getDnspodTc3CredentialsForUser(userId, Number(deployConfig.dnsCredentialId));
      const regionId = resolveDefaultRegion(deployConfig, 'ap-guangzhou');
      const loadBalancerResponse = await tencentCloudRequest<any>({
        creds,
        host: 'clb.tencentcloudapi.com',
        service: 'clb',
        action: 'DescribeLoadBalancers',
        version: '2018-03-17',
        region: regionId,
        payload: { Limit: 100, Offset: 0 },
      });
      const loadBalancers = Array.isArray(loadBalancerResponse?.LoadBalancerSet) ? loadBalancerResponse.LoadBalancerSet : [];
      const loadBalancerId = normalizeString(query?.loadBalancerId);
      let listeners: any[] = [];
      let domains: any[] = [];
      if (loadBalancerId) {
        const listenerResponse = await tencentCloudRequest<any>({
          creds,
          host: 'clb.tencentcloudapi.com',
          service: 'clb',
          action: 'DescribeListeners',
          version: '2018-03-17',
          region: regionId,
          payload: { LoadBalancerId: loadBalancerId, Protocol: 'HTTPS' },
        }).catch(() => ({ Listeners: [], TotalCount: 0 }));
        listeners = Array.isArray(listenerResponse?.Listeners) ? listenerResponse.Listeners : [];
        const selectedListenerId = normalizeString(query?.listenerId);
        if (selectedListenerId) {
          const matched = listeners.find((item: any) => String(item?.ListenerId || '') === selectedListenerId);
          const rules = Array.isArray(matched?.Rules) ? matched.Rules : [];
          domains = rules.map((item: any) => ({
            id: String(item?.Domain || ''),
            name: String(item?.Domain || ''),
          })).filter((item: any) => item.id);
        }
      }
      return {
        type,
        resources: {
          loadBalancers: loadBalancers.map((item: any) => ({
            id: String(item?.LoadBalancerId || ''),
            name: String(item?.LoadBalancerName || item?.LoadBalancerId || ''),
            address: String(item?.LoadBalancerVips?.[0] || ''),
          })).filter((item: any) => item.id),
          listeners: listeners.map((item: any) => ({
            id: String(item?.ListenerId || ''),
            name: `${String(item?.Protocol || 'HTTPS').toUpperCase()}:${item?.Port || ''}`,
          })).filter((item: any) => item.id),
          domains,
        },
      };
    }

    if (type === 'huawei_cdn') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { creds } = await getHuaweiAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const response = await huaweiCloudRequest<any>({
        creds,
        host: 'cdn.myhuaweicloud.com',
        path: '/v1.0/cdn/domains',
        method: 'GET',
        query: { page_size: 100, page_number: 1 },
      }).catch(() => ({ domains: [] }));
      const domains = Array.isArray(response?.domains) ? response.domains : [];
      return {
        type,
        resources: {
          domains: domains.map((item: any) => ({
            id: String(item?.domain_name || item?.domain || ''),
            name: String(item?.domain_name || item?.domain || ''),
            status: String(item?.status || ''),
          })).filter((item: any) => item.id),
        },
      };
    }

    if (type === 'huawei_elb') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { creds } = await getHuaweiAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const regionId = resolveDefaultRegion(deployConfig, '');
      const projectId = normalizeString(deployConfig.defaultProjectId);
      if (!regionId || !projectId) {
        return { type, resources: { loadBalancers: [], listeners: [], certificates: [] } };
      }
      const host = `elb.${regionId}.myhuaweicloud.com`;
      const lbResponse = await huaweiCloudRequest<any>({
        creds,
        host,
        path: `/v3/${projectId}/elb/loadbalancers`,
        method: 'GET',
        query: { limit: 100 },
      }).catch(() => ({ loadbalancers: [] }));
      const listenerResponse = await huaweiCloudRequest<any>({
        creds,
        host,
        path: `/v3/${projectId}/elb/listeners`,
        method: 'GET',
        query: { limit: 100 },
      }).catch(() => ({ listeners: [] }));
      const certificateResponse = await huaweiCloudRequest<any>({
        creds,
        host,
        path: `/v3/${projectId}/elb/certificates`,
        method: 'GET',
        query: { limit: 100 },
      }).catch(() => ({ certificates: [] }));
      const loadBalancers = Array.isArray(lbResponse?.loadbalancers) ? lbResponse.loadbalancers : [];
      const listeners = Array.isArray(listenerResponse?.listeners) ? listenerResponse.listeners : [];
      const certificates = Array.isArray(certificateResponse?.certificates) ? certificateResponse.certificates : [];
      return {
        type,
        resources: {
          loadBalancers: loadBalancers.map((item: any) => ({
            id: String(item?.id || ''),
            name: String(item?.name || item?.vip_address || item?.id || ''),
          })).filter((item: any) => item.id),
          listeners: listeners
            .filter((item: any) => ['HTTPS', 'TERMINATED_HTTPS', 'QUIC'].includes(String(item?.protocol || '').toUpperCase()))
            .map((item: any) => ({
              id: String(item?.id || ''),
              name: `${String(item?.protocol || '').toUpperCase()}:${item?.protocol_port || ''}`,
              loadBalancerId: String(item?.loadbalancer_id || ''),
            }))
            .filter((item: any) => item.id),
          certificates: certificates.map((item: any) => ({
            id: String(item?.id || ''),
            name: String(item?.name || item?.common_name || item?.id || ''),
          })).filter((item: any) => item.id),
        },
      };
    }

    if (type === 'ucloud_cdn') {
      const deployConfig = configData as DnsCredentialDeployConfigStored;
      const { auth } = await getUcloudAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const response = await listUcloudCdnDomains({
        auth,
        offset: 0,
        limit: 100,
      });
      const domains = extractUcloudCdnDomains(response);
      return {
        type,
        resources: {
          domains: domains.map((item: any) => ({
            id: String(item?.DomainId || ''),
            name: String(item?.Domain || item?.DomainId || ''),
            status: String(item?.Status || ''),
            httpsStatusCn: String(item?.HttpsStatusCn || ''),
            httpsStatusAbroad: String(item?.HttpsStatusAbroad || ''),
          })).filter((item: any) => item.id),
        },
      };
    }

    if (type === 'aws_cloudfront') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as AwsCloudfrontConfigStored;
      const client = createAwsCloudFrontClient(deployConfig);
      const response = await client.send(new ListDistributionsCommand({ MaxItems: 100 }));
      const items = Array.isArray(response.DistributionList?.Items) ? response.DistributionList.Items : [];
      return {
        type,
        resources: {
          distributions: items.map((item) => ({
            id: String(item.Id || ''),
            name: String(item.Aliases?.Items?.[0] || item.DomainName || item.Id || ''),
            domainName: String(item.DomainName || ''),
            status: String(item.Status || ''),
            acmCertificateArn: String(item.ViewerCertificate?.ACMCertificateArn || ''),
          })).filter((item) => item.id),
        },
      };
    }

    if (type === 'gcore') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as ApiTokenConfigStored;
      const certificates = await gcoreRequest<any[]>({
        apiToken: decryptIfPresent(deployConfig.apiToken),
        path: '/cdn/sslData',
      });
      return {
        type,
        resources: {
          certificates: (Array.isArray(certificates) ? certificates : []).map((item) => ({
            id: String(item?.id || ''),
            name: String(item?.name || item?.cert_subject_cn || item?.id || ''),
            domain: String(item?.cert_subject_cn || ''),
            automated: !!item?.automated,
            hasRelatedResources: !!item?.hasRelatedResources,
          })).filter((item) => item.id),
        },
      };
    }

    return { type, resources: {} };
  }

  static async listTargets(userId: number) {
    const targets = await prisma.certificateDeployTarget.findMany({
      where: { userId },
      include: { _count: { select: { jobs: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return targets.map(mapTargetRecord);
  }

  static async createTarget(userId: number, payload: UpsertDeployTargetInput) {
    const name = normalizeString(payload.name);
    if (!name) throw new Error('目标名称不能为空');
    const type = normalizeTargetType(payload.type || 'webhook');

    const existingCount = await prisma.certificateDeployTarget.count({ where: { userId } });
    const isDefault = existingCount === 0 || payload.isDefault === true;
    if (isDefault) {
      await prisma.certificateDeployTarget.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }

    const created = await prisma.certificateDeployTarget.create({
      data: {
        userId,
        name,
        type,
        enabled: normalizeBoolean(payload.enabled, true),
        isDefault,
        configJson: JSON.stringify(buildStoredConfig(type, payload.config)),
      },
      include: { _count: { select: { jobs: true } } },
    });

    await logDeploy(userId, '', `target:create:${name}`, 'SUCCESS');
    return mapTargetRecord(created);
  }

  static async updateTarget(userId: number, targetId: number, payload: UpsertDeployTargetInput) {
    const existing = await getTargetForUser(userId, targetId);
    const nextType = normalizeTargetType(payload.type || existing.type || 'webhook');
    if (existing.type !== nextType && existing._count.jobs > 0) {
      throw new Error('目标存在部署任务时不可修改类型');
    }

    const name = normalizeString(payload.name || existing.name);
    if (!name) throw new Error('目标名称不能为空');
    const isDefault = payload.isDefault === true || existing.isDefault;

    if (isDefault) {
      await prisma.certificateDeployTarget.updateMany({
        where: { userId, isDefault: true, id: { not: targetId } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.certificateDeployTarget.update({
      where: { id: targetId },
      data: {
        name,
        type: nextType,
        enabled: normalizeBoolean(payload.enabled, existing.enabled),
        isDefault,
        configJson: JSON.stringify(buildStoredConfig(nextType, payload.config, parseStoredConfig(existing.configJson, {}))),
      },
      include: { _count: { select: { jobs: true } } },
    });

    await logDeploy(userId, '', `target:update:${updated.name}`, 'SUCCESS');
    return mapTargetRecord(updated);
  }

  static async deleteTarget(userId: number, targetId: number) {
    const existing = await getTargetForUser(userId, targetId);
    if (existing._count.jobs > 0) throw new Error('目标仍被部署任务引用，无法删除');

    await prisma.certificateDeployTarget.delete({ where: { id: targetId } });
    if (existing.isDefault) {
      const next = await prisma.certificateDeployTarget.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
      if (next) {
        await prisma.certificateDeployTarget.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }

    await logDeploy(userId, '', `target:delete:${existing.name}`, 'SUCCESS');
  }

  static async testTarget(userId: number, targetId: number) {
    const target = await getTargetForUser(userId, targetId);
    const type = normalizeTargetType(target.type);
    const definition = DEPLOY_TARGET_TYPES[type];
    const configData = parseStoredConfig<any>(target.configJson, {});

    if (!definition.supportsTest) {
      throw new Error('当前部署目标类型暂不支持在线测试');
    }

    if (type === 'webhook') {
      const config = buildStoredConfig(type, undefined, configData) as WebhookConfigStored;
      const payload = {
        event: 'certificate.issued',
        certificateOrderId: 0,
        primaryDomain: 'example.com',
        domains: ['example.com'],
        provider: 'test',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        certPem: TEST_CERT,
        fullchainPem: TEST_CERT,
        ...(config.sendPrivateKey ? { privateKeyPem: TEST_KEY } : {}),
        triggeredAt: new Date().toISOString(),
      };
      const response = await postWebhook(config, payload);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Webhook 测试失败: HTTP ${response.status}`);
      }
      await logDeploy(userId, 'example.com', `target:test:${target.name}`, 'SUCCESS');
      return response;
    }

    if (type === 'dokploy') {
      const dokploy = buildStoredConfig(type, undefined, configData) as DokployConfigStored;
      const service = new DokployService({
        baseUrl: dokploy.baseUrl,
        apiKey: decrypt(dokploy.apiKey),
        serverId: dokploy.serverId || undefined,
        dynamicRoot: dokploy.dynamicRoot,
        allowInsecureTls: dokploy.allowInsecureTls,
        timeoutMs: dokploy.timeoutMs,
        reloadTraefikAfterPush: dokploy.reloadTraefikAfterPush,
      });
      const result = await service.testConnection();
      return { status: 200, body: JSON.stringify(result) };
    }

    if (type === 'cloudflare_custom_hostname') {
      const { service } = await getCloudflareServiceForUser(userId, Number(configData.dnsCredentialId));
      const zones = await service.getDomains();
      return { status: 200, body: JSON.stringify({ zones: zones.length }) };
    }

    if (type === 'aliyun_esa') {
      const { auth } = await getAliyunAuthForUser(userId, Number(configData.dnsCredentialId));
      const region = normalizeString(configData.defaultRegion) || undefined;
      const sites = await listEsaSites(auth, { region, pageNumber: 1, pageSize: 10 });
      return { status: 200, body: JSON.stringify({ sites: sites.sites.length }) };
    }

    if (type === 'aliyun_oss') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const { auth } = await getAliyunAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const response = await aliyunRpcRequest<any>({
        auth,
        endpoint: 'cas.aliyuncs.com',
        action: 'ListUserCertificateOrder',
        version: '2020-04-07',
        params: { OrderType: 'CERT', CurrentPage: 1, ShowSize: 1 },
      });
      return {
        status: 200,
        body: JSON.stringify({
          certificates: Number(response?.TotalCount || 0),
        }),
      };
    }

    if (type === 'aliyun_waf') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const regionId = resolveDefaultRegion(deployConfig, 'cn-hangzhou');
      const { auth } = await getAliyunAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const instanceId = await resolveAliyunWafInstanceId({
        auth,
        regionId,
      });
      return {
        status: 200,
        body: JSON.stringify({
          instanceId,
          regionId,
        }),
      };
    }

    if (type === 'aliyun_fc') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as AliyunFcConfigStored;
      const regionId = resolveAliyunFcRegion(deployConfig);
      const { auth } = await getAliyunAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const { endpoint, response } = await listAliyunFcCustomDomains({
        auth,
        accountId: deployConfig.accountId,
        regionId,
        limit: 1,
      });
      return {
        status: 200,
        body: JSON.stringify({
          endpoint,
          regionId,
          customDomains: extractAliyunFcCustomDomains(response).length,
          nextToken: normalizeString(response?.nextToken) || null,
        }),
      };
    }

    if (type === 'aliyun_cdn' || type === 'aliyun_dcdn' || type === 'aliyun_clb' || type === 'aliyun_alb' || type === 'aliyun_nlb') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const { auth } = await getAliyunAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      if (type === 'aliyun_cdn' || type === 'aliyun_dcdn') {
        const endpoint = type === 'aliyun_cdn' ? 'cdn.aliyuncs.com' : 'dcdn.aliyuncs.com';
        const action = type === 'aliyun_cdn' ? 'DescribeUserDomains' : 'DescribeDcdnUserDomains';
        const version = type === 'aliyun_cdn' ? '2018-05-10' : '2018-01-15';
        const response = await aliyunRpcRequest<any>({
          auth,
          endpoint,
          action,
          version,
          params: { PageSize: 1, PageNumber: 1 },
        });
        const total = Number(response?.TotalCount || response?.Domains?.TotalCount || 0);
        return { status: 200, body: JSON.stringify({ total }) };
      }

      const regionId = resolveDefaultRegion(deployConfig, type === 'aliyun_clb' ? 'cn-hangzhou' : 'cn-hangzhou');
      const endpoint = `${type === 'aliyun_clb' ? 'slb' : type === 'aliyun_alb' ? 'alb' : 'nlb'}.${regionId}.aliyuncs.com`;
      const version = type === 'aliyun_clb' ? '2014-05-15' : type === 'aliyun_alb' ? '2020-06-16' : '2022-04-30';
      const action = type === 'aliyun_clb' ? 'DescribeLoadBalancers' : 'ListLoadBalancers';
      const response = await aliyunRpcRequest<any>({
        auth,
        endpoint,
        action,
        version,
        params: type === 'aliyun_clb' ? { RegionId: regionId, PageSize: 1, PageNumber: 1 } : { MaxResults: 1 },
      });
      return { status: 200, body: JSON.stringify({ ok: true, sample: response?.RequestId || true }) };
    }

    if (type === 'tencent_cdn' || type === 'tencent_edgeone' || type === 'tencent_clb') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const { creds } = await getDnspodTc3CredentialsForUser(userId, Number(deployConfig.dnsCredentialId));
      if (type === 'tencent_cdn') {
        const response = await tencentCloudRequest<any>({
          creds,
          host: 'cdn.tencentcloudapi.com',
          service: 'cdn',
          action: 'DescribeDomainsConfig',
          version: '2018-06-06',
          payload: { Offset: 0, Limit: 1 },
        });
        return { status: 200, body: JSON.stringify({ domains: Number(response?.TotalNumber || 0) }) };
      }
      if (type === 'tencent_edgeone') {
        const response = await tencentCloudRequest<any>({
          creds,
          host: 'teo.tencentcloudapi.com',
          service: 'teo',
          action: 'DescribeZones',
          version: '2022-09-01',
          payload: { Offset: 0, Limit: 1 },
        });
        return { status: 200, body: JSON.stringify({ zones: Array.isArray(response?.Zones) ? response.Zones.length : 0 }) };
      }
      const regionId = resolveDefaultRegion(deployConfig, 'ap-guangzhou');
      const response = await tencentCloudRequest<any>({
        creds,
        host: 'clb.tencentcloudapi.com',
        service: 'clb',
        action: 'DescribeLoadBalancers',
        version: '2018-03-17',
        region: regionId,
        payload: { Offset: 0, Limit: 1 },
      });
      return { status: 200, body: JSON.stringify({ loadBalancers: Array.isArray(response?.LoadBalancerSet) ? response.LoadBalancerSet.length : 0 }) };
    }

    if (type === 'tencent_cos' || type === 'tencent_tke' || type === 'tencent_scf') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const regionId = resolveDefaultRegion(deployConfig, 'ap-guangzhou');
      const { creds } = await getDnspodTc3CredentialsForUser(userId, Number(deployConfig.dnsCredentialId));

      if (type === 'tencent_cos') {
        const buckets = await listTencentCosBuckets(creds, regionId);
        return { status: 200, body: JSON.stringify({ regionId, buckets: buckets.length }) };
      }

      if (type === 'tencent_tke') {
        const clusters = await listTencentTkeClusters(creds, regionId, 1);
        return { status: 200, body: JSON.stringify({ regionId, clusters: clusters.length }) };
      }

      const namespaces = await listTencentScfNamespaces(creds, regionId, 1);
      return { status: 200, body: JSON.stringify({ regionId, namespaces: namespaces.length }) };
    }

    if (type === 'huawei_cdn' || type === 'huawei_elb') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const { creds } = await getHuaweiAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      if (type === 'huawei_cdn') {
        const response = await huaweiCloudRequest<any>({
          creds,
          host: 'cdn.myhuaweicloud.com',
          path: '/v1.0/cdn/domains',
          method: 'GET',
          query: { page_size: 1, page_number: 1 },
        });
        return { status: 200, body: JSON.stringify({ domains: Array.isArray(response?.domains) ? response.domains.length : 0 }) };
      }
      const regionId = resolveDefaultRegion(deployConfig, '');
      const projectId = normalizeString(deployConfig.defaultProjectId);
      if (!regionId || !projectId) throw new Error('华为云 ELB 在线测试需要默认 Region 和默认项目 ID');
      const response = await huaweiCloudRequest<any>({
        creds,
        host: `elb.${regionId}.myhuaweicloud.com`,
        path: `/v3/${projectId}/elb/loadbalancers`,
        method: 'GET',
        query: { limit: 1 },
      });
      return { status: 200, body: JSON.stringify({ loadBalancers: Array.isArray(response?.loadbalancers) ? response.loadbalancers.length : 0 }) };
    }

    if (type === 'huawei_waf') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const { creds } = await getHuaweiAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const regionId = normalizeRequiredText(deployConfig.defaultRegion, '默认 Region');
      const projectId = normalizeRequiredText(deployConfig.defaultProjectId, '默认项目 ID');
      const host = `waf.${regionId}.myhuaweicloud.com`;
      const [certificates, cloudHosts] = await Promise.all([
        huaweiCloudRequest<any>({
          creds,
          host,
          path: `/v1/${projectId}/waf/certificate`,
          method: 'GET',
          query: { page: 1, pagesize: 1 },
        }).catch(() => ({ total: 0, items: [] })),
        huaweiCloudRequest<any>({
          creds,
          host,
          path: `/v1/${projectId}/waf/instance`,
          method: 'GET',
          query: { page: 1, pagesize: 1 },
        }).catch(() => ({ total: 0, items: [] })),
      ]);
      return {
        status: 200,
        body: JSON.stringify({
          certificates: Number(certificates?.total || 0),
          cloudHosts: Number(cloudHosts?.total || 0),
        }),
      };
    }

    if (type === 'ucloud_cdn') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const { auth } = await getUcloudAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const response = await listUcloudCdnDomains({
        auth,
        offset: 0,
        limit: 1,
      });
      return {
        status: 200,
        body: JSON.stringify({
          domains: extractUcloudCdnDomains(response).length,
          projectId: auth.projectId || null,
        }),
      };
    }

    if (type === 'qiniu_cdn' || type === 'qiniu_oss') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as AccessKeySecretConfigStored;
      const certificates = await listQiniuCertificates(deployConfig.accessKey, decryptIfPresent(deployConfig.secretKey), 1);
      return {
        status: 200,
        body: JSON.stringify({
          certificates: certificates.length,
        }),
      };
    }

    if (type === 'baidu_cdn') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const { creds } = await getBaiduAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const response = await baiduCloudRequest<any>({
        creds,
        host: 'cdn.baidubce.com',
        path: '/v2/domain',
        method: 'GET',
      });
      const domains = Array.isArray(response?.domains)
        ? response.domains
        : Array.isArray(response?.result)
          ? response.result
          : [];
      return {
        status: 200,
        body: JSON.stringify({
          domains: domains.length,
        }),
      };
    }

    if (type === 'volcengine_cdn') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as DnsCredentialDeployConfigStored;
      const { creds } = await getVolcengineAuthForUser(userId, Number(deployConfig.dnsCredentialId));
      const response = await volcengineRequest<any>({
        creds,
        host: 'cdn.volcengineapi.com',
        service: 'cdn',
        version: '2021-03-01',
        region: resolveDefaultRegion(deployConfig, 'cn-north-1'),
        action: 'ListCertInfo',
        body: {
          Source: 'volc_cert_center',
          PageNum: 1,
          PageSize: 1,
          CertType: 'server_cert',
          EncryType: 'inter_cert',
        },
      });
      const certificates = Array.isArray(response?.CertInfo) ? response.CertInfo : [];
      return {
        status: 200,
        body: JSON.stringify({
          certificates: Number(response?.Total || certificates.length),
          source: 'volc_cert_center',
        }),
      };
    }

    if (type === 'dogecloud_cdn') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as AccessKeySecretConfigStored;
      const certificates = await listDogeCloudCertificates(deployConfig.accessKey, decryptIfPresent(deployConfig.secretKey));
      return {
        status: 200,
        body: JSON.stringify({
          certificates: certificates.length,
        }),
      };
    }

    if (type === 'aws_cloudfront') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as AwsCloudfrontConfigStored;
      const credentials = buildAwsStaticCredentials(deployConfig);
      const stsClient = new STSClient({ region: 'us-east-1', credentials });
      const cloudFrontClient = createAwsCloudFrontClient(deployConfig);
      const identity = await stsClient.send(new GetCallerIdentityCommand({}));
      const listed = await cloudFrontClient.send(new ListDistributionsCommand({ MaxItems: 1 }));
      return {
        status: 200,
        body: JSON.stringify({
          account: identity.Account || null,
          arn: identity.Arn || null,
          distributions: Number(listed.DistributionList?.Quantity || 0),
        }),
      };
    }

    if (type === 'gcore') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as ApiTokenConfigStored;
      const apiToken = decryptIfPresent(deployConfig.apiToken);
      const client = await gcoreRequest<any>({
        apiToken,
        path: '/iam/clients/me',
      });
      const certificates = await gcoreRequest<any[]>({
        apiToken,
        path: '/cdn/sslData',
      }).catch(() => []);
      return {
        status: 200,
        body: JSON.stringify({
          clientId: client?.id || client?.client_id || null,
          clientName: client?.name || client?.company_name || null,
          certificates: Array.isArray(certificates) ? certificates.length : 0,
        }),
      };
    }

    if (type === 'cachefly') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as ApiTokenConfigStored;
      const account = await cacheflyRequest<any>({
        apiToken: decryptIfPresent(deployConfig.apiToken),
        path: '/accounts/me',
      });
      return {
        status: 200,
        body: JSON.stringify({
          accountId: account?.id || account?.uid || null,
          accountName: account?.name || account?.accountName || null,
        }),
      };
    }

    if (type === 'allwaf') {
      const deployConfig = buildStoredConfig(type, undefined, configData) as BaseUrlApiKeyConfigStored;
      const version = await btwafRequest<any>({
        baseUrl: deployConfig.baseUrl,
        apiKey: decryptIfPresent(deployConfig.apiKey),
        path: '/api/user/latest_version',
        body: {},
      });
      return {
        status: 200,
        body: JSON.stringify({
          version: version?.version || version?.latest_version || version || null,
        }),
      };
    }

    if (type === 'onepanel') {
      const service = new OnePanelService({
        baseUrl: normalizeString(configData.baseUrl),
        apiKey: decryptIfPresent(configData.apiKey),
        allowInsecureTls: normalizeBoolean(configData.allowInsecureTls, false),
        timeoutMs: normalizeTimeoutMs(configData.timeoutMs, 8000),
      });
      const websites = await service.testConnection();
      return { status: 200, body: JSON.stringify({ websites: websites.length }) };
    }

    if (type === 'ssh_server' || type === 'iis') {
      const config = buildStoredConfig(type, undefined, configData) as SshServerConfigStored;
      const result = await testSshConnection({
        host: config.host,
        port: config.port,
        username: config.username,
        authMode: config.authMode,
        password: decryptIfPresent(config.password),
        privateKey: decryptIfPresent(config.privateKey),
        passphrase: decryptIfPresent(config.passphrase),
        timeoutMs: config.timeoutMs,
        allowInsecureHostKey: config.allowInsecureHostKey,
      });
      return { status: 200, body: JSON.stringify(result) };
    }

    if (type === 'ftp_server') {
      const config = buildStoredConfig(type, undefined, configData) as FtpServerConfigStored;
      const result = await testFtpConnection({
        host: config.host,
        port: config.port,
        username: config.username,
        password: decryptIfPresent(config.password),
        secure: config.secure,
        timeoutMs: config.timeoutMs,
        allowInsecureTls: config.allowInsecureTls,
      });
      return { status: 200, body: JSON.stringify(result) };
    }

    if (type === 'local_directory') {
      return {
        status: 200,
        body: JSON.stringify({ ok: true, note: '路径在部署任务绑定时校验' }),
      };
    }

    if (type === 'nginx_proxy_manager') {
      const service = new NginxProxyManagerService({
        baseUrl: normalizeString(configData.baseUrl),
        username: normalizeString(configData.username),
        password: decryptIfPresent(configData.password),
        allowInsecureTls: normalizeBoolean(configData.allowInsecureTls, false),
        timeoutMs: normalizeTimeoutMs(configData.timeoutMs, 8000),
      });
      const proxyHosts = await service.testConnection();
      return { status: 200, body: JSON.stringify({ proxyHosts: proxyHosts.length }) };
    }

    throw new Error('当前部署目标类型暂不支持在线测试');
  }

  static async listJobs(userId: number) {
    const jobs = await prisma.certificateDeployJob.findMany({
      where: {
        certificateDeployTarget: { userId },
        OR: [
          { certificateOrder: { userId } },
          { vendorCertificateOrder: { userId } },
        ],
      },
      include: {
        certificateOrder: {
          select: { id: true, primaryDomain: true, status: true, expiresAt: true, autoRenew: true },
        },
        vendorCertificateOrder: {
          select: { id: true, primaryDomain: true, provider: true, status: true, expiresAt: true },
        },
        certificateDeployTarget: {
          select: { id: true, name: true, type: true, enabled: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return jobs.map(mapJobRecord);
  }

  static async createJob(userId: number, payload: UpsertDeployJobInput) {
    const source = await resolveIssuedSourceForUser(userId, payload);
    const target = await getTargetForUser(userId, Number(payload.certificateDeployTargetId));
    const type = normalizeTargetType(target.type);
    const existing = await prisma.certificateDeployJob.findFirst({
      where: {
        certificateOrderId: source.certificateOrderId,
        vendorCertificateOrderId: source.vendorCertificateOrderId,
        certificateDeployTargetId: target.id,
      },
    });
    if (existing) throw new Error('该证书与部署目标已存在任务绑定');

    const binding = buildBinding(type, payload.binding);

    const created = await prisma.certificateDeployJob.create({
      data: {
        certificateOrderId: source.certificateOrderId,
        vendorCertificateOrderId: source.vendorCertificateOrderId,
        certificateDeployTargetId: target.id,
        bindingJson: binding ? JSON.stringify(binding) : null,
        enabled: normalizeBoolean(payload.enabled, true),
        triggerOnIssue: normalizeBoolean(payload.triggerOnIssue, true),
        triggerOnRenew: normalizeBoolean(payload.triggerOnRenew, true),
      },
      include: {
        certificateOrder: {
          select: { id: true, primaryDomain: true, status: true, expiresAt: true, autoRenew: true },
        },
        vendorCertificateOrder: {
          select: { id: true, primaryDomain: true, provider: true, status: true, expiresAt: true },
        },
        certificateDeployTarget: {
          select: { id: true, name: true, type: true, enabled: true },
        },
      },
    });

    await logDeploy(userId, source.primaryDomain, `job:create:${target.name}`, 'SUCCESS');
    if (created.enabled && created.certificateDeployTarget?.enabled && EXECUTABLE_TARGET_TYPES.has(type)) {
      setImmediate(() => {
        void this.executeCreatedJobOnce(created.id).catch((error) => {
          console.error('[certificate-deploy:create-job:auto-run]', error?.message || error);
        });
      });
    }
    return mapJobRecord(created);
  }

  static async updateJob(userId: number, jobId: number, payload: Partial<UpsertDeployJobInput>) {
    const existing = await getJobForUser(userId, jobId);

    const source =
      payload.certificateOrderId !== undefined || payload.vendorCertificateOrderId !== undefined
        ? await resolveIssuedSourceForUser(userId, {
            certificateOrderId: payload.certificateOrderId,
            vendorCertificateOrderId: payload.vendorCertificateOrderId,
            certificateDeployTargetId: existing.certificateDeployTargetId,
          })
        : {
            certificateOrderId: existing.certificateOrderId,
            vendorCertificateOrderId: existing.vendorCertificateOrderId,
            primaryDomain: existing.certificateOrder?.primaryDomain || existing.vendorCertificateOrder?.primaryDomain || '',
          };

    let certificateDeployTargetId = existing.certificateDeployTargetId;
    let targetType = normalizeTargetType(existing.certificateDeployTarget.type);
    if (payload.certificateDeployTargetId !== undefined) {
      const target = await getTargetForUser(userId, Number(payload.certificateDeployTargetId));
      certificateDeployTargetId = target.id;
      targetType = normalizeTargetType(target.type);
    }

    const duplicate = await prisma.certificateDeployJob.findFirst({
      where: {
        id: { not: existing.id },
        certificateOrderId: source.certificateOrderId,
        vendorCertificateOrderId: source.vendorCertificateOrderId,
        certificateDeployTargetId,
      },
    });
    if (duplicate) throw new Error('该证书与部署目标已存在任务绑定');

    const binding = payload.binding !== undefined
      ? buildBinding(targetType, payload.binding, parseJson(existing.bindingJson, null))
      : (existing.bindingJson ? parseJson(existing.bindingJson, null) : null);

    const updated = await prisma.certificateDeployJob.update({
      where: { id: existing.id },
      data: {
        certificateOrderId: source.certificateOrderId,
        vendorCertificateOrderId: source.vendorCertificateOrderId,
        certificateDeployTargetId,
        bindingJson: binding ? JSON.stringify(binding) : null,
        enabled: normalizeBoolean(payload.enabled, existing.enabled),
        triggerOnIssue: normalizeBoolean(payload.triggerOnIssue, existing.triggerOnIssue),
        triggerOnRenew: normalizeBoolean(payload.triggerOnRenew, existing.triggerOnRenew),
      },
      include: {
        certificateOrder: {
          select: { id: true, primaryDomain: true, status: true, expiresAt: true, autoRenew: true },
        },
        vendorCertificateOrder: {
          select: { id: true, primaryDomain: true, provider: true, status: true, expiresAt: true },
        },
        certificateDeployTarget: {
          select: { id: true, name: true, type: true, enabled: true },
        },
      },
    });

    await logDeploy(userId, source.primaryDomain, `job:update:${updated.certificateDeployTarget.name}`, 'SUCCESS');
    return mapJobRecord(updated);
  }

  static async deleteJob(userId: number, jobId: number) {
    const existing = await getJobForUser(userId, jobId);
    const domain = existing.certificateOrder?.primaryDomain || existing.vendorCertificateOrder?.primaryDomain || '';
    await prisma.certificateDeployRun.deleteMany({ where: { jobId: existing.id } });
    await prisma.certificateDeployJob.delete({ where: { id: existing.id } });
    await logDeploy(userId, domain, `job:delete:${existing.certificateDeployTarget.name}`, 'SUCCESS');
  }

  static async runJob(userId: number, jobId: number, event: CertificateDeployEvent = 'certificate.issued') {
    const job = await getJobForUser(userId, jobId);
    const run = await prisma.certificateDeployRun.create({
      data: {
        jobId: job.id,
        event,
        triggerMode: 'manual',
        status: 'running',
        scheduledAt: new Date(),
        startedAt: new Date(),
      },
    });
    await this.executeJob(job.id, event, { triggerMode: 'manual', runId: run.id });
    const updated = await getJobForUser(userId, job.id);
    return mapJobRecord(updated);
  }

  private static async executeCreatedJobOnce(jobId: number) {
    const run = await prisma.certificateDeployRun.create({
      data: {
        jobId,
        event: 'certificate.issued',
        triggerMode: 'manual',
        status: 'running',
        scheduledAt: new Date(),
        startedAt: new Date(),
      },
    });

    try {
      await this.executeJob(jobId, 'certificate.issued', { triggerMode: 'manual', runId: run.id });
    } catch (error: any) {
      const message = error?.message || '部署任务执行失败';
      await prisma.certificateDeployRun.updateMany({
        where: { id: run.id, finishedAt: null },
        data: { status: 'failed', finishedAt: new Date(), lastError: message },
      });
      await prisma.certificateDeployJob.updateMany({
        where: { id: jobId },
        data: {
          lastStatus: 'failed',
          lastError: message,
          lastTriggeredAt: new Date(),
        },
      });
    }
  }

  static async triggerJobsForOrder(orderId: number, event: CertificateDeployEvent) {
    await this.enqueueTriggeredJobs({ certificateOrderId: orderId }, event);
  }

  static async triggerJobsForVendorOrder(vendorCertificateOrderId: number, event: CertificateDeployEvent = 'certificate.issued') {
    await this.enqueueTriggeredJobs({ vendorCertificateOrderId }, event);
  }

  private static async enqueueTriggeredJobs(filter: { certificateOrderId?: number; vendorCertificateOrderId?: number }, event: CertificateDeployEvent) {
    const jobs = await prisma.certificateDeployJob.findMany({
      where: {
        ...filter,
        enabled: true,
        certificateDeployTarget: { enabled: true },
        ...(event === 'certificate.issued' ? { triggerOnIssue: true } : { triggerOnRenew: true }),
      },
      select: { id: true },
    });

    for (const job of jobs) {
      await prisma.certificateDeployRun.create({
        data: {
          jobId: job.id,
          event,
          triggerMode: 'auto',
          status: 'pending',
          scheduledAt: new Date(),
        },
      });
    }
  }

  static async processPendingRuns(limit = 20) {
    const runs = await prisma.certificateDeployRun.findMany({
      where: { status: 'pending' },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    for (const run of runs) {
      let job: any;
      try {
        job = await loadJobForExecution(run.jobId);
      } catch (error: any) {
        await prisma.certificateDeployRun.update({
          where: { id: run.id },
          data: { status: 'failed', finishedAt: new Date(), lastError: error?.message || '部署任务不存在' },
        });
        continue;
      }

      let source: any;
      try {
        source = resolveExecutionSource(job);
      } catch (error: any) {
        await prisma.certificateDeployRun.update({
          where: { id: run.id },
          data: { status: 'failed', finishedAt: new Date(), lastError: error?.message || '证书来源不可用' },
        });
        continue;
      }

      if (!job.enabled || !job.certificateDeployTarget.enabled) {
        await prisma.certificateDeployRun.update({
          where: { id: run.id },
          data: { status: 'skipped', finishedAt: new Date(), lastError: '部署任务或目标已禁用' },
        });
        await prisma.certificateDeployJob.update({
          where: { id: job.id },
          data: { lastStatus: 'skipped', lastError: '部署任务或目标已禁用', lastTriggeredAt: new Date() },
        });
        continue;
      }

      if (run.triggerMode === 'auto') {
        const withinWindow = await CertificateSettingsService.isWithinDeployWindow(source.userId);
        if (!withinWindow) {
          continue;
        }
      }

      await prisma.certificateDeployRun.update({
        where: { id: run.id },
        data: { status: 'running', startedAt: new Date(), lastError: null },
      });

      try {
        await this.executeJob(job.id, run.event as CertificateDeployEvent, { triggerMode: run.triggerMode as 'auto' | 'manual', runId: run.id });
      } catch {
        // executeJob already persisted failure state
      }
    }
  }

  static async executeJob(jobId: number, event: CertificateDeployEvent, options?: { triggerMode?: 'auto' | 'manual'; runId?: number }) {
    const job = await loadJobForExecution(jobId);
    const source = resolveExecutionSource(job);
    const target = job.certificateDeployTarget;
    const type = normalizeTargetType(target.type);
    const logName = `${target.name}:${event}`;

    await prisma.certificateDeployJob.update({
      where: { id: job.id },
      data: {
        lastStatus: 'running',
        lastError: null,
        lastTriggeredAt: new Date(),
      },
    });

    try {
      let nextBindingJson: string | null | undefined;
      let deployLogMessage: string | undefined;

      if (!EXECUTABLE_TARGET_TYPES.has(type)) {
        throw new Error('当前部署目标类型正在接入中，执行器尚未完成');
      }

      if (type === 'webhook') {
        const configData = buildStoredConfig(type, undefined, parseStoredConfig(target.configJson, {})) as WebhookConfigStored;
        const payload = buildWebhookPayload(job, event);
        const response = await postWebhook(configData, payload);
        if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
      } else if (type === 'dokploy') {
        const configData = buildStoredConfig(type, undefined, parseStoredConfig(target.configJson, {})) as DokployConfigStored;
        const binding = parseJson<DokployBinding | null>(job.bindingJson, null);
        const certData = buildOrderCertificateData(job);
        const service = new DokployService({
          baseUrl: configData.baseUrl,
          apiKey: decrypt(configData.apiKey),
          serverId: configData.serverId || undefined,
          dynamicRoot: configData.dynamicRoot,
          allowInsecureTls: configData.allowInsecureTls,
          timeoutMs: configData.timeoutMs,
          reloadTraefikAfterPush: configData.reloadTraefikAfterPush,
        });
        const prefix = renderTemplate(binding?.fileNamePrefix || '{primaryDomain}', {
          primaryDomain: source.primaryDomain,
          date: new Date().toISOString().slice(0, 10),
          orderId: String(source.id),
        });
        const result = await service.pushFlatFiles({
          certificatePem: certData.fullchainPem || certData.certificatePem,
          privateKeyPem: certData.privateKeyPem,
          fileNamePrefix: prefix,
        });
        deployLogMessage = formatDokployDeployLogMessage(result);
      } else if (type === 'cloudflare_custom_hostname') {
        const configData = parseStoredConfig<CloudflareCustomHostnameConfigStored>(target.configJson, { dnsCredentialId: 0 });
        const binding = parseJson<CloudflareCustomHostnameBinding | null>(job.bindingJson, null);
        if (!binding) throw new Error('Cloudflare Custom Hostname 绑定信息缺失');
        const { service } = await getCloudflareServiceForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const existing = await service.getCustomHostnameByHostname(binding.zoneId, binding.hostname);
        if (existing?.id) {
          await service.updateCustomHostnameCertificate(binding.zoneId, String(existing.id), {
            certificate: certData.fullchainPem,
            privateKey: certData.privateKeyPem,
          });
        } else {
          if (!binding.createIfMissing) throw new Error('远端 Custom Hostname 不存在，且未开启自动创建');
          await service.createCustomHostnameWithCertificate(binding.zoneId, {
            hostname: binding.hostname,
            certificate: certData.fullchainPem,
            privateKey: certData.privateKeyPem,
            customOriginServer: binding.fallbackOrigin || undefined,
          });
        }
      } else if (type === 'aliyun_esa') {
        const configData = parseStoredConfig<AliyunEsaConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<AliyunEsaBinding | null>(job.bindingJson, null);
        if (!binding) throw new Error('阿里云 ESA 绑定信息缺失');
        const { auth } = await getAliyunAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        await setEsaCertificate(auth, {
          region: binding.region || configData.defaultRegion || undefined,
          siteId: binding.siteId,
          certificate: certData.fullchainPem,
          privateKey: certData.privateKeyPem,
          type: 'upload',
          name: `${source.primaryDomain}-${job.id}`,
        });
      } else if (type === 'aliyun_cdn' || type === 'aliyun_dcdn') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        const domain = normalizeRequiredText(binding?.domain, '绑定域名');
        const { auth } = await getAliyunAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const casCert = await ensureAliyunCasCertificate(auth, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        await aliyunRpcRequest({
          auth,
          endpoint: type === 'aliyun_cdn' ? 'cdn.aliyuncs.com' : 'dcdn.aliyuncs.com',
          action: type === 'aliyun_cdn' ? 'SetCdnDomainSSLCertificate' : 'SetDcdnDomainSSLCertificate',
          version: type === 'aliyun_cdn' ? '2018-05-10' : '2018-01-15',
          params: {
            DomainName: domain,
            CertName: casCert.certificateName,
            CertType: 'cas',
            SSLProtocol: 'on',
            CertId: casCert.certificateId,
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          casCertificateId: casCert.certificateId,
          casCertificateName: casCert.certificateName,
        }));
      } else if (type === 'aliyun_clb') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('阿里云 CLB 绑定信息缺失');
        const regionId = resolveDefaultRegion(configData, 'cn-hangzhou');
        const loadBalancerId = normalizeRequiredText(binding.loadBalancerId, '负载均衡实例 ID');
        const listenerPort = normalizePositiveInt(binding.listenerPort, 'HTTPS 监听端口');
        const { auth } = await getAliyunAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const casCert = await ensureAliyunCasCertificate(auth, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        const serverCertificateId = await ensureAliyunClbServerCertificate({
          auth,
          regionId,
          casCertificateId: casCert.certificateId,
          certificateName: casCert.certificateName,
        });
        await aliyunRpcRequest({
          auth,
          endpoint: `slb.${regionId}.aliyuncs.com`,
          action: 'SetLoadBalancerHTTPSListenerAttribute',
          version: '2014-05-15',
          params: {
            RegionId: regionId,
            LoadBalancerId: loadBalancerId,
            ListenerPort: listenerPort,
            ServerCertificateId: serverCertificateId,
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          casCertificateId: casCert.certificateId,
          serverCertificateId,
        }));
      } else if (type === 'aliyun_alb' || type === 'aliyun_nlb') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        const listenerId = normalizeRequiredText(binding?.listenerId, '监听 ID');
        const regionId = resolveDefaultRegion(configData, 'cn-hangzhou');
        const { auth } = await getAliyunAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const casCert = await ensureAliyunCasCertificate(auth, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        const aliCertRef = normalizeAliyunCertReference(casCert.certificateId);
        await aliyunRpcRequest({
          auth,
          endpoint: `${type === 'aliyun_alb' ? 'alb' : 'nlb'}.${regionId}.aliyuncs.com`,
          action: 'UpdateListenerAttribute',
          version: type === 'aliyun_alb' ? '2020-06-16' : '2022-04-30',
          params: type === 'aliyun_alb'
            ? {
                ListenerId: listenerId,
                'Certificates.1.CertificateId': aliCertRef,
              }
            : {
                ListenerId: listenerId,
                'CertificateIds.1': aliCertRef,
              },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          casCertificateId: casCert.certificateId,
          certificateId: aliCertRef,
        }));
      } else if (type === 'aliyun_oss') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('阿里云 OSS 绑定信息缺失');
        const endpoint = normalizeRequiredText(binding.endpoint, 'Endpoint');
        const bucket = normalizeRequiredText(binding.bucket, 'Bucket');
        const domain = normalizeRequiredText(binding.domain, '自定义域名');
        const { auth } = await getAliyunAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const casCert = await ensureAliyunCasCertificate(auth, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        const certId = normalizeAliyunCertReference(casCert.certificateId);
        const existing = (await aliyunOssRequest({
          auth,
          endpoint,
          bucket,
          path: '/',
          query: { cname: '' },
          method: 'GET',
        }).catch(() => null))?.body;
        const existingEntry = existing
          ? parseAliyunOssCnameEntries(existing).find((item) => item.domain.trim().toLowerCase() === domain.trim().toLowerCase())
          : null;
        const xml = [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<BucketCnameConfiguration>',
          '  <Cname>',
          `    <Domain>${domain}</Domain>`,
          '    <CertificateConfiguration>',
          `      <CertId>${certId}</CertId>`,
          `      <Certificate>${certData.fullchainPem || certData.certificatePem}</Certificate>`,
          `      <PrivateKey>${certData.privateKeyPem}</PrivateKey>`,
          ...(existingEntry?.certId ? [`      <PreviousCertId>${existingEntry.certId}</PreviousCertId>`] : []),
          '      <Force>true</Force>',
          '    </CertificateConfiguration>',
          '  </Cname>',
          '</BucketCnameConfiguration>',
        ].join('\n');
        await aliyunOssRequest({
          auth,
          endpoint,
          bucket,
          path: '/',
          query: { cname: '', comp: 'add' },
          method: 'POST',
          body: xml,
          contentType: 'application/xml',
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          endpoint,
          bucket,
          domain,
          casCertificateId: casCert.certificateId,
          certificateId: certId,
        }));
      } else if (type === 'aliyun_waf') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('阿里云 WAF 绑定信息缺失');
        const regionId = resolveDefaultRegion(configData, 'cn-hangzhou');
        const domain = normalizeRequiredText(binding.domain, '站点域名');
        const { auth } = await getAliyunAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const casCert = await ensureAliyunCasCertificate(auth, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        const certId = normalizeAliyunCertReference(casCert.certificateId);
        const { instanceId, detail } = await describeAliyunWafDomainDetail({
          auth,
          regionId,
          domain,
          instanceId: normalizeString(binding.instanceId) || null,
        });
        const listen = detail?.Listen && typeof detail.Listen === 'object' ? { ...detail.Listen } : null;
        const redirect = detail?.Redirect && typeof detail.Redirect === 'object' ? { ...detail.Redirect } : null;
        if (!listen || !redirect) {
          throw new Error(`阿里云 WAF 未返回域名 ${domain} 的完整监听配置`);
        }
        listen.CertId = certId;
        if (!Array.isArray(listen.HttpsPorts) || !listen.HttpsPorts.length) {
          listen.HttpsPorts = [443];
        }
        if (!normalizeString(listen.TLSVersion)) {
          listen.TLSVersion = 'tlsv1.2';
        }
        if (listen.EnableTLSv3 === undefined) {
          listen.EnableTLSv3 = true;
        }
        if (!Number.isFinite(Number(listen.CipherSuite))) {
          listen.CipherSuite = 2;
        }

        const backendPorts = Array.isArray(redirect.BackendPorts) ? [...redirect.BackendPorts] : [];
        if (backendPorts.length === 1 && String(backendPorts[0]?.Protocol || '').toLowerCase() === 'http') {
          backendPorts.push({
            ListenPort: Array.isArray(listen.HttpsPorts) && listen.HttpsPorts.length ? Number(listen.HttpsPorts[0]) : 443,
            Protocol: 'https',
            BackendPort: backendPorts[0]?.BackendPort,
          });
          redirect.FocusHttpBackend = true;
        }
        if (backendPorts.length) {
          redirect.BackendPorts = backendPorts;
        }
        if (Array.isArray(redirect.AllBackends) && redirect.AllBackends.length) {
          redirect.Backends = redirect.AllBackends;
        }

        await aliyunRpcRequest({
          auth,
          endpoint: `wafopenapi.${regionId}.aliyuncs.com`,
          action: 'ModifyDomain',
          version: '2021-10-01',
          params: {
            InstanceId: instanceId,
            Domain: domain,
            Listen: JSON.stringify(listen),
            Redirect: JSON.stringify(redirect),
            RegionId: regionId,
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          instanceId,
          certificateId: certId,
          casCertificateId: casCert.certificateId,
        }));
      } else if (type === 'aliyun_fc') {
        const configData = parseStoredConfig<AliyunFcConfigStored>(target.configJson, { dnsCredentialId: 0, accountId: '', defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('阿里云函数计算绑定信息缺失');
        const customDomain = normalizeRequiredText(binding.customDomain, '自定义域名');
        const regionId = resolveAliyunFcRegion(configData, binding.regionId);
        const { auth } = await getAliyunAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const certificatePem = certData.fullchainPem || certData.certificatePem;
        const { endpoint, response: current } = await getAliyunFcCustomDomain({
          auth,
          accountId: configData.accountId,
          regionId,
          customDomain,
        });
        const nextPayload = buildAliyunFcUpdatePayload(
          current,
          buildRemoteCertificateName(certificatePem, source.primaryDomain),
          certificatePem,
          certData.privateKeyPem,
        );
        const currentCertificate = normalizeString(current?.certConfig?.certificate);
        const protocolChanged = normalizeString(nextPayload.protocol) !== normalizeString(current?.protocol);
        if (!currentCertificate || currentCertificate.trim() !== certificatePem.trim() || protocolChanged) {
          await updateAliyunFcCustomDomain({
            auth,
            accountId: configData.accountId,
            regionId,
            customDomain,
            body: nextPayload,
          });
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          customDomain,
          regionId,
          endpoint,
        }));
      } else if (type === 'tencent_cdn') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        const domain = normalizeRequiredText(binding?.domain, '绑定域名');
        const { creds } = await getDnspodTc3CredentialsForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const uploaded = await uploadTencentCertificate(creds, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        await tencentCloudRequest({
          creds,
          host: 'ssl.tencentcloudapi.com',
          service: 'ssl',
          action: 'DeployCertificateInstance',
          version: '2019-12-05',
          payload: {
            CertificateId: uploaded.certificateId,
            ResourceType: 'cdn',
            InstanceIdList: [`${domain}|on`],
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          certificateId: uploaded.certificateId,
        }));
      } else if (type === 'tencent_edgeone') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        const zoneId = normalizeRequiredText(binding?.zoneId, '站点 ID');
        const domain = normalizeRequiredText(binding?.domain, '绑定域名');
        const { creds } = await getDnspodTc3CredentialsForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const uploaded = await uploadTencentCertificate(creds, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        await tencentCloudRequest({
          creds,
          host: 'teo.tencentcloudapi.com',
          service: 'teo',
          action: 'ModifyHostsCertificate',
          version: '2022-09-01',
          payload: {
            ZoneId: zoneId,
            Hosts: [domain],
            Mode: 'sslcert',
            ServerCertInfo: [{ CertId: uploaded.certificateId }],
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          certificateId: uploaded.certificateId,
        }));
      } else if (type === 'tencent_clb') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('腾讯云 CLB 绑定信息缺失');
        const loadBalancerId = normalizeRequiredText(binding.loadBalancerId, '负载均衡 ID');
        const listenerId = normalizeRequiredText(binding.listenerId, '监听器 ID');
        const domain = normalizeString(binding.domain) || null;
        const regionId = resolveDefaultRegion(configData, 'ap-guangzhou');
        const { creds } = await getDnspodTc3CredentialsForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const uploaded = await uploadTencentCertificate(creds, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        if (domain) {
          await tencentCloudRequest({
            creds,
            host: 'clb.tencentcloudapi.com',
            service: 'clb',
            action: 'ModifyDomainAttributes',
            version: '2018-03-17',
            region: regionId,
            payload: {
              LoadBalancerId: loadBalancerId,
              ListenerId: listenerId,
              Domain: domain,
              Certificate: {
                SSLMode: 'UNIDIRECTIONAL',
                CertId: uploaded.certificateId,
              },
            },
          });
        } else {
          await tencentCloudRequest({
            creds,
            host: 'clb.tencentcloudapi.com',
            service: 'clb',
            action: 'ModifyListener',
            version: '2018-03-17',
            region: regionId,
            payload: {
              LoadBalancerId: loadBalancerId,
              ListenerId: listenerId,
              Certificate: {
                SSLMode: 'UNIDIRECTIONAL',
                CertId: uploaded.certificateId,
              },
            },
          });
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          certificateId: uploaded.certificateId,
        }));
      } else if (type === 'tencent_cos') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('腾讯云 COS 绑定信息缺失');
        const bucket = normalizeRequiredText(binding.bucket, 'Bucket');
        const regionId = normalizeRequiredText(binding.regionId, 'Region');
        const domains = parseTextareaList(binding.domains);
        if (!domains.length) throw new Error('腾讯云 COS 域名列表不能为空');
        const { creds } = await getDnspodTc3CredentialsForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const uploaded = await uploadTencentCertificate(creds, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        await tencentCloudRequest({
          creds,
          host: 'ssl.tencentcloudapi.com',
          service: 'ssl',
          action: 'DeployCertificateInstance',
          version: '2019-12-05',
          region: regionId,
          payload: {
            CertificateId: uploaded.certificateId,
            ResourceType: 'cos',
            InstanceIdList: domains.map((domain) => `${regionId}|${bucket}|${domain}`),
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          bucket,
          regionId,
          domains: domains.join('\n'),
          certificateId: uploaded.certificateId,
        }));
      } else if (type === 'tencent_tke') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('腾讯云 TKE 绑定信息缺失');
        const clusterId = normalizeRequiredText(binding.clusterId, '集群 ID');
        const namespace = normalizeRequiredText(binding.namespace, '命名空间');
        const secretName = normalizeRequiredText(binding.secretName, 'Secret 名称');
        const regionId = resolveDefaultRegion(configData, 'ap-guangzhou');
        const { creds } = await getDnspodTc3CredentialsForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const uploaded = await uploadTencentCertificate(creds, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        await tencentCloudRequest({
          creds,
          host: 'ssl.tencentcloudapi.com',
          service: 'ssl',
          action: 'DeployCertificateInstance',
          version: '2019-12-05',
          region: regionId,
          payload: {
            CertificateId: uploaded.certificateId,
            ResourceType: 'tke',
            InstanceIdList: [`${clusterId}|${namespace}|${secretName}`],
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          clusterId,
          namespace,
          secretName,
          regionId,
          certificateId: uploaded.certificateId,
        }));
      } else if (type === 'tencent_scf') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('腾讯云 SCF 绑定信息缺失');
        const regionId = normalizeRequiredText(binding.regionId || configData.defaultRegion, 'Region');
        const customDomain = normalizeRequiredText(binding.customDomain, '自定义域名');
        const { creds } = await getDnspodTc3CredentialsForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const uploaded = await uploadTencentCertificate(creds, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        const current = await tencentCloudRequest<any>({
          creds,
          host: 'scf.tencentcloudapi.com',
          service: 'scf',
          action: 'GetCustomDomain',
          version: '2018-04-16',
          region: regionId,
          payload: { Domain: customDomain },
        });
        const currentCertificateId = normalizeString(current?.CertConfig?.CertificateId) || '';
        const currentProtocol = normalizeString(current?.Protocol).toUpperCase();
        const nextProtocol = currentProtocol === 'HTTP' ? 'HTTP&HTTPS' : (currentProtocol || 'HTTP&HTTPS');
        if (currentCertificateId !== uploaded.certificateId || nextProtocol !== currentProtocol) {
          await tencentCloudRequest({
            creds,
            host: 'scf.tencentcloudapi.com',
            service: 'scf',
            action: 'UpdateCustomDomain',
            version: '2018-04-16',
            region: regionId,
            payload: {
              Domain: customDomain,
              Protocol: nextProtocol,
              CertConfig: {
                ...(current?.CertConfig && typeof current.CertConfig === 'object' ? current.CertConfig : {}),
                CertificateId: uploaded.certificateId,
              },
            },
          });
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          regionId,
          customDomain,
          certificateId: uploaded.certificateId,
        }));
      } else if (type === 'huawei_cdn') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        const domain = normalizeRequiredText(binding?.domain, '绑定域名');
        const { creds } = await getHuaweiAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        await huaweiCloudRequest({
          creds,
          host: 'cdn.myhuaweicloud.com',
          path: `/v1.1/cdn/configuration/domains/${domain}/configs`,
          method: 'PUT',
          body: {
            configs: {
              https: {
                https_status: 'on',
                certificate_type: 'server',
                certificate_source: 0,
                certificate_name: buildRemoteCertificateName(certData.fullchainPem || certData.certificatePem, source.primaryDomain),
                certificate_value: certData.fullchainPem || certData.certificatePem,
                private_key: certData.privateKeyPem,
              },
            },
          },
        });
      } else if (type === 'huawei_elb') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null, defaultProjectId: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('华为云 ELB 绑定信息缺失');
        const regionId = normalizeRequiredText(configData.defaultRegion, '默认 Region');
        const projectId = normalizeRequiredText(configData.defaultProjectId, '默认项目 ID');
        const listenerId = normalizeRequiredText(binding.listenerId, '监听器 ID');
        const { creds } = await getHuaweiAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const certificateId = await ensureHuaweiElbCertificate({
          creds,
          projectId,
          regionId,
          certificateId: normalizeString(binding.certificateId) || null,
          certificateName: buildRemoteCertificateName(certData.fullchainPem || certData.certificatePem, source.primaryDomain),
          domains: source.domains,
          fullchainPem: certData.fullchainPem || certData.certificatePem,
          privateKeyPem: certData.privateKeyPem,
        });
        await huaweiCloudRequest({
          creds,
          host: `elb.${regionId}.myhuaweicloud.com`,
          path: `/v3/${projectId}/elb/listeners/${listenerId}`,
          method: 'PUT',
          body: {
            listener: {
              default_tls_container_ref: certificateId,
            },
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, { certificateId }));
      } else if (type === 'huawei_waf') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null, defaultProjectId: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('华为云 WAF 绑定信息缺失');
        const regionId = normalizeRequiredText(configData.defaultRegion, '默认 Region');
        const projectId = normalizeRequiredText(configData.defaultProjectId, '默认项目 ID');
        const domain = normalizeRequiredText(binding.domain, '站点域名');
        const { creds } = await getHuaweiAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const hostIds = await findHuaweiWafHostIds({
          creds,
          projectId,
          regionId,
          domain,
        });
        if (!hostIds.cloudHostIds.length && !hostIds.premiumHostIds.length) {
          throw new Error(`华为云 WAF 未找到域名 ${domain} 的可绑定站点`);
        }
        const certificateId = await ensureHuaweiWafCertificate({
          creds,
          projectId,
          regionId,
          domain,
          certificateId: normalizeString(binding.certificateId) || null,
          certificateName: buildRemoteCertificateName(certData.fullchainPem || certData.certificatePem, source.primaryDomain),
          fullchainPem: certData.fullchainPem || certData.certificatePem,
          privateKeyPem: certData.privateKeyPem,
        });
        await huaweiCloudRequest({
          creds,
          host: `waf.${regionId}.myhuaweicloud.com`,
          path: `/v1/${projectId}/waf/certificate/${certificateId}/apply-to-hosts`,
          method: 'POST',
          body: {
            ...(hostIds.cloudHostIds.length ? { cloud_host_ids: hostIds.cloudHostIds } : {}),
            ...(hostIds.premiumHostIds.length ? { premium_host_ids: hostIds.premiumHostIds } : {}),
          },
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, { certificateId }));
      } else if (type === 'ucloud_cdn') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('UCloud CDN 绑定信息缺失');
        const domainId = normalizeRequiredText(binding.domainId, '云分发资源 ID');
        const { auth } = await getUcloudAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const certificateName = buildRemoteCertificateName(certData.fullchainPem || certData.certificatePem, source.primaryDomain);
        const listedDomains = await listUcloudCdnDomains({
          auth,
          domainId,
          offset: 0,
          limit: 1,
        });
        const domain = extractUcloudCdnDomains(listedDomains)[0];
        if (!domain) throw new Error(`UCloud CDN 未找到资源 ${domainId}`);
        try {
          await ucloudRequest({
            auth,
            action: 'AddCertificate',
            params: {
              ...buildUcloudProjectParams(auth),
              CertName: certificateName,
              UserCert: certData.fullchainPem || certData.certificatePem,
              PrivateKey: certData.privateKeyPem,
            },
          });
        } catch (error: any) {
          if (!/already exist/i.test(String(error?.message || ''))) throw error;
        }
        let certificateList = await listUcloudCertificates({
          auth,
          domain: normalizeString(domain?.Domain) || null,
          limit: 100,
        });
        let certificates = Array.isArray(certificateList?.CertList) ? certificateList.CertList : [];
        let matchedCertificate = certificates.find((item: any) => String(item?.CertName || '') === certificateName)
          || certificates.find((item: any) => String(item?.CommonName || '') === source.primaryDomain)
          || null;
        if (!matchedCertificate) {
          certificateList = await listUcloudCertificates({ auth, limit: 100 });
          certificates = Array.isArray(certificateList?.CertList) ? certificateList.CertList : [];
          matchedCertificate = certificates.find((item: any) => String(item?.CertName || '') === certificateName)
            || certificates.find((item: any) => String(item?.CommonName || '') === source.primaryDomain)
            || null;
        }
        const certificateId = String(
          matchedCertificate?.CertId
          || matchedCertificate?.CertificateId
          || matchedCertificate?.Id
          || ''
        );
        if (!certificateId) throw new Error('UCloud CDN 证书查询失败：未返回证书 ID');
        if (String(domain?.CertNameCn || '') !== certificateName || String(domain?.CertNameAbroad || '') !== certificateName) {
          await ucloudRequest({
            auth,
            action: 'UpdateUcdnDomainHttpsConfigV2',
            params: {
              ...buildUcloudProjectParams(auth),
              DomainId: domainId,
              CertName: certificateName,
              CertId: certificateId,
              CertType: 'ucdn',
              ...(String(domain?.HttpsStatusCn || '') === 'enable'
                ? { HttpsStatusCn: String(domain.HttpsStatusCn) }
                : {}),
              ...(String(domain?.HttpsStatusAbroad || '') === 'enable'
                ? { HttpsStatusAbroad: String(domain.HttpsStatusAbroad) }
                : {}),
              ...(
                String(domain?.HttpsStatusCn || '') !== 'enable'
                && String(domain?.HttpsStatusAbroad || '') !== 'enable'
                  ? { HttpsStatusCn: 'enable' }
                  : {}
              ),
            },
          });
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          domainId,
          domain: normalizeString(domain?.Domain) || null,
          certificateId,
          certificateName,
        }));
      } else if (type === 'qiniu_cdn') {
        const configData = parseStoredConfig<AccessKeySecretConfigStored>(target.configJson, { accessKey: '', secretKey: '' });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('七牛 CDN 绑定信息缺失');
        const domains = parseTextareaList(binding.domains);
        if (!domains.length) throw new Error('七牛 CDN 域名列表不能为空');
        const accessKey = configData.accessKey;
        const secretKey = decryptIfPresent(configData.secretKey);
        const certData = buildOrderCertificateData(job);
        const certificate = await ensureQiniuCertificate(accessKey, secretKey, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        for (const domain of domains) {
          const detail = await qiniuRequest<any>({
            accessKey,
            secretKey,
            path: `/domain/${domain}`,
            method: 'GET',
          });
          const https = detail?.https && typeof detail.https === 'object' ? detail.https : {};
          const currentCertId = String(https?.certId || https?.certid || '');
          if (currentCertId === certificate.certificateId) continue;
          if (currentCertId) {
            await qiniuRequest({
              accessKey,
              secretKey,
              path: `/domain/${domain}/httpsconf`,
              method: 'PUT',
              body: {
                certId: certificate.certificateId,
                forceHttps: !!https?.forceHttps,
                http2Enable: !!https?.http2Enable,
                ...(Array.isArray(https?.tlsversions) && https.tlsversions.length ? { tlsversions: https.tlsversions } : {}),
              },
            });
          } else {
            await qiniuRequest({
              accessKey,
              secretKey,
              path: `/domain/${domain}/sslize`,
              method: 'PUT',
              body: {
                certid: certificate.certificateId,
                forceHttps: !!https?.forceHttps,
                http2Enable: !!https?.http2Enable,
                ...(Array.isArray(https?.tlsversions) && https.tlsversions.length ? { tlsversions: https.tlsversions } : {}),
              },
            });
          }
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          domains: domains.join('\n'),
          certificateId: certificate.certificateId,
          certificateName: certificate.certificateName,
        }));
      } else if (type === 'qiniu_oss') {
        const configData = parseStoredConfig<AccessKeySecretConfigStored>(target.configJson, { accessKey: '', secretKey: '' });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('七牛 OSS 绑定信息缺失');
        const domains = parseTextareaList(binding.domains);
        if (!domains.length) throw new Error('七牛 OSS 域名列表不能为空');
        const accessKey = configData.accessKey;
        const secretKey = decryptIfPresent(configData.secretKey);
        const certData = buildOrderCertificateData(job);
        const certificate = await ensureQiniuCertificate(accessKey, secretKey, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        for (const domain of domains) {
          await qiniuRequest({
            accessKey,
            secretKey,
            path: '/cert/bind',
            method: 'POST',
            body: {
              certid: certificate.certificateId,
              domain,
            },
          });
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          domains: domains.join('\n'),
          certificateId: certificate.certificateId,
          certificateName: certificate.certificateName,
        }));
      } else if (type === 'baidu_cdn') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('百度云 CDN 绑定信息缺失');
        const domains = parseTextareaList(binding.domains);
        if (!domains.length) throw new Error('百度云 CDN 域名列表不能为空');
        const { creds } = await getBaiduAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const certificateName = buildRemoteCertificateName(certData.fullchainPem || certData.certificatePem, source.primaryDomain);
        let lastCertificateId = '';
        for (const domain of domains) {
          const current = await baiduCloudRequest<any>({
            creds,
            host: 'cdn.baidubce.com',
            path: `/v2/${domain}/certificates`,
            method: 'GET',
          }).catch(() => ({}));
          if (String(current?.certName || '') === certificateName && current?.certId) {
            lastCertificateId = String(current.certId);
            continue;
          }
          const updated = await baiduCloudRequest<any>({
            creds,
            host: 'cdn.baidubce.com',
            path: `/v2/${domain}/certificates`,
            method: 'PUT',
            body: {
              httpsEnable: 'ON',
              certificate: {
                certName: certificateName,
                certServerData: certData.fullchainPem || certData.certificatePem,
                certPrivateData: certData.privateKeyPem,
              },
            },
          });
          lastCertificateId = String(updated?.certId || current?.certId || lastCertificateId || '');
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          domains: domains.join('\n'),
          certificateId: lastCertificateId || null,
          certificateName,
        }));
      } else if (type === 'volcengine_cdn') {
        const configData = parseStoredConfig<DnsCredentialDeployConfigStored>(target.configJson, { dnsCredentialId: 0, defaultRegion: null });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('火山引擎 CDN 绑定信息缺失');
        const domains = parseTextareaList(binding.domains);
        if (!domains.length) throw new Error('火山引擎 CDN 域名列表不能为空');
        const { creds } = await getVolcengineAuthForUser(source.userId, configData.dnsCredentialId);
        const certData = buildOrderCertificateData(job);
        const certificate = await ensureVolcengineCertificate({
          creds,
          fullchainPem: certData.fullchainPem || certData.certificatePem,
          privateKeyPem: certData.privateKeyPem,
          fallbackPrimaryDomain: source.primaryDomain,
        });
        const response = await volcengineRequest<any>({
          creds,
          host: 'cdn.volcengineapi.com',
          service: 'cdn',
          version: '2021-03-01',
          region: resolveDefaultRegion(configData, 'cn-north-1'),
          action: 'BatchDeployCert',
          body: {
            CertId: certificate.certificateId,
            Domain: domains.join(','),
          },
        });
        const deployResults = Array.isArray(response?.DeployResult) ? response.DeployResult : [];
        if (!deployResults.length) {
          throw new Error('火山引擎 CDN 证书部署失败：未返回部署结果');
        }
        const failed = deployResults.filter((item: any) => String(item?.Status || '').toLowerCase() !== 'success');
        if (failed.length) {
          throw new Error(`火山引擎 CDN 证书部署失败：${failed.map((item: any) => `${item?.Domain || 'unknown'} ${item?.ErrorMsg || '未知错误'}`).join('; ')}`);
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          domains: domains.join('\n'),
          certificateId: certificate.certificateId,
          certificateName: certificate.certificateName,
        }));
      } else if (type === 'dogecloud_cdn') {
        const configData = parseStoredConfig<AccessKeySecretConfigStored>(target.configJson, { accessKey: '', secretKey: '' });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('DogeCloud CDN 绑定信息缺失');
        const domains = parseTextareaList(binding.domains);
        if (!domains.length) throw new Error('DogeCloud CDN 域名列表不能为空');
        const accessKey = configData.accessKey;
        const secretKey = decryptIfPresent(configData.secretKey);
        const certData = buildOrderCertificateData(job);
        const certificate = await ensureDogeCloudCertificate(accessKey, secretKey, certData.fullchainPem || certData.certificatePem, certData.privateKeyPem);
        for (const domain of domains) {
          await dogeCloudRequest({
            accessKey,
            secretKey,
            path: '/cdn/cert/bind.json',
            method: 'POST',
            body: {
              id: certificate.certificateId,
              domain,
            },
          });
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          domains: domains.join('\n'),
          certificateId: certificate.certificateId,
          certificateName: certificate.certificateName,
        }));
      } else if (type === 'aws_cloudfront') {
        const configData = parseStoredConfig<AwsCloudfrontConfigStored>(target.configJson, { accessKeyId: '', secretAccessKey: '' });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('AWS CloudFront 绑定信息缺失');
        const distributionId = normalizeRequiredText(binding.distributionId, 'Distribution ID');
        const certData = buildOrderCertificateData(job);
        const certificateArn = await ensureAwsAcmCertificate({
          config: configData,
          certificateArn: normalizeString(binding.acmCertificateArn) || null,
          certificatePem: certData.certificatePem,
          fullchainPem: certData.fullchainPem || certData.certificatePem,
          privateKeyPem: certData.privateKeyPem,
        });
        await bindAwsCloudFrontCertificate({
          config: configData,
          distributionId,
          certificateArn,
        });
        nextBindingJson = JSON.stringify(mergeBinding(binding, { acmCertificateArn: certificateArn }));
      } else if (type === 'gcore') {
        const configData = parseStoredConfig<ApiTokenConfigStored>(target.configJson, { apiToken: '' });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        if (!binding) throw new Error('Gcore 绑定信息缺失');
        const certificateName = normalizeRequiredText(binding.certificateName, '证书名称');
        const certData = buildOrderCertificateData(job);
        const apiToken = decryptIfPresent(configData.apiToken);
        const payload = {
          name: certificateName,
          sslCertificate: certData.fullchainPem || certData.certificatePem,
          sslPrivateKey: certData.privateKeyPem,
          validate_root_ca: true,
        };
        let certificateId = normalizeString(binding.certificateId) || null;
        if (certificateId) {
          try {
            await gcoreRequest({
              apiToken,
              path: `/cdn/sslData/${encodeURIComponent(certificateId)}`,
              method: 'PUT',
              body: payload,
            });
          } catch (error: any) {
            if (!/not[\s-]?found|404/i.test(String(error?.message || ''))) throw error;
            certificateId = null;
          }
        }
        if (!certificateId) {
          const created = await gcoreRequest<any>({
            apiToken,
            path: '/cdn/sslData',
            method: 'POST',
            body: payload,
          });
          certificateId = String(created?.id || '');
          if (!certificateId) throw new Error('Gcore 证书创建失败：未返回证书 ID');
        }
        nextBindingJson = JSON.stringify(mergeBinding(binding, {
          certificateId,
          certificateName,
        }));
      } else if (type === 'cachefly') {
        const configData = parseStoredConfig<ApiTokenConfigStored>(target.configJson, { apiToken: '' });
        const certData = buildOrderCertificateData(job);
        await cacheflyRequest({
          apiToken: decryptIfPresent(configData.apiToken),
          path: '/certificates',
          method: 'POST',
          body: {
            certificate: certData.fullchainPem || certData.certificatePem,
            certificateKey: certData.privateKeyPem,
          },
        });
        nextBindingJson = null;
      } else if (type === 'allwaf') {
        const configData = parseStoredConfig<BaseUrlApiKeyConfigStored>(target.configJson, { baseUrl: '', apiKey: '' });
        const binding = parseJson<Record<string, any> | null>(job.bindingJson, null);
        const baseUrl = normalizeBaseUrl(configData.baseUrl, '控制台地址');
        const apiKey = decryptIfPresent(configData.apiKey);
        const certData = buildOrderCertificateData(job);
        const siteNames = parseTextareaList(binding?.domain);
        const siteIds = parseTextareaList(binding?.siteId);
        if (!siteNames.length && !siteIds.length) {
          await btwafRequest({
            baseUrl,
            apiKey,
            path: '/api/config/set_cert',
            body: {
              certContent: certData.fullchainPem || certData.certificatePem,
              keyContent: certData.privateKeyPem,
            },
          });
          nextBindingJson = null;
        } else {
          const succeeded: Array<{ siteId: string; siteName: string }> = [];
          let lastError: Error | null = null;
          const siteRefs = [
            ...siteIds.map(siteId => ({ siteId, siteName: null as string | null })),
            ...siteNames.map(siteName => ({ siteId: null as string | null, siteName })),
          ];
          for (const siteRef of siteRefs) {
            try {
              const site = await resolveBtWafSite({
                baseUrl,
                apiKey,
                siteId: siteRef.siteId,
                siteName: siteRef.siteName,
              });
              await btwafRequest({
                baseUrl,
                apiKey,
                path: '/api/wafmastersite/modify_site',
                body: {
                  types: 'openCert',
                  site_id: site.siteId,
                  server: {
                    listen_ssl_port: site.listenSslPort,
                    ssl: {
                      is_ssl: 1,
                      private_key: certData.privateKeyPem,
                      full_chain: certData.fullchainPem || certData.certificatePem,
                    },
                  },
                },
              });
              succeeded.push({ siteId: site.siteId, siteName: site.siteName });
            } catch (error: any) {
              lastError = error instanceof Error ? error : new Error(String(error?.message || error || '堡塔云WAF部署失败'));
            }
          }
          if (!succeeded.length) {
            throw lastError || new Error('堡塔云WAF部署失败');
          }
          nextBindingJson = JSON.stringify(mergeBinding(binding, {
            siteId: succeeded.map(item => item.siteId).join('\n'),
            domain: succeeded.map(item => item.siteName).join('\n'),
          }));
        }
      } else if (type === 'onepanel') {
        const configData = parseStoredConfig<OnePanelConfigStored>(target.configJson, { baseUrl: '', apiKey: '', allowInsecureTls: false, timeoutMs: 8000 });
        const binding = parseJson<OnePanelBinding | null>(job.bindingJson, null);
        if (!binding) throw new Error('1Panel 绑定信息缺失');
        const service = new OnePanelService({
          baseUrl: configData.baseUrl,
          apiKey: decryptIfPresent(configData.apiKey),
          allowInsecureTls: configData.allowInsecureTls,
          timeoutMs: configData.timeoutMs,
        });
        const certData = buildOrderCertificateData(job);
        const name = renderTemplate(binding.certificateNameTemplate, {
          primaryDomain: source.primaryDomain,
          date: new Date().toISOString().slice(0, 10),
          orderId: String(source.id),
        });
        await service.uploadCertificate({
          certificate: certData.fullchainPem,
          privateKey: certData.privateKeyPem,
          description: name,
        });
        const certificates = await service.searchUploadedCertificate(source.primaryDomain);
        const matched = certificates.find((item) => item.description === name) || certificates[0];
        if (!matched?.id) throw new Error('1Panel 未找到刚上传的证书');
        await service.bindWebsiteCertificate(binding.websiteId, matched.id);
      } else if (type === 'ssh_server') {
        const configData = parseStoredConfig<SshServerConfigStored>(target.configJson, {
          host: '',
          port: 22,
          username: '',
          authMode: 'password',
          password: null,
          privateKey: null,
          passphrase: null,
          os: 'linux',
          timeoutMs: 10000,
          allowInsecureHostKey: false,
        });
        const binding = parseJson<SshServerBinding | null>(job.bindingJson, null);
        if (!binding) throw new Error('SSH Server 绑定信息缺失');
        const certData = buildOrderCertificateData(job);
        const transportConfig = {
          host: configData.host,
          port: configData.port,
          username: configData.username,
          authMode: configData.authMode,
          password: decryptIfPresent(configData.password),
          privateKey: decryptIfPresent(configData.privateKey),
          passphrase: decryptIfPresent(configData.passphrase),
          timeoutMs: configData.timeoutMs,
          allowInsecureHostKey: configData.allowInsecureHostKey,
        } as const;
        if (binding.format === 'pfx') {
          await deployPfxViaSsh(transportConfig, {
            pfxFilePath: binding.pfxFilePath || '',
            pfxPassword: binding.pfxPassword || null,
            postCommand: binding.postCommand || null,
          }, certData);
        } else {
          await deployPemViaSsh(transportConfig, {
            certificateFilePath: binding.certificateFilePath || '',
            privateKeyFilePath: binding.privateKeyFilePath || '',
            postCommand: binding.postCommand || null,
          }, certData);
        }
      } else if (type === 'ftp_server') {
        const configData = parseStoredConfig<FtpServerConfigStored>(target.configJson, {
          host: '',
          port: 21,
          username: '',
          password: '',
          secure: false,
          timeoutMs: 10000,
          allowInsecureTls: false,
        });
        const binding = parseJson<FtpServerBinding | null>(job.bindingJson, null);
        if (!binding) throw new Error('FTP Server 绑定信息缺失');
        const certData = buildOrderCertificateData(job);
        await deployViaFtp({
          host: configData.host,
          port: configData.port,
          username: configData.username,
          password: decryptIfPresent(configData.password),
          secure: configData.secure,
          timeoutMs: configData.timeoutMs,
          allowInsecureTls: configData.allowInsecureTls,
        }, {
          format: binding.format,
          certificateFilePath: binding.certificateFilePath || null,
          privateKeyFilePath: binding.privateKeyFilePath || null,
          pfxFilePath: binding.pfxFilePath || null,
          pfxPassword: binding.pfxPassword || null,
        }, certData);
      } else if (type === 'iis') {
        const configData = parseStoredConfig<SshServerConfigStored>(target.configJson, {
          host: '',
          port: 22,
          username: '',
          authMode: 'password',
          password: null,
          privateKey: null,
          passphrase: null,
          os: 'windows',
          timeoutMs: 10000,
          allowInsecureHostKey: false,
        });
        const binding = parseJson<IisBinding | null>(job.bindingJson, null);
        if (!binding) throw new Error('IIS 绑定信息缺失');
        const certData = buildOrderCertificateData(job);
        await deployIisViaSsh({
          host: configData.host,
          port: configData.port,
          username: configData.username,
          authMode: configData.authMode,
          password: decryptIfPresent(configData.password),
          privateKey: decryptIfPresent(configData.privateKey),
          passphrase: decryptIfPresent(configData.passphrase),
          timeoutMs: configData.timeoutMs,
          allowInsecureHostKey: configData.allowInsecureHostKey,
        }, {
          siteName: binding.siteName,
          bindingHost: binding.bindingHost || null,
          port: binding.port,
          pfxPath: binding.pfxPath,
          pfxPassword: binding.pfxPassword || null,
          certStore: binding.certStore || 'My',
        }, certData);
      } else if (type === 'local_directory') {
        const binding = parseJson<LocalDirectoryBinding | null>(job.bindingJson, null);
        if (!binding) throw new Error('本地目录绑定信息缺失');
        const certData = buildOrderCertificateData(job);
        const certDir = path.dirname(binding.certificateFilePath);
        const keyDir = path.dirname(binding.privateKeyFilePath);
        await fs.access(certDir, fsConstants.W_OK);
        await fs.access(keyDir, fsConstants.W_OK);
        await fs.writeFile(binding.certificateFilePath, certData.fullchainPem || certData.certificatePem, 'utf8');
        await fs.writeFile(binding.privateKeyFilePath, certData.privateKeyPem, 'utf8');

        const commands = String(binding.postCommand || '')
          .split(/\r?\n/g)
          .map((item) => item.trim())
          .filter(Boolean);

        for (const command of commands) {
          await execAsync(command, {
            timeout: 120000,
            shell: '/bin/bash',
            maxBuffer: 1024 * 1024,
          });
        }
      } else {
        const configData = parseStoredConfig<NginxProxyManagerConfigStored>(target.configJson, { baseUrl: '', username: '', password: '', allowInsecureTls: false, timeoutMs: 8000 });
        const binding = parseJson<NginxProxyManagerBinding | null>(job.bindingJson, null);
        if (!binding) throw new Error('Nginx Proxy Manager 绑定信息缺失');
        const service = new NginxProxyManagerService({
          baseUrl: configData.baseUrl,
          username: configData.username,
          password: decryptIfPresent(configData.password),
          allowInsecureTls: configData.allowInsecureTls,
          timeoutMs: configData.timeoutMs,
        });
        const certData = buildOrderCertificateData(job);
        const niceName = renderTemplate(binding.certificateNameTemplate, {
          primaryDomain: source.primaryDomain,
          date: new Date().toISOString().slice(0, 10),
          orderId: String(source.id),
        });
        const certId = await service.createCustomCertificate(niceName);
        await service.uploadCustomCertificate(certId, {
          certificate: certData.certificatePem,
          certificateKey: certData.privateKeyPem,
          intermediateCertificate: extractIntermediateCertificate(certData.fullchainPem, certData.certificatePem) || undefined,
        });
        await service.updateProxyHostCertificate(binding.proxyHostId, certId);
      }

      await prisma.certificateDeployJob.update({
        where: { id: job.id },
        data: {
          ...(nextBindingJson !== undefined ? { bindingJson: nextBindingJson } : {}),
          lastStatus: 'success',
          lastError: null,
          lastSucceededAt: new Date(),
          lastTriggeredAt: new Date(),
        },
      });
      if (options?.runId) {
        await prisma.certificateDeployRun.update({
          where: { id: options.runId },
          data: { status: 'success', finishedAt: new Date(), lastError: null },
        });
      }
      await logDeploy(source.userId, source.primaryDomain, logName, 'SUCCESS', deployLogMessage);
      await CertificateNotificationService.notifyDeploymentResult(source.userId, {
        primaryDomain: source.primaryDomain,
        targetName: target.name,
        targetType: type,
        event,
        success: true,
        triggerMode: options?.triggerMode || null,
        sourceType: source.kind,
      }).catch(() => undefined);
    } catch (error: any) {
      const message = error?.message || '证书部署失败';
      await prisma.certificateDeployJob.update({
        where: { id: job.id },
        data: {
          lastStatus: 'failed',
          lastError: message,
          lastTriggeredAt: new Date(),
        },
      });
      if (options?.runId) {
        await prisma.certificateDeployRun.update({
          where: { id: options.runId },
          data: { status: 'failed', finishedAt: new Date(), lastError: message },
        });
      }
      await logDeploy(source.userId, source.primaryDomain, logName, 'FAILED', message);
      await CertificateNotificationService.notifyDeploymentResult(source.userId, {
        primaryDomain: source.primaryDomain,
        targetName: target.name,
        targetType: type,
        event,
        success: false,
        triggerMode: options?.triggerMode || null,
        sourceType: source.kind,
        error: message,
      }).catch(() => undefined);
      throw error;
    }
  }
}
