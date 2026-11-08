import type { Bucket, BucketObject, AccessKey } from '@/types';
import { ago, tags, scope, DAY, HOUR, MIN } from './util';

const GB = 1024 ** 3;

export function seedStorage() {
  const buckets: Bucket[] = [
    { id: 'bkt-001', name: 'app1-assets', ...scope('proj-app1'), locationId: 'dc1', storageClass: 'STANDARD', versioning: true, objectLock: false, encryption: 'SSE', access: 'public-read', status: 'active',
      bytesUsed: 38 * GB, objectCount: 18_420, requestsLast30d: 41_800_000, egressGBLast30d: 620, lifecycleRules: [{ id: 'lc-1', prefix: 'tmp/', action: 'expire', days: 7, enabled: true }],
      cors: [{ id: 'cors-1', origins: ['https://example.com', 'https://www.example.com'], methods: ['GET', 'HEAD'], maxAgeSec: 3600 }],
      endpoint: 'https://s3.dc1.autark.cloud/app1-assets', quotaGB: 100, createdAt: ago(300 * DAY), tags: tags({ env: 'prod', app: 'web' }) },
    { id: 'bkt-005', name: 'app1-backups', ...scope('proj-app1'), locationId: 'dc2', storageClass: 'INFREQUENT', versioning: true, objectLock: true, objectLockRetentionDays: 30, objectLockMode: 'compliance', encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 412 * GB, objectCount: 2_210, requestsLast30d: 90_000, egressGBLast30d: 3, lifecycleRules: [{ id: 'lc-2', prefix: '', action: 'transition', days: 30, toClass: 'ARCHIVE', enabled: true }, { id: 'lc-3', prefix: '', action: 'expire', days: 365, enabled: true }],
      cors: [], endpoint: 'https://s3.dc2.autark.cloud/app1-backups', quotaGB: null, createdAt: ago(290 * DAY), tags: tags({ env: 'prod' }) },
    { id: 'bkt-003', name: 'app2-logs', ...scope('proj-app2'), locationId: 'dc2', storageClass: 'STANDARD', versioning: false, objectLock: false, encryption: 'SSE', access: 'private', status: 'active',
      bytesUsed: 96 * GB, objectCount: 1_204_330, requestsLast30d: 12_400_000, egressGBLast30d: 18, lifecycleRules: [{ id: 'lc-4', prefix: 'raw/', action: 'expire', days: 30, enabled: true }, { id: 'lc-5', prefix: 'aggregated/', action: 'transition', days: 14, toClass: 'INFREQUENT', enabled: true }],
      cors: [], endpoint: 'https://s3.dc2.autark.cloud/app2-logs', quotaGB: 500, createdAt: ago(250 * DAY), tags: tags({ env: 'staging' }) },
    { id: 'bkt-002', name: 'ml-artifacts', ...scope('proj-ml'), locationId: 'dc1', storageClass: 'STANDARD', versioning: true, objectLock: false, encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 1840 * GB, objectCount: 64_100, requestsLast30d: 3_100_000, egressGBLast30d: 210, lifecycleRules: [{ id: 'lc-6', prefix: 'checkpoints/', action: 'transition', days: 60, toClass: 'INFREQUENT', enabled: true }],
      cors: [], endpoint: 'https://s3.dc1.autark.cloud/ml-artifacts', quotaGB: 5000, createdAt: ago(180 * DAY), tags: tags({ team: 'ml' }) },
    { id: 'bkt-004', name: 'infra-terraform-state', ...scope('proj-infra'), locationId: 'dc2', storageClass: 'STANDARD', versioning: true, objectLock: true, objectLockRetentionDays: 7, objectLockMode: 'governance', encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 0.2 * GB, objectCount: 148, requestsLast30d: 220_000, egressGBLast30d: 1, lifecycleRules: [], cors: [], endpoint: 'https://s3.dc2.autark.cloud/infra-terraform-state', quotaGB: 10, createdAt: ago(360 * DAY), tags: [] },
  ];

  let n = 0;
  const CLASS: Record<string, BucketObject['storageClass']> = { 'bkt-005': 'INFREQUENT' };
  const LOCK_DAYS: Record<string, number> = { 'bkt-005': 30, 'bkt-004': 7 };
  const o = (bucketId: string, project: string, key: string, sizeBytes: number, contentType: string, minutesAgo: number, content?: string): BucketObject => ({
    id: `obj-${String(++n).padStart(4, '0')}`, bucketId, ...scope(project), key, name: key, sizeBytes, contentType, storageClass: CLASS[bucketId] ?? 'STANDARD',
    versions: ['bkt-001', 'bkt-002', 'bkt-004', 'bkt-005'].includes(bucketId) ? 1 + (n % 3) : 1,
    retainUntil: LOCK_DAYS[bucketId] ? new Date(Date.now() - minutesAgo * MIN + LOCK_DAYS[bucketId] * DAY).toISOString() : null,
    etag: `"${(n * 2654435761 >>> 0).toString(16).padStart(8, '0')}${(n * 40503 >>> 0).toString(16)}"`, lastModified: ago(minutesAgo * MIN), createdAt: ago(minutesAgo * MIN), content, tags: [],
  });

  const bucketObjects: BucketObject[] = [
    o('bkt-001', 'proj-app1', 'index.html', 2_314, 'text/html', 90, '<!doctype html>\n<html>\n  <head><title>Example Shop</title></head>\n  <body><h1>Welcome to Example Shop</h1></body>\n</html>\n'),
    o('bkt-001', 'proj-app1', 'robots.txt', 64, 'text/plain', 4000, 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n'),
    o('bkt-001', 'proj-app1', 'favicon.ico', 15_086, 'image/x-icon', 40_000),
    o('bkt-001', 'proj-app1', 'css/app.4f2a91.css', 48_220, 'text/css', 90, ':root{--brand:#5b67f8}\nbody{font-family:system-ui;margin:0}\n.header{display:flex;gap:1rem}\n'),
    o('bkt-001', 'proj-app1', 'js/app.81bc0e.js', 412_008, 'application/javascript', 90, 'console.log("example shop v4.12.0");\n'),
    o('bkt-001', 'proj-app1', 'js/vendor.2c4d1a.js', 1_204_551, 'application/javascript', 90),
    o('bkt-001', 'proj-app1', 'img/hero.webp', 284_112, 'image/webp', 2000),
    o('bkt-001', 'proj-app1', 'img/logo.svg', 3_201, 'image/svg+xml', 30_000, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32"><rect width="32" height="32" rx="8" fill="#5b67f8"/><text x="40" y="22" font-family="sans-serif" font-size="16" fill="#5b67f8">Example</text></svg>'),
    o('bkt-001', 'proj-app1', 'img/products/sku-1001.jpg', 182_400, 'image/jpeg', 6000),
    o('bkt-001', 'proj-app1', 'img/products/sku-1002.jpg', 176_100, 'image/jpeg', 6000),
    o('bkt-001', 'proj-app1', 'img/products/sku-1003.jpg', 201_950, 'image/jpeg', 5000),
    o('bkt-001', 'proj-app1', 'tmp/upload-7f2c.bin', 5_242_880, 'application/octet-stream', 30),
    o('bkt-001', 'proj-app1', 'sitemap.xml', 18_220, 'application/xml', 1440, '<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/</loc></url>\n</urlset>\n'),
    o('bkt-003', 'proj-app2', 'raw/2026/11/08/api-1.log.gz', 84_221_004, 'application/gzip', 20),
    o('bkt-003', 'proj-app2', 'raw/2026/11/08/api-2.log.gz', 79_002_441, 'application/gzip', 20),
    o('bkt-003', 'proj-app2', 'raw/2026/11/07/api-1.log.gz', 91_552_000, 'application/gzip', 1460),
    o('bkt-003', 'proj-app2', 'aggregated/2026-10.parquet', 1_288_490_188, 'application/octet-stream', 12_000),
    o('bkt-003', 'proj-app2', 'README.md', 412, 'text/markdown', 200_000, '# app2-logs\n\nRaw API logs (30 day retention) and monthly aggregates.\n'),
    o('bkt-002', 'proj-ml', 'checkpoints/llama-ft/epoch-38.safetensors', 26_843_545_600, 'application/octet-stream', 5 * 1440),
    o('bkt-002', 'proj-ml', 'checkpoints/llama-ft/epoch-39.safetensors', 26_843_545_600, 'application/octet-stream', 4.5 * 1440),
    o('bkt-002', 'proj-ml', 'checkpoints/llama-ft/epoch-40.safetensors', 26_843_545_600, 'application/octet-stream', 4 * 1440),
    o('bkt-002', 'proj-ml', 'datasets/support-tickets-v3.jsonl', 4_831_838_208, 'application/jsonl', 20 * 1440),
    o('bkt-002', 'proj-ml', 'models/embedder-v2/config.json', 1_024, 'application/json', 9 * 1440, '{\n  "model_type": "bert",\n  "hidden_size": 768,\n  "num_attention_heads": 12\n}\n'),
    o('bkt-002', 'proj-ml', 'models/embedder-v2/model.onnx', 438_000_000, 'application/octet-stream', 9 * 1440),
    o('bkt-004', 'proj-infra', 'env/prod/terraform.tfstate', 412_331, 'application/json', 2 * 60, '{\n  "version": 4,\n  "terraform_version": "1.9.5",\n  "serial": 1412,\n  "lineage": "6c1f0f6e-..."\n}\n'),
    o('bkt-004', 'proj-infra', 'env/staging/terraform.tfstate', 188_002, 'application/json', 26 * 60),
    o('bkt-005', 'proj-app1', 'pg-app1/2026-11-08T01-00.dump', 2_576_980_377, 'application/octet-stream', 9 * 60),
    o('bkt-005', 'proj-app1', 'pg-app1/2026-11-07T01-00.dump', 2_561_002_100, 'application/octet-stream', 33 * 60),
  ];

  const accessKeys: AccessKey[] = [
    { id: 'ak-001', name: 'web-uploads', ...scope('proj-app1'), accessKeyId: 'AUTK4F2A91C0DE7Q', secretMasked: '••••••••••••Xk2p', bucketIds: ['bkt-001'], permission: 'readwrite', createdAt: ago(200 * DAY), lastUsed: ago(4 * MIN), status: 'active', tags: [] },
    { id: 'ak-002', name: 'pg-backup-agent', ...scope('proj-app1'), accessKeyId: 'AUTK91BC22D0FF1M', secretMasked: '••••••••••••9qLw', bucketIds: ['bkt-005'], permission: 'write', createdAt: ago(280 * DAY), lastUsed: ago(9 * HOUR), status: 'active', tags: [] },
    { id: 'ak-003', name: 'log-shipper', ...scope('proj-app2'), accessKeyId: 'AUTK0C77E1A9B3KZ', secretMasked: '••••••••••••mN3e', bucketIds: ['bkt-003'], permission: 'write', createdAt: ago(240 * DAY), lastUsed: ago(1 * MIN), status: 'active', tags: [] },
    { id: 'ak-004', name: 'ml-pipelines', ...scope('proj-ml'), accessKeyId: 'AUTKD3A1F00B2C9R', secretMasked: '••••••••••••Pp7a', bucketIds: '*', permission: 'readwrite', createdAt: ago(170 * DAY), lastUsed: ago(25 * MIN), status: 'active', tags: [] },
    { id: 'ak-005', name: 'old-notebook', ...scope('proj-ml'), accessKeyId: 'AUTK11A0E9C4D2VW', secretMasked: '••••••••••••a0Zz', bucketIds: ['bkt-002'], permission: 'read', createdAt: ago(160 * DAY), lastUsed: ago(80 * DAY), status: 'revoked', tags: [] },
    { id: 'ak-006', name: 'terraform-backend', ...scope('proj-infra'), accessKeyId: 'AUTK7E7E9A0C1B2T', secretMasked: '••••••••••••tF9s', bucketIds: ['bkt-004'], permission: 'readwrite', createdAt: ago(350 * DAY), lastUsed: ago(2 * HOUR), status: 'active', tags: [] },
  ];

  return { buckets, bucketObjects, accessKeys };
}
