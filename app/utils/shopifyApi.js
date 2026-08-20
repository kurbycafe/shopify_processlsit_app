/**
 * Execute Shopify GraphQL query with exponential backoff for 429 / Throttled errors
 * @param {object} admin Shopify admin client
 * @param {string} query GraphQL query or mutation string
 * @param {object} variables Variables object
 * @param {number} maxRetries Max retry attempts (default: 3)
 * @returns {Promise<object>} JSON payload
 */
export async function executeGraphQLWithRetry(admin, query, variables = {}, maxRetries = 3) {
  let attempt = 0;
  let delay = 500;

  while (attempt <= maxRetries) {
    try {
      const response = await admin.graphql(query, { variables });
      const payload = await response.json();

      // Check if throttled or rate limited in errors
      const hasThrottled = payload?.errors?.some(
        (err) => err?.extensions?.code === "THROTTLED" || (err?.message && err.message.toLowerCase().includes("throttled"))
      );

      if (hasThrottled && attempt < maxRetries) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // exponential backoff
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
