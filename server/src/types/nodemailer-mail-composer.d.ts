// nodemailer v10 ships its own accurate .d.ts files, but only reachable via
// package.json "exports" subpaths (e.g. "nodemailer/lib/mail-composer" ->
// dist/cjs/mail-composer/index.js). Our tsconfig uses the classic
// `moduleResolution: "node"` (switching the whole server to "node16"/
// "nodenext" to respect `exports` would force explicit ".js" extensions on
// every relative import in the codebase — too big a change for one import),
// which doesn't consult `exports` for type resolution, so TS can't find
// declarations for that subpath even though Node's `require()` resolves it
// fine at runtime. This ambient module covers just the shape we actually use.
declare module "nodemailer/lib/mail-composer" {
  export interface MailComposerAttachment {
    filename?: string;
    content?: string | Buffer;
    contentType?: string;
    cid?: string;
  }

  export interface MailComposerOptions {
    from?: string;
    to?: string | string[];
    cc?: string | string[];
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
    text?: string;
    html?: string;
    attachments?: MailComposerAttachment[];
    headers?: Record<string, string>;
  }

  export default class MailComposer {
    constructor(mail: MailComposerOptions);
    compile(): {
      build(callback: (err: Error | null, message: Buffer) => void): void;
    };
  }
}
