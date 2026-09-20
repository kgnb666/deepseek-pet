/**
 * 检查更新（对标 dsh-pet）：GitHub Releases 最新版优先，jsDelivr package.json 兜底。
 * repo 在设置里配置（如 "MerZlin/dsh-pet-indesktop"），为空则视为未配置源。
 */
const https = require('https');
const path = require('path');
const { pathToFileURL } = require('url');

// 共享 semver 模块是 ESM（.mjs），CJS 主进程通过动态 import 加载
const sharedReady = import(pathToFileURL(path.join(__dirname, '../src/shared/semver.mjs')).href);

function fetchJson(urlStr, headers = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'DeepSeekPet-Updater', ...headers },
        timeout,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJson(res.headers.location, headers, timeout).then(resolve, reject);
          return;
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            reject(new Error('响应解析失败'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * @param {{repo:string, currentVersion:string}} cfg
 * @returns {Promise<{ok:boolean, newer:boolean, latest?:string, url?:string, notes?:string, error?:string}>}
 */
async function checkUpdate({ repo, currentVersion }) {
  const { isNewerVersion } = await sharedReady;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { ok: false, error: '未配置更新源（设置里的 GitHub 仓库，如 user/DeepSeekPet）' };
  }
  let latest = null;
  let url = `https://github.com/${repo}/releases/latest`;
  let notes = '';
  try {
    const r = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
    if (r.status === 200 && r.body) {
      latest = r.body.tag_name || r.body.name || null;
      notes = (r.body.body || '').slice(0, 400);
      if (Array.isArray(r.body.assets)) {
        const setup = r.body.assets.find((a) => /Setup.*\.exe$/i.test(a.name)) || r.body.assets.find((a) => /\.exe$/i.test(a.name));
        if (setup) url = setup.browser_download_url;
      }
    }
  } catch {
    /* 走兜底 */
  }
  if (!latest) {
    try {
      const r = await fetchJson(`https://cdn.jsdelivr.net/gh/${repo}/package.json`);
      if (r.status === 200 && r.body?.version) {
        latest = r.body.version;
        url = `https://github.com/${repo}/releases`;
      }
    } catch {
      /* 兜底也失败 */
    }
  }
  if (!latest) return { ok: false, error: '无法获取最新版本（网络或仓库地址有误）' };
  return {
    ok: true,
    newer: isNewerVersion(latest, currentVersion),
    latest: String(latest),
    current: currentVersion,
    url,
    notes,
  };
}

module.exports = { checkUpdate };
