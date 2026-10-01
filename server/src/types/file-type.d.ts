// file-type v22+ ships only an ESM "exports" entry (no "main"/"types" field
// our classic `moduleResolution: "node"` can resolve — same situation as
// nodemailer/lib/mail-composer, see that ambient module's comment for why we
// don't switch the whole server to "node16"/"nodenext" moduleResolution just
// for this). We load it at runtime via an indirect dynamic import
// (src/lib/attachmentStorage.ts) that TS can't see through anyway, so this
// ambient module exists purely to type that result — covering only the one
// function we actually call.
declare module "file-type" {
  export interface FileTypeResult {
    ext: string;
    mime: string;
  }

  export function fileTypeFromBuffer(buffer: Uint8Array | ArrayBuffer): Promise<FileTypeResult | undefined>;
}
