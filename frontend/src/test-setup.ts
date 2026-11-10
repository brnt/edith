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

// jsdom has no PointerEvent; a MouseEvent with a pointerId carries what the timeline needs.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
}

// Real browsers define onpointer* properties; jsdom does not, and without them Preact registers
// the listeners under a different (capitalised) event name and the tests would not match reality.
for (const name of ["onpointerdown", "onpointermove", "onpointerup", "onpointercancel"]) {
  if (!(name in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, name, {
      value: null,
      writable: true,
      configurable: true,
    });
  }
}
