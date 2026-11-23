import { describe, expect, it } from 'vitest';
import { JobQueue } from '../lib/queue';

const tick = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const log: string[] = [];
  let active = 0;
  let maxActive = 0;
  const gates = new Map<string, () => void>();
  const queue = new JobQueue<string, string>(
    (item, ctx) =>
      new Promise((resolve, reject) => {
        active++;
        maxActive = Math.max(maxActive, active);
        log.push(`start ${item.input}`);
        ctx.setStep('Transcribing');
        ctx.onProgress({ phase: 'transcribe', fraction: 0.5, message: 'half' });
        const done = () => {
          active--;
          log.push(`end ${item.input}`);
        };
        ctx.signal.addEventListener('abort', () => {
          done();
          reject(Object.assign(new Error('aborted'), { kind: 'aborted' }));
        });
        gates.set(item.input, () => {
          done();
          resolve(`result ${item.input}`);
        });
      }),
  );
  return { queue, log, gates, maxActive: () => maxActive };
}

describe('JobQueue', () => {
  it('runs strictly one at a time, first in first out', async () => {
    const h = harness();
    h.queue.add('a', 'A');
    h.queue.add('b', 'B');
    h.queue.add('c', 'C');
    await tick();
    expect(h.log).toEqual(['start A']);
    expect(h.queue.position(h.queue.items[1].id)).toBe(1);
    expect(h.queue.position(h.queue.items[2].id)).toBe(2);
    h.gates.get('A')!();
    await tick();
    expect(h.log).toEqual(['start A', 'end A', 'start B']);
    h.gates.get('B')!();
    await tick();
    h.gates.get('C')!();
    await tick();
    expect(h.log).toEqual(['start A', 'end A', 'start B', 'end B', 'start C', 'end C']);
    expect(h.maxActive()).toBe(1);
    expect(h.queue.items.map((i) => i.status)).toEqual(['done', 'done', 'done']);
    expect(h.queue.items[0].result).toBe('result A');
  });

  it('reports step and progress for the running item', async () => {
    const h = harness();
    h.queue.add('a', 'A');
    await tick();
    const [i] = h.queue.items;
    expect(i.status).toBe('running');
    expect(i.step).toBe('Transcribing');
    expect(i.progress?.fraction).toBe(0.5);
  });

  it('cancels a queued item without running it, and a running item by aborting it', async () => {
    const h = harness();
    h.queue.add('a', 'A');
    const b = h.queue.add('b', 'B');
    h.queue.add('c', 'C');
    await tick();
    h.queue.cancel(b.id);
    h.queue.cancel(h.queue.items[0].id); // running A
    await tick();
    expect(h.log).toEqual(['start A', 'end A', 'start C']);
    expect(h.queue.items.map((i) => i.status)).toEqual(['cancelled', 'cancelled', 'running']);
    h.gates.get('C')!();
    await tick();
    expect(h.maxActive()).toBe(1);
  });

  it('a failing item does not stop the queue, and settles callbacks run before the next item starts', async () => {
    const order: string[] = [];
    const q = new JobQueue<string, string>(
      async (item) => {
        order.push(`run ${item.input}`);
        if (item.input === 'bad') throw new Error('boom');
        return 'ok';
      },
      {
        onSettled: async (i) => {
          await tick();
          order.push(`settled ${i.input} ${i.status}`);
        },
      },
    );
    q.add('bad', 'bad');
    q.add('good', 'good');
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['run bad', 'settled bad failed', 'run good', 'settled good done']);
    expect(q.items[0].error).toBe('boom');
  });

  it('remove drops only finished items', async () => {
    const h = harness();
    const a = h.queue.add('a', 'A');
    await tick();
    h.queue.remove(a.id);
    expect(h.queue.items).toHaveLength(1);
    h.gates.get('A')!();
    await tick();
    h.queue.remove(a.id);
    expect(h.queue.items).toHaveLength(0);
  });

  it('retry puts a failed item back at the end of the line and runs it again', async () => {
    let fail = true;
    const ran: string[] = [];
    const q = new JobQueue<string, string>(async (item) => {
      ran.push(item.input);
      if (item.input === 'a' && fail) throw new Error('boom');
      return 'ok';
    });
    const a = q.add('a', 'a');
    await new Promise((r) => setTimeout(r, 10));
    expect(q.items[0].status).toBe('failed');
    fail = false;
    q.retry(a.id);
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toEqual(['a', 'a']);
    expect(q.items[0]).toMatchObject({ status: 'done', error: undefined });
  });
});
