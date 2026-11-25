/**
 * A CCS exchange (a MongoDB command and its reply), for its log row (`LoggedRequest.detail`): only
 * these summary fields are kept, never documents, query values, credentials or error messages.
 */
export interface CcsSummary {
    command: string;
    db?: string;
    collection?: string;
    /** the cluster host:port it went to */
    server: string;
    /** the driver's own traffic, not the page's operations: connection handshakes, authentication, monitoring */
    background?: "handshake" | "auth" | "heartbeat";
    requestBytes: number;
    replyBytes?: number;
    /** documents or statements the write sent */
    items?: number;
    ok?: boolean;
    code?: number;
    codeName?: string;
    /** documents in the reply's batch (or values / databases listed) */
    batch?: number;
    batchKind?: "first" | "next";
    n?: number;
    modified?: number;
    writeErrors?: number;
    /** a reply of a streaming (exhaust) command, following the previous one */
    streamed?: boolean;
    /** MongoDB-level compression the command / reply used (zlib is decompressed) */
    compressor?: string;
    replyCompressor?: string;
    /** compressed with a compressor that isn't decoded (snappy, zstd) */
    compressed?: boolean;
}

