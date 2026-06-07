import { createClient } from "@vercel/edge-config";

const connectionString = process.env.EDGE_CONFIG;
const edgeConfigClient = createClient(connectionString);

function ensureWriteEnv() {
  const configId = process.env.EDGE_CONFIG_ID;
  const accessToken = process.env.VERCEL_ACCESS_TOKEN;

  if (!configId || !accessToken) {
    throw new Error(
      "EDGE_CONFIG_ID and VERCEL_ACCESS_TOKEN are required for write operations.",
    );
  }

  return { configId, accessToken };
}

export function isEdgeConfigEnabled() {
  return Boolean(connectionString);
}

export async function getEdgeConfigValue(key, fallback = null) {
  if (!isEdgeConfigEnabled()) {
    return fallback;
  }

  try {
    const value = await edgeConfigClient.get(key);
    return value ?? fallback;
  } catch (error) {
    console.error("Failed to read Edge Config:", error);
    return fallback;
  }
}

export async function upsertEdgeConfigValue(key, value) {
  const { configId, accessToken } = ensureWriteEnv();

  const response = await fetch(
    `https://api.vercel.com/v1/edge-config/${configId}/items`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ operation: "upsert", key, value }],
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Edge Config write failed (${response.status}): ${body}`);
  }

  return response.json();
}