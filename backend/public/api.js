const STORAGE_ACCESS = 'access_token';
const STORAGE_REFRESH = 'refresh_token';

function readJson(contentType, text) {
  if (contentType && contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return null;
}

export function getTokens() {
  return {
    accessToken: localStorage.getItem(STORAGE_ACCESS) || null,
    refreshToken: localStorage.getItem(STORAGE_REFRESH) || null
  };
}

export function setTokens(accessToken, refreshToken = null) {
  if (accessToken) localStorage.setItem(STORAGE_ACCESS, accessToken);
  else localStorage.removeItem(STORAGE_ACCESS);

  if (refreshToken) localStorage.setItem(STORAGE_REFRESH, refreshToken);
  else localStorage.removeItem(STORAGE_REFRESH);
}

export function clearTokens() {
  setTokens(null, null);
}

async function refreshAccessToken() {
  const { refreshToken } = getTokens();
  if (!refreshToken) return null;

  const res = await fetch('/admin/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });

  const text = await res.text();
  const data = readJson(res.headers.get('content-type'), text) || {};
  if (!res.ok) return null;

  if (data.access_token) {
    setTokens(data.access_token, refreshToken);
    return data.access_token;
  }
  return null;
}

async function request(path, { method = 'GET', body = null, auth = true, retry = true } = {}) {
  const headers = {};
  if (body !== null) headers['Content-Type'] = 'application/json';

  if (auth) {
    const { accessToken } = getTokens();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined
  });

  if (auth && res.status === 401 && retry) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      return request(path, { method, body, auth, retry: false });
    }
    clearTokens();
    throw new Error('未登录或登录已过期，请重新登录');
  }

  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  const data = readJson(contentType, text);

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      (typeof text === 'string' && text.trim() ? text.trim() : `HTTP ${res.status}`);
    throw new Error(msg);
  }

  return data ?? text;
}

export async function login(password, remember = true) {
  const data = await request('/admin/auth/login', {
    method: 'POST',
    auth: false,
    body: { password, remember }
  });

  if (data?.access_token) {
    setTokens(data.access_token, data.refresh_token || null);
  }
  return data;
}

export async function getMe() {
  return request('/admin/auth/me');
}

export async function getDashboard() {
  return request('/admin/dashboard');
}

export async function getAccounts() {
  return request('/admin/accounts');
}

export async function createAccount(email, refreshToken) {
  return request('/admin/accounts', { method: 'POST', body: { email, refresh_token: refreshToken } });
}

export async function updateAccountStatus(id, status) {
  return request(`/admin/accounts/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { status } });
}

export async function refreshAccount(id) {
  return request(`/admin/accounts/${encodeURIComponent(id)}/refresh`, { method: 'POST', body: {} });
}

export async function refreshAllAccounts() {
  return request('/admin/accounts/refresh-all', { method: 'POST', body: {} });
}

export async function deleteAccount(id) {
  return request(`/admin/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getAccountQuota(id) {
  return request(`/admin/accounts/${encodeURIComponent(id)}/quota`);
}

export async function getLogs(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const url = q.toString() ? `/admin/logs?${q}` : '/admin/logs';
  return request(url);
}

export async function getStats(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const url = q.toString() ? `/admin/stats?${q}` : '/admin/stats';
  return request(url);
}

export async function getOAuthConfig() {
  return request('/oauth/config');
}

export async function exchangeOAuthCode(code, port) {
  return request('/oauth/exchange', { method: 'POST', body: { code, port } });
}

