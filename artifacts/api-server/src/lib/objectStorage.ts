import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// GCS client authenticated via the Replit sidecar. Do not modify.
export const objectStorageClient = new Storage({
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

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

function getPrivateObjectDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
        "tool and set PRIVATE_OBJECT_DIR env var.",
    );
  }
  return dir;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  return {
    bucketName: pathParts[1]!,
    objectName: pathParts.slice(2).join("/"),
  };
}

function fileForStorageKey(storageKey: string) {
  let dir = getPrivateObjectDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const { bucketName, objectName } = parseObjectPath(`${dir}${storageKey}`);
  return objectStorageClient.bucket(bucketName).file(objectName);
}

/** Uploads attachment bytes under the private object dir at the given storage key. */
export async function saveAttachmentObject(
  storageKey: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const file = fileForStorageKey(storageKey);
  await file.save(data, { contentType, resumable: false });
}

/** Reads attachment bytes for the given storage key. Throws ObjectNotFoundError if missing. */
export async function readAttachmentObject(storageKey: string): Promise<Buffer> {
  const file = fileForStorageKey(storageKey);
  const [exists] = await file.exists();
  if (!exists) throw new ObjectNotFoundError();
  const [contents] = await file.download();
  return contents;
}

/** Best-effort deletion of an attachment object (used by tests/cleanup). */
export async function deleteAttachmentObject(storageKey: string): Promise<void> {
  const file = fileForStorageKey(storageKey);
  await file.delete({ ignoreNotFound: true });
}
