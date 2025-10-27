'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Task = {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  file_url: string | null;
};

type Filter = 'all' | 'active' | 'done';

const BUCKET = 'attachments'; // <-- change to 'attahcments' if your bucket is misspelled

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const userIdRef = useRef<string | null>(null);

  // --- web notifications (lightweight) ---
  function notify(msg: string) {
    try {
      if (typeof window !== 'undefined' && Notification?.permission === 'granted') {
        new Notification(msg);
      }
    } catch { /* noop */ }
  }

  async function ensureAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) { setErr(error.message); return; }
      userIdRef.current = data.user?.id ?? null;
    } else {
      userIdRef.current = session.user?.id ?? null;
    }
    setAuthReady(true);
  }

  async function load() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { setErr(error.message); setTasks([]); }
    else { setTasks((data ?? []) as Task[]); }
    setLoading(false);
  }

  // init: auth + data + realtime + request notif permission
  useEffect(() => {
    (async () => {
      await ensureAuth();
      await load();

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }

      const channel = supabase
        .channel('tasks-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => { await load(); })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    })();
  }, []);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || !authReady || !userIdRef.current) return;

    // Upload file first (if any)
    let file_url: string | null = null;
    try {
      if (file) {
        const path = `${userIdRef.current}/${crypto.randomUUID()}-${file.name}`;
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
    };
    setTasks(prev => [temp, ...prev]);
    setTitle('');
    setFile(null);

    const { error } = await supabase.from('tasks').insert({
      title: t,
      file_url,
      user_id: userIdRef.current,
    });

    if (error) {
      // eslint-disable-next-line no-console
      console.error('Insert error:', (error as any)?.message, (error as any)?.details, (error as any)?.hint, (error as any)?.code);
      setErr((error as any)?.message ?? 'Insert failed');
      await load();
    } else {
      setErr(null);
      notify('Task added');
    }
  }

  async function toggleDone(task: Task) {
    const next = !task.done;
    const prev = tasks;
    setTasks(prev.map(x => (x.id === task.id ? { ...x, done: next } : x)));
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

  const filtered = tasks.filter(t =>
    filter === 'all' ? true : filter === 'active' ? !t.done : t.done
  );
  const remaining = tasks.filter(t => !t.done).length;
  const canSubmit = authReady && title.trim().length > 0;

  return (
    <main
      className="
        min-h-dvh relative overflow-hidden
        bg-black text-white
      "
    >
      {/* ambient gradients */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[40rem] w-[40rem] rounded-full blur-3xl opacity-30"
           style={{ background: 'radial-gradient(75% 75% at 50% 50%, #22d3ee33 0%, transparent 60%)' }} />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[40rem] w-[40rem] rounded-full blur-3xl opacity-30"
           style={{ background: 'radial-gradient(75% 75% at 50% 50%, #a78bfa33 0%, transparent 60%)' }} />

      {/* content */}
      <div className="mx-auto max-w-3xl px-4 py-14">
        {/* header / brand */}
        <div className="mb-8 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500 animate-pulse" />
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Task <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400">Lite</span>
          </h1>
          <div className="ml-auto text-xs text-zinc-400">
            {authReady ? 'Signed in (anonymous)' : 'Signing in…'}
          </div>
        </div>

        {/* card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
          {/* neon top border */}
          <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400/60 via-fuchsia-400/60 to-cyan-400/60" />

          <div className="p-5 sm:p-6">
            {/* input row */}
            <form onSubmit={addTask} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1 relative group">
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="What needs doing?"
                  disabled={!authReady}
                  className="
                    w-full rounded-2xl bg-zinc-900/80 border border-zinc-800
                    px-4 py-3 outline-none
                    transition
                    focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400/40
                    disabled:opacity-50
                  "
                />
                {/* glow on focus */}
                <span className="pointer-events-none absolute -inset-0.5 rounded-2xl opacity-0 group-focus-within:opacity-100 transition"
                      style={{ background: 'radial-gradient(60% 60% at 50% 0%, rgba(56,189,248,0.12), transparent 70%)' }} />
              </div>

              <div className="flex gap-3">
                <label className="text-xs text-zinc-400 flex items-center gap-2 cursor-pointer">
                  <input
                    type="file"
                    onChange={e => setFile(e.target.files?.[0] ?? null)}
                    className="text-xs file:mr-3 file:px-3 file:py-1.5 file:rounded-xl file:border file:border-zinc-700
                               file:bg-zinc-900 file:text-zinc-200 file:hover:bg-zinc-800"
                  />
                </label>

                <button
                  disabled={!canSubmit}
                  className="
                    relative rounded-2xl px-5 py-3 font-medium
                    bg-white text-black
                    transition hover:opacity-90 active:opacity-80
                    disabled:opacity-40 disabled:cursor-not-allowed
                  "
                >
                  <span>Add</span>
                  {/* subtle glow */}
                  <span className="absolute inset-0 -z-10 rounded-2xl blur-md bg-gradient-to-r from-cyan-400/40 to-fuchsia-400/40 opacity-0 group-hover:opacity-100" />
                </button>
              </div>
            </form>

            {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

            {/* controls */}
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1">
                {(['all','active','done'] as Filter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`
                      capitalize px-3 py-1.5 rounded-xl text-sm transition
                      ${filter === f ? 'bg-gradient-to-r from-cyan-400/20 to-fuchsia-400/20 text-zinc-50 border border-white/10' : 'text-zinc-400 hover:text-zinc-200'}
                    `}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <div className="sm:ml-auto flex items-center gap-3">
                <span className="text-sm text-zinc-400">{remaining} remaining</span>
                <button
                  onClick={clearCompleted}
                  className="text-sm text-zinc-400 hover:text-red-400 transition"
                >
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
                    <li
                      key={t.id}
                      className="
                        group flex items-center justify-between
                        rounded-2xl border border-white/10 bg-white/[0.035]
                        p-3 transition
                        hover:border-cyan-400/30 hover:bg-white/[0.055]
                      "
                    >
                      <button
                        onClick={() => toggleDone(t)}
                        className="flex items-center gap-3"
                      >
                        <span className={`
                          inline-block h-5 w-5 rounded-md border transition
                          ${t.done ? 'bg-cyan-400 border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.45)]' : 'border-zinc-600 group-hover:border-zinc-400'}
                        `} />
                        <div className="flex flex-col items-start">
                          <span className={t.done ? 'line-through text-zinc-500' : 'text-zinc-100'}>
                            {t.title}
                          </span>
                          {t.file_url && (
                            <a
                              href={t.file_url}
                              target="_blank"
                              className="text-xs text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                            >
                              attachment
                            </a>
                          )}
                        </div>
                      </button>

                      <button
                        onClick={() => remove(t)}
                        className="text-sm text-zinc-400 hover:text-red-400 transition"
                        title="Delete"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* neon bottom border */}
          <div className="h-[2px] w-full bg-gradient-to-r from-fuchsia-400/60 via-cyan-400/60 to-fuchsia-400/60" />
        </div>
      </div>
    </main>
  );
}
