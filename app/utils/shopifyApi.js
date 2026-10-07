export async function executeGraphQLWithRetry(admin, query, variables = {}, maxRetries = 3) {
  let attempt = 0;
  let delay = 500;

  while (attempt <= maxRetries) {
    try {
      const response = await admin.graphql(query, { variables });
      const payload = await response.json();

      const hasThrottled = payload?.errors?.some(
        (err) => err?.extensions?.code === "THROTTLED" || (err?.message && err.message.toLowerCase().includes("throttled"))
      );

      if (hasThrottled && attempt < maxRetries) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }

      return payload;
    } catch (err) {
      if (attempt < maxRetries) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}
