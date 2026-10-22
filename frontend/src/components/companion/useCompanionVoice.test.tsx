import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCompanionVoice } from "./useCompanionVoice";

function Controls({ name }: { name: string }) {
  const voice = useCompanionVoice(() => {});
  return <div><button onClick={voice.toggleListening}>{name} listen</button><button onClick={() => voice.speak("描述", true)}>{name} speak</button><span>{name}: {voice.listening ? "listening" : voice.speaking ? "speaking" : "idle"}</span></div>;
}
afterEach(() => vi.unstubAllGlobals());
it("hands off microphone and speech between controls and ignores stale results", () => {
  const instances: any[] = [];
  vi.stubGlobal("SpeechRecognition", class {
    abort = vi.fn(); stop = vi.fn(); start = vi.fn();
    constructor() { instances.push(this); }
  });
  vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: vi.fn() });
  render(<><Controls name="date" /><Controls name="description" /></>);
  fireEvent.click(screen.getByText("date listen"));
  expect(screen.getByText("date: listening")).toBeInTheDocument();
  fireEvent.click(screen.getByText("description listen"));
  expect(instances[0].abort).toHaveBeenCalled();
  expect(instances[0].onresult).toBeNull();
  expect(screen.getByText("date: idle")).toBeInTheDocument();
  fireEvent.click(screen.getByText("date speak"));
  expect(instances[1].abort).toHaveBeenCalled();
  expect(screen.getByText("description: idle")).toBeInTheDocument();
  expect(screen.getByText("date: speaking")).toBeInTheDocument();
  fireEvent.click(screen.getByText("description speak"));
  expect(screen.getByText("date: idle")).toBeInTheDocument();
  expect(screen.getByText("description: speaking")).toBeInTheDocument();
});
