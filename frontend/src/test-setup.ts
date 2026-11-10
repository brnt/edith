import "@testing-library/jest-dom";
import { vi } from "vitest";

// jsdom implements neither canvas nor media playback.
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: "",
  setTransform: vi.fn(),
  scale: vi.fn(),
})) as unknown as HTMLCanvasElement["getContext"];
HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
HTMLMediaElement.prototype.pause = vi.fn();
