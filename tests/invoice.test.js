import test from "node:test";
import assert from "node:assert/strict";
import {
  formatInvoiceNumber,
  formatInvoiceDate,
  getInvoiceYear,
  pickInvoiceSnapshot,
  resolveInvoiceView,
  getOutstandingAmount,
  buildPaymentReference,
  computeInvoiceTotals,
  translateFinancialStatus,
  translatePaymentGateway,
} from "../app/utils/invoice.js";
import {
  issueInvoiceForOrder,
  getInvoiceForOrder,
  getInvoicesForOrders,
  handleIssueInvoiceIntent,
} from "../app/services/invoiceService.server.js";
import {
  COMPANY,
  COMPANY_BANK,
  COMPANY_BANK_B2B,
  COMPANY_BANK_B2C,
  getCompanyBankAccount,
} from "../app/constants/company.js";

test("COMPANY constants contain valid German legal notice (Impressum) data", () => {
  assert.equal(COMPANY.legalName, "Popeye GmbH");
  assert.equal(COMPANY.registerCourt, "Amtsgericht Düsseldorf");
  assert.equal(COMPANY.registerNumber, "HRB 84725");
  assert.deepEqual(COMPANY.managingDirectors, ["Soonchan Kwon"]);
  assert.equal(COMPANY.vatId, "DE 3208 90998");
  assert.equal(COMPANY.taxNumber, "106 5721 6110");
  assert.equal(COMPANY.eori, "DE 83 5767 6549 86380");
  assert.equal(COMPANY.street, "Erkrather Str. 343");
  assert.equal(COMPANY.zip, "40231");
  assert.equal(COMPANY.city, "Düsseldorf");
  assert.equal(COMPANY.phone, "+49 (0) 211 15812527");
  assert.equal(COMPANY.email, "service@dawayo.de");
});

test("bank accounts: B2C (general) and B2B (wholesale)", () => {
  assert.equal(COMPANY_BANK, COMPANY_BANK_B2C);
  for (const bank of [COMPANY_BANK_B2C, COMPANY_BANK_B2B]) {
    assert.equal(bank.accountHolder, "Popeye GmbH");
    assert.equal(bank.bankName, "Stadtsparkasse Düsseldorf");
    assert.equal(bank.bic, "DUSSDEDDXXX");
  }
  assert.equal(COMPANY_BANK_B2C.iban, "DE41 3005 0110 1008 3808 24");
  assert.equal(COMPANY_BANK_B2B.iban, "DE76 3005 0110 1008 0519 46");
  assert.equal(getCompanyBankAccount(true), COMPANY_BANK_B2B);
  assert.equal(getCompanyBankAccount(false), COMPANY_BANK_B2C);
  assert.equal(getCompanyBankAccount(undefined), COMPANY_BANK_B2C);
});

test("formatInvoiceNumber generates compliant RE-YYYY-00000 format", () => {
  assert.equal(formatInvoiceNumber(2026, 1), "RE-2026-00001");
  assert.equal(formatInvoiceNumber(2026, 42), "RE-2026-00042");
  assert.equal(formatInvoiceNumber(2026, 10005), "RE-2026-10005");
  assert.throws(() => formatInvoiceNumber(2026, 0));
  assert.throws(() => formatInvoiceNumber("2026", 1));
});

test("formatInvoiceDate formats date in de-DE timezone", () => {
  const d = new Date("2026-10-12T14:30:00Z");
  assert.equal(formatInvoiceDate(d), "12.10.2026");
  assert.equal(formatInvoiceDate(null), "-");
});

test("getInvoiceYear accurately resolves Europe/Berlin calendar year", () => {
  assert.equal(getInvoiceYear("2026-01-01T01:00:00Z"), 2026);
  assert.equal(getInvoiceYear("2026-12-31T23:30:00Z"), 2027);
});

test("pickInvoiceSnapshot extracts essential fields and freezes them", () => {
  const mockOrder = {
    name: "#1001",
    createdAt: "12.10.2026",
    totalPrice: "50.00",
    totalShipping: "4.99",
    financialStatus: "PENDING",
    isB2B: false,
    extraUnneededField: "should_be_omitted",
    items: [
      {
        id: "item_1",
        title: "Shin Ramyun",
        quantity: 5,
        priceOriginal: "1.50",
        taxRate: 7,
        unneededItemField: "drop_me",
      },
    ],
  };

  const snapshot = pickInvoiceSnapshot({
    order: mockOrder,
    taxDisplayMode: "GROSS",
    taxExemptionNote: "None",
  });

  assert.equal(snapshot.order.name, "#1001");
  assert.equal(snapshot.order.extraUnneededField, undefined);
  assert.equal(snapshot.order.items[0].title, "Shin Ramyun");
  assert.equal(snapshot.order.items[0].unneededItemField, undefined);
  assert.equal(snapshot.taxDisplayMode, "GROSS");
  assert.equal(snapshot.taxExemptionNote, "None");
});

test("resolveInvoiceView merges live hold/cancellation status into frozen snapshot", () => {
  const liveOrder = {
    id: "gid://shopify/Order/1",
    name: "#1001",
    isCustomerHold: true,
    hasReturnRequest: true,
  };

  const invoice = {
    invoiceNumber: "RE-2026-00001",
    issuedAt: new Date("2026-10-10"),
    snapshot: {
      order: {
        name: "#1001",
        totalPrice: "25.00",
        items: [],
      },
      taxDisplayMode: "NET",
      taxExemptionNote: "Reverse Charge",
    },
  };

  const view = resolveInvoiceView(liveOrder, invoice, { taxDisplayMode: "GROSS", taxExemptionNote: "" });
  assert.equal(view.invoice.invoiceNumber, "RE-2026-00001");
  assert.equal(view.order.isCustomerHold, true);
  assert.equal(view.order.totalPrice, "25.00");
  assert.equal(view.taxDisplayMode, "NET");
  assert.equal(view.taxExemptionNote, "Reverse Charge");
});

test("resolveInvoiceView preserves invoiceNumber even when snapshot is missing or incomplete", () => {
  const liveOrder = { id: "1", name: "#1001" };
  const invoiceWithoutSnapshot = { invoiceNumber: "RE-2026-00002", issuedAt: new Date("2026-10-10"), snapshot: null };
  const view = resolveInvoiceView(liveOrder, invoiceWithoutSnapshot, { taxDisplayMode: "GROSS", taxExemptionNote: "" });
  assert.equal(view.invoice.invoiceNumber, "RE-2026-00002");
  assert.equal(view.order.name, "#1001");
});

test("fallback invoice number formatting produces immediate valid RE number", () => {
  const getDisplayNumber = (invoice, order) =>
    invoice?.invoiceNumber ||
    (order?.name
      ? String(order.name).startsWith("RE-")
        ? order.name
        : `RE-${String(order.name).replace(/^#/, "")}`
      : "-");

  assert.equal(getDisplayNumber({ invoiceNumber: "RE-2026-00001" }, { name: "#1001" }), "RE-2026-00001");
  assert.equal(getDisplayNumber(null, { name: "#1001" }), "RE-1001");
  assert.equal(getDisplayNumber(null, { name: "1002" }), "RE-1002");
  assert.equal(getDisplayNumber(null, { name: "RE-2026-00005" }), "RE-2026-00005");
  assert.equal(getDisplayNumber(null, null), "-");
});

test("getOutstandingAmount returns positive outstanding amount or zero", () => {
  assert.equal(getOutstandingAmount({ totalOutstanding: "45.00" }), 45.0);
  assert.equal(getOutstandingAmount({ totalOutstanding: "0.00" }), 0);
  assert.equal(getOutstandingAmount({ totalOutstanding: "-5.00" }), 0);
  assert.equal(getOutstandingAmount({}), 0);
});

test("buildPaymentReference uses the Bestellung-Nr format", () => {
  assert.equal(buildPaymentReference("#1001"), "Bestellung-Nr 1001");
  assert.equal(buildPaymentReference("1001"), "Bestellung-Nr 1001");
  assert.equal(buildPaymentReference(null), "Bestellung-Nr");
});

test("computeInvoiceTotals calculates gross/net and VAT breakdown", () => {
  const order = {
    totalPrice: "21.40",
    totalShipping: "0.00",
    subtotalPrice: "21.40",
    items: [
      {
        id: "1",
        quantity: 2,
        priceOriginal: "10.70",
        originalTaxRate: 7,
        taxRate: 7,
      },
    ],
  };

  const totals = computeInvoiceTotals(order, "GROSS");
  assert.equal(totals.finalTotal, 21.4);
  assert.ok(Math.abs(totals.vatBreakdown[7] - 1.4) < 0.05);
});

test("translateFinancialStatus and translatePaymentGateway translate to German", () => {
  assert.equal(translateFinancialStatus("PAID"), "Bezahlt (결제완료)");
  assert.equal(translateFinancialStatus("PENDING"), "Ausstehend (결제대기)");
  assert.equal(translatePaymentGateway(["bank_transfer"]), "Vorkasse/Überweisung (무통장입금)");
  assert.equal(translatePaymentGateway(["paypal"]), "PayPal (페이팔)");
});

test("getInvoiceForOrder returns null when not found and invoice object when found", async () => {
  const mockClient = {
    inspectionRecord: {
      findUnique: async ({ where }) => {
        if (where.orderId === "order_with_invoice") {
          return {
            invoiceNumber: "RE-2026-00001",
            invoiceIssuedAt: new Date("2026-10-12T10:00:00Z"),
            invoiceSnapshot: { test: true },
          };
        }
        return null;
      },
    },
  };

  assert.equal(await getInvoiceForOrder(null, mockClient), null);
  assert.equal(await getInvoiceForOrder("order_without_invoice", mockClient), null);

  const res = await getInvoiceForOrder("order_with_invoice", mockClient);
  assert.equal(res.invoiceNumber, "RE-2026-00001");
  assert.equal(res.snapshot.test, true);
});

test("getInvoicesForOrders returns mapped invoice records", async () => {
  const mockClient = {
    inspectionRecord: {
      findMany: async () => [
        {
          orderId: "gid://order/1",
          invoiceNumber: "RE-2026-00001",
          invoiceIssuedAt: new Date("2026-10-12T10:00:00Z"),
          invoiceSnapshot: {},
        },
      ],
    },
  };

  const empty = await getInvoicesForOrders([], mockClient);
  assert.deepEqual(empty, {});

  const res = await getInvoicesForOrders(["gid://order/1", "gid://order/2"], mockClient);
  assert.equal(res["gid://order/1"].invoiceNumber, "RE-2026-00001");
  assert.equal(res["gid://order/2"], undefined);
});

test("issueInvoiceForOrder is idempotent and returns existing invoice if already issued", async () => {
  const mockClient = {
    $transaction: async (cb) => {
      const tx = {
        inspectionRecord: {
          findUnique: async () => ({
            invoiceNumber: "RE-2026-00003",
            invoiceIssuedAt: new Date("2026-10-10"),
            invoiceSnapshot: { frozen: true },
          }),
        },
      };
      return cb(tx);
    },
  };

  const res = await issueInvoiceForOrder(
    {
      shop: "test.myshopify.com",
      orderId: "gid://order/3",
      orderName: "#1003",
      snapshot: { frozen: true },
    },
    mockClient
  );

  assert.equal(res.invoiceNumber, "RE-2026-00003");
});

test("issueInvoiceForOrder generates sequential invoice number and creates record", async () => {
  let executedLock = false;
  let upsertData = null;

  const mockClient = {
    $transaction: async (cb) => {
      const tx = {
        inspectionRecord: {
          findUnique: async () => null,
          upsert: async (args) => {
            upsertData = args;
            return {
              invoiceNumber: args.create.invoiceNumber,
              invoiceIssuedAt: args.create.invoiceIssuedAt,
              invoiceSnapshot: args.create.invoiceSnapshot,
            };
          },
        },
        $executeRaw: async () => {
          executedLock = true;
        },
        $queryRaw: async () => [{ max_seq: 41 }],
      };
      return cb(tx);
    },
  };

  const res = await issueInvoiceForOrder(
    {
      shop: "test.myshopify.com",
      orderId: "gid://order/1004",
      orderName: "#1004",
      snapshot: { items: [] },
    },
    mockClient
  );

  assert.equal(executedLock, true);
  assert.equal(res.invoiceNumber, `RE-${getInvoiceYear()}-00042`);
  assert.equal(upsertData.create.invoiceSequence, 42);
  assert.equal(upsertData.create.orderName, "#1004");
});

test("issueInvoiceForOrder validates required shop and orderId", async () => {
  await assert.rejects(
    async () => issueInvoiceForOrder({ shop: null, orderId: "123" }),
    /shop and orderId are required/
  );
  await assert.rejects(
    async () => issueInvoiceForOrder({ shop: "test.myshopify.com", orderId: null }),
    /shop and orderId are required/
  );
});

test("handleIssueInvoiceIntent issues numbers for every allowed order in a batch and ignores foreign IDs", async () => {
  let seq = 0;
  const issuedFor = [];
  const mockClient = {
    $transaction: async (cb) => cb({
      inspectionRecord: {
        findUnique: async () => null,
        upsert: async (args) => {
          issuedFor.push(args.where.orderId);
          return {
            invoiceNumber: args.create.invoiceNumber,
            invoiceIssuedAt: args.create.invoiceIssuedAt,
            invoiceSnapshot: args.create.invoiceSnapshot,
          };
        },
      },
      $executeRaw: async () => {},
      $queryRaw: async () => [{ max_seq: seq++ }],
    }),
  };

  const formData = new FormData();
  formData.set("entries", JSON.stringify([
    { orderId: "gid://shopify/Order/1", orderName: "#1", snapshot: {} },
    { orderId: "gid://shopify/Order/2", orderName: "#2", snapshot: {} },
    { orderId: "gid://shopify/Order/999", orderName: "#999", snapshot: {} },
  ]));

  const res = await handleIssueInvoiceIntent(
    { shop: "test.myshopify.com", formData, allowedRawIds: ["1", " 2"] },
    mockClient,
  );

  assert.equal(res.success, true);
  assert.deepEqual(issuedFor, ["gid://shopify/Order/1", "gid://shopify/Order/2"]);
  assert.equal(res.invoices["gid://shopify/Order/1"].invoiceNumber, `RE-${getInvoiceYear()}-00001`);
  assert.equal(res.invoices["gid://shopify/Order/2"].invoiceNumber, `RE-${getInvoiceYear()}-00002`);
  assert.equal(res.invoices["gid://shopify/Order/999"], undefined);
});

test("handleIssueInvoiceIntent returns an error result instead of throwing", async () => {
  const formData = new FormData();
  formData.set("entries", "not-json");
  const res = await handleIssueInvoiceIntent({ shop: "s", formData, allowedRawIds: ["1"] }, {});
  assert.equal(res.success, false);
  assert.ok(res.error);
});

test("missing orders detection correctly identifies dropped order IDs", () => {
  const rawIds = ["1001", "1002", "1003", "1004"];
  const loadedOrders = [
    { id: "gid://shopify/Order/1001", name: "#1001" },
    { id: "gid://shopify/Order/1003", name: "#1003" },
  ];
  const loadedGids = new Set(loadedOrders.map((o) => o.id));
  const missingRawIds = rawIds.filter((rawId) => !loadedGids.has(`gid://shopify/Order/${rawId}`));

  assert.deepEqual(missingRawIds, ["1002", "1004"]);
  assert.equal(rawIds.length, 4);
  assert.equal(loadedOrders.length, 2);
  assert.equal(missingRawIds.length, 2);
});


