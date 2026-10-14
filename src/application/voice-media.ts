import { execFile } from "node:child_process";
import { z } from "zod";

function run(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        ...(signal === undefined ? {} : { signal }),
      },
      (error, stdout) => {
        if (error) reject(new Error("VOICE_MEDIA_DECODE_FAILED"));
        else resolve(stdout);
      },
    );
  });
}
/** Validates the host's private artifact without blocking HTTP while decoders run. */
export async function validateVoiceMedia(input: {
  path: string;
  mediaType: "audio/mpeg" | "audio/wav" | "audio/pcm";
  outputFormat: string | null;
  byteLength: number;
  signal?: AbortSignal;
}): Promise<number> {
  const rawArgs: string[] = [];
  if (input.mediaType === "audio/pcm") {
    const rate = z
      .enum(["16000", "22050", "24000", "44100", "48000"])
      .safeParse(input.outputFormat?.replace("pcm_", ""));
    if (!rate.success || input.byteLength % 2 !== 0)
      throw new Error("VOICE_MEDIA_FORMAT_INVALID");
    rawArgs.push("-f", "s16le", "-ar", rate.data, "-ac", "1");
  }
  await run(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      ...rawArgs,
      "-i",
      input.path,
      "-f",
      "null",
      "-",
    ],
    input.signal,
  );
  if (input.mediaType === "audio/pcm")
    return z
      .number()
      .finite()
      .positive()
      .parse(
        input.byteLength / 2 / Number(input.outputFormat?.replace("pcm_", "")),
      );
  const json = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      input.path,
    ],
    input.signal,
  );
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("VOICE_MEDIA_PROBE_FAILED");
  }
  const metadata = z
    .object({
      streams: z
        .array(z.object({ codec_type: z.literal("audio") }))
        .min(1)
        .max(1),
      format: z.object({
        duration: z
          .string()
          .transform(Number)
          .pipe(z.number().finite().positive().max(36000)),
      }),
    })
    .safeParse(value);
  if (!metadata.success) throw new Error("VOICE_MEDIA_PROBE_FAILED");
  return metadata.data.format.duration;
}
export function voicePcmToWav(bytes: Uint8Array, format: string): Uint8Array {
  const rate = z
    .enum(["16000", "22050", "24000", "44100", "48000"])
    .parse(format.replace("pcm_", ""));
  if (bytes.byteLength % 2 !== 0) throw new Error("VOICE_MEDIA_FORMAT_INVALID");
  const wav = Buffer.alloc(44 + bytes.byteLength);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(Number(rate), 24);
  wav.writeUInt32LE(Number(rate) * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(bytes.byteLength, 40);
  Buffer.from(bytes).copy(wav, 44);
  return wav;
}
