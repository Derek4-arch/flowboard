/* Flowboard JSON API client. Never throws: resolves to { ok: true, ... } or { ok: false, error, field, status }. */
(function (FB) {
  'use strict';
  async function request(method, url, body) {
    const opts = { method, headers: { 'X-Client-Id': FB.util.clientId }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); } catch (e) {
      FB.emit('offline', true);
      return { ok: false, network: true, error: 'Flowboard can’t reach the server. Check that it is still running.' };
    }
    FB.emit('offline', false);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') data = { ok: res.ok, error: res.ok ? undefined : 'Unexpected response from the server.' };
    data.status = res.status;
    if (res.status === 401 && data.code === 'auth') FB.emit('auth-expired');
    return data;
  }
  FB.api = {
    get: url => request('GET', url),
    post: (url, body) => request('POST', url, body || {}),
    put: (url, body) => request('PUT', url, body || {}),
    patch: (url, body) => request('PATCH', url, body || {}),
    del: (url, body) => request('DELETE', url, body || {})
  };
})(window.FB = window.FB || {});
