import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

/** PrivateAuth is outside privateData, ICM, repository, backups and exports. Return presence only to the frontend. */
export function openVoiceCredentialStore(input: { privateAuthRoot: string }) {
  if (!isAbsolute(input.privateAuthRoot))
    throw new Error("VOICE_AUTH_ROOT_INVALID");
  mkdirSync(input.privateAuthRoot, { recursive: true, mode: 0o700 });
  const root = lstatSync(input.privateAuthRoot);
  const uid = process.getuid?.();
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    (root.mode & 0o077) !== 0 ||
    (uid !== undefined && root.uid !== uid)
  )
    throw new Error("VOICE_AUTH_ROOT_INVALID");
  const path = join(input.privateAuthRoot, "elevenlabs-auth.json");
  function read(): string | undefined {
    if (!existsSync(path)) return undefined;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        (stat.mode & 0o077) !== 0 ||
        stat.nlink !== 1 ||
        stat.size > 8192 ||
        (uid !== undefined && stat.uid !== uid)
      )
        throw new Error("VOICE_AUTH_FILE_INVALID");
      const result = z
        .object({
          kind: z.literal("elevenlabs-api-key"),
          apiKey: z
            .string()
            .min(1)
            .refine(
              (value) =>
                Buffer.byteLength(value) <= 4096 && !/[\0\r\n]/u.test(value),
            ),
        })
        .strict()
        .safeParse(JSON.parse(readFileSync(fd, "utf8")));
      if (!result.success) throw new Error("VOICE_AUTH_FILE_INVALID");
      return result.data.apiKey;
    } catch {
      throw new Error("VOICE_AUTH_FILE_INVALID");
    } finally {
      closeSync(fd);
    }
  }
  const receiptPath = join(
    input.privateAuthRoot,
    "elevenlabs-credential-operations.json",
  );
  const receiptsSchema = z
    .array(
      z
        .object({
          operationId: z.uuid(),
          kind: z.enum(["replace", "remove"]),
          credentialConfigured: z.boolean(),
        })
        .strict(),
    )
    .max(100000);
  function receipt(
    request: { operationId: string; kind: "replace" | "remove" },
    action: () => void,
  ) {
    const operationId = z.uuid().parse(request.operationId);
    const previous = (() => {
      if (!existsSync(receiptPath)) return [];
      const fd = openSync(
        receiptPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = fstatSync(fd);
        if (
          !stat.isFile() ||
          (stat.mode & 0o077) !== 0 ||
          stat.nlink !== 1 ||
          stat.size > 16 * 1024 * 1024
        )
          throw new Error("VOICE_AUTH_FILE_INVALID");
        return receiptsSchema.parse(JSON.parse(readFileSync(fd, "utf8")));
      } finally {
        closeSync(fd);
      }
    })();
    const old = previous.find((item) => item.operationId === operationId);
    if (old) {
      if (old.kind !== request.kind)
        throw new Error("VOICE_IDEMPOTENCY_KEY_REUSE");
      return { credentialConfigured: old.credentialConfigured, safeCode: null };
    }
    action();
    const result = {
      operationId,
      kind: request.kind,
      credentialConfigured: read() !== undefined,
    };
    const temp = join(
      input.privateAuthRoot,
      `elevenlabs-receipts-${randomUUID()}.tmp`,
    );
    const fd = openSync(
      temp,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, JSON.stringify([...previous, result]));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, receiptPath);
    const rootFd = openSync(
      input.privateAuthRoot,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      fsyncSync(rootFd);
    } finally {
      closeSync(rootFd);
    }
    return {
      credentialConfigured: result.credentialConfigured,
      safeCode: null,
    };
  }
  let api: ReturnType<typeof makeApi>;
  function makeApi() {
    return Object.freeze({
      /** Host adapter only. Never serialize this result. */
      getApiKey: read,
      status() {
        try {
          return { credentialConfigured: read() !== undefined, safeCode: null };
        } catch {
          return {
            credentialConfigured: false,
            safeCode: "VOICE_AUTH_FILE_INVALID",
          };
        }
      },
      replace(raw: unknown) {
        const parsed = z
          .object({
            apiKey: z
              .string()
              .min(1)
              .refine(
                (value) =>
                  Buffer.byteLength(value) <= 4096 && !/[\0\r\n]/u.test(value),
              ),
          })
          .strict()
          .safeParse(raw);
        if (!parsed.success) throw new Error("VOICE_CREDENTIAL_INVALID");
        const temp = join(
          input.privateAuthRoot,
          `elevenlabs-auth-${randomUUID()}.tmp`,
        );
        const fd = openSync(
          temp,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          writeFileSync(
            fd,
            JSON.stringify({
              kind: "elevenlabs-api-key",
              apiKey: parsed.data.apiKey,
            }),
          );
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        try {
          renameSync(temp, path);
          const rootFd = openSync(
            input.privateAuthRoot,
            constants.O_RDONLY | constants.O_DIRECTORY,
          );
          try {
            fsyncSync(rootFd);
          } finally {
            closeSync(rootFd);
          }
        } catch {
          if (existsSync(temp)) unlinkSync(temp);
          throw new Error("VOICE_CREDENTIAL_PERSISTENCE_FAILED");
        }
      },
      replaceOnce(request: { operationId: string; raw: unknown }) {
        return receipt(
          { operationId: request.operationId, kind: "replace" },
          () => api.replace(request.raw),
        );
      },
      removeOnce(request: { operationId: string }) {
        return receipt(
          { operationId: request.operationId, kind: "remove" },
          () => api.remove(),
        );
      },
      remove() {
        if (existsSync(path)) {
          const stat = lstatSync(path);
          if (stat.isSymbolicLink() || !stat.isFile())
            throw new Error("VOICE_AUTH_FILE_INVALID");
          unlinkSync(path);
        }
      },
    });
  }
  api = makeApi();
  return api;
}
