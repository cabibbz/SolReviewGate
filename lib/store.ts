import { Redis } from "@upstash/redis";
import { config } from "@/lib/config";
import type { ReviewJob } from "@/lib/types";

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  transition(key: string, expected: string[], next: ReviewJob, ttlSeconds: number): Promise<boolean>;
  addPending(id: string, score: number): Promise<void>;
  removePending(id: string): Promise<void>;
  pendingIds(limit: number): Promise<string[]>;
  addRecent(id: string, score: number): Promise<void>;
  removeRecent(id: string): Promise<void>;
  recentIds(limit: number): Promise<string[]>;
  addClientIndex(id: string, score: number): Promise<void>;
  clientIds(limit: number): Promise<string[]>;
}

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

class MemoryStore implements Store {
  private values = new Map<string, MemoryEntry>();
  private pending = new Map<string, number>();
  private recent = new Map<string, number>();
  private clients = new Map<string, number>();

  private active(key: string): MemoryEntry | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.active(key)?.value as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    if (this.active(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async del(...keys: string[]): Promise<void> {
    keys.forEach((key) => this.values.delete(key));
  }

  async transition(key: string, expected: string[], next: ReviewJob, ttlSeconds: number): Promise<boolean> {
    const current = await this.get<ReviewJob>(key);
    if (!current || !expected.includes(current.state)) return false;
    await this.set(key, next, ttlSeconds);
    return true;
  }

  async addPending(id: string, score: number): Promise<void> {
    this.pending.set(id, score);
  }

  async removePending(id: string): Promise<void> {
    this.pending.delete(id);
  }

  async pendingIds(limit: number): Promise<string[]> {
    return [...this.pending.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([id]) => id);
  }

  async addRecent(id: string, score: number): Promise<void> {
    this.recent.set(id, score);
  }

  async removeRecent(id: string): Promise<void> {
    this.recent.delete(id);
  }

  async recentIds(limit: number): Promise<string[]> {
    return [...this.recent.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }

  async addClientIndex(id: string, score: number): Promise<void> {
    this.clients.set(id, score);
  }

  async clientIds(limit: number): Promise<string[]> {
    return [...this.clients.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }
}

class RedisStore implements Store {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    return this.redis.get<T>(key);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }

  async setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, value, { ex: ttlSeconds, nx: true })) === "OK";
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys);
  }

  async transition(key: string, expected: string[], next: ReviewJob, ttlSeconds: number): Promise<boolean> {
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local current = cjson.decode(raw)
      local allowed = cjson.decode(ARGV[1])
      local ok = false
      for _, state in ipairs(allowed) do
        if current.state == state then ok = true end
      end
      if not ok then return 0 end
      redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
      return 1
    `;
    const result = await this.redis.eval(script, [key], [JSON.stringify(expected), JSON.stringify(next), ttlSeconds]);
    return Number(result) === 1;
  }

  async addPending(id: string, score: number): Promise<void> {
    await this.redis.zadd("sol:pending", { score, member: id });
  }

  async removePending(id: string): Promise<void> {
    await this.redis.zrem("sol:pending", id);
  }

  async pendingIds(limit: number): Promise<string[]> {
    return this.redis.zrange<string[]>("sol:pending", 0, Math.max(0, limit - 1));
  }

  async addRecent(id: string, score: number): Promise<void> {
    await this.redis.zadd("sol:recent", { score, member: id });
  }

  async removeRecent(id: string): Promise<void> {
    await this.redis.zrem("sol:recent", id);
  }

  async recentIds(limit: number): Promise<string[]> {
    return this.redis.zrange<string[]>("sol:recent", 0, Math.max(0, limit - 1), { rev: true });
  }

  async addClientIndex(id: string, score: number): Promise<void> {
    await this.redis.zadd("sol:clients", { score, member: id });
  }

  async clientIds(limit: number): Promise<string[]> {
    return this.redis.zrange<string[]>("sol:clients", 0, Math.max(0, limit - 1), { rev: true });
  }
}

declare global {
  var __solMemoryStore: MemoryStore | undefined;
}

export function getStore(): Store {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return new RedisStore(new Redis({ url, token }));
  if (!config.memoryStoreAllowed) throw new Error("Durable store is not configured");
  globalThis.__solMemoryStore ??= new MemoryStore();
  return globalThis.__solMemoryStore;
}

export function resetMemoryStoreForTests(): void {
  globalThis.__solMemoryStore = new MemoryStore();
}
