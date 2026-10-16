import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createConfigurationService } from "../third_party/agnes-harness/packages/host/src/index.ts";

const home = "/data-ssd/zhongchengkai/agnes/.agh-home-step7";
const profile = "local-dev";
const providerId = "agnes-ai";
const baseUrl = "https://api.agnes-ai.cn/v1";
const model = "agnes-3.0-flash";
const accountId = "agnes-official";

const safeCodes = new Set([
  "CONFIG_REVISION_CONFLICT",
  "CONFIG_INVALID_INPUT",
  "CONFIG_CREDENTIAL_STORE",
  "CONFIG_PERSIST_FAILED",
  "CONFIG_MODEL_UNAVAILABLE",
  "CONFIG_TEST_FAILED",
  "CONFIG_INVALID_STATE",
]);

function safeErrorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && safeCodes.has(code)) return code;
  }
  return "UNKNOWN_SAFE_ERROR";
}

function safeFailure(code: string): Error & { code: string } {
  return Object.assign(new Error(), { code });
}

async function preparePrivateDirectories(kind: "credential" | "persist"): Promise<void> {
  const directories = [
    home,
    join(home, "profiles"),
    join(home, "profiles", profile),
  ];
  if (kind === "credential") {
    directories.push(
      join(home, "auth"),
      join(home, "auth", providerId),
      join(home, "secrets"),
      join(home, "secrets", providerId),
      join(home, "locks"),
    );
  }
  for (const directory of directories) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
}

function savePayload(apiKey: string, revision: number) {
  return {
    providerId,
    baseUrl,
    apiKey,
    model,
    accountId,
    label: "Agnes Official",
    enabled: true,
    makeDefault: true,
    expectedRevision: revision,
  };
}

async function testProvider(service: ReturnType<typeof createConfigurationService>, apiKey: string) {
  const tested = await service.test({ providerId, baseUrl, apiKey });
  const modelIds = tested.models.map((entry) => entry.id);
  const verified = tested.verified === true;
  const hasTargetModel = modelIds.includes(model);
  return { verified, hasTargetModel, modelIds };
}

async function saveWithBoundedRecovery(
  service: ReturnType<typeof createConfigurationService>,
  apiKey: string,
  initialRevision: number,
): Promise<void> {
  let revision = initialRevision;
  let revisionRetried = false;
  let credentialRetried = false;
  let persistRetried = false;
  let testRetried = false;

  for (;;) {
    try {
      await service.save(savePayload(apiKey, revision));
      return;
    } catch (error) {
      const code = safeErrorCode(error);
      if (code === "CONFIG_REVISION_CONFLICT" && !revisionRetried) {
        revisionRetried = true;
        revision = (await service.get()).revision;
        continue;
      }
      if (code === "CONFIG_CREDENTIAL_STORE" && !credentialRetried) {
        credentialRetried = true;
        await preparePrivateDirectories("credential");
        continue;
      }
      if (code === "CONFIG_PERSIST_FAILED" && !persistRetried) {
        persistRetried = true;
        await preparePrivateDirectories("persist");
        continue;
      }
      if (code === "CONFIG_TEST_FAILED" && !testRetried) {
        testRetried = true;
        const retested = await testProvider(service, apiKey);
        if (retested.verified && retested.hasTargetModel) continue;
        throw safeFailure("CONFIG_TEST_FAILED");
      }
      throw error;
    }
  }
}

function validateSavedConfiguration(snapshot: Awaited<ReturnType<ReturnType<typeof createConfigurationService>["get"]>>): void {
  const account = snapshot.accounts?.find((entry) => entry.accountId === accountId);
  if (
    snapshot.configured !== true ||
    snapshot.defaultAccountId !== accountId ||
    account?.providerId !== providerId ||
    account?.model !== model ||
    account?.enabled !== true
  ) {
    throw safeFailure("CONFIG_INVALID_STATE");
  }
}

let apiKey = process.env.AGNES_STEP7_API_KEY ?? "";

try {
  if (!apiKey) {
    console.log("CONFIG_API_KEY_MISSING");
    process.exitCode = 1;
  } else {
    const service = createConfigurationService({ home, profile });
    let tested;
    try {
      tested = await testProvider(service, apiKey);
    } catch (error) {
      console.log(safeErrorCode(error));
      process.exitCode = 1;
      tested = undefined;
    }

    if (tested !== undefined) {
      console.log(`CONFIG_TEST_VERIFIED=${tested.verified}`);
      console.log(`MODELS=${tested.modelIds.join(",")}`);
      if (!tested.verified || !tested.hasTargetModel) {
        console.log("CONFIG_TEST_FAILED");
        process.exitCode = 1;
      } else {
        try {
          const current = await service.get();
          await saveWithBoundedRecovery(service, apiKey, current.revision);
          const snapshot = await service.get();
          validateSavedConfiguration(snapshot);
          const account = snapshot.accounts?.find((entry) => entry.accountId === accountId);
          console.log("STEP7_PROVIDER_CONFIGURED=true");
          console.log(`configured=${snapshot.configured}`);
          console.log(`revision=${snapshot.revision}`);
          console.log(`defaultAccountId=${snapshot.defaultAccountId ?? ""}`);
          console.log(`account_label=${account?.label ?? ""}`);
          console.log(`provider_id=${account?.providerId ?? ""}`);
          console.log(`model=${account?.model ?? ""}`);
          console.log(`enabled=${account?.enabled === true}`);
        } catch (error) {
          console.log(safeErrorCode(error));
          process.exitCode = 1;
        }
      }
    }
  }
} catch (error) {
  console.log(safeErrorCode(error));
  process.exitCode = 1;
} finally {
  apiKey = "";
  delete process.env.AGNES_STEP7_API_KEY;
}
