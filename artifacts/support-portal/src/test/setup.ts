import "@testing-library/jest-dom";
import { vi, beforeEach } from "vitest";

// Stub navigator.clipboard so copy tests don't crash in jsdom
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  configurable: true,
});

// Stub localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// Reset localStorage before each test
beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});
