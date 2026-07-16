import path from "node:path";
import fs from "node:fs/promises";
import { Storage } from "@google-cloud/storage";

// ---------------------------------------------------------------------------
// Storage backend selection
// ---------------------------------------------------------------------------
// Set STORAGE_BACKEND=local in your environment to store files on the local
// filesystem (e.g. when self-hosting on a plain Linux/EC2 server).
// The default ("replit") uses the Replit-managed GCS sidecar.
// ---------------------------------------------------------------------------

const STORAGE_BACKEND = process.env.STORAGE_BACKEND ?? "replit";

// Root directory for local storage (must be on a persistent volume).
const LOCAL_STORAGE_ROOT =
  process.env.LOCAL_STORAGE_ROOT ?? "/app/uploads/objects";

// ---------------------------------------------------------------------------
// Replit GCS sidecar client (only constructed when needed)
// ---------------------------------------------------------------------------

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function getReplitStorageClient(): Storage {
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: "json",
          subject_token_field_name: "access_token",
        },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
}

// Lazily instantiated so we don't attempt to connect when using local backend.
let _replitClient: Storage | null = null;
export const objectStorageClient = new Proxy({} as Storage, {
  get(_target, prop) {
    if (!_replitClient) _replitClient = getReplitStorageClient();
    return (_replitClient as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// ---------------------------------------------------------------------------
// Shared error type
// ---------------------------------------------------------------------------

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Replit GCS helpers
// ---------------------------------------------------------------------------

async function getPrivateObjectDir(): Promise<string> {
  const { getPrivateObjectDir: getDir } = await import("./systemConfig");
  const dir = (await getDir()) ?? "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set. Configure it in Admin → Settings → System " +
        "or set the PRIVATE_OBJECT_DIR environment variable.",
    );
  }
  return dir;
}

function parseObjectPath(p: string): { bucketName: string; objectName: string } {
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = p.split("/");
  if (parts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  return { bucketName: parts[1]!, objectName: parts.slice(2).join("/") };
}

async function fileForStorageKey(storageKey: string) {
  let dir = await getPrivateObjectDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const { bucketName, objectName } = parseObjectPath(`${dir}${storageKey}`);
  if (!_replitClient) _replitClient = getReplitStorageClient();
  return _replitClient.bucket(bucketName).file(objectName);
}

// ---------------------------------------------------------------------------
// Local filesystem helpers
// ---------------------------------------------------------------------------

function localPath(storageKey: string): string {
  // Prevent path traversal
  const safe = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(LOCAL_STORAGE_ROOT, safe);
}

async function localSave(storageKey: string, data: Buffer): Promise<void> {
  const dest = localPath(storageKey);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, data);
}

async function localRead(storageKey: string): Promise<Buffer> {
  const src = localPath(storageKey);
  try {
    return await fs.readFile(src);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ObjectNotFoundError();
    }
    throw err;
  }
}

async function localDelete(storageKey: string): Promise<void> {
  try {
    await fs.unlink(localPath(storageKey));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API — dispatches to the correct backend
// ---------------------------------------------------------------------------

/** Uploads attachment bytes under the private object dir at the given storage key. */
export async function saveAttachmentObject(
  storageKey: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  if (STORAGE_BACKEND === "local") {
    await localSave(storageKey, data);
    return;
  }
  const file = await fileForStorageKey(storageKey);
  await file.save(data, { contentType, resumable: false });
}

/** Reads attachment bytes for the given storage key. Throws ObjectNotFoundError if missing. */
export async function readAttachmentObject(storageKey: string): Promise<Buffer> {
  if (STORAGE_BACKEND === "local") {
    return localRead(storageKey);
  }
  const file = await fileForStorageKey(storageKey);
  const [exists] = await file.exists();
  if (!exists) throw new ObjectNotFoundError();
  const [contents] = await file.download();
  return contents;
}

/** Best-effort deletion of an attachment object (used by tests/cleanup). */
export async function deleteAttachmentObject(storageKey: string): Promise<void> {
  if (STORAGE_BACKEND === "local") {
    await localDelete(storageKey);
    return;
  }
  const file = await fileForStorageKey(storageKey);
  await file.delete({ ignoreNotFound: true });
}
