/**
 * Utility functions for identifying customer cancellation, return, and withdrawal (Widerruf) requests.
 * Prevents false positives caused by generic words such as "credit card" (which contains "edit")
 * or system "requests" (carrier/fulfillment/label requests).
 */

const KNOWN_CANCELLATION_TAGS = new Set([
  "customer_request",
  "customer_request:return",
  "customer_request:cancel",
  "customer_request:cancellation",
  "customer_request:edit",
  "cancellation_requested",
  "cancel_requested",
  "return_requested",
  "widerruf",
  "stornierung",
  "storno",
  "취소요청",
  "반품요청",
  "청약철회",
]);

/**
 * Checks if order tags include explicit customer cancellation or return requests.
 * @param {string|string[]} rawTags - Order tags as comma-separated string or array
 * @returns {boolean}
 */
export function matchesCancellationTag(rawTags) {
  if (!rawTags) return false;

  const tagList = Array.isArray(rawTags)
    ? rawTags.map((t) => String(t).trim().toLowerCase())
    : String(rawTags)
        .toLowerCase()
        .split(",")
        .map((t) => t.trim());

  return tagList.some((tag) => {
    if (!tag) return false;
    if (KNOWN_CANCELLATION_TAGS.has(tag)) return true;
    if (tag.startsWith("customer_request:")) return true;
    return false;
  });
}

/**
 * Checks if Shopify order return status indicates an active customer return.
 * @param {string} returnStatus
 * @returns {boolean}
 */
export function isReturnRequestedStatus(returnStatus) {
  if (!returnStatus) return false;
  const normalized = String(returnStatus).toUpperCase().trim();
  return (
    normalized === "RETURN_REQUESTED" ||
    normalized === "IN_PROGRESS" ||
    normalized === "RETURNED"
  );
}

/**
 * Strict regex patterns matching actual cancellation or return requests.
 * Does NOT match bare substrings like "edit" (which matches "credit card")
 * or "request" (which matches fulfillment/API requests).
 */
const CANCELLATION_EVENT_PATTERNS = [
  /\b(stornier|stornierung|storniert|stornieren)\b/i,
  /\b(widerruf|widerrufsbelehrung|widerrufen|widerrufsrecht)\b/i,
  /\b(cancellation\s+request|cancellation\s+requested|cancel\s+request|canceled\s+by\s+customer)\b/i,
  /\b(requested\s+a\s+cancellation|requested\s+to\s+cancel)\b/i,
  /\b(return\s+request|return\s+requested|requested\s+a\s+return)\b/i,
  /\b(rücksendung\s+angefragt|rückgabe\s+angefragt|rücksendung\s+beantragt|rückgabe\s+beantragt)\b/i,
  /취소\s*요청/,
  /반품\s*요청/,
  /청약\s*철회/,
];

/**
 * Known system messages that must never trigger cancellation alerts even if ambiguous.
 */
const SYSTEM_FALSE_POSITIVE_PATTERNS = [
  /credit\s*card/i,
  /kreditkarte/i,
  /payment\s+gateway/i,
  /shipping\s+label/i,
  /tracking\s+number/i,
  /sendcloud/i,
  /fulfillment\s+service/i,
  /carrier/i,
  /ups\s+standard/i,
  /ups\s+express/i,
  /dhl\s+paket/i,
  /return\s+address/i, // Return address on delivery slips/labels
  /rücksendeadresse/i,
];

/**
 * Checks if a timeline event message legitimately signifies a cancellation or return.
 * @param {string} rawMsg
 * @returns {boolean}
 */
export function matchesCancellationEventMessage(rawMsg) {
  if (!rawMsg || typeof rawMsg !== "string") return false;
  const msg = rawMsg.trim();

  // If message matches any cancellation pattern
  const hasCancellationKeyword = CANCELLATION_EVENT_PATTERNS.some((pattern) =>
    pattern.test(msg)
  );
  if (!hasCancellationKeyword) {
    return false;
  }

  // If message looks like a system payment or shipping notification, verify it's not a false positive
  const isSystemNotice = SYSTEM_FALSE_POSITIVE_PATTERNS.some((pattern) =>
    pattern.test(msg)
  );
  if (isSystemNotice) {
    // Only allow if explicit cancellation keyword is present independently of the system terms
    const explicitNotice =
      /취소\s*요청|반품\s*요청|청약\s*철회|cancellation\s+request|return\s+request|stornierung|widerruf/i.test(
        msg
      );
    if (!explicitNotice) return false;
  }

  return true;
}

/**
 * Comprehensive check for whether an order is under customer hold / cancellation request.
 * @param {object} params
 * @param {string|null} [params.cancelledAt]
 * @param {string|null} [params.cancelReason]
 * @param {string|null} [params.returnStatus]
 * @param {string|string[]} [params.tags]
 * @param {Array<{ message?: string, createdAt?: string }>} [params.events]
 * @param {number|null} [params.maxRecencyMs] - If set, ignores cancellations older than this threshold
 * @param {number} [params.now]
 * @returns {{
 *   isCustomerHold: boolean,
 *   hasCancellationRequest: boolean,
 *   hasReturnRequest: boolean,
 *   cancelReason: string|null,
 *   matchedEventMessage: string|null
 * }}
 */
export function detectOrderCancellationStatus({
  cancelledAt = null,
  cancelReason = null,
  returnStatus = null,
  tags = null,
  events = [],
  maxRecencyMs = null,
  now = Date.now(),
}) {
  const isCancelled = Boolean(cancelledAt) || Boolean(cancelReason);
  let isRecentCancelled = isCancelled;
  if (isCancelled && maxRecencyMs && cancelledAt) {
    const age = now - new Date(cancelledAt).getTime();
    if (age > maxRecencyMs) {
      isRecentCancelled = false;
    }
  }

  const isReturnRequested = isReturnRequestedStatus(returnStatus);
  const hasTag = matchesCancellationTag(tags);

  let matchedEvent = null;
  if (Array.isArray(events) && events.length > 0) {
    matchedEvent = events.find((event) => {
      const msg = event?.message || event?.node?.message;
      if (!msg) return false;
      if (!matchesCancellationEventMessage(msg)) return false;
      if (maxRecencyMs) {
        const createdAt = event?.createdAt || event?.node?.createdAt;
        if (createdAt) {
          const age = now - new Date(createdAt).getTime();
          if (age > maxRecencyMs) return false;
        }
      }
      return true;
    });
  }

  const isCustomerHold =
    isRecentCancelled || isReturnRequested || hasTag || Boolean(matchedEvent);

  let resolvedReason = cancelReason || "";
  if (!resolvedReason && isCustomerHold) {
    if (matchedEvent) {
      resolvedReason = matchedEvent.message || matchedEvent.node?.message;
    } else if (isReturnRequested) {
      resolvedReason = "고객 반품/철회 요청 접수 (RETURN_REQUESTED)";
    } else if (hasTag) {
      resolvedReason = "고객 취소/반품 요청 태그 접수 (customer_request)";
    } else if (isCancelled) {
      resolvedReason = "주문 취소 접수";
    }
  }

  return {
    isCustomerHold,
    hasCancellationRequest: isCustomerHold && !isReturnRequested,
    hasReturnRequest: isReturnRequested,
    cancelReason: resolvedReason || null,
    matchedEventMessage: matchedEvent
      ? matchedEvent.message || matchedEvent.node?.message
      : null,
  };
}
