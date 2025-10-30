'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Task = {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  file_url: string | null;
  user_id: string;
  assignee_id: string | null;
  due_at: string | null;
};

type Profile = { id: string; email: string | null };
type Comment = { id: string; task_id: string; user_id: string; content: string; created_at: string };
type Filter = 'all' | 'active' | 'done' | 'assignedToMe';

const BUCKET = 'attachments'; // change to 'attahcments' if your bucket is misspelled

export default function Page() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | ''>('');
  const [dueLocal, setDueLocal] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  // comments drawer
  const [openCommentsFor, setOpenCommentsFor] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);

  const tasksChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const commentsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  function notify(msg: string) {
    try { if (Notification?.permission === 'granted') new Notification(msg); } catch {}
  }
  function fmtDate(d: string) {
    try { return new Date(d).toLocaleString(); } catch { return d; }
  }
  function toISOFromLocal(dl: string): string | null {
    if (!dl) return null;
    const dt = new Date(dl);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  // session
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSessionUserId(null); setLoading(false); return; }
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
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (error) { setErr(error.message); setTasks([]); }
    else setTasks((data ?? []) as Task[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!sessionUserId) return;
    (async () => {
      await Promise.all([loadProfiles(), loadTasks()]);
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      const ch = supabase
        .channel('tasks-rt-v5')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => { await loadTasks(); })
        .subscribe();
      tasksChannelRef.current = ch;
    })();
    return () => { if (tasksChannelRef.current) supabase.removeChannel(tasksChannelRef.current); };
  }, [sessionUserId]);

  // comments loader + realtime
  async function loadComments(taskId: string) {
    setCommentsLoading(true);
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    if (error) { setErr(error.message); setComments([]); }
    else setComments((data ?? []) as Comment[]);
    setCommentsLoading(false);
  }
  useEffect(() => {
    if (!openCommentsFor) {
      if (commentsChannelRef.current) { supabase.removeChannel(commentsChannelRef.current); commentsChannelRef.current = null; }
      return;
    }
    const taskId = openCommentsFor.id;
    (async () => {
      await loadComments(taskId);
      const ch = supabase
        .channel(`comments-rt-${taskId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `task_id=eq.${taskId}` },
          async () => { await loadComments(taskId); })
        .subscribe();
      commentsChannelRef.current = ch;
    })();
    return () => { if (commentsChannelRef.current) { supabase.removeChannel(commentsChannelRef.current); commentsChannelRef.current = null; } };
  }, [openCommentsFor]);

  // actions
  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionUserId) return;
    const t = title.trim();
    if (!t) return;

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

    const due_at = toISOFromLocal(dueLocal);

    const temp: Task = {
      id: crypto.randomUUID(),
      title: t,
      done: false,
      created_at: new Date().toISOString(),
      file_url,
      user_id: sessionUserId,
      assignee_id: assigneeId || null,
      due_at,
    };
    setTasks(prev => [temp, ...prev]);
    setTitle(''); setAssigneeId(''); setFile(null); setDueLocal('');

    const { error } = await supabase.from('tasks').insert({
      title: t, file_url, user_id: sessionUserId, assignee_id: assigneeId || null, due_at,
    });
    if (error) { console.error('Insert error:', (error as any)?.message, (error as any)?.details); setErr((error as any)?.message ?? 'Insert failed'); await loadTasks(); }
    else { setErr(null); notify('Task added'); }
  }

  async function toggleDone(task: Task) {
    const next = !task.done;
    const prev = tasks;
    setTasks(prev.map(x => x.id === task.id ? { ...x, done: next } : x));
    const { error } = await supabase.from('tasks').update({ done: next }).eq('id', task.id);
    if (error) { setErr(error.message); setTasks(prev); } else { setErr(null); notify(next ? 'Task completed' : 'Task re-opened'); }
  }
  async function remove(task: Task) {
    const prev = tasks;
    setTasks(prev.filter(x => x.id !== task.id));
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) { setErr(error.message); setTasks(prev); } else { setErr(null); notify('Task deleted'); }
  }
  async function clearCompleted() {
    const doneIds = tasks.filter(t => t.done).map(t => t.id);
    if (!doneIds.length) return;
    const prev = tasks;
    setTasks(prev.filter(t => !t.done));
    const { error } = await supabase.from('tasks').delete().in('id', doneIds);
    if (error) { setErr(error.message); setTasks(prev); }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!openCommentsFor || !sessionUserId) return;
    const content = commentText.trim();
    if (!content) return;

    const tmp: Comment = {
      id: crypto.randomUUID(),
      task_id: openCommentsFor.id,
      user_id: sessionUserId,
      content,
      created_at: new Date().toISOString(),
    };
    setComments(prev => [tmp, ...prev]);
    setCommentText('');

    const { error } = await supabase.from('comments').insert({
      task_id: openCommentsFor.id, user_id: sessionUserId, content,
    });
    if (error) { console.error('Comment insert error:', (error as any)?.message, (error as any)?.details); setErr((error as any)?.message ?? 'Comment failed'); await loadComments(openCommentsFor.id); }
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
      {/* ambience */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[40rem] w-[40rem] rounded-full blur-3xl opacity-30" style={{ background: 'radial-gradient(75% 75% at 50% 50%, #22d3ee33 0%, transparent 60%)' }} />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[40rem] w-[40rem] rounded-full blur-3xl opacity-30" style={{ background: 'radial-gradient(75% 75% at 50% 50%, #a78bfa33 0%, transparent 60%)' }} />

      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500 animate-pulse" />
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Task <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400">Lite</span>
          </h1>
          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
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
          <div className="p-5 sm:p-6 overflow-x-hidden">
            {/* FORM: two-row layout on sm+ */}
            <form onSubmit={addTask} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              {/* Row 1 */}
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Task title"
                className="sm:col-span-6 rounded-2xl bg-zinc-900/80 border border-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-400/30 min-w-0 w-full"
              />
              <input
                type="datetime-local"
                value={dueLocal}
                onChange={e => setDueLocal(e.target.value)}
                className="sm:col-span-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-400/30 min-w-0 w-full"
              />
              <select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
                className="sm:col-span-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-400/30 min-w-0 w-full"
              >
                <option value="">Unassigned</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.email ?? p.id}</option>
                ))}
              </select>

              {/* Row 2: Actions, full width, right-aligned */}
              <div className="sm:col-span-12 flex justify-end gap-2">
                <input
                  id="attach"
                  type="file"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                <label
                  htmlFor="attach"
                  className="rounded-2xl px-4 py-3 border border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 cursor-pointer text-sm whitespace-nowrap"
                  title={file ? `Selected: ${file.name}` : 'Attach file'}
                >
                  {file ? 'Attached ✓' : 'Attach'}
                </label>

                <button className="rounded-2xl px-5 py-3 bg-white text-black font-medium hover:opacity-90 active:opacity-80 whitespace-nowrap">
                  Add
                </button>
              </div>
            </form>

            {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

            {/* controls */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1">
                {(['all','active','done','assignedToMe'] as Filter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`capitalize px-3 py-1.5 rounded-xl text-sm transition ${
                      filter === f
                        ? 'bg-gradient-to-r from-cyan-400/20 to-fuchsia-400/20 text-zinc-50 border border-white/10'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {f === 'assignedToMe' ? 'Assigned To Me' : f}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-3">
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
                  {filtered.map(t => {
                    const overdue = t.due_at ? new Date(t.due_at) < new Date() : false;
                    return (
                      <li key={t.id} className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition hover:border-cyan-400/30 hover:bg-white/[0.055]">
                        <button onClick={() => toggleDone(t)} className="flex items-center gap-3">
                          <span className={`inline-block h-5 w-5 rounded-md border transition ${t.done ? 'bg-cyan-400 border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.45)]' : 'border-zinc-600 group-hover:border-zinc-400'}`} />
                          <div className="flex flex-col items-start">
                            <span className={t.done ? 'line-through text-zinc-500' : 'text-zinc-100'}>{t.title}</span>
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              {t.assignee_id && (
                                <span className="text-zinc-400">
                                  Assigned to: {profiles.find(p => p.id === t.assignee_id)?.email ?? t.assignee_id}
                                </span>
                              )}
                              {t.file_url && (
                                <a href={t.file_url} target="_blank" className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2">
                                  attachment
                                </a>
                              )}
                              {t.due_at && (
                                <span className={overdue ? 'text-red-400' : 'text-emerald-400'}>
                                  Due {new Date(t.due_at).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setOpenCommentsFor(t)}
                            className="text-sm text-zinc-400 hover:text-cyan-300 transition"
                            title="Comments"
                          >
                            💬 Comments
                          </button>
                          <button onClick={() => remove(t)} className="text-sm text-zinc-400 hover:text-red-400 transition" title="Delete">
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <div className="h-[2px] w-full bg-gradient-to-r from-fuchsia-400/60 via-cyan-400/60 to-fuchsia-400/60" />
        </div>
      </div>

      {/* COMMENTS DRAWER */}
      {openCommentsFor && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpenCommentsFor(null)} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[28rem] bg-zinc-950 border-l border-white/10 shadow-2xl p-5 sm:p-6 overflow-y-auto">
            <div className="flex items-start gap-3">
              <h2 className="text-lg font-semibold">Comments</h2>
              <button className="ml-auto text-zinc-400 hover:text-zinc-200" onClick={() => setOpenCommentsFor(null)}>✕</button>
            </div>
            <div className="mt-2 text-sm text-zinc-400">
              For task: <span className="text-zinc-200">{openCommentsFor.title}</span>
            </div>
            {openCommentsFor.due_at && (
              <div className="mt-1 text-xs text-zinc-400">
                Due: {fmtDate(openCommentsFor.due_at)}
              </div>
            )}

            <form onSubmit={addComment} className="mt-4 flex gap-2">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Write a comment…"
                className="flex-1 rounded-xl bg-zinc-900/80 border border-zinc-800 px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-400/30"
              />
              <button className="rounded-xl px-4 py-2 bg-white text-black font-medium hover:opacity-90 active:opacity-80">
                Send
              </button>
            </form>

            <div className="mt-4">
              {commentsLoading ? (
                <p className="text-zinc-400">Loading comments…</p>
              ) : comments.length === 0 ? (
                <p className="text-zinc-500">No comments yet.</p>
              ) : (
                <ul className="space-y-3">
                  {comments.map(c => {
                    const who = profiles.find(p => p.id === c.user_id)?.email ?? c.user_id;
                    return (
                      <li key={c.id} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                          <span>{who}</span>
                          <span>•</span>
                          <span>{new Date(c.created_at).toLocaleString()}</span>
                        </div>
                        <div className="mt-1 text-sm text-zinc-100 whitespace-pre-wrap">
                          {c.content}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
