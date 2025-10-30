'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Task = {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  file_url: string | null;
  user_id: string;       // creator
  assignee_id: string | null;
};

type Profile = { id: string; email: string | null };

type Filter = 'all' | 'active' | 'done' | 'assignedToMe';

const BUCKET = 'attachments'; // change to 'attahcments' if your bucket is misspelled

export default function Page() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Session gate
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // not signed in → show sign-in link
        setSessionUserId(null);
        setLoading(false);
        return;
      }
      setSessionUserId(session.user.id);
    })();
  }, []);

  async function loadProfiles() {
    const { data, error } = await supabase.from('profiles').select('id,email').order('email');
    if (error) setErr(error.message);
    else setProfiles((data ?? []) as Profile[]);
  }

  async function loadTasks() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { setErr(error.message); setTasks([]); }
    else setTasks((data ?? []) as Task[]);
    setLoading(false);
  }

  // After we know user id, load data + realtime
  useEffect(() => {
    if (!sessionUserId) return;
    (async () => {
      await Promise.all([loadProfiles(), loadTasks()]);

      // realtime (RLS will scope rows to creator/assignee)
      const ch = supabase
        .channel('tasks-rt-v2')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => {
          await loadTasks();
        })
        .subscribe();
      channelRef.current = ch;

      // ask notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    })();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [sessionUserId]);

  function notify(msg: string) {
    try { if (Notification?.permission === 'granted') new Notification(msg); } catch {}
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionUserId) return;
    const t = title.trim();
    if (!t) return;

    // upload file first (optional)
    let file_url: string | null = null;
    try {
      if (file) {
        const path = `${sessionUserId}/${crypto.randomUUID()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
        if (upErr) throw upErr;
        const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path);
        file_url = pub?.publicUrl ?? null;
      }
    } catch (e: any) {
      setErr(e?.message ?? 'File upload failed');
      file_url = null;
    }

    // optimistic insert
    const temp: Task = {
      id: crypto.randomUUID(),
      title: t,
      done: false,
      created_at: new Date().toISOString(),
      file_url,
      user_id: sessionUserId,
      assignee_id: assigneeId || null,
    };
    setTasks(prev => [temp, ...prev]);
    setTitle('');
    setAssigneeId('');
    setFile(null);

    const { error } = await supabase.from('tasks').insert({
      title: t,
      file_url,
      user_id: sessionUserId,
      assignee_id: assigneeId || null,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('Insert error:', (error as any)?.message, (error as any)?.details);
      setErr((error as any)?.message ?? 'Insert failed');
      await loadTasks();
    } else {
      setErr(null);
      notify('Task added');
    }
  }

  async function toggleDone(task: Task) {
    const next = !task.done;
    const prev = tasks;
    setTasks(prev.map(x => x.id === task.id ? { ...x, done: next } : x));
    const { error } = await supabase.from('tasks').update({ done: next }).eq('id', task.id);
    if (error) { setErr(error.message); setTasks(prev); }
    else { setErr(null); notify(next ? 'Task completed' : 'Task re-opened'); }
  }

  async function remove(task: Task) {
    const prev = tasks;
    setTasks(prev.filter(x => x.id !== task.id));
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) { setErr(error.message); setTasks(prev); }
    else { setErr(null); notify('Task deleted'); }
  }

  async function clearCompleted() {
    const doneIds = tasks.filter(t => t.done).map(t => t.id);
    if (!doneIds.length) return;
    const prev = tasks;
    setTasks(prev.filter(t => !t.done));
    const { error } = await supabase.from('tasks').delete().in('id', doneIds);
    if (error) { setErr(error.message); setTasks(prev); }
  }

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return t.done;
      if (filter === 'assignedToMe') return t.assignee_id === sessionUserId;
      return true;
    });
  }, [tasks, filter, sessionUserId]);

  if (sessionUserId === null && !loading) {
    return (
      <main className="min-h-dvh grid place-items-center bg-black text-white p-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Task Lite</h1>
          <p className="text-zinc-400 mb-4">Please sign in to continue.</p>
          <a href="/login" className="rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10">Go to Login</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh relative overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute -top-40 -left-40 h-[40rem] w-[40rem] rounded-full blur-3xl opacity-30"
        style={{ background: 'radial-gradient(75% 75% at 50% 50%, #22d3ee33 0%, transparent 60%)' }} />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[40rem] w-[40rem] rounded-full blur-3xl opacity-30"
        style={{ background: 'radial-gradient(75% 75% at 50% 50%, #a78bfa33 0%, transparent 60%)' }} />

      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500 animate-pulse" />
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Task <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400">Lite</span></h1>
          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
            <span className="hidden sm:inline">Signed in</span>
            <button
              onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }}
              className="rounded-xl border border-white/20 px-3 py-1 hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400/60 via-fuchsia-400/60 to-cyan-400/60" />
          <div className="p-5 sm:p-6">
            {/* form */}
            <form onSubmit={addTask} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Task title"
                className="sm:col-span-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-400/30"
              />

              {/* assignee dropdown */}
              <select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                className="sm:col-span-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-400/30"
              >
                <option value="">Unassigned</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.email ?? p.id}
                  </option>
                ))}
              </select>

              <div className="sm:col-span-3 flex items-center gap-2">
                <input
                  type="file"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  className="flex-1 text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-xl file:border file:border-zinc-700 file:bg-zinc-900 file:text-zinc-200 file:hover:bg-zinc-800"
                />
                <button className="rounded-2xl px-5 py-3 bg-white text-black font-medium hover:opacity-90 active:opacity-80">
                  Add
                </button>
              </div>
            </form>

            {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

            {/* controls */}
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1">
                {(['all','active','done','assignedToMe'] as Filter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`capitalize px-3 py-1.5 rounded-xl text-sm transition ${
                      filter === f ? 'bg-gradient-to-r from-cyan-400/20 to-fuchsia-400/20 text-zinc-50 border border-white/10' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {f === 'assignedToMe' ? 'assigned to me' : f}
                  </button>
                ))}
              </div>

              <div className="sm:ml-auto flex items-center gap-3">
                <span className="text-sm text-zinc-400">
                  {tasks.filter(t => !t.done).length} remaining
                </span>
                <button onClick={clearCompleted} className="text-sm text-zinc-400 hover:text-red-400 transition">
                  Clear completed
                </button>
              </div>
            </div>

            {/* list */}
            <div className="mt-5">
              {loading ? (
                <p className="text-zinc-400">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-zinc-400">No tasks {filter === 'all' ? 'yet' : `in ${filter}` }.</p>
              ) : (
                <ul className="space-y-2">
                  {filtered.map(t => (
                    <li key={t.id} className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition hover:border-cyan-400/30 hover:bg-white/[0.055]">
                      <button onClick={() => toggleDone(t)} className="flex items-center gap-3">
                        <span className={`inline-block h-5 w-5 rounded-md border transition ${t.done ? 'bg-cyan-400 border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.45)]' : 'border-zinc-600 group-hover:border-zinc-400'}`} />
                        <div className="flex flex-col items-start">
                          <span className={t.done ? 'line-through text-zinc-500' : 'text-zinc-100'}>{t.title}</span>
                          <div className="flex flex-wrap items-center gap-3">
                            {t.assignee_id && (
                              <span className="text-xs text-zinc-400">
                                Assigned to: {profiles.find(p => p.id === t.assignee_id)?.email ?? t.assignee_id}
                              </span>
                            )}
                            {t.file_url && (
                              <a href={t.file_url} target="_blank" className="text-xs text-cyan-300 hover:text-cyan-200 underline underline-offset-2">
                                attachment
                              </a>
                            )}
                          </div>
                        </div>
                      </button>
                      <button onClick={() => remove(t)} className="text-sm text-zinc-400 hover:text-red-400 transition" title="Delete">
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="h-[2px] w-full bg-gradient-to-r from-fuchsia-400/60 via-cyan-400/60 to-fuchsia-400/60" />
        </div>
      </div>
    </main>
  );
}
