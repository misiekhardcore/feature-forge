export abstract class Registry<T> {
  protected readonly items = new Map<string, T>();

  get(name: string): T | undefined {
    return this.items.get(name);
  }

  getAll(): readonly T[] {
    return Array.from(this.items.values());
  }

  set(name: string, item: T): void {
    if (this.items.has(name)) {
      throw new Error(`Item already registered: ${name}`);
    }
    this.items.set(name, item);
  }

  unregister(name: string): boolean {
    return this.items.delete(name);
  }

  where(predicate: (item: T) => boolean): readonly T[] {
    return Array.from(this.items.values()).filter(predicate);
  }

  has(name: string): boolean {
    return this.items.has(name);
  }

  get size(): number {
    return this.items.size;
  }
}
