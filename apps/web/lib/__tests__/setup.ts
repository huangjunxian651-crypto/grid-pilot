import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node 22+ 自带实验性全局 localStorage（未配 --localstorage-file 时为不可用的
// 存根），会遮蔽 jsdom 的实现导致 `localStorage.getItem` 读 undefined。
// 统一装一个内存实现，保证测试环境行为与浏览器一致。
function createMemoryLocalStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store = new Map();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

Object.defineProperty(globalThis, "localStorage", {
  value: createMemoryLocalStorage(),
  writable: true,
  configurable: true,
});

afterEach(() => {
  globalThis.localStorage.clear();
  cleanup();
});
