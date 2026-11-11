/* FormPilot storage: localStorage for settings, profile and recipes; IndexedDB for run history
   (runs carry per-step snapshots, so they can be large). Falls back to memory if storage is blocked. */
(function (root) {
  'use strict';
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  let dbp = null; const mem = new Map();
  function db() { if (dbp) return dbp; dbp = new Promise((res, rej) => { if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB unavailable')); return; } const r = indexedDB.open('formpilot', 1); r.onupgradeneeded = () => { r.result.createObjectStore('runs', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return dbp; }
  async function tx(mode, fn) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('runs', mode); const req = fn(t.objectStore('runs')); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); }); }
  const runs = {
    async put(r) { try { await tx('readwrite', (s) => s.put(r)); } catch (e) { mem.set(r.id, r); } },
    async del(id) { try { await tx('readwrite', (s) => s.delete(id)); } catch (e) { /* ignore */ } mem.delete(id); },
    async all() { let a = []; try { a = (await tx('readonly', (s) => s.getAll())) || []; } catch (e) { /* ignore */ } const ids = new Set(a.map((x) => x.id)); for (const r of mem.values()) if (!ids.has(r.id)) a.push(r); return a.sort((x, y) => String(y.startedAt).localeCompare(String(x.startedAt))); },
    async clear() { try { await tx('readwrite', (s) => s.clear()); } catch (e) { /* ignore */ } mem.clear(); }
  };
  root.FormPilotStore = { ls, runs };
})(typeof self !== 'undefined' ? self : this);
