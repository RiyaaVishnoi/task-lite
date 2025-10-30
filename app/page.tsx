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
type Filter = 'all' | 'active' | 'done' | 'assignedToMe' | 'assignedByMe';

const BUCKET = 'attachments'; // change to match your Supabase bucket

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
  const [openCommentsFor, setOpenCommentsFor] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);

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

  // Load user session
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSessionUserId(session?.user?.id ?? null);
      setLoading(false);
    })();
  }, []);

  async function loadProfiles() {
    const { data, error } = await supabase.from('profiles').select('id,email');
    if (!error) setProfiles((data ?? []) as Profile[]);
  }

  async function loadTasks() {
    setLoading(true);
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    setLoading(false);
    if (error) return setErr(error.message);
    setTasks((data ?? []) as Task[]);
  }

  useEffect(() => {
    if (!sessionUserId) return;
    (async () => {
      await Promise.all([loadProfiles(), loadTasks()]);
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    })();
  }, [sessionUserId]);

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
    if (error) { console.error('Insert error:', error); await loadTasks(); }
    else notify('Task added');
  }

  async function toggleDone(task: Task) {
    const next = !task.done;
    setTasks(prev => prev.map(x => x.id === task.id ? { ...x, done: next } : x));
    const { error } = await supabase.from('tasks').update({ done: next }).eq('id', task.id);
    if (error) setErr(error.message);
  }

  async function remove(task: Task) {
    const prev = tasks;
    setTasks(prev.filter(x => x.id !== task.id));
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) setErr(error.message);
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!openCommentsFor || !sessionUserId) return;
    const content = commentText.trim();
    if (!content) return;

    const { error } = await supabase.from('comments').insert({
      task_id: openCommentsFor.id, user_id: sessionUserId, content,
    });
    if (error) console.error('Comment error:', error);
    else { setCommentText(''); await loadComments(openCommentsFor.id); }
  }

  async function loadComments(taskId: string) {
    setCommentsLoading(true);
    const { data, error } = await supabase.from('comments').select('*').eq('task_id', taskId).order('created_at', { ascending: false });
    setCommentsLoading(false);
    if (!error) setComments((data ?? []) as Comment[]);
  }

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return t.done;
      if (filter === 'assignedToMe') return t.assignee_id === sessionUserId;
      if (filter === 'assignedByMe') return t.user_id === sessionUserId && t.assignee_id && t.assignee_id !== sessionUserId;
      return true;
    });
  }, [tasks, filter, sessionUserId]);

  if (!sessionUserId && !loading) {
    return (
      <main className="min-h-screen grid place-items-center text-white bg-black">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Task Lite</h1>
          <p className="text-zinc-400 mb-3">Please sign in to continue.</p>
          <a href="/login" className="border border-white/20 px-4 py-2 rounded-xl hover:bg-white/10">Go to Login</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-semibold bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">Task Lite</h1>
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }}
            className="border border-white/20 px-3 py-1.5 rounded-xl hover:bg-white/10 text-sm"
          >
            Sign Out
          </button>
        </header>

        {/* Form */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <form onSubmit={addTask} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Task title"
              className="sm:col-span-6 bg-zinc-900/80 border border-zinc-800 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-cyan-400/30"
            />
            <input
              type="datetime-local"
              value={dueLocal}
              onChange={e => setDueLocal(e.target.value)}
              className="sm:col-span-3 bg-zinc-900/80 border border-zinc-800 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-cyan-400/30"
            />
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="sm:col-span-3 bg-zinc-900/80 border border-zinc-800 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-cyan-400/30"
            >
              <option value="">Unassigned</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.email ?? p.id}</option>
              ))}
            </select>

            <div className="sm:col-span-12 flex justify-end gap-2">
              <input id="attach" type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
              <label htmlFor="attach" className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm cursor-pointer hover:bg-white/10">
                {file ? 'Attached ✓' : 'Attach'}
              </label>
              <button className="rounded-2xl px-5 py-3 bg-white text-black font-medium hover:opacity-90">Add</button>
            </div>
          </form>
        </div>

        {/* Filters */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="inline-flex border border-white/10 rounded-2xl p-1 bg-white/5">
            {(['all','active','done','assignedToMe','assignedByMe'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`capitalize px-3 py-1.5 rounded-xl text-sm ${
                  filter === f
                    ? 'bg-gradient-to-r from-cyan-400/20 to-fuchsia-400/20 text-zinc-50'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {f === 'assignedToMe' ? 'To Me' : f === 'assignedByMe' ? 'By Me' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Task list */}
        <div className="mt-5">
          {loading ? (
            <p className="text-zinc-400">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-zinc-400">No tasks found.</p>
          ) : (
            <ul className="space-y-2">
              {filtered.map(t => {
                const overdue = t.due_at ? new Date(t.due_at) < new Date() : false;
                const creator = profiles.find(p => p.id === t.user_id)?.email ?? t.user_id;
                const assignee = profiles.find(p => p.id === t.assignee_id)?.email ?? t.assignee_id;
                return (
                  <li key={t.id} className="group flex flex-col sm:flex-row sm:items-center sm:justify-between border border-white/10 bg-white/5 rounded-2xl p-4 hover:border-cyan-400/30 transition">
                    <div className="flex items-start gap-3">
                      <span
                        onClick={() => toggleDone(t)}
                        className={`mt-1 inline-block h-5 w-5 rounded-md border cursor-pointer ${
                          t.done ? 'bg-cyan-400 border-cyan-400' : 'border-zinc-600'
                        }`}
                      />
                      <div>
                        <p className={t.done ? 'line-through text-zinc-500' : 'text-zinc-100'}>{t.title}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs mt-1 text-zinc-400">
                          {t.assignee_id && (
                            <span>Assigned to: {assignee}</span>
                          )}
                          <span>
                            {t.assignee_id === sessionUserId
                              ? `Assigned by: ${creator}`
                              : `Created by: ${creator}`}
                          </span>
                          {t.file_url && (
                            <a href={t.file_url} target="_blank" className="text-cyan-300 underline">
                              Attachment
                            </a>
                          )}
                          {t.due_at && (
                            <span className={overdue ? 'text-red-400' : 'text-emerald-400'}>
                              Due {new Date(t.due_at).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-3 sm:mt-0 sm:ml-3">
                      <button onClick={() => setOpenCommentsFor(t)} className="text-sm text-zinc-400 hover:text-cyan-300">
                        💬 Comments
                      </button>
                      <button onClick={() => remove(t)} className="text-sm text-zinc-400 hover:text-red-400">
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Comments Drawer */}
        {openCommentsFor && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpenCommentsFor(null)} />
            <div className="absolute right-0 top-0 h-full w-full sm:w-[28rem] bg-zinc-950 border-l border-white/10 p-6 overflow-y-auto">
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-semibold">Comments</h2>
                <button onClick={() => setOpenCommentsFor(null)}>✕</button>
              </div>
              <p className="text-sm text-zinc-400 mt-2">For task: <span className="text-white">{openCommentsFor.title}</span></p>

              <form onSubmit={addComment} className="mt-4 flex gap-2">
                <input
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 rounded-xl bg-zinc-900/80 border border-zinc-800 px-3 py-2"
                />
                <button className="rounded-xl px-4 py-2 bg-white text-black font-medium">Send</button>
              </form>

              <div className="mt-4">
                {commentsLoading ? (
                  <p className="text-zinc-400">Loading...</p>
                ) : comments.length === 0 ? (
                  <p className="text-zinc-500">No comments yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {comments.map(c => {
                      const who = profiles.find(p => p.id === c.user_id)?.email ?? c.user_id;
                      return (
                        <li key={c.id} className="border border-white/10 bg-white/5 rounded-xl p-3">
                          <div className="text-xs text-zinc-400">{who} • {new Date(c.created_at).toLocaleString()}</div>
                          <div className="text-sm mt-1 text-zinc-100">{c.content}</div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
