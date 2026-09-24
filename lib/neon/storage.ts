import "server-only";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

let client: S3Client | null = null;

function s3(): S3Client {
  client ??= new S3Client({
    region: env.AWS_REGION,
    endpoint: env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

function key(logicalBucket: string, objectPath: string): string {
  const bucket = logicalBucket.replace(/^\/+|\/+$/g, "");
  const object = objectPath.replace(/^\/+/, "");
  if (!bucket || !object || object.includes("..")) {
    throw new Error("Caminho de objeto inválido.");
  }
  return `${bucket}/${object}`;
}

async function bodyToBlob(body: unknown): Promise<Blob> {
  if (!body) return new Blob([]);
  const sdkBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof sdkBody.transformToByteArray === "function") {
    const bytes = await sdkBody.transformToByteArray();
    const copy = Uint8Array.from(bytes);
    return new Blob([copy.buffer]);
  }
  if (body instanceof Blob) return body;
  if (body instanceof Uint8Array) {
    const copy = Uint8Array.from(body);
    return new Blob([copy.buffer]);
  }
  throw new Error("Resposta de Storage em formato não suportado.");
}

function normalizarErro(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}

export function neonStorage() {
  return {
    from(logicalBucket: string) {
      return {
        async upload(
          objectPath: string,
          body: string | Buffer | Uint8Array | Blob | ArrayBuffer,
          options?: { contentType?: string; upsert?: boolean },
        ) {
          try {
            let payload: string | Buffer | Uint8Array;
            if (body instanceof Blob) {
              payload = Buffer.from(await body.arrayBuffer());
            } else if (body instanceof ArrayBuffer) {
              payload = Buffer.from(body);
            } else {
              payload = body;
            }
            await s3().send(
              new PutObjectCommand({
                Bucket: env.S3_BUCKET,
                Key: key(logicalBucket, objectPath),
                Body: payload,
                ContentType: options?.contentType,
                IfNoneMatch: options?.upsert === false ? "*" : undefined,
              }),
            );
            return { data: { path: objectPath }, error: null };
          } catch (error) {
            return { data: null, error: normalizarErro(error) };
          }
        },

        async download(objectPath: string) {
          try {
            const result = await s3().send(
              new GetObjectCommand({
                Bucket: env.S3_BUCKET,
                Key: key(logicalBucket, objectPath),
              }),
            );
            const data = await bodyToBlob(result.Body);
            return { data, error: null };
          } catch (error) {
            return { data: null, error: normalizarErro(error) };
          }
        },

        async remove(objectPaths: string[]) {
          try {
            if (objectPaths.length === 0) return { data: [], error: null };
            await s3().send(
              new DeleteObjectsCommand({
                Bucket: env.S3_BUCKET,
                Delete: {
                  Objects: objectPaths.map((objectPath) => ({
                    Key: key(logicalBucket, objectPath),
                  })),
                  Quiet: true,
                },
              }),
            );
            return {
              data: objectPaths.map((name) => ({ name })),
              error: null,
            };
          } catch (error) {
            return { data: null, error: normalizarErro(error) };
          }
        },

        async createSignedUrl(objectPath: string, expiresIn: number) {
          try {
            const signedUrl = await getSignedUrl(
              s3(),
              new GetObjectCommand({
                Bucket: env.S3_BUCKET,
                Key: key(logicalBucket, objectPath),
              }),
              { expiresIn },
            );
            return { data: { signedUrl }, error: null };
          } catch (error) {
            return { data: null, error: normalizarErro(error) };
          }
        },
      };
    },
  };
}
