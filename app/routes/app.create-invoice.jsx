import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate, redirect } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Button,
  BlockStack,
  InlineStack,
  Divider,
  Select,
  Box,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const jsonResponse = (data, init) => {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {})
      }
    });
  };

  if (intent === "search_customers") {
    const query = formData.get("query") || "";
    const response = await admin.graphql(`
      query searchCustomers($query: String!) {
        customers(first: 10, query: $query) {
          edges {
            node {
              id
              displayName
              email
              defaultAddress {
                name
                company
                address1
                address2
                zip
                city
                country
                phone
              }
            }
          }
        }
      }
    `, { variables: { query } });

    const resJson = await response.json();
    return jsonResponse({ customers: resJson.data?.customers?.edges || [] });
  }

  if (intent === "search_products") {
    const query = formData.get("query") || "";
    const response = await admin.graphql(`
      query searchProducts($query: String!) {
        products(first: 10, query: $query) {
          edges {
            node {
              id
              title
              featuredImage { url }
              variants(first: 20) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    barcode
                    inventoryQuantity
                  }
                }
              }
            }
          }
        }
      }
    `, { variables: { query } });

    const resJson = await response.json();
    return jsonResponse({ products: resJson.data?.products?.edges || [] });
  }

  if (intent === "create_order") {
    const customerId = formData.get("customerId") || null;
    const shippingAddress = JSON.parse(formData.get("shippingAddress") || "null");
    const billingAddress = JSON.parse(formData.get("billingAddress") || "null");
    const lineItems = JSON.parse(formData.get("lineItems") || "[]");
    const shippingTitle = formData.get("shippingTitle") || "Standard Shipping";
    const shippingPrice = formData.get("shippingPrice") || "0.00";

    // Build the draft order input
    const draftOrderInput = {
      lineItems: lineItems.map(item => ({
        variantId: item.variantId,
        quantity: parseInt(item.quantity),
        originalUnitPrice: parseFloat(item.price).toFixed(2),
        taxable: item.taxable === "true" || item.taxable === true
      })),
      shippingLine: {
        title: shippingTitle,
        price: parseFloat(shippingPrice).toFixed(2)
      }
    };

    if (customerId) {
      draftOrderInput.customerId = customerId;
    }
    if (shippingAddress) {
      draftOrderInput.shippingAddress = shippingAddress;
    }
    if (billingAddress) {
      draftOrderInput.billingAddress = billingAddress;
    }

    try {
      // 1. Create Draft Order
      const createRes = await admin.graphql(`
        mutation createWholesaleDraft($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `, { variables: { input: draftOrderInput } });

      const createJson = await createRes.json();
      if (createJson.errors || createJson.data?.draftOrderCreate?.userErrors?.length > 0) {
        const errors = createJson.errors || createJson.data.draftOrderCreate.userErrors;
        return jsonResponse({ error: errors.map(e => e.message).join(", ") }, { status: 400 });
      }

      const draftOrderId = createJson.data.draftOrderCreate.draftOrder.id;

      // 2. Complete Draft Order to register sales and deduct stock via unstable API for bypassCartValidations
      const completeRes = await fetch(`https://${session.shop}/admin/api/unstable/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken
        },
        body: JSON.stringify({
          query: `
            mutation completeDraft($id: ID!) {
              draftOrderComplete(id: $id, paymentPending: false, bypassCartValidations: true) {
                draftOrder {
                  order {
                    id
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: { id: draftOrderId }
        })
      });

      const completeJson = await completeRes.json();
      if (completeJson.errors || completeJson.data?.draftOrderComplete?.userErrors?.length > 0) {
        const errors = completeJson.errors || completeJson.data.draftOrderComplete.userErrors;
        return jsonResponse({ error: errors.map(e => e.message || e.field).join(", ") }, { status: 400 });
      }

      const orderId = completeJson.data.draftOrderComplete.draftOrder.order.id;
      const numericOrderId = orderId.split("/").pop();

      return jsonResponse({ success: true, orderId: numericOrderId });
    } catch (err) {
      return jsonResponse({ error: err.message }, { status: 500 });
    }
  }

  return jsonResponse({});
};

export default function CreateWholesaleInvoicePage() {
  const navigate = useNavigate();

  // Search fetchers
  const customerSearchFetcher = useFetcher();
  const productSearchFetcher = useFetcher();
  const orderCreateFetcher = useFetcher();

  // Input states
  const [customerQuery, setCustomerQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");

  // Selection states
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [orderItems, setOrderItems] = useState([]);

  // Shipping states
  const [shippingTitle, setShippingTitle] = useState("Standard Shipping");
  const [shippingPrice, setShippingPrice] = useState("0.00");

  // Address states
  const [shippingAddress, setShippingAddress] = useState({
    firstName: "",
    lastName: "",
    company: "",
    address1: "",
    address2: "",
    zip: "",
    city: "",
    country: "",
    phone: "",
  });

  const [billingAddress, setBillingAddress] = useState({
    firstName: "",
    lastName: "",
    company: "",
    address1: "",
    address2: "",
    zip: "",
    city: "",
    country: "",
    phone: "",
  });

  // Handle customer search trigger
  const handleCustomerSearch = () => {
    customerSearchFetcher.submit(
      { intent: "search_customers", query: customerQuery },
      { method: "POST" }
    );
  };

  // Handle product search trigger
  const handleProductSearch = () => {
    productSearchFetcher.submit(
      { intent: "search_products", query: productQuery },
      { method: "POST" }
    );
  };

  // Automatically trigger search on enter keys
  const handleCustomerQueryKeyDown = (e) => {
    if (e.key === "Enter") handleCustomerSearch();
  };

  const handleProductQueryKeyDown = (e) => {
    if (e.key === "Enter") handleProductSearch();
  };

  // Set addresses when customer is selected
  const handleSelectCustomer = (cust) => {
    setSelectedCustomer(cust);
    const addr = cust.defaultAddress || {};
    
    // Parse name
    const nameParts = (addr.name || "").trim().split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const newAddr = {
      firstName,
      lastName,
      company: addr.company || "",
      address1: addr.address1 || "",
      address2: addr.address2 || "",
      zip: addr.zip || "",
      city: addr.city || "",
      country: addr.country || "",
      phone: addr.phone || "",
    };

    setShippingAddress(newAddr);
    setBillingAddress(newAddr);
  };

  // Add product variant to items list
  const handleAddVariant = (product, variant) => {
    setOrderItems((prev) => {
      const exists = prev.find((item) => item.variantId === variant.id);
      if (exists) {
        return prev.map((item) =>
          item.variantId === variant.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        return [
          ...prev,
          {
            variantId: variant.id,
            productTitle: product.title,
            variantTitle: variant.title === "Default Title" ? "" : variant.title,
            sku: variant.sku || "",
            barcode: variant.barcode || "",
            price: variant.price || "0.00",
            quantity: 1,
            inventoryQuantity: variant.inventoryQuantity ?? 0,
            taxable: true,
          },
        ];
      }
    });
  };

  // Update item quantity
  const handleQtyChange = (variantId, newQty) => {
    const qty = Math.max(1, parseInt(newQty) || 1);
    setOrderItems((prev) =>
      prev.map((item) => (item.variantId === variantId ? { ...item, quantity: qty } : item))
    );
  };

  // Update item price
  const handlePriceChange = (variantId, newPrice) => {
    setOrderItems((prev) =>
      prev.map((item) => (item.variantId === variantId ? { ...item, price: newPrice } : item))
    );
  };

  // Update taxable status
  const handleTaxableChange = (variantId, val) => {
    setOrderItems((prev) =>
      prev.map((item) => (item.variantId === variantId ? { ...item, taxable: val === "true" } : item))
    );
  };

  // Remove item
  const handleRemoveItem = (variantId) => {
    setOrderItems((prev) => prev.filter((item) => item.variantId !== variantId));
  };

  // Handle final order creation submit
  const handleCreateOrder = () => {
    if (orderItems.length === 0) return;

    orderCreateFetcher.submit(
      {
        intent: "create_order",
        customerId: selectedCustomer?.id || "",
        shippingAddress: JSON.stringify(shippingAddress),
        billingAddress: JSON.stringify(billingAddress),
        lineItems: JSON.stringify(orderItems),
        shippingTitle,
        shippingPrice,
      },
      { method: "POST" }
    );
  };

  // Handle redirection on successful order creation
  useEffect(() => {
    if (orderCreateFetcher.data?.success && orderCreateFetcher.data?.orderId) {
      navigate(`/app/lieferschein/${orderCreateFetcher.data.orderId}`);
    }
  }, [orderCreateFetcher.data, navigate]);

  const subtotal = orderItems.reduce((acc, item) => acc + parseFloat(item.price || 0) * item.quantity, 0);
  const total = subtotal + parseFloat(shippingPrice || 0);

  const customerResults = customerSearchFetcher.data?.customers || [];
  const productResults = productSearchFetcher.data?.products || [];

  const isSubmitting = orderCreateFetcher.state === "submitting";
  const submitError = orderCreateFetcher.data?.error || null;

  return (
    <Page title="도매 주문서 생성 (Invoice / Rechnung)">
      <Layout>
        {/* Left Column: Form Settings */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* 1. Customer Search */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">1. 도매 고객 검색</Text>
                <div onKeyDown={handleCustomerQueryKeyDown}>
                  <TextField
                    label="고객 이름 또는 이메일 검색"
                    value={customerQuery}
                    onChange={setCustomerQuery}
                    autoComplete="off"
                    placeholder="예: Gildong 또는 customer@email.com"
                    connectedRight={
                      <Button onClick={handleCustomerSearch} loading={customerSearchFetcher.state === "submitting"}>
                        검색
                      </Button>
                    }
                  />
                </div>
                {customerResults.length > 0 && (
                  <Box paddingBlockStart="200">
                    <Text variant="bodySm" fontWeight="bold">검색 결과:</Text>
                    <div style={{ maxHeight: "150px", overflowY: "auto", marginTop: "8px", border: "1px solid #f1f5f9", borderRadius: "6px" }}>
                      {customerResults.map((edge) => {
                        const cust = edge.node;
                        return (
                          <div
                            key={cust.id}
                            style={{
                              padding: "8px 12px",
                              cursor: "pointer",
                              borderBottom: "1px solid #f1f5f9",
                              fontSize: "13px",
                              backgroundColor: selectedCustomer?.id === cust.id ? "#eff6ff" : "transparent",
                            }}
                            onClick={() => handleSelectCustomer(cust)}
                          >
                            <strong>{cust.displayName}</strong> ({cust.email || "이메일 없음"})
                            {cust.defaultAddress?.company && <div style={{ color: "#64748b", fontSize: "11px" }}>{cust.defaultAddress.company}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </Box>
                )}
                {selectedCustomer && (
                  <Box padding="300" background="bg-surface-active" borderRadius="200" style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <BlockStack gap="100">
                      <Text variant="bodySm" fontWeight="bold">선택된 고객:</Text>
                      <Text variant="bodyMd"><strong>{selectedCustomer.displayName}</strong></Text>
                      <Text variant="bodySm" color="subdued">{selectedCustomer.email}</Text>
                      {selectedCustomer.defaultAddress?.company && (
                        <Text variant="bodySm" color="subdued">회사: {selectedCustomer.defaultAddress.company}</Text>
                      )}
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>

            {/* 2. Product Search */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">2. 상품 품목 검색</Text>
                <div onKeyDown={handleProductQueryKeyDown}>
                  <TextField
                    label="상품명 또는 SKU 검색"
                    value={productQuery}
                    onChange={setProductQuery}
                    autoComplete="off"
                    placeholder="예: 소주, 라면 등"
                    connectedRight={
                      <Button onClick={handleProductSearch} loading={productSearchFetcher.state === "submitting"}>
                        검색
                      </Button>
                    }
                  />
                </div>
                {productResults.length > 0 && (
                  <Box paddingBlockStart="200">
                    <Text variant="bodySm" fontWeight="bold">검색 결과:</Text>
                    <div style={{ maxHeight: "250px", overflowY: "auto", marginTop: "8px", border: "1px solid #f1f5f9", borderRadius: "6px" }}>
                      {productResults.map((edge) => {
                        const prod = edge.node;
                        return (
                          <div key={prod.id} style={{ padding: "8px", borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
                              {prod.featuredImage?.url && (
                                <img src={prod.featuredImage.url} alt="" style={{ width: "32px", height: "32px", objectFit: "cover", borderRadius: "4px" }} />
                              )}
                              <Text variant="bodySm" fontWeight="bold">{prod.title}</Text>
                            </div>
                            <BlockStack gap="100" style={{ paddingLeft: "8px" }}>
                              {prod.variants.edges.map((vEdge) => {
                                const v = vEdge.node;
                                return (
                                  <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", padding: "3px 0" }}>
                                    <div>
                                      {v.title !== "Default Title" && <span style={{ marginRight: "4px", color: "#475569" }}>[{v.title}]</span>}
                                      {v.sku && <span style={{ color: "#64748b", marginRight: "4px" }}>({v.sku})</span>}
                                      <span style={{ fontWeight: "bold" }}>{v.price} EUR</span>
                                      <span style={{ color: (v.inventoryQuantity ?? 0) <= 0 ? "#dc2626" : "#16a34a", marginLeft: "6px" }}>
                                        재고: {v.inventoryQuantity ?? 0}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => handleAddVariant(prod, v)}
                                      style={{
                                        padding: "3px 8px",
                                        borderRadius: "4px",
                                        border: "1px solid #cbd5e1",
                                        background: "#fff",
                                        fontSize: "11px",
                                        cursor: "pointer",
                                      }}
                                    >
                                      추가
                                    </button>
                                  </div>
                                );
                              })}
                            </BlockStack>
                          </div>
                        );
                      })}
                    </div>
                  </Box>
                )}
              </BlockStack>
            </Card>

            {/* 3. Shipping Details */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">3. 배송 방법 설정</Text>
                <TextField label="배송 방법 명칭" value={shippingTitle} onChange={setShippingTitle} autoComplete="off" />
                <TextField label="배송 비용 (EUR)" type="number" value={shippingPrice} onChange={setShippingPrice} autoComplete="off" prefix="€" />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Right Column: Order Items & Submit */}
        <Layout.Section>
          <BlockStack gap="400">
            {/* Order Items List */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">선택된 도매 상품 목록 ({orderItems.length}개)</Text>
                <Divider />
                {orderItems.length > 0 ? (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #f1f5f9", textAlign: "left" }}>
                          <th style={{ padding: "8px 4px", color: "#64748b" }}>상품 정보</th>
                          <th style={{ padding: "8px 4px", color: "#64748b", width: "80px", textAlign: "center" }}>현재 재고</th>
                          <th style={{ padding: "8px 4px", color: "#64748b", width: "80px", textAlign: "center" }}>수량</th>
                          <th style={{ padding: "8px 4px", color: "#64748b", width: "100px", textAlign: "right" }}>도매 단가(€)</th>
                          <th style={{ padding: "8px 4px", color: "#64748b", width: "100px", textAlign: "center" }}>MwSt. 적용</th>
                          <th style={{ padding: "8px 4px", color: "#64748b", width: "100px", textAlign: "right" }}>합계 금액</th>
                          <th style={{ padding: "8px 4px", width: "50px", textAlign: "center" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderItems.map((item) => {
                          const itemTotal = parseFloat(item.price || 0) * item.quantity;
                          const isOverStock = item.quantity > item.inventoryQuantity;
                          return (
                            <tr key={item.variantId} style={{ borderBottom: "1px solid #f8fafc" }}>
                              <td style={{ padding: "8px 4px" }}>
                                <strong>{item.productTitle}</strong>
                                {item.variantTitle && <div style={{ fontSize: "11px", color: "#475569" }}>옵션: {item.variantTitle}</div>}
                                {item.sku && <div style={{ fontSize: "11px", color: "#64748b" }}>SKU: {item.sku}</div>}
                              </td>
                              <td style={{ padding: "8px 4px", textAlign: "center", color: item.inventoryQuantity <= 0 ? "#dc2626" : "#1e293b" }}>
                                {item.inventoryQuantity}
                              </td>
                              <td style={{ padding: "8px 4px", textAlign: "center" }}>
                                <div style={{ display: "inline-flex", flexDirection: "column", gap: "2px" }}>
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.quantity}
                                    onChange={(e) => handleQtyChange(item.variantId, e.target.value)}
                                    style={{ width: "60px", textAlign: "center", padding: "4px", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                                  />
                                  {isOverStock && (
                                    <span style={{ fontSize: "10px", color: "#d97706", fontWeight: "bold" }}>재고부족</span>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: "8px 4px", textAlign: "right" }}>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.price}
                                  onChange={(e) => handlePriceChange(item.variantId, e.target.value)}
                                  style={{ width: "80px", textAlign: "right", padding: "4px", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                                />
                              </td>
                              <td style={{ padding: "8px 4px", textAlign: "center" }}>
                                <select
                                  value={String(item.taxable)}
                                  onChange={(e) => handleTaxableChange(item.variantId, e.target.value)}
                                  style={{ padding: "4px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px", width: "80px" }}
                                >
                                  <option value="true">과세 (MwSt)</option>
                                  <option value="false">면세 (0%)</option>
                                </select>
                              </td>
                              <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: "bold", fontFamily: "monospace" }}>
                                {itemTotal.toFixed(2)} €
                              </td>
                              <td style={{ padding: "8px 4px", textAlign: "center" }}>
                                <button
                                  onClick={() => handleRemoveItem(item.variantId)}
                                  style={{ color: "#dc2626", border: "none", background: "none", cursor: "pointer", fontSize: "12px", fontWeight: "bold" }}
                                >
                                  삭제
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Text variant="bodyMd" color="subdued" style={{ textAlign: "center", padding: "20px 0" }}>
                    선택된 상품이 없습니다. 왼쪽 검색에서 품목을 찾아서 추가해 주세요.
                  </Text>
                )}
              </BlockStack>
            </Card>

            {/* Custom Addresses (Shipping & Billing) */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">배송지 및 청구지 주소 (주문 등록용)</Text>
                <Divider />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                  {/* Shipping Address fields */}
                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="bold">배송 주소 (Lieferadresse)</Text>
                    <TextField label="이름(성)" value={shippingAddress.lastName} onChange={(val) => setShippingAddress(p => ({ ...p, lastName: val }))} autoComplete="off" />
                    <TextField label="이름(이름)" value={shippingAddress.firstName} onChange={(val) => setShippingAddress(p => ({ ...p, firstName: val }))} autoComplete="off" />
                    <TextField label="회사명" value={shippingAddress.company} onChange={(val) => setShippingAddress(p => ({ ...p, company: val }))} autoComplete="off" />
                    <TextField label="도로명 주소 1" value={shippingAddress.address1} onChange={(val) => setShippingAddress(p => ({ ...p, address1: val }))} autoComplete="off" />
                    <TextField label="추가 주소 2" value={shippingAddress.address2} onChange={(val) => setShippingAddress(p => ({ ...p, address2: val }))} autoComplete="off" />
                    <InlineStack gap="200" wrap={false}>
                      <div style={{ flex: 1 }}><TextField label="우편번호" value={shippingAddress.zip} onChange={(val) => setShippingAddress(p => ({ ...p, zip: val }))} autoComplete="off" /></div>
                      <div style={{ flex: 2 }}><TextField label="도시" value={shippingAddress.city} onChange={(val) => setShippingAddress(p => ({ ...p, city: val }))} autoComplete="off" /></div>
                    </InlineStack>
                    <TextField label="국가" value={shippingAddress.country} onChange={(val) => setShippingAddress(p => ({ ...p, country: val }))} autoComplete="off" />
                    <TextField label="전화번호" value={shippingAddress.phone} onChange={(val) => setShippingAddress(p => ({ ...p, phone: val }))} autoComplete="off" />
                  </BlockStack>

                  {/* Billing Address fields */}
                  <BlockStack gap="200">
                    <Text variant="bodyMd" fontWeight="bold">청구 주소 (Rechnungsadresse)</Text>
                    <TextField label="이름(성)" value={billingAddress.lastName} onChange={(val) => setBillingAddress(p => ({ ...p, lastName: val }))} autoComplete="off" />
                    <TextField label="이름(이름)" value={billingAddress.firstName} onChange={(val) => setBillingAddress(p => ({ ...p, firstName: val }))} autoComplete="off" />
                    <TextField label="회사명" value={billingAddress.company} onChange={(val) => setBillingAddress(p => ({ ...p, company: val }))} autoComplete="off" />
                    <TextField label="도로명 주소 1" value={billingAddress.address1} onChange={(val) => setBillingAddress(p => ({ ...p, address1: val }))} autoComplete="off" />
                    <TextField label="추가 주소 2" value={billingAddress.address2} onChange={(val) => setBillingAddress(p => ({ ...p, address2: val }))} autoComplete="off" />
                    <InlineStack gap="200" wrap={false}>
                      <div style={{ flex: 1 }}><TextField label="우편번호" value={billingAddress.zip} onChange={(val) => setBillingAddress(p => ({ ...p, zip: val }))} autoComplete="off" /></div>
                      <div style={{ flex: 2 }}><TextField label="도시" value={billingAddress.city} onChange={(val) => setBillingAddress(p => ({ ...p, city: val }))} autoComplete="off" /></div>
                    </InlineStack>
                    <TextField label="국가" value={billingAddress.country} onChange={(val) => setBillingAddress(p => ({ ...p, country: val }))} autoComplete="off" />
                    <TextField label="전화번호" value={billingAddress.phone} onChange={(val) => setBillingAddress(p => ({ ...p, phone: val }))} autoComplete="off" />
                  </BlockStack>
                </div>
              </BlockStack>
            </Card>

            {/* Price Calculations & Submission */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">최종 금액 정산 및 주문서 등록</Text>
                <Divider />
                <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                  <table style={{ width: "250px", borderCollapse: "collapse", fontSize: "14px", lineHeight: "2" }}>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ color: "#64748b" }}>상품 금액 합계:</td>
                        <td style={{ textAlign: "right", fontWeight: "bold", fontFamily: "monospace" }}>{subtotal.toFixed(2)} €</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ color: "#64748b" }}>배송비:</td>
                        <td style={{ textAlign: "right", fontWeight: "bold", fontFamily: "monospace" }}>{parseFloat(shippingPrice || 0).toFixed(2)} €</td>
                      </tr>
                      <tr style={{ borderBottom: "2px solid #1e293b", fontSize: "16px", fontWeight: "bold" }}>
                        <td>최종 합계 금액 (MwSt 포함):</td>
                        <td style={{ textAlign: "right", fontFamily: "monospace" }}>{total.toFixed(2)} €</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {submitError && (
                  <Box padding="300" background="bg-surface-critical" borderRadius="200" style={{ backgroundColor: "#fef2f2", border: "1px solid #fee2e2", color: "#b91c1c" }}>
                    <Text variant="bodyMd" tone="critical"><strong>오류 발생:</strong> {submitError}</Text>
                  </Box>
                )}

                <InlineStack align="end">
                  <Button
                    variant="primary"
                    size="large"
                    disabled={orderItems.length === 0}
                    loading={isSubmitting}
                    onClick={handleCreateOrder}
                  >
                    쇼피파이에 주문 등록 및 명세서(Rechnung) 보기
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
