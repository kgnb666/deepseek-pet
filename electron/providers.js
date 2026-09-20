/**
 * AI Provider 管理：多 Provider（任意 OpenAI 兼容服务）配置持久化。
 * API Key 用 safeStorage 加密落盘（与主 Key 同级安全），不可用时降级明文并标记。
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_PROVIDER = () => ({
  id: 'deepseek-default',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  visionModel: '',
  apiKeyEnc: null, // base64(safeStorage)
  apiKeyPlain: null, // safeStorage 不可用时的降级明文
});

function storePath(userData) {
  return path.join(userData, 'providers.json');
}

function loadRaw(userData) {
  try {
    return JSON.parse(fs.readFileSync(storePath(userData), 'utf8'));
  } catch {
    return null;
  }
}

function saveRaw(userData, data) {
  const p = storePath(userData);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

class ProviderStore {
  constructor({ userData, safeStorage }) {
    this.userData = userData;
    this.safeStorage = safeStorage;
    const raw = loadRaw(userData);
    if (!raw || !Array.isArray(raw.providers) || raw.providers.length === 0) {
      this.providers = [DEFAULT_PROVIDER()];
      this.activeId = this.providers[0].id;
      saveRaw(userData, this.snapshot());
    } else {
      this.providers = raw.providers;
      this.activeId = raw.activeId && this.providers.some((p) => p.id === raw.activeId) ? raw.activeId : this.providers[0].id;
    }
  }

  encryptionAvailable() {
    try {
      return Boolean(this.safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  snapshot() {
    return { providers: this.providers, activeId: this.activeId };
  }

  /** 供渲染层列表展示：不吐出 Key 本体，只回是否已配置 */
  list() {
    return {
      activeId: this.activeId,
      providers: this.providers.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model,
        visionModel: p.visionModel || '',
        hasKey: Boolean(p.apiKeyEnc || p.apiKeyPlain),
        keyEncrypted: Boolean(p.apiKeyEnc),
      })),
    };
  }

  get(id) {
    return this.providers.find((p) => p.id === id) || null;
  }

  getActive() {
    return this.get(this.activeId) || this.providers[0];
  }

  setActive(id) {
    if (this.get(id)) {
      this.activeId = id;
      saveRaw(this.userData, this.snapshot());
    }
    return this.list();
  }

  /** 新增/更新。apiKey 传空字符串表示清除；undefined 表示保持不变。 */
  upsert(input) {
    const p = this.get(input.id) || { ...DEFAULT_PROVIDER(), id: input.id || `p-${Date.now().toString(36)}` };
    if (input.name !== undefined) p.name = String(input.name).slice(0, 60) || p.name;
    if (input.baseUrl !== undefined) p.baseUrl = String(input.baseUrl).trim() || p.baseUrl;
    if (input.model !== undefined) p.model = String(input.model).trim() || p.model;
    if (input.visionModel !== undefined) p.visionModel = String(input.visionModel).trim();
    if (input.apiKey !== undefined) {
      const key = String(input.apiKey).trim();
      if (!key) {
        p.apiKeyEnc = null;
        p.apiKeyPlain = null;
      } else if (this.encryptionAvailable()) {
        p.apiKeyEnc = this.safeStorage.encryptString(key).toString('base64');
        p.apiKeyPlain = null;
      } else {
        p.apiKeyPlain = key;
        p.apiKeyEnc = null;
      }
    }
    if (!this.get(p.id)) this.providers.push(p);
    if (!this.activeId) this.activeId = p.id;
    saveRaw(this.userData, this.snapshot());
    return this.list();
  }

  remove(id) {
    if (this.providers.length <= 1) return this.list(); // 至少保留一个
    this.providers = this.providers.filter((p) => p.id !== id);
    if (this.activeId === id) this.activeId = this.providers[0].id;
    saveRaw(this.userData, this.snapshot());
    return this.list();
  }

  /** 取激活 Provider 的调用凭据（解密 Key）。vision=true 时返回视觉模型配置。 */
  resolveForCall(id, { vision = false } = {}) {
    const p = this.get(id) || this.getActive();
    let apiKey = '';
    if (p.apiKeyEnc) {
      try {
        apiKey = this.safeStorage.decryptString(Buffer.from(p.apiKeyEnc, 'base64'));
      } catch {
        apiKey = '';
      }
    } else if (p.apiKeyPlain) {
      apiKey = p.apiKeyPlain;
    }
    return {
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey,
      model: p.model,
      visionModel: p.visionModel || p.model,
    };
  }
}

module.exports = { ProviderStore };
