import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import WhiteModelReference from "./WhiteModelReference";

vi.mock("@/components/shared/WhiteModelViewer", () => ({
  default: ({ labels }: { labels: { reset: string; wireframe: string } }) => <div role="img" aria-label="white model mock">
    <button type="button">{labels.reset}</button>
    <button type="button">{labels.wireframe}</button>
  </div>,
}));

function renderReference() {
  return render(<NextIntlClientProvider locale="en" messages={messages}><WhiteModelReference /></NextIntlClientProvider>);
}

describe("WhiteModelReference", () => {
  it("does not mount the 3D viewer until the reference panel is opened", () => {
    renderReference();
    expect(screen.queryByRole("img", { name: "white model mock" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(messages.recreation.whiteModel));
    expect(screen.getByRole("img", { name: "white model mock" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.recreation.whiteModelReset })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.recreation.whiteModelWireframe })).toBeInTheDocument();
  });
});
