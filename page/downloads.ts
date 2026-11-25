// -------------------------------------------------------------------------------------------------
// DOWNLOADS
// -------------------------------------------------------------------------------------------------

/** Saves `text` as a file the user downloads (`tweak.onPage` code: the page's document can start downloads). */
export async function downloadFile(filename: string, text: string, mime: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    a.style.display = "none";
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
