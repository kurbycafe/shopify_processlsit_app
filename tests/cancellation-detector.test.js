import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesCancellationTag,
  isReturnRequestedStatus,
  matchesCancellationEventMessage,
  detectOrderCancellationStatus,
} from "../app/utils/cancellationDetector.js";

test("matchesCancellationTag accurately detects hold tags and rejects regular tags", () => {
  // Positive cases
  assert.equal(matchesCancellationTag("customer_request"), true);
  assert.equal(matchesCancellationTag("customer_request:return"), true);
  assert.equal(matchesCancellationTag("customer_request:edit"), true);
  assert.equal(matchesCancellationTag("customer_request:cancel"), true);
  assert.equal(matchesCancellationTag("cancellation_requested"), true);
  assert.equal(matchesCancellationTag("return_requested"), true);
  assert.equal(matchesCancellationTag("widerruf"), true);
  assert.equal(matchesCancellationTag("stornierung"), true);
  assert.equal(matchesCancellationTag("취소요청"), true);
  assert.equal(matchesCancellationTag(["regular", "customer_request:return", "vip"]), true);

  // Negative cases: Normal order tags
  assert.equal(matchesCancellationTag(""), false);
  assert.equal(matchesCancellationTag(null), false);
  assert.equal(matchesCancellationTag("vip, first_order, summer_sale"), false);
  assert.equal(matchesCancellationTag(["dry", "chilled", "b2b"]), false);
  assert.equal(matchesCancellationTag("credit_buyer"), false);
  assert.equal(matchesCancellationTag("requested_delivery_morning"), false);
});

test("isReturnRequestedStatus correctly identifies return status states", () => {
  assert.equal(isReturnRequestedStatus("RETURN_REQUESTED"), true);
  assert.equal(isReturnRequestedStatus("IN_PROGRESS"), true);
  assert.equal(isReturnRequestedStatus("RETURNED"), true);
  assert.equal(isReturnRequestedStatus("return_requested"), true);

  assert.equal(isReturnRequestedStatus("NO_RETURN"), false);
  assert.equal(isReturnRequestedStatus(""), false);
  assert.equal(isReturnRequestedStatus(null), false);
  assert.equal(isReturnRequestedStatus(undefined), false);
});

test("matchesCancellationEventMessage rejects benign system messages (credit card, carrier, requests)", () => {
  // Critical bug reproduction cases:
  // 1. Credit card payments ("credit" substring previously matched "edit")
  assert.equal(
    matchesCancellationEventMessage("Payment of €45.20 was processed via Credit Card."),
    false
  );
  assert.equal(
    matchesCancellationEventMessage("A credit card payment was authorized and captured."),
    false
  );
  assert.equal(
    matchesCancellationEventMessage("Zahlung von 30,00 € per Kreditkarte erfolgreich autorisiert."),
    false
  );

  // 2. Generic requests (fulfillment, carrier, label)
  assert.equal(
    matchesCancellationEventMessage("A request was sent to Sendcloud to create a shipping label."),
    false
  );
  assert.equal(
    matchesCancellationEventMessage("Fulfillment service requested to fulfill 2 items."),
    false
  );
  assert.equal(
    matchesCancellationEventMessage("Carrier pickup request sent to UPS Standard."),
    false
  );
  assert.equal(
    matchesCancellationEventMessage("Return address: Erkrather Str. 343, 40231 Düsseldorf."),
    false
  );
  assert.equal(
    matchesCancellationEventMessage("Tracking number 1Z9999999999999999 was assigned."),
    false
  );
  assert.equal(
    matchesCancellationEventMessage("Order confirmation email was sent to customer."),
    false
  );
});

test("matchesCancellationEventMessage detects genuine cancellation and return requests", () => {
  assert.equal(
    matchesCancellationEventMessage("Customer requested a cancellation for this order."),
    true
  );
  assert.equal(
    matchesCancellationEventMessage("Customer requested a return for 2 items."),
    true
  );
  assert.equal(
    matchesCancellationEventMessage("Bestellung wurde storniert (Kunde bittet um Stornierung)."),
    true
  );
  assert.equal(
    matchesCancellationEventMessage("Kunde hat eine Rücksendung beantragt."),
    true
  );
  assert.equal(
    matchesCancellationEventMessage("EU Widerruf per E-Mail eingegangen."),
    true
  );
  assert.equal(
    matchesCancellationEventMessage("고객 취소 요청 접수 (배송 전 취소)"),
    true
  );
  assert.equal(
    matchesCancellationEventMessage("고객 반품 요청 접수"),
    true
  );
});

test("detectOrderCancellationStatus prevents false holds on normal orders", () => {
  const normalOrder = {
    cancelledAt: null,
    cancelReason: null,
    returnStatus: null,
    tags: "vip, regular",
    events: [
      { message: "Payment of €78.50 captured via Credit Card", createdAt: new Date().toISOString() },
      { message: "Sendcloud requested shipping label generation", createdAt: new Date().toISOString() },
    ],
  };

  const status = detectOrderCancellationStatus(normalOrder);
  assert.equal(status.isCustomerHold, false);
  assert.equal(status.hasCancellationRequest, false);
  assert.equal(status.hasReturnRequest, false);
  assert.equal(status.cancelReason, null);
});

test("detectOrderCancellationStatus identifies genuine holds with correct reason", () => {
  // Case A: Tagged hold
  const taggedOrder = {
    tags: "customer_request:return",
    events: [],
  };
  const taggedStatus = detectOrderCancellationStatus(taggedOrder);
  assert.equal(taggedStatus.isCustomerHold, true);
  assert.equal(taggedStatus.hasCancellationRequest, true);
  assert.ok(taggedStatus.cancelReason);

  // Case B: Native return status
  const returnOrder = {
    returnStatus: "RETURN_REQUESTED",
  };
  const returnStatus = detectOrderCancellationStatus(returnOrder);
  assert.equal(returnStatus.isCustomerHold, true);
  assert.equal(returnStatus.hasReturnRequest, true);
  assert.equal(returnStatus.hasCancellationRequest, false);

  // Case C: Timeline event cancellation
  const eventOrder = {
    events: [{ message: "고객 취소 요청 접수", createdAt: new Date().toISOString() }],
  };
  const eventStatus = detectOrderCancellationStatus(eventOrder);
  assert.equal(eventStatus.isCustomerHold, true);
  assert.equal(eventStatus.hasCancellationRequest, true);

  // Case D: Recency check on historical cancellations
  const now = Date.now();
  const oldCancelledOrder = {
    cancelledAt: new Date(now - 30 * 60 * 1000).toISOString(), // 30 minutes old
    maxRecencyMs: 15 * 60 * 1000, // 15 minutes limit
    now,
  };
  const oldStatus = detectOrderCancellationStatus(oldCancelledOrder);
  assert.equal(oldStatus.isCustomerHold, false); // Ignored due to age

  const recentCancelledOrder = {
    cancelledAt: new Date(now - 5 * 60 * 1000).toISOString(), // 5 minutes old
    maxRecencyMs: 15 * 60 * 1000,
    now,
  };
  const recentStatus = detectOrderCancellationStatus(recentCancelledOrder);
  assert.equal(recentStatus.isCustomerHold, true);
});
