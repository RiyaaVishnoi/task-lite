'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Task = { id: string; title: string; done: boolean; created_at: string };

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      setErr(error.message);
      setTasks([]); // keep UI consistent on failure
    } else {
      setTasks((data ?? []) as Task[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;

    // optimistic insert
    const temp: Task = {
      id: crypto.randomUUID(),
      title: t,
      done: false,
      created_at: new Date().toISOString()
    };
    setTasks(prev => [temp, ...prev]);
    setTitle('');

    const { error } = await supabase.from('tasks').insert({ title: t });
    if (error) {
      setErr(error.message);
      await load(); // recover from optimistic write
    } else {
      setErr(null);
    }
  }

  async function toggleDone(task: Task) {
    const next = !task.done;

    // optimistic toggle
    const prev = tasks;
    setTasks(prev.map(x => (x.id === task.id ? { ...x, done: next } : x)));

    const { error } = await supabase.from('tasks').update({ done: next }).eq('id', task.id);
    if (error) {
      setErr(error.message);
      setTasks(prev); // rollback
    } else {
      setErr(null);
    }
  }

  async function remove(task: Task) {
    // optimistic delete
    const prev = tasks;
    setTasks(prev.filter(x => x.id !== task.id));

    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      setErr(error.message);
      setTasks(prev); // rollback
    } else {
      setErr(null);
    }
  }

  const canSubmit = title.trim().length > 0;

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950/60 backdrop-blur p-6 shadow-2xl">
        <h1 className="text-2xl font-semibold mb-4">Task Lite</h1>

        <form onSubmit={addTask} className="flex gap-2 mb-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What needs doing?"
            className="flex-1 rounded-xl bg-zinc-900/80 border border-zinc-700 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50"
          />
          <button
            disabled={!canSubmit}
            className="rounded-xl px-4 py-2 bg-white text-black font-medium hover:opacity-90 active:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Add
          </button>
        </form>

        {err && <p className="mb-4 text-sm text-red-400">{err}</p>}

        {loading ? (
          <p className="text-zinc-400">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="text-zinc-400">No tasks yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map(t => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 p-3"
              >
                <button onClick={() => toggleDone(t)} className="flex items-center gap-3 group">
                  <span
                    className={`inline-block h-5 w-5 rounded border transition
                    ${t.done ? 'bg-emerald-400 border-emerald-400' : 'border-zinc-500 group-hover:border-zinc-400'}`}
                  />
                  <span className={t.done ? 'line-through text-zinc-500' : 'text-zinc-100'}>
                    {t.title}
                  </span>
                </button>
                <button
                  onClick={() => remove(t)}
                  className="text-sm text-zinc-400 hover:text-red-400 transition"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
