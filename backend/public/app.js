import {
  clearTokens,
  getTokens,
  login,
  getMe,
  getDashboard,
  getAccounts,
  createAccount,
  updateAccountStatus,
  refreshAccount,
  refreshAllAccounts,
  deleteAccount,
  getAccountQuota,
  getLogs,
  getStats,
  getOAuthConfig,
  exchangeOAuthCode
} from './api.js';

const $app = document.getElementById('app');

const state = {
  me: null,
  tab: 'dashboard',
  loading: false,
  dashboard: null,
  accounts: [],
  logs: [],
  stats: null,
  modelUsage: [],
  logFilters: { model: '', status: '' },
  logPagination: { page: 1, size: 50 },
  oauth: { port: null, authUrl: '', callbackUrl: '' },
  quota: { account: null, data: null }
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTs(ts) {
  if (!ts) return '-';
  try {
    return new Date(Number(ts)).toLocaleString();
  } catch {
    return String(ts);
  }
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '-');
  return `${n.toFixed(1)}%`;
}

function badge(text, variant) {
  return `<span class="badge ${variant}">${esc(text)}</span>`;
}

function showToast(title, msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.classList.remove('hidden');
  el.querySelector('.title').textContent = title;
  el.querySelector('.msg').textContent = msg || '';
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => el.classList.add('hidden'), 3200);
}

async function ensureMe() {
  const { accessToken } = getTokens();
  if (!accessToken) {
    state.me = null;
    return;
  }
  try {
    state.me = await getMe();
  } catch {
    state.me = null;
  }
}

async function loadDashboard() {
  state.loading = true;
  render();
  try {
    state.dashboard = await getDashboard();
  } finally {
    state.loading = false;
    render();
  }
}

async function loadAccounts() {
  state.loading = true;
  render();
  try {
    const res = await getAccounts();
    state.accounts = res.accounts || [];
  } finally {
    state.loading = false;
    render();
  }
}

async function loadLogs() {
  state.loading = true;
  render();
  try {
    const now = Date.now();
    const start = now - 24 * 60 * 60 * 1000;
    const stats = await getStats({ start_time: start, end_time: now });
    state.stats = stats.stats || null;
    state.modelUsage = stats.modelUsage || [];

    const { page, size } = state.logPagination;
    const offset = (page - 1) * size;
    const logs = await getLogs({
      limit: size,
      offset,
      model: state.logFilters.model || undefined,
      status: state.logFilters.status || undefined
    });
    state.logs = logs.logs || [];
  } finally {
    state.loading = false;
    render();
  }
}

async function loadTab(tab) {
  state.tab = tab;
  if (tab === 'dashboard') return loadDashboard();
  if (tab === 'accounts') return loadAccounts();
  if (tab === 'logs') return loadLogs();
}

function renderLogin() {
  return `
    <div class="container">
      <div class="topbar">
        <div class="brand">
          <span>Antigravity Proxy</span>
          <span class="pill">Admin</span>
        </div>
        <div class="muted">请先登录</div>
      </div>

      <div class="grid">
        <div class="card col-6">
          <h2>登录</h2>
          <form id="loginForm" class="row" style="align-items:flex-end">
            <label style="flex:1">
              管理密码
              <input id="loginPassword" type="password" autocomplete="current-password" placeholder="ADMIN_PASSWORD" required />
            </label>
            <label style="min-width:180px">
              <span>&nbsp;</span>
              <div class="row">
                <input id="remember" type="checkbox" checked />
                <span class="muted" style="font-size:13px">记住登录（refresh_token）</span>
              </div>
            </label>
            <button class="btn primary" type="submit">登录</button>
          </form>
          <p class="muted" style="margin:10px 0 0">提示：此页面只调用 /admin 与 /oauth 接口，不会暴露 API_KEY。</p>
        </div>
      </div>

      <div id="toast" class="toast hidden">
        <div class="title"></div>
        <div class="msg"></div>
      </div>
    </div>
  `;
}

function renderTopbar() {
  const active = (k) => (state.tab === k ? 'true' : 'false');
  return `
    <div class="topbar">
      <div class="brand">
        <span>Antigravity Proxy</span>
        <span class="pill">Admin</span>
      </div>
      <div class="nav">
        <button class="navbtn" data-tab="dashboard" data-active="${active('dashboard')}">统计</button>
        <button class="navbtn" data-tab="accounts" data-active="${active('accounts')}">账号</button>
        <button class="navbtn" data-tab="logs" data-active="${active('logs')}">日志</button>
      </div>
      <div class="actions">
        <span class="muted" style="font-size:13px">${esc(state.me?.username || '')}</span>
        <button class="btn" data-action="refresh">刷新</button>
        <button class="btn danger" data-action="logout">退出</button>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const d = state.dashboard || {};
  const today = d.today || {};
  const accounts = d.accounts || {};
  const pool = d.pool || {};
  const modelUsage = Array.isArray(d.modelUsage) ? d.modelUsage : [];

  return `
    <div class="grid">
      <div class="card col-4">
        <h2>账号</h2>
        <div class="row">
          ${badge(`Active ${accounts.active || 0}/${accounts.total || 0}`, 'ok')}
          ${accounts.error ? badge(`Error ${accounts.error}`, 'bad') : ''}
        </div>
        <div class="muted" style="margin-top:10px">池：${esc(pool.active ?? '-')}/${esc(pool.total ?? '-')}，平均配额 ${esc((pool.avgQuota ?? 0).toFixed?.(3) ?? pool.avgQuota)}</div>
      </div>

      <div class="card col-4">
        <h2>今日</h2>
        <div class="row">
          ${badge(`请求 ${today.requests || 0}`, 'ok')}
          ${badge(`Token ${today.tokens || 0}`, 'warn')}
        </div>
        <div class="muted" style="margin-top:10px">成功率 ${esc(today.successRate ?? '100')}%，平均延迟 ${esc(today.avgLatency ?? 0)}ms</div>
      </div>

      <div class="card col-4">
        <h2>接口</h2>
        <div class="muted">OpenAI 端点：<span class="mono">${esc(location.origin)}/v1/chat/completions</span></div>
        <div class="muted" style="margin-top:6px">Gemini 端点：<span class="mono">${esc(location.origin)}/v1beta/models/...</span></div>
        <div class="muted" style="margin-top:6px">Anthropic 端点：<span class="mono">${esc(location.origin)}/v1/messages</span></div>
      </div>

      <div class="card col-8">
        <h2>模型使用（今日）</h2>
        ${
          modelUsage.length
            ? `<table class="table">
                <thead><tr><th>Model</th><th>Count</th><th>Tokens</th></tr></thead>
                <tbody>
                  ${modelUsage
                    .map((m) => `<tr><td class="mono">${esc(m.model)}</td><td>${esc(m.count)}</td><td>${esc(m.tokens)}</td></tr>`)
                    .join('')}
                </tbody>
              </table>`
            : `<div class="muted">暂无数据</div>`
        }
      </div>

      <div class="card col-4">
        <h2>状态</h2>
        <div class="muted">加载中：${state.loading ? '是' : '否'}</div>
        <div class="muted" style="margin-top:6px">提示：代理鉴权使用环境变量 <span class="mono">API_KEY</span></div>
      </div>
    </div>
  `;
}

function renderAccounts() {
  const rows = (state.accounts || []).map((a) => {
    const status = a.status || 'unknown';
    const statusBadge =
      status === 'active' ? badge('active', 'ok') : status === 'disabled' ? badge('disabled', 'warn') : badge(status, 'bad');
    const tokenValid = a.token_valid ? badge('token ok', 'ok') : badge('token invalid', 'bad');
    const quota = typeof a.quota_remaining === 'number' ? a.quota_remaining.toFixed(3) : a.quota_remaining ?? '-';
    return `
      <tr>
        <td>${esc(a.id)}</td>
        <td>${esc(a.email)}</td>
        <td>${statusBadge}</td>
        <td class="mono">${esc(a.tier || '-')}</td>
        <td class="mono">${esc(quota)}</td>
        <td>${tokenValid}</td>
        <td class="mono">${esc(a.error_count || 0)}</td>
        <td class="mono">${esc(a.last_error || '')}</td>
        <td class="mono">${esc(formatTs(a.last_used_at))}</td>
        <td>
          <div class="row">
            <button class="btn" data-action="acct-refresh" data-id="${esc(a.id)}">刷新Token</button>
            <button class="btn" data-action="acct-quota" data-id="${esc(a.id)}">配额</button>
            <button class="btn" data-action="acct-toggle" data-id="${esc(a.id)}" data-status="${esc(status)}">
              ${status === 'active' ? '禁用' : '启用'}
            </button>
            <button class="btn danger" data-action="acct-delete" data-id="${esc(a.id)}">删除</button>
          </div>
        </td>
      </tr>
    `;
  });

  return `
    <div class="grid">
      <div class="card">
        <h2>账号管理</h2>
        <div class="row" style="margin-bottom:10px">
          <button class="btn primary" data-action="open-oauth">OAuth 添加账号</button>
          <button class="btn" data-action="refresh-all">刷新全部 Token/配额</button>
        </div>

        <form id="addAccountForm" class="row" style="align-items:flex-end; margin: 10px 0 16px;">
          <label style="flex:1; min-width:240px">
            Email
            <input id="addEmail" placeholder="user@example.com" required />
          </label>
          <label style="flex:2; min-width:320px">
            Refresh Token
            <input id="addRefresh" class="mono" placeholder="1//xxxx" required />
          </label>
          <button class="btn primary" type="submit">添加</button>
        </form>

        <div class="muted" style="margin-bottom:10px">共 ${esc(state.accounts.length)} 个账号</div>
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Status</th>
              <th>Tier</th>
              <th>Quota</th>
              <th>Token</th>
              <th>Err</th>
              <th>Last Error</th>
              <th>Last Used</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>

      ${renderOAuthDialog()}
      ${renderQuotaDialog()}
    </div>
  `;
}

function renderOAuthDialog() {
  const o = state.oauth;
  return `
    <dialog id="oauthDialog">
      <div class="modal-header">
        <div>
          <div style="font-weight:700">OAuth 添加账号</div>
          <div class="muted" style="font-size:12px">授权后把浏览器地址栏 URL 粘贴回来（即使显示 localhost 打不开也没关系）</div>
        </div>
        <button class="btn" data-action="close-oauth">关闭</button>
      </div>
      <div class="modal-body">
        <div class="row" style="margin-bottom:10px">
          <button class="btn primary" data-action="oauth-start">打开授权页面</button>
          <span class="muted">随机端口：<span class="mono">${esc(o.port ?? '-')}</span></span>
        </div>
        <label>
          回调 URL（粘贴）
          <textarea id="oauthCallback" class="mono" placeholder="http://localhost:xxxxx/oauth-callback?code=...">${esc(
            o.callbackUrl
          )}</textarea>
        </label>
        <div class="muted" style="margin-top:8px">授权 URL：<span class="mono">${esc(o.authUrl || '')}</span></div>
      </div>
      <div class="modal-footer">
        <button class="btn primary" data-action="oauth-exchange">交换并创建账号</button>
      </div>
    </dialog>
  `;
}

function renderQuotaDialog() {
  const q = state.quota;
  const data = q.data?.data || q.data || null;
  const quotas = data?.quotas || {};
  const rows = Object.entries(quotas).map(([modelId, info]) => {
    return `<tr>
      <td class="mono">${esc(modelId)}</td>
      <td>${esc(info?.displayName || '')}</td>
      <td class="mono">${esc(info?.remainingFraction ?? '')}</td>
      <td class="mono">${esc(formatTs(info?.resetTime))}</td>
    </tr>`;
  });

  return `
    <dialog id="quotaDialog">
      <div class="modal-header">
        <div>
          <div style="font-weight:700">配额详情</div>
          <div class="muted" style="font-size:12px">${esc(q.account?.email || '')}</div>
        </div>
        <button class="btn" data-action="close-quota">关闭</button>
      </div>
      <div class="modal-body">
        ${
          data
            ? `<div class="row" style="margin-bottom:10px">
                ${badge(`overall ${data.overallQuota ?? '-'}`, 'ok')}
                <span class="muted">reset：<span class="mono">${esc(formatTs(data.resetTime))}</span></span>
              </div>`
            : `<div class="muted">未加载</div>`
        }
        <table class="table">
          <thead><tr><th>Model</th><th>Name</th><th>Remaining</th><th>Reset</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn" data-action="close-quota">关闭</button>
      </div>
    </dialog>
  `;
}

function renderLogs() {
  const s = state.stats || {};
  const mu = Array.isArray(state.modelUsage) ? state.modelUsage : [];
  const logs = Array.isArray(state.logs) ? state.logs : [];
  const { page, size } = state.logPagination;

  const logRows = logs.map((l) => {
    const st = l.status === 'success' ? badge('success', 'ok') : badge(l.status || 'error', 'bad');
    return `<tr>
      <td class="mono">${esc(formatTs(l.created_at))}</td>
      <td class="mono">${esc(l.model)}</td>
      <td>${esc(l.account_email || '-')}</td>
      <td>${st}</td>
      <td class="mono">${esc(l.prompt_tokens)} → ${esc(l.completion_tokens)} (${esc(l.total_tokens)})</td>
      <td class="mono">${esc(l.latency_ms)}ms</td>
      <td class="mono">${esc(l.error_message || '')}</td>
    </tr>`;
  });

  return `
    <div class="grid">
      <div class="card col-6">
        <h2>24h 统计</h2>
        <div class="row">
          ${badge(`requests ${s.total_requests || 0}`, 'ok')}
          ${badge(`tokens ${s.total_tokens || 0}`, 'warn')}
          ${badge(`success ${s.success_count || 0}`, 'ok')}
          ${s.error_count ? badge(`error ${s.error_count}`, 'bad') : ''}
        </div>
        <div class="muted" style="margin-top:10px">平均延迟：${esc(Math.round(s.avg_latency || 0))}ms</div>
      </div>

      <div class="card col-6">
        <h2>模型（24h）</h2>
        ${
          mu.length
            ? `<table class="table">
                <thead><tr><th>Model</th><th>Count</th><th>Tokens</th></tr></thead>
                <tbody>${mu
                  .map((m) => `<tr><td class="mono">${esc(m.model)}</td><td>${esc(m.count)}</td><td>${esc(m.tokens)}</td></tr>`)
                  .join('')}</tbody>
              </table>`
            : `<div class="muted">暂无数据</div>`
        }
      </div>

      <div class="card">
        <h2>请求日志</h2>
        <div class="row" style="margin-bottom:10px; align-items:flex-end">
          <label style="min-width:220px">
            Model（可选）
            <input id="logModel" class="mono" placeholder="claude-opus-4-5-thinking" value="${esc(state.logFilters.model)}" />
          </label>
          <label style="min-width:160px">
            Status
            <select id="logStatus">
              <option value="" ${state.logFilters.status === '' ? 'selected' : ''}>all</option>
              <option value="success" ${state.logFilters.status === 'success' ? 'selected' : ''}>success</option>
              <option value="error" ${state.logFilters.status === 'error' ? 'selected' : ''}>error</option>
            </select>
          </label>
          <button class="btn" data-action="logs-apply">应用筛选</button>
          <span class="muted">页：${esc(page)}（size ${esc(size)}）</span>
          <button class="btn" data-action="logs-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <button class="btn" data-action="logs-next" ${logs.length < size ? 'disabled' : ''}>下一页</button>
        </div>

        <table class="table">
          <thead><tr><th>Time</th><th>Model</th><th>Account</th><th>Status</th><th>Tokens</th><th>Latency</th><th>Error</th></tr></thead>
          <tbody>${logRows.join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAuthed() {
  return `
    <div class="container">
      ${renderTopbar()}
      ${state.tab === 'dashboard' ? renderDashboard() : state.tab === 'accounts' ? renderAccounts() : renderLogs()}
      <div id="toast" class="toast hidden">
        <div class="title"></div>
        <div class="msg"></div>
      </div>
    </div>
  `;
}

function render() {
  if (!state.me) {
    $app.innerHTML = renderLogin();
  } else {
    $app.innerHTML = renderAuthed();
  }
}

async function startOAuthFlow() {
  const cfg = await getOAuthConfig();
  const config = cfg?.client_id ? cfg : cfg?.data || cfg;
  const port = Math.floor(Math.random() * 10000) + 50000;
  const redirectUri = `http://localhost:${port}/oauth-callback`;
  const authUrl =
    `${config.auth_endpoint}?` +
    `access_type=offline&` +
    `client_id=${encodeURIComponent(config.client_id)}&` +
    `prompt=consent&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(config.scope)}&` +
    `state=${Date.now()}`;

  state.oauth.port = String(port);
  state.oauth.authUrl = authUrl;
  state.oauth.callbackUrl = '';
  render();

  const dialog = document.getElementById('oauthDialog');
  dialog?.showModal();
  window.open(authUrl, '_blank');
}

function parseOAuthCodeFromUrl(inputUrl) {
  const raw = String(inputUrl || '').trim();
  if (!raw) return { code: null, port: null };

  // Try URL parsing first
  try {
    const u = new URL(raw);
    const code = u.searchParams.get('code');
    const port = u.port || null;
    return { code, port };
  } catch {
    // Fallback regex
    const codeMatch = raw.match(/[?&]code=([^&]+)/);
    const portMatch = raw.match(/localhost:(\d+)/);
    return { code: codeMatch ? decodeURIComponent(codeMatch[1]) : null, port: portMatch ? portMatch[1] : null };
  }
}

async function onClick(e) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;

  const tab = t.dataset.tab;
  if (tab) {
    await loadTab(tab);
    return;
  }

  const action = t.dataset.action;
  if (!action) return;

  try {
    if (action === 'logout') {
      clearTokens();
      state.me = null;
      render();
      return;
    }

    if (action === 'refresh') {
      await loadTab(state.tab);
      showToast('OK', '已刷新');
      return;
    }

    if (action === 'open-oauth') {
      const dialog = document.getElementById('oauthDialog');
      dialog?.showModal();
      return;
    }

    if (action === 'close-oauth') {
      document.getElementById('oauthDialog')?.close();
      return;
    }

    if (action === 'oauth-start') {
      await startOAuthFlow();
      return;
    }

    if (action === 'oauth-exchange') {
      const textarea = document.getElementById('oauthCallback');
      const inputUrl = textarea ? textarea.value : state.oauth.callbackUrl;
      const { code, port } = parseOAuthCodeFromUrl(inputUrl);
      const usePort = state.oauth.port || port || null;
      if (!code) throw new Error('未找到 code 参数，请检查回调 URL 是否完整');
      if (!usePort) throw new Error('未找到端口，请先点击“打开授权页面”生成端口');
      await exchangeOAuthCode(code, usePort);
      document.getElementById('oauthDialog')?.close();
      showToast('OK', '账号已添加');
      await loadAccounts();
      return;
    }

    if (action === 'refresh-all') {
      await refreshAllAccounts();
      showToast('OK', '已触发刷新全部账号');
      await loadAccounts();
      return;
    }

    if (action === 'acct-refresh') {
      const id = t.dataset.id;
      await refreshAccount(id);
      showToast('OK', `已刷新账号 ${id}`);
      await loadAccounts();
      return;
    }

    if (action === 'acct-toggle') {
      const id = t.dataset.id;
      const cur = t.dataset.status;
      const next = cur === 'active' ? 'disabled' : 'active';
      await updateAccountStatus(id, next);
      showToast('OK', `账号 ${id} -> ${next}`);
      await loadAccounts();
      return;
    }

    if (action === 'acct-delete') {
      const id = t.dataset.id;
      if (!confirm(`确认删除账号 ${id}？`)) return;
      await deleteAccount(id);
      showToast('OK', `已删除账号 ${id}`);
      await loadAccounts();
      return;
    }

    if (action === 'acct-quota') {
      const id = t.dataset.id;
      const account = (state.accounts || []).find((a) => String(a.id) === String(id)) || null;
      state.quota.account = account;
      state.quota.data = await getAccountQuota(id);
      render();
      document.getElementById('quotaDialog')?.showModal();
      return;
    }

    if (action === 'close-quota') {
      document.getElementById('quotaDialog')?.close();
      return;
    }

    if (action === 'logs-apply') {
      const model = document.getElementById('logModel')?.value || '';
      const status = document.getElementById('logStatus')?.value || '';
      state.logFilters.model = model.trim();
      state.logFilters.status = status;
      state.logPagination.page = 1;
      await loadLogs();
      return;
    }

    if (action === 'logs-prev') {
      state.logPagination.page = Math.max(1, state.logPagination.page - 1);
      await loadLogs();
      return;
    }

    if (action === 'logs-next') {
      state.logPagination.page += 1;
      await loadLogs();
      return;
    }
  } catch (err) {
    showToast('Error', err?.message || String(err));
  }
}

async function onSubmit(e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.id === 'loginForm') {
    e.preventDefault();
    const password = document.getElementById('loginPassword')?.value || '';
    const remember = !!document.getElementById('remember')?.checked;
    try {
      await login(password, remember);
      await ensureMe();
      if (!state.me) throw new Error('登录失败');
      state.tab = 'dashboard';
      render();
      await loadDashboard();
      showToast('OK', '已登录');
    } catch (err) {
      showToast('Error', err?.message || String(err));
    }
    return;
  }

  if (form.id === 'addAccountForm') {
    e.preventDefault();
    const email = document.getElementById('addEmail')?.value?.trim() || '';
    const refreshToken = document.getElementById('addRefresh')?.value?.trim() || '';
    if (!email || !refreshToken) {
      showToast('Error', '请填写 email 与 refresh_token');
      return;
    }
    try {
      await createAccount(email, refreshToken);
      showToast('OK', '账号已添加');
      await loadAccounts();
    } catch (err) {
      showToast('Error', err?.message || String(err));
    }
  }
}

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);

await ensureMe();
render();
if (state.me) {
  await loadDashboard();
}

