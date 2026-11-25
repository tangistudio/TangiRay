import { useMemo } from "react";
import { STATUS_CODES, statusPhrase } from "../http/status-codes";
import { Combobox } from "./Combobox";

/** An HTTP status field: suggests the common codes with what they mean, and names the chosen one. */
export function StatusInput({ value, onChange, openOnFocus }: { value: number; onChange: (status: number) => void; openOnFocus?: boolean }) {
    const options = useMemo(() => STATUS_CODES.map((s) => ({ value: String(s.code), label: s.phrase, hint: s.meaning })), []);
    return (
        <Combobox value={value ? String(value) : ""} options={options} note={statusPhrase(value)} inputMode="numeric" aria-label="Status" openOnFocus={openOnFocus}
            onChange={(text) => onChange(Number(text.replace(/\D/g, "").slice(0, 3)) || 0)} />
    );
}
