export interface Vault {
  set(token: string, value: string): void;
  get(token: string): string | undefined;
  has(token: string): boolean;
  delete(token: string): boolean;
  size(): number;
  clear(): void;
}
