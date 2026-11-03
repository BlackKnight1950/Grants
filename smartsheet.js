'use strict';
/**
 * Minimal Smartsheet API client.
 *  - Bearer token auth.
 *  - Stays under the 300 requests/minute/token limit with a rolling-window throttle.
 *  - On HTTP 429 / error 4003 it pauses ALL requests for a minute (Smartsheet's guidance) and retries.
 *  - Retries transient errors (5xx, 4001, 4002, 4004, network) with exponential backoff.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SmartsheetError extends Error {
  constructor(status, body, where) {
    super((body && body.message ? body.message : 'Smartsheet request failed') + ' (' + status + (body && body.errorCode ? '/' + body.errorCode : '') + ') ' + where);
    this.status = status;
    this.errorCode = body && body.errorCode;
    this.retryable = status === 429 || status >= 500;
  }
}

class SmartsheetClient {
  constructor(opts) {
    this.token = opts.token;
    this.base = (opts.base || 'https://api.smartsheet.com/2.0').replace(/\/+$/, '');
    this.perMinute = opts.perMinute || 240;               // headroom under the 300 limit
    this.rateWaitMs = opts.rateLimitWaitMs != null ? opts.rateLimitWaitMs : 60000;
    this.maxRetries = opts.maxRetries != null ? opts.maxRetries : 4;
    this.backoffMs = opts.backoffMs != null ? opts.backoffMs : 1000;
    this.stamps = [];
    this.pausedUntil = 0;
    this.requests = 0;
  }

  async _throttle() {
    for (;;) {
      const now = Date.now();
      if (this.pausedUntil > now) { await sleep(this.pausedUntil - now); continue; }
      this.stamps = this.stamps.filter((t) => now - t < 60000);
      if (this.stamps.length < this.perMinute) { this.stamps.push(now); return; }
      await sleep(this.stamps[0] + 60000 - now + 5);
    }
  }

  /** Requests made in the last minute (for diagnostics). */
  usedLastMinute() { const now = Date.now(); return this.stamps.filter((t) => now - t < 60000).length; }

  async request(method, path, opts) {
    const o = opts || {};
    const url = new URL(this.base + path);
    if (o.query) for (const [k, v] of Object.entries(o.query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    let attempt = 0;
    for (;;) {
      await this._throttle();
      this.requests++;
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Authorization: 'Bearer ' + this.token,
            'Content-Type': 'application/json',
            'smartsheet-integration-source': 'APPLICATION,Cook County Health,Grants Command Center'
          },
          body: o.body === undefined ? undefined : JSON.stringify(o.body)
        });
      } catch (e) {
        if (attempt++ < this.maxRetries) { await sleep(this.backoffMs * 2 ** (attempt - 1)); continue; }
        throw e;
      }
      const text = await res.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { message: text.slice(0, 200) }; }
      if (res.ok) return json;
      const code = json.errorCode;
      if (res.status === 429 || code === 4003) {
        this.pausedUntil = Date.now() + this.rateWaitMs;
        if (attempt++ < this.maxRetries) continue;
      } else if (res.status >= 500 || code === 4001 || code === 4002 || code === 4004) {
        if (attempt++ < this.maxRetries) { await sleep(this.backoffMs * 2 ** (attempt - 1)); continue; }
      }
      throw new SmartsheetError(res.status, json, method + ' ' + url.pathname);
    }
  }

  get(path, query) { return this.request('GET', path, { query }); }
  post(path, body, query) { return this.request('POST', path, { body, query }); }
  put(path, body, query) { return this.request('PUT', path, { body, query }); }
  del(path, query) { return this.request('DELETE', path, { query }); }
}

module.exports = { SmartsheetClient, SmartsheetError, sleep };
