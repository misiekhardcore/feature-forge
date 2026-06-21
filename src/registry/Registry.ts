import { Registrable } from "./Registrable";

export abstract class Registry<T extends Registrable> {
  protected readonly items = new Map<string, T>();

  get(name: string): T | undefined {
    return this.items.get(name);
  }

  getAll(): readonly T[] {
    return Array.from(this.items.values());
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
