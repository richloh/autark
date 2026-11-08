import type { Bucket, BucketObject, AccessKey } from '@/types';
import { ago, tags, ptags, scope, DAY, HOUR, MIN } from './util';

const GB = 1024 ** 3;

export function seedStorage() {
  const enneoTags = (env: string) => tags({ env, team: 'enneo' });
  const buckets: Bucket[] = [
    { id: 'bkt-001', name: 'compass-invoices', ...scope('proj-compass'), locationId: 'dc1', storageClass: 'STANDARD', versioning: true, objectLock: true, objectLockRetentionDays: 3650, objectLockMode: 'compliance', encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 2150 * GB, objectCount: 18_420_311, requestsLast30d: 9_800_000, egressGBLast30d: 340,
      lifecycleRules: [{ id: 'lc-1', prefix: '', action: 'transition', days: 90, toClass: 'INFREQUENT', enabled: true }, { id: 'lc-2', prefix: '', action: 'transition', days: 730, toClass: 'ARCHIVE', enabled: true }],
      cors: [], endpoint: 'https://s3.dc1.autark.cloud/compass-invoices', quotaGB: null, createdAt: ago(660 * DAY), tags: ptags('proj-compass', 'prod', { retention: 'GoBD-10y' }),
      description: 'Invoice & Abschlag PDFs — WORM, 10 years (GoBD)' },
    { id: 'bkt-002', name: 'compass-imports', ...scope('proj-compass'), locationId: 'dc1', storageClass: 'STANDARD', versioning: false, objectLock: false, encryption: 'SSE', access: 'private', status: 'active',
      bytesUsed: 64 * GB, objectCount: 412_880, requestsLast30d: 2_100_000, egressGBLast30d: 12,
      lifecycleRules: [{ id: 'lc-3', prefix: 'processed/', action: 'expire', days: 90, enabled: true }],
      cors: [], endpoint: 'https://s3.dc1.autark.cloud/compass-imports', quotaGB: 250, createdAt: ago(500 * DAY), tags: ptags('proj-compass', 'prod'), description: 'Meter reading & MSCONS imports from Orchestrator' },
    { id: 'bkt-003', name: 'website-assets', ...scope('proj-website'), locationId: 'dc2', storageClass: 'STANDARD', versioning: true, objectLock: false, encryption: 'SSE', access: 'public-read', status: 'active',
      bytesUsed: 18 * GB, objectCount: 9_420, requestsLast30d: 21_800_000, egressGBLast30d: 410, lifecycleRules: [{ id: 'lc-4', prefix: 'tmp/', action: 'expire', days: 7, enabled: true }],
      cors: [{ id: 'cors-1', origins: ['https://regiocom-energie.de', 'https://www.regiocom-energie.de'], methods: ['GET', 'HEAD'], maxAgeSec: 3600 }],
      endpoint: 'https://s3.dc2.autark.cloud/website-assets', quotaGB: 100, createdAt: ago(600 * DAY), tags: ptags('proj-website', 'prod') },
    { id: 'bkt-004', name: 'backups', ...scope('proj-tools'), locationId: 'dc2', storageClass: 'INFREQUENT', versioning: true, objectLock: true, objectLockRetentionDays: 30, objectLockMode: 'compliance', encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 6800 * GB, objectCount: 48_210, requestsLast30d: 410_000, egressGBLast30d: 6,
      lifecycleRules: [{ id: 'lc-5', prefix: '', action: 'transition', days: 30, toClass: 'ARCHIVE', enabled: true }, { id: 'lc-6', prefix: '', action: 'expire', days: 400, enabled: true }],
      cors: [], endpoint: 'https://s3.dc2.autark.cloud/backups', quotaGB: null, createdAt: ago(560 * DAY), tags: ptags('proj-tools', 'prod'), description: 'Offsite backups (restic) — immutable for 30 days' },
    { id: 'bkt-005', name: 'terraform-state', ...scope('proj-tools'), locationId: 'dc1', storageClass: 'STANDARD', versioning: true, objectLock: true, objectLockRetentionDays: 7, objectLockMode: 'governance', encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 0.3 * GB, objectCount: 212, requestsLast30d: 220_000, egressGBLast30d: 1, lifecycleRules: [], cors: [], endpoint: 'https://s3.dc1.autark.cloud/terraform-state', quotaGB: 10, createdAt: ago(500 * DAY), tags: ptags('proj-tools', 'prod') },
    { id: 'bkt-006', name: 'enneo-attachments', ...scope('proj-enneo-regiocom'), locationId: 'dc1', storageClass: 'STANDARD', versioning: true, objectLock: false, encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 940 * GB, objectCount: 3_480_102, requestsLast30d: 14_200_000, egressGBLast30d: 95,
      lifecycleRules: [{ id: 'lc-7', prefix: 'tmp/', action: 'expire', days: 1, enabled: true }, { id: 'lc-8', prefix: 'mails/', action: 'expire', days: 1095, enabled: true }],
      cors: [{ id: 'cors-2', origins: ['https://regiocom.enneo.ai'], methods: ['GET', 'PUT'], maxAgeSec: 600 }],
      endpoint: 'https://s3.dc1.autark.cloud/enneo-attachments', quotaGB: 2000, createdAt: ago(236 * DAY), tags: enneoTags('prod'), description: 'Customer e-mail attachments (stays in RZ Magdeburg)' },
    { id: 'bkt-007', name: 'enneo-models', ...scope('proj-enneo-intern'), locationId: 'dc1', storageClass: 'STANDARD', versioning: true, objectLock: false, encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 610 * GB, objectCount: 1_204, requestsLast30d: 48_000, egressGBLast30d: 820, lifecycleRules: [{ id: 'lc-9', prefix: 'checkpoints/', action: 'transition', days: 60, toClass: 'INFREQUENT', enabled: true }],
      cors: [], endpoint: 'https://s3.dc1.autark.cloud/enneo-models', quotaGB: 2000, createdAt: ago(200 * DAY), tags: enneoTags('dev') },
    { id: 'bkt-008', name: 'isu-hana-backups', ...scope('proj-isu'), locationId: 'dc2', storageClass: 'INFREQUENT', versioning: true, objectLock: true, objectLockRetentionDays: 35, objectLockMode: 'compliance', encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 14_200 * GB, objectCount: 6_118, requestsLast30d: 120_000, egressGBLast30d: 2,
      lifecycleRules: [{ id: 'lc-10', prefix: 'log/', action: 'expire', days: 35, enabled: true }, { id: 'lc-11', prefix: 'data/', action: 'transition', days: 14, toClass: 'ARCHIVE', enabled: true }],
      cors: [], endpoint: 'https://s3.dc2.autark.cloud/isu-hana-backups', quotaGB: 25_000, createdAt: ago(680 * DAY), tags: ptags('proj-isu', 'prod'), description: 'HANA Backint target, offsite in RZ Frankfurt' },
    { id: 'bkt-009', name: 'edifact-archive', ...scope('proj-orchestrator'), locationId: 'dc1', storageClass: 'STANDARD', versioning: true, objectLock: true, objectLockRetentionDays: 3650, objectLockMode: 'compliance', encryption: 'SSE-KMS', access: 'private', status: 'active',
      bytesUsed: 380 * GB, objectCount: 22_904_118, requestsLast30d: 6_700_000, egressGBLast30d: 4,
      lifecycleRules: [{ id: 'lc-12', prefix: '', action: 'transition', days: 180, toClass: 'INFREQUENT', enabled: true }],
      cors: [], endpoint: 'https://s3.dc1.autark.cloud/edifact-archive', quotaGB: null, createdAt: ago(510 * DAY), tags: ptags('proj-orchestrator', 'prod'), description: 'Archive of all market messages (UTILMD, MSCONS, INVOIC, APERAK …)' },
  ];

  let n = 0;
  const CLASS: Record<string, BucketObject['storageClass']> = { 'bkt-004': 'INFREQUENT', 'bkt-008': 'INFREQUENT' };
  const LOCK_DAYS: Record<string, number> = { 'bkt-001': 3650, 'bkt-004': 30, 'bkt-005': 7, 'bkt-008': 35, 'bkt-009': 3650 };
  const VERSIONED = new Set(buckets.filter((b) => b.versioning).map((b) => b.id));
  const o = (bucketId: string, project: string, key: string, sizeBytes: number, contentType: string, minutesAgo: number, content?: string): BucketObject => ({
    id: `obj-${String(++n).padStart(4, '0')}`, bucketId, ...scope(project), key, name: key, sizeBytes, contentType, storageClass: CLASS[bucketId] ?? 'STANDARD',
    versions: VERSIONED.has(bucketId) ? 1 + (n % 3) : 1,
    retainUntil: LOCK_DAYS[bucketId] ? new Date(Date.now() - minutesAgo * MIN + LOCK_DAYS[bucketId] * DAY).toISOString() : null,
    etag: `"${(n * 2654435761 >>> 0).toString(16).padStart(8, '0')}${(n * 40503 >>> 0).toString(16)}"`, lastModified: ago(minutesAgo * MIN), createdAt: ago(minutesAgo * MIN), content, tags: [],
  });
  const C = 'proj-compass', W = 'proj-website', T = 'proj-tools', EP = 'proj-enneo-regiocom', EI = 'proj-enneo-intern', I = 'proj-isu', O = 'proj-orchestrator';

  const bucketObjects: BucketObject[] = [
    o('bkt-001', C, 'invoices/2026/11/RE-2026-11-0048213.pdf', 84_221, 'application/pdf', 40),
    o('bkt-001', C, 'invoices/2026/11/RE-2026-11-0048214.pdf', 79_002, 'application/pdf', 40),
    o('bkt-001', C, 'invoices/2026/10/RE-2026-10-0471120.pdf', 91_552, 'application/pdf', 12_000),
    o('bkt-001', C, 'abschlaege/2026/11/AB-2026-11-0193377.pdf', 41_880, 'application/pdf', 300),
    o('bkt-001', C, 'mahnungen/2026/11/MA-2026-11-000912.pdf', 38_410, 'application/pdf', 900),
    o('bkt-001', C, 'README.md', 512, 'text/markdown', 600_000, '# compass-invoices\n\nInvoice, Abschlag and Mahnung PDFs written by Compass.\nObject lock: COMPLIANCE, 3650 days (GoBD). Objects cannot be deleted or overwritten.\n'),
    o('bkt-002', C, 'mscons/2026-11-08/MSCONS_9900123000002_20261108_0412.edi', 128_400, 'application/edifact', 180),
    o('bkt-002', C, 'mscons/2026-11-08/MSCONS_9900123000002_20261108_0812.edi', 131_022, 'application/edifact', 40),
    o('bkt-002', C, 'processed/2026-11-07/meter-readings-batch-0042.csv', 18_220_441, 'text/csv', 1500, 'malo_id;melo_id;zaehlernummer;ablesedatum;zaehlerstand;einheit\n51238696788;DE0001234567890000000000000012345;1ESY1160123456;2026-11-07;14821;kWh\n'),
    o('bkt-003', W, 'fileadmin/images/hero-energiewende.webp', 284_112, 'image/webp', 2000),
    o('bkt-003', W, 'fileadmin/images/logo-regiocom.svg', 3_201, 'image/svg+xml', 30_000, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 32"><rect width="32" height="32" rx="8" fill="#16a34a"/><text x="40" y="22" font-family="sans-serif" font-size="16" fill="#16a34a">Regiocom</text></svg>'),
    o('bkt-003', W, 'fileadmin/downloads/preisblatt-strom-2027.pdf', 412_008, 'application/pdf', 4000),
    o('bkt-003', W, 'fileadmin/downloads/preisblatt-gas-2027.pdf', 398_551, 'application/pdf', 4000),
    o('bkt-003', W, 'typo3temp/assets/css/main.4f2a91.css', 48_220, 'text/css', 90, ':root{--brand:#16a34a}\nbody{font-family:system-ui;margin:0}\n'),
    o('bkt-003', W, 'robots.txt', 64, 'text/plain', 40_000, 'User-agent: *\nAllow: /\nSitemap: https://www.regiocom-energie.de/sitemap.xml\n'),
    o('bkt-004', T, 'gitlab/2026-11-08_0200_gitlab_backup.tar', 41_231_686_041, 'application/x-tar', 9 * 60),
    o('bkt-004', T, 'gitlab/2026-11-07_0200_gitlab_backup.tar', 41_002_441_000, 'application/x-tar', 33 * 60),
    o('bkt-004', T, 'restic/config', 155, 'application/octet-stream', 500_000),
    o('bkt-005', T, 'env/prod/terraform.tfstate', 612_331, 'application/json', 2 * 60, '{\n  "version": 4,\n  "terraform_version": "1.9.5",\n  "serial": 2207,\n  "lineage": "6c1f0f6e-..."\n}\n'),
    o('bkt-005', T, 'env/staging/terraform.tfstate', 188_002, 'application/json', 26 * 60),
    o('bkt-006', EP, 'mails/2026/11/08/8f2c1a0e/zaehlerfoto.jpg', 2_182_400, 'image/jpeg', 12),
    o('bkt-006', EP, 'mails/2026/11/08/41be9d77/kuendigung.pdf', 176_100, 'application/pdf', 35),
    o('bkt-006', EP, 'mails/2026/11/08/0d5a33c2/sepa-mandat.pdf', 201_950, 'application/pdf', 64),
    o('bkt-007', EI, 'base/Llama-3.3-70B-Instruct-AWQ/config.json', 1_024, 'application/json', 30 * 1440, '{\n  "architectures": ["LlamaForCausalLM"],\n  "hidden_size": 8192,\n  "num_hidden_layers": 80,\n  "quantization_config": { "quant_method": "awq", "bits": 4 }\n}\n'),
    o('bkt-007', EI, 'base/Llama-3.3-70B-Instruct-AWQ/model.safetensors', 39_728_447_488, 'application/octet-stream', 30 * 1440),
    o('bkt-007', EI, 'checkpoints/regiocom-intent-v7/adapter_model.safetensors', 335_544_320, 'application/octet-stream', 4 * 1440),
    o('bkt-007', EI, 'embeddings/multilingual-e5-large/model.onnx', 2_240_000_000, 'application/octet-stream', 60 * 1440),
    o('bkt-008', I, 'data/IP1/2026-11-08_0100/databackup_0_1', 1_932_735_283_200, 'application/octet-stream', 7 * 60),
    o('bkt-008', I, 'data/IP1/2026-11-07_0100/databackup_0_1', 1_928_100_000_000, 'application/octet-stream', 31 * 60),
    o('bkt-008', I, 'log/IP1/2026-11-08/log_backup_1_0_88213440_88229120', 2_147_483_648, 'application/octet-stream', 20),
    o('bkt-009', O, 'utilmd/2026/11/08/UTILMD_9900123000002_9907654000003_0001.edi', 6_422, 'application/edifact', 15),
    o('bkt-009', O, 'invoic/2026/11/08/INVOIC_9900123000002_9907654000003_0001.edi', 9_118, 'application/edifact', 55),
    o('bkt-009', O, 'aperak/2026/11/08/APERAK_9907654000003_9900123000002_0001.edi', 1_204, 'application/edifact', 50),
  ];

  const accessKeys: AccessKey[] = [
    { id: 'ak-001', name: 'compass-invoice-writer', ...scope(C), accessKeyId: 'AUTK4F2A91C0DE7Q', secretMasked: '••••••••••••Xk2p', bucketIds: ['bkt-001', 'bkt-002'], permission: 'readwrite', createdAt: ago(600 * DAY), lastUsed: ago(4 * MIN), status: 'active', tags: [] },
    { id: 'ak-002', name: 'website-deploy', ...scope(W), accessKeyId: 'AUTK91BC22D0FF1M', secretMasked: '••••••••••••9qLw', bucketIds: ['bkt-003'], permission: 'readwrite', createdAt: ago(400 * DAY), lastUsed: ago(2 * DAY), status: 'active', tags: [] },
    { id: 'ak-003', name: 'restic-backup', ...scope(T), accessKeyId: 'AUTK0C77E1A9B3KZ', secretMasked: '••••••••••••mN3e', bucketIds: ['bkt-004'], permission: 'write', createdAt: ago(540 * DAY), lastUsed: ago(9 * HOUR), status: 'active', tags: [] },
    { id: 'ak-004', name: 'hana-backint', ...scope(I), accessKeyId: 'AUTKD3A1F00B2C9R', secretMasked: '••••••••••••Pp7a', bucketIds: ['bkt-008'], permission: 'readwrite', createdAt: ago(670 * DAY), lastUsed: ago(20 * MIN), status: 'active', tags: [] },
    { id: 'ak-005', name: 'enneo-attachments-rw', ...scope(EP), accessKeyId: 'AUTK5E9C0A1B7D2N', secretMasked: '••••••••••••Qe4r', bucketIds: ['bkt-006'], permission: 'readwrite', createdAt: ago(230 * DAY), lastUsed: ago(1 * MIN), status: 'active', tags: [] },
    { id: 'ak-006', name: 'enneo-models-ro', ...scope(EI), accessKeyId: 'AUTK2B8D4F6A0C1E', secretMasked: '••••••••••••Lm8t', bucketIds: ['bkt-007'], permission: 'read', createdAt: ago(190 * DAY), lastUsed: ago(25 * MIN), status: 'active', tags: [] },
    { id: 'ak-007', name: 'terraform-backend', ...scope(T), accessKeyId: 'AUTK7E7E9A0C1B2T', secretMasked: '••••••••••••tF9s', bucketIds: ['bkt-005'], permission: 'readwrite', createdAt: ago(490 * DAY), lastUsed: ago(2 * HOUR), status: 'active', tags: [] },
    { id: 'ak-008', name: 'edifact-archiver', ...scope(O), accessKeyId: 'AUTK3C1A9E7F5B0D', secretMasked: '••••••••••••Vh6w', bucketIds: ['bkt-009'], permission: 'write', createdAt: ago(500 * DAY), lastUsed: ago(3 * MIN), status: 'active', tags: [] },
    { id: 'ak-009', name: 'old-sap-consultant', ...scope(I), accessKeyId: 'AUTK11A0E9C4D2VW', secretMasked: '••••••••••••a0Zz', bucketIds: ['bkt-008'], permission: 'read', createdAt: ago(380 * DAY), lastUsed: ago(48 * DAY), status: 'revoked', tags: [] },
  ];

  return { buckets, bucketObjects, accessKeys };
}
