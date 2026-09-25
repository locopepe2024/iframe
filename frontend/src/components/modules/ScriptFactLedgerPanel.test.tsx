// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { api } from "@/lib/api";
import ScriptFactLedgerPanel from "./ScriptFactLedgerPanel";

beforeEach(() => {
    vi.restoreAllMocks();
});

it("keeps Director imports uncertain and separates saving a draft from confirming it", async () => {
    const facts = [{
        fact_id: "c1-characters",
        kind: "character",
        subject_ids: [],
        phase: null,
        source_revision: 3,
        source_ranges: [],
        value: { subject: "Zhou Han", value: "age not specified", source_refs: ["Scene 1"] },
        evidence_status: "uncertain" as const,
        conflict_group_id: null,
    }];
    vi.spyOn(api, "getScriptFactLedgerDraft").mockResolvedValue({
        project_id: "film", draft_revision: 0, source_revision: null, facts: [],
    });
    vi.spyOn(api, "listScriptFactLedgerRevisions")
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
            revision: 1, source_revision: 3, fact_count: 1, confirmed_at: 10,
        }]);
    const save = vi.spyOn(api, "saveScriptFactLedgerDraft").mockResolvedValue({
        draft_revision: 1,
        facts,
    });
    const confirm = vi.spyOn(api, "confirmScriptFactLedger").mockResolvedValue({});
    vi.spyOn(api, "getScriptFactLedger").mockResolvedValue({
        project_id: "film",
        ledger_revision: 1,
        source_revision: 3,
        source_revision_id: "source-r3:test",
        source_version: "test",
        offset_unit: "unicode_codepoint_half_open",
        offset: 0,
        total_facts: 1,
        truncated: false,
        facts: [{ ...facts[0], evidence: [] }],
    });

    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <ScriptFactLedgerPanel
                projectId="film"
                sourceRevision={3}
                directorProfile={{
                    canon_state: {
                        characters: [{
                            fact_id: "c1", kind: "character", subject: "Zhou Han",
                            value: "age not specified", source_refs: ["Scene 1"],
                        }],
                    },
                } as never}
            />
        </NextIntlClientProvider>,
    );

    const editor = await screen.findByLabelText("Script fact ledger draft JSON");
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('"evidence_status": "uncertain"'));
    const confirmButton = screen.getByRole("button", { name: "Confirm fact ledger" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("film", 3, 0, facts));
    expect(confirm).not.toHaveBeenCalled();
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("film", 0, 1));
});
