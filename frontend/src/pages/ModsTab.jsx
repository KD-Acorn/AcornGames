import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import { useToast } from '../Toast';
import { useAuth } from '../AuthContext';

const STATUS_LABELS = {
  running: { label: 'Applying…', color: 'var(--warning)' },
  pending_restart: { label: 'Waiting for players to disconnect', color: 'var(--warning)' },
  success: { label: 'Applied successfully', color: 'var(--success)' },
  failed: { label: 'Apply failed', color: 'var(--danger)' },
  rolled_back: { label: 'Rolled back', color: 'var(--danger)' },
  auto_disabled: { label: 'Mod auto-disabled (crash loop)', color: 'var(--danger)' },
};

const CRASH_TYPE_LABELS = {
  abi_incompatible: 'ABI incompatibility',
  plugin_load_failed: 'Plugin load failure',
  crash_loop: 'Crash loop',
  crash: 'Crash',
};

const CRASH_TYPE_EXPLAIN = {
  abi_incompatible:
    'The mod contains native code compiled against an older version of Satisfactory. After a game update, the server cannot load it because the internal function signatures no longer match. The mod author needs to release an update compiled against the current game version.',
  plugin_load_failed:
    'The server could not load this mod plugin. This is usually caused by a game version mismatch or a missing dependency mod.',
  crash_loop:
    'The server restarted 3 or more times within 5 minutes. The watchdog detected a crash loop and automatically disabled the likely offending mod.',
  crash:
    'The server crashed while loading mods. No specific mod was identified from the crash log.',
};

function BrokenModModal({ run, onDisableAndRestart, onDismiss, serverId }) {
  const ci = run?.detail?.crashInfo;
  if (!ci) return null;

  const [techOpen, setTechOpen] = useState(false);
  const typeLabel = CRASH_TYPE_LABELS[ci.crash_type] || ci.crash_type;
  const explain = CRASH_TYPE_EXPLAIN[ci.crash_type] || 'An unexpected error prevented the server from starting with the mod loaded.';

  const isAutoDisabled = run.status === 'auto_disabled';
  const disabledMod = isAutoDisabled ? run.detail?.disabledMod : ci.failed_mod;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--danger)',
        borderRadius: 12, padding: 24, maxWidth: 520, width: '100%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--danger)' }}>
              {isAutoDisabled ? 'Mod auto-disabled' : 'Mod failed to load'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{typeLabel}</div>
          </div>
        </div>

        {disabledMod && (
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 14,
          }}>
            <span style={{ fontWeight: 600, color: 'var(--danger)' }}>{disabledMod}</span>
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              {isAutoDisabled ? 'was automatically disabled' : 'caused a crash at startup'}
            </span>
          </div>
        )}

        <p style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 14, lineHeight: 1.5 }}>
          {explain}
        </p>

        <button
          style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 12,
            textDecoration: 'underline',
          }}
          onClick={() => setTechOpen(v => !v)}
        >
          {techOpen ? '▲ Hide' : '▼ Show'} technical details
        </button>

        {techOpen && (
          <pre style={{
            background: 'var(--bg-elevated, #111)', borderRadius: 6, padding: 10,
            fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            color: 'var(--text-secondary)', marginBottom: 12, maxHeight: 180, overflowY: 'auto',
          }}>
            {ci.error_excerpt || 'No additional detail available.'}
          </pre>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          {!isAutoDisabled && ci.failed_mod && onDisableAndRestart && (
            <button className="btn btn-danger btn-sm" onClick={() => onDisableAndRestart(ci.failed_mod)}>
              Disable &amp; Restart
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onDismiss}>
            {isAutoDisabled ? 'OK' : 'Dismiss'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RunStatus({ run, onForceRestart, canControl }) {
  if (!run) return null;
  const s = STATUS_LABELS[run.status] || { label: run.status, color: 'var(--text-secondary)' };
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8, marginBottom: 16,
      background: 'var(--bg-card)', border: `1px solid ${s.color}`,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
      <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        {run.triggered_by_username && `by ${run.triggered_by_username} · `}
        {new Date(run.created_at).toLocaleString()}
      </span>
      {run.status === 'pending_restart' && canControl && (
        <button className="btn btn-sm btn-warning" style={{ marginLeft: 'auto' }} onClick={onForceRestart}>
          Force Restart Now
        </button>
      )}
      {run.status === 'failed' && run.detail?.error && (
        <span style={{ fontSize: 12, color: 'var(--danger)', marginLeft: 8 }}>
          {run.detail.error.slice(0, 120)}
        </span>
      )}
    </div>
  );
}

function BrokenBadge({ reason }) {
  return (
    <span
      title={reason || 'This mod crashed the server'}
      style={{
        fontSize: 11, padding: '2px 6px', borderRadius: 4,
        background: 'rgba(239,68,68,0.15)', color: 'var(--danger)',
        border: '1px solid rgba(239,68,68,0.4)', flexShrink: 0, fontWeight: 700,
      }}
    >
      ⚠ Broken
    </span>
  );
}

function CompatBadge({ server_compatible }) {
  if (server_compatible === true)
    return <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: 'var(--success)', flexShrink: 0 }}>Server compatible</span>;
  if (server_compatible === false)
    return <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', flexShrink: 0 }}>No server target</span>;
  // null = targets list was empty — mod may still work; author just didn't tag targets
  return <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(234,179,8,0.12)', color: 'var(--warning)', flexShrink: 0 }}>Unverified</span>;
}

function CatalogSearch({ serverId, activeMods, onAdd }) {
  const [q, setQ]           = useState('');
  const [mods, setMods]     = useState([]);
  const [count, setCount]   = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef(null);
  const PAGE = 50;

  const doSearch = useCallback(async (query, off, append) => {
    if (append) setLoadingMore(true); else setSearching(true);
    try {
      const res = await api.get(`/api/servers/${serverId}/mods/catalog`, { params: { q: query, offset: off } });
      const data = res.data;
      setCount(data.count ?? 0);
      setOffset(off);
      setMods(prev => append ? [...prev, ...(data.mods || [])] : (data.mods || []));
    } catch {}
    if (append) setLoadingMore(false); else setSearching(false);
  }, [serverId]);

  useEffect(() => {
    if (!q.trim()) { setMods([]); setCount(0); setOffset(0); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q, 0, false), 350);
    return () => clearTimeout(debounceRef.current);
  }, [q, doSearch]);

  const activeRefs = new Set(activeMods.map(m => m.mod_reference));
  const hasMore = mods.length < count;

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="section-title">Add Mod</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          style={{ flex: 1 }}
          placeholder="Search ficsit.app catalog…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {searching && <span style={{ color: 'var(--text-secondary)', fontSize: 13, flexShrink: 0 }}>Searching…</span>}
        {!searching && count > 0 && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, flexShrink: 0 }}>
            {mods.length} / {count}
          </span>
        )}
      </div>
      {mods.length > 0 && (
        <div style={{
          marginTop: 8, border: '1px solid var(--border)', borderRadius: 8,
          background: 'var(--bg-card)', overflow: 'hidden',
        }}>
          {mods.map(mod => {
            const already = activeRefs.has(mod.mod_reference);
            return (
              <div key={mod.mod_reference} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderBottom: '1px solid var(--border)',
              }}>
                {mod.logo && (
                  <img src={mod.logo} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{mod.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {mod.mod_reference} {mod.version && `· v${mod.version}`}
                  </div>
                  {mod.short_description && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {mod.short_description.slice(0, 80)}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <CompatBadge server_compatible={mod.server_compatible} />
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={already}
                    onClick={() => { onAdd(mod); setQ(''); setMods([]); setCount(0); }}
                  >
                    {already ? 'Added' : '+ Add'}
                  </button>
                </div>
              </div>
            );
          })}
          {hasMore && (
            <div style={{ padding: '8px 12px', textAlign: 'center' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => doSearch(q, offset + PAGE, true)}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : `Load more (${count - mods.length} remaining)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunHistory({ runs }) {
  const [open, setOpen] = useState(false);
  if (!runs.length) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen(v => !v)}
        style={{ marginBottom: 8 }}
      >
        {open ? '▲' : '▼'} Apply History ({runs.length})
      </button>
      {open && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>By</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => {
                const s = STATUS_LABELS[r.status] || { label: r.status, color: 'var(--text-secondary)' };
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{r.triggered_by_username || '—'}</td>
                    <td><span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {r.detail?.error
                        ? r.detail.error.slice(0, 80)
                        : r.detail?.steps?.length
                        ? `${r.detail.steps.length} steps`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ModsTab({ serverId, isSatisfactory }) {
  const { user } = useAuth();
  const toast = useToast();

  const [mods, setMods] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [applyLocked, setApplyLocked] = useState(false);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(null); // null = no pending edits
  const [crashModal, setCrashModal] = useState(null); // run object to show in modal
  const [seenRunIds, setSeenRunIds] = useState(new Set());
  const pollRef = useRef(null);

  const canControl = user?.role === 'admin' || user?.role === 'mod';

  async function reload(quiet = false) {
    try {
      const [modRes, runRes] = await Promise.all([
        api.get(`/api/servers/${serverId}/mods`),
        api.get(`/api/servers/${serverId}/mods/runs`),
      ]);
      setMods(modRes.data.mods);
      setLastRun(modRes.data.lastRun);
      setApplyLocked(modRes.data.applyLocked);
      setRuns(runRes.data);

      // Auto-show crash modal for recent failed/auto_disabled runs with crash info (within 5 min)
      const FIVE_MIN = 5 * 60 * 1000;
      const newRuns = runRes.data.filter(r =>
        (r.status === 'failed' || r.status === 'rolled_back' || r.status === 'auto_disabled') &&
        r.detail?.crashInfo &&
        !seenRunIds.has(r.id) &&
        Date.now() - new Date(r.created_at).getTime() < FIVE_MIN
      );
      if (newRuns.length > 0 && !crashModal) {
        setCrashModal(newRuns[0]);
        setSeenRunIds(prev => new Set([...prev, newRuns[0].id]));
      }
    } catch (err) {
      if (!quiet) toast('Failed to load mod data', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [serverId]);

  // Poll while a run is active
  useEffect(() => {
    const active = lastRun?.status === 'running' || lastRun?.status === 'pending_restart' || applyLocked;
    if (active && !pollRef.current) {
      pollRef.current = setInterval(() => reload(true), 3000);
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {};
  }, [lastRun?.status, applyLocked]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Working copy — either pending edits or a copy of persisted mods
  const workingMods = pendingChanges !== null ? pendingChanges : mods;

  function addMod(catalogMod) {
    if (workingMods.find(m => m.mod_reference === catalogMod.mod_reference)) return;
    const next = [...workingMods, {
      mod_reference: catalogMod.mod_reference,
      display_name: catalogMod.name || catalogMod.mod_reference,
      version_constraint: '>=0.0.0',
      enabled: true,
      installed_version: null,
    }];
    setPendingChanges(next);
  }

  function removeMod(ref) {
    setPendingChanges(workingMods.filter(m => m.mod_reference !== ref));
  }

  function toggleMod(ref) {
    const mod = workingMods.find(m => m.mod_reference === ref);
    if (mod && !mod.enabled && mod.broken) {
      const ok = window.confirm(
        `"${mod.display_name || ref}" was marked as broken because it crashed the server.\n\nRe-enable it anyway? The server may crash again on the next apply.`
      );
      if (!ok) return;
    }
    setPendingChanges(workingMods.map(m =>
      m.mod_reference === ref ? { ...m, enabled: !m.enabled } : m
    ));
  }

  function discardChanges() {
    setPendingChanges(null);
  }

  async function applyChanges(force = false) {
    setApplying(true);
    try {
      const payload = workingMods.map(m => ({
        mod_reference: m.mod_reference,
        display_name: m.display_name,
        version_constraint: m.version_constraint || '>=0.0.0',
        enabled: m.enabled,
      }));
      const res = await api.post(`/api/servers/${serverId}/mods`, { mods: payload, force });
      setPendingChanges(null);
      if (res.data.status === 'pending_restart') {
        toast('Mods queued — restart pending (players online)', 'warn');
      } else if (res.data.status === 'failed') {
        toast('Apply failed — see history for details', 'error');
      } else if (res.data.locked) {
        toast('An apply is already in progress', 'warn');
      } else {
        toast('Apply started');
      }
      await reload(true);
    } catch (err) {
      toast(err.response?.data?.error || 'Apply failed', 'error');
    } finally {
      setApplying(false);
    }
  }

  async function forceRestart() {
    setApplying(true);
    try {
      await api.post(`/api/servers/${serverId}/mods/force-restart`);
      toast('Force restart issued');
      await reload(true);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error');
    } finally {
      setApplying(false);
    }
  }

  async function disableModAndRestart(modRef) {
    setCrashModal(null);
    // Disable the broken mod in the current list and apply
    const next = mods.map(m =>
      m.mod_reference === modRef ? { ...m, enabled: false } : m
    );
    setApplying(true);
    try {
      const payload = next.map(m => ({
        mod_reference: m.mod_reference,
        display_name: m.display_name,
        version_constraint: m.version_constraint || '>=0.0.0',
        enabled: m.enabled,
      }));
      await api.post(`/api/servers/${serverId}/mods`, { mods: payload });
      toast(`${modRef} disabled — restarting server`);
      await reload(true);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to disable mod', 'error');
    } finally {
      setApplying(false);
    }
  }

  const hasPending = pendingChanges !== null;
  const added = hasPending ? pendingChanges.filter(m => !mods.find(x => x.mod_reference === m.mod_reference)).length : 0;
  const removed = hasPending ? mods.filter(m => !pendingChanges.find(x => x.mod_reference === m.mod_reference)).length : 0;
  const toggled = hasPending ? pendingChanges.filter(m => {
    const orig = mods.find(x => x.mod_reference === m.mod_reference);
    return orig && orig.enabled !== m.enabled;
  }).length : 0;

  if (!isSatisfactory) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 40 }}>
        Mod management is only available for the Satisfactory server.
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)', padding: 24 }}>Loading mods…</div>;
  }

  return (
    <div>
      {/* Crash / broken-mod modal */}
      {crashModal && (
        <BrokenModModal
          run={crashModal}
          serverId={serverId}
          onDisableAndRestart={disableModAndRestart}
          onDismiss={() => setCrashModal(null)}
        />
      )}

      {/* Live run status banner */}
      <RunStatus run={lastRun} onForceRestart={forceRestart} canControl={canControl} />

      {/* Catalog search (admins/mods only) */}
      {canControl && (
        <CatalogSearch serverId={serverId} activeMods={workingMods} onAdd={addMod} />
      )}

      {/* Active mods list */}
      <div className="section-title">Active Mods</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Players must install mods via the Satisfactory Mod Manager (SMM) to see mod content in-game.
      </div>

      {workingMods.length === 0 ? (
        <div className="empty-state" style={{ padding: 24 }}>No mods installed — vanilla mode.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          {workingMods.map((mod, i) => {
            const orig = mods.find(m => m.mod_reference === mod.mod_reference);
            const isNew = !orig;
            const isToggled = orig && orig.enabled !== mod.enabled;
            const isBroken = orig?.broken && mod.enabled; // broken & not already pending-disable
            return (
              <div
                key={mod.mod_reference}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px',
                  borderBottom: i < workingMods.length - 1 ? '1px solid var(--border)' : 'none',
                  background: isBroken ? 'rgba(239,68,68,0.05)' : isNew ? 'rgba(34,197,94,0.06)' : isToggled ? 'rgba(234,179,8,0.06)' : 'var(--bg-card)',
                  opacity: mod.enabled ? 1 : 0.55,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{mod.display_name || mod.mod_reference}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' }}>{mod.mod_reference}</span>
                  {mod.installed_version && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-secondary)' }}>installed: v{mod.installed_version}</span>
                  )}
                  {isNew && <span style={{ marginLeft: 8, fontSize: 11, padding: '1px 5px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: 'var(--success)' }}>new</span>}
                  {orig?.broken && <BrokenBadge reason={orig.broken_reason} />}
                </div>
                {canControl && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      className={`btn btn-sm ${mod.enabled ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => toggleMod(mod.mod_reference)}
                      title={mod.enabled ? 'Disable mod' : (orig?.broken ? 'Re-enable (broken — may crash)' : 'Enable mod')}
                    >
                      {mod.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => removeMod(mod.mod_reference)}
                      title="Remove mod"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pending changes bar */}
      {hasPending && canControl && (
        <div style={{
          position: 'sticky', bottom: 16,
          background: 'var(--bg-elevated, var(--bg-card))',
          border: '1px solid var(--border)',
          borderRadius: 10, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        }}>
          <div style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
            Pending:
            {added > 0 && <span style={{ marginLeft: 6, color: 'var(--success)' }}>+{added} added</span>}
            {removed > 0 && <span style={{ marginLeft: 6, color: 'var(--danger)' }}>−{removed} removed</span>}
            {toggled > 0 && <span style={{ marginLeft: 6, color: 'var(--warning)' }}>{toggled} toggled</span>}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={discardChanges} disabled={applying}>
            Discard
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => applyChanges(false)}
            disabled={applying || applyLocked}
          >
            {applying ? 'Applying…' : 'Apply & Restart'}
          </button>
        </div>
      )}

      {!canControl && hasPending === false && mods.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
          Contact a server admin to request mod changes.
        </div>
      )}

      <RunHistory runs={runs} />
    </div>
  );
}
