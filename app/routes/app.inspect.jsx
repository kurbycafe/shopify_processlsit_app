import { useState, useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import {
  Page, Layout, Card, TextField, BlockStack, InlineStack, Text,
  DataTable, Badge, Thumbnail, Button, Banner, Box, EmptyState,
  Icon, Divider, Modal, ChoiceList, ResourceList, ResourceItem, Avatar,
  Tabs
} from "@shopify/polaris";
import { SearchIcon, BarcodeIcon, AlertTriangleIcon } from "@shopify/polaris-icons"; 
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendQcIssueReportEmail } from "../utils/emailService.js";

async function getInspectorName(admin, session) {
  // 1. Try to get it from the online session
  if (session.firstName || session.lastName) {
    return `${session.firstName || ""} ${session.lastName || ""}`.trim();
  }

  // 2. Try currentStaffMember GraphQL (defensive in case scope is granted)
  try {
    const staffResponse = await admin.graphql(
      `#graphql
      query {
        currentStaffMember {
          firstName
          lastName
        }
      }`
    );
    const staffJson = await staffResponse.json();
    if (staffJson.data?.currentStaffMember) {
      const { firstName, lastName } = staffJson.data.currentStaffMember;
      if (firstName || lastName) {
        return `${firstName || ""} ${lastName || ""}`.trim();
      }
    }
  } catch (e) {
    // Ignore error if scope read_users is not granted or query fails
  }

  // 3. Try fallback to shopOwner
  try {
    const shopResponse = await admin.graphql(
      `#graphql
      query {
        shop {
          shopOwner
        }
      }`
    );
    const shopJson = await shopResponse.json();
    if (shopJson.data?.shop?.shopOwner) {
      return shopJson.data.shop.shopOwner;
    }
  } catch (e) {
    // Ignore error
  }

  return "알 수 없음";
}

// ========================================================
// 📩 고객 안내 이메일 발송용 HTML 빌더 (Java 템플릿 100% 이식)
// ========================================================
function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safe(value) {
  return value == null || String(value).trim() === "" ? "-" : value;
}

function renderImage(imageUrl) {
  if (imageUrl == null || imageUrl.trim() === "" || imageUrl === "-") {
    return "-";
  }
  return `<img class='img' src='${escapeHtml(imageUrl)}' alt='product'>`;
}

function buildHtmlEmail(orderNumber, items) {
  const safeScanned = items || [];
  const normalProcessed = safeScanned.filter(item => item.inspectedQuantity > 0 && !item.issueType);
  const replacements = safeScanned.filter(item => item.issueType === "SUBSTITUTE");
  const refunds = safeScanned.filter(item => item.issueType === "REFUND");
  const points = safeScanned.filter(item => item.issueType === "CREDIT");

  let html = "";
  html += `<!doctype html><html><head><meta charset='UTF-8'><style>
    body{font-family:Arial,sans-serif;color:#222;line-height:1.5}
    .wrap{max-width:900px;margin:0 auto;padding:16px}
    .title{font-size:20px;font-weight:700;margin:8px 0 16px}
    .section{margin:18px 0}
    .section h3{margin:0 0 8px;font-size:16px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ddd;padding:8px;font-size:13px;vertical-align:top}
    th{background:#f7f7f7;text-align:left}
    .img{width:64px;height:64px;object-fit:cover;border:1px solid #ddd;border-radius:6px}
    .muted{color:#777}
  </style></head><body><div class='wrap'>`;

  html += `<div class='title'>주문 처리 완료 알림 / Auftragsbearbeitung abgeschlossen</div>
    <div><b>주문번호 / Bestellnummer:</b> ${escapeHtml(safe(orderNumber))}</div>`;

  // 1) 원래 주문 리스트
  html += `<div class='section'><h3>원래 주문 리스트 / Urspruengliche Bestellliste</h3>`;
  if (safeScanned.length === 0) {
    html += `<div class='muted'>원주문 정보가 없습니다. / Keine urspruenglichen Bestelldaten vorhanden.</div>`;
  } else {
    html += `<table><thead><tr><th>#</th><th>사진 / Bild</th><th>상품명 / Produktname</th><th>SKU</th><th>주문수량 / Bestellmenge</th><th>유통기한 / MHD</th></tr></thead><tbody>`;
    safeScanned.forEach((item, index) => {
      html += `<tr>
        <td>${index + 1}</td>
        <td>${renderImage(item.imageUrl)}</td>
        <td>${escapeHtml(safe(item.title))}</td>
        <td>${escapeHtml(safe(item.sku))}</td>
        <td>${escapeHtml(safe(item.orderedQuantity))}</td>
        <td>${escapeHtml(safe(item.expiryDate))}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // 2) 정상 처리된 제품
  html += `<div class='section'><h3>정상 처리된 제품 / Normal bearbeitete Produkte</h3>`;
  if (normalProcessed.length === 0) {
    html += `<div class='muted'>정상 처리된 상품이 없습니다. / Keine normal bearbeiteten Produkte.</div>`;
  } else {
    html += `<table><thead><tr><th>#</th><th>사진 / Bild</th><th>상품명 / Produktname</th><th>SKU</th><th>정상처리수량 / Normalmenge</th></tr></thead><tbody>`;
    normalProcessed.forEach((item, index) => {
      html += `<tr>
        <td>${index + 1}</td>
        <td>${renderImage(item.imageUrl)}</td>
        <td>${escapeHtml(safe(item.title))}</td>
        <td>${escapeHtml(safe(item.sku))}</td>
        <td>${escapeHtml(safe(item.inspectedQuantity))}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // 3) 대체
  html += `<div class='section'><h3>대체 처리 상품 / Ersetzte Produkte</h3>`;
  if (replacements.length === 0) {
    html += `<div class='muted'>대체 처리 내역이 없습니다. / Keine Ersatzbearbeitung vorhanden.</div>`;
  } else {
    html += `<table><thead><tr><th>#</th><th>원상품 / Originalprodukt</th><th>대체상품 / Ersatzprodukt</th><th>수량 / Menge</th></tr></thead><tbody>`;
    replacements.forEach((item, index) => {
      html += `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(safe(item.title))} (SKU: ${escapeHtml(safe(item.sku))})</td>
        <td>${escapeHtml(safe(item.substitutedProductTitle))}</td>
        <td>${escapeHtml(safe(item.orderedQuantity))}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // 4) 환불
  html += `<div class='section'><h3>환불 처리 상품 / Rueckerstattete Produkte</h3>`;
  if (refunds.length === 0) {
    html += `<div class='muted'>환불 처리 내역이 없습니다. / Keine Rueckerstattung vorhanden.</div>`;
  } else {
    html += `<table><thead><tr><th>#</th><th>상품 / Produkt</th><th>수량 / Menge</th><th>사유 / Grund</th></tr></thead><tbody>`;
    refunds.forEach((item, index) => {
      html += `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(safe(item.title))} (SKU: ${escapeHtml(safe(item.sku))})</td>
        <td>${escapeHtml(safe(item.orderedQuantity))}</td>
        <td>${escapeHtml(safe(item.issueNote))}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // 5) 포인트
  html += `<div class='section'><h3>포인트 적립 상품 / Punktegutschrift Produkte</h3>`;
  if (points.length === 0) {
    html += `<div class='muted'>포인트 적립 내역이 없습니다. / Keine Punktegutschrift vorhanden.</div>`;
  } else {
    html += `<table><thead><tr><th>#</th><th>상품 / Produkt</th><th>수량 / Menge</th><th>적립액 / Punkte</th></tr></thead><tbody>`;
    points.forEach((item, index) => {
      let amount = safe(item.issueNote);
      if (amount !== "-" && !amount.toUpperCase().endsWith("P")) {
        amount = amount + "P";
      }
      html += `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(safe(item.title))} (SKU: ${escapeHtml(safe(item.sku))})</td>
        <td>${escapeHtml(safe(item.orderedQuantity))}</td>
        <td>${escapeHtml(amount)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  html += `<p class='muted'>문의사항이 있으시면 고객지원팀에 연락주세요. / Bei Fragen wenden Sie sich bitte an den Kundensupport.</p>
    </div></body></html>`;

  return html;
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const inspectorName = await getInspectorName(admin, session);
  return { inspectorName };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch_order") {
    const orderName = formData.get("orderName");
    const response = await admin.graphql(
      `#graphql
      query findOrder($query: String!) {
        orders(first: 1, query: $query) {
          edges {
            node {
              id
              name
              email
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    variantTitle
                    sku
                    quantity
                    variant {
                      id
                      barcode
                      image { url }
                      product {
                        featuredImage { url }
                        expiryDate: metafield(namespace: "freshly", key: "expiry_date") { value }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { query: `name:${orderName}` } }
    );

    const json = await response.json();
    const order = json.data?.orders?.edges[0]?.node;

    if (!order) return { error: "주문을 찾을 수 없습니다." };

        // Fetch existing inspection record from local DB to merge
    const existingRecord = await prisma.inspectionRecord.findUnique({
      where: { orderId: order.id },
      include: { items: true }
    });

    const items = order.lineItems.edges.map(edge => {
      const lineItemId = edge.node.id;
      const variantId = edge.node.variant?.id;
      
      const existingItem = existingRecord?.items.find(
        item => item.variantId === variantId || (item.sku && item.sku === edge.node.sku)
      );

      return {
        id: lineItemId,
        variantId: variantId,
        title: edge.node.title,
        variantTitle: edge.node.variantTitle,
        sku: edge.node.sku,
        barcode: edge.node.variant?.barcode,
        imageUrl: edge.node.variant?.image?.url || edge.node.variant?.product?.featuredImage?.url || "",
        orderedQuantity: edge.node.quantity,
        inspectedQuantity: existingItem ? existingItem.inspectedQuantity : 0,
        expiryDate: edge.node.variant?.product?.expiryDate?.value || "",
        issueType: existingItem ? existingItem.issueType : null,
        issueNote: existingItem ? existingItem.issueNote : "",
        substitutedVariantId: existingItem ? existingItem.substitutedVariantId : null,
        substitutedProductTitle: existingItem ? existingItem.substitutedProductTitle : "",
      };
    });

    return { order: { id: order.id, name: order.name, email: order.email || "", items } };
  }

  // ✨ 실제 스토어 상품 검색 연동
  if (intent === "search_substitute") {
    const query = formData.get("query");
    const escapedQuery = (query || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const searchQuery = `'${escapedQuery}' OR barcode:${escapedQuery} OR sku:${escapedQuery}`;

    try {
      const response = await admin.graphql(
        `#graphql
        query searchSubstituteVariants($query: String!) {
          productVariants(first: 10, query: $query) {
            nodes {
              id
              title
              sku
              barcode
              price
              product {
                title
              }
            }
          }
        }`,
        { variables: { query: searchQuery } }
      );

      const responseJson = await response.json();
      const variants = responseJson?.data?.productVariants?.nodes || [];

      const results = variants.map(variant => ({
        id: variant.id,
        title: `${variant.product?.title || ""} ${variant.title === "Default Title" ? "" : `(${variant.title})`}`.trim(),
        sku: variant.sku || "",
        barcode: variant.barcode || "",
        price: variant.price || "0.00"
      }));

      return { results };
    } catch (e) {
      console.error("Error searching substitutes:", e);
      return { results: [] };
    }
  }

  if (intent === "save_inspection") {
    const orderId = formData.get("orderId");
    const orderName = formData.get("orderName");
    const items = JSON.parse(formData.get("items"));
    const inspectorName = formData.get("inspectorName");
    const orderEmail = formData.get("orderEmail");
    
    // ✨ 상태 판별 로직 고도화 (예외가 1개라도 있으면 STATUS 변경)
    let status = "SUCCESS";
    const hasIssue = items.some(item => item.issueType !== null);
    const isPartial = items.some(item => item.inspectedQuantity < item.orderedQuantity && item.issueType === null);

    if (hasIssue) {
      status = "ISSUE_REPORTED"; // DB 구조에 맞게 상태값 조정 가능 (예: SUBSTITUTED, REFUNDED)
    } else if (isPartial) {
      status = "PARTIAL";
    }

    // ✨ 중복 저장 시 크래시 방지를 위해 기존 내역을 안전하게 삭제 (Cascade 옵션으로 아이템 자동 삭제)
    await prisma.inspectionRecord.deleteMany({
      where: { orderId }
    });

    const record = await prisma.inspectionRecord.create({
      data: {
        orderId,
        orderName,
        shop: session.shop,
        status,
        inspectorName,
        completedAt: new Date(),
        items: {
          create: items.map(item => ({
            variantId: item.variantId || "N/A",
            productTitle: item.title,
            variantTitle: item.variantTitle,
            sku: item.sku,
            barcode: item.barcode,
            orderedQuantity: item.orderedQuantity,
            inspectedQuantity: item.inspectedQuantity,
            // ✨ 예외 처리 기록 저장 활성화
            issueType: item.issueType,
            issueNote: item.issueNote,
            substitutedVariantId: item.substitutedVariantId,
            substitutedProductTitle: item.substitutedProductTitle,
          })),
        },
      },
    });

    // 📩 고객 이메일 발송 (Brevo 이메일 서비스 연동)
    if (orderEmail && orderEmail.trim() !== "") {
      try {
        const issueItems = items.filter((i) => i.issueType);
        await sendQcIssueReportEmail({
          email: orderEmail,
          orderName,
          issueItems,
          shopDomain: shop,
        });
      } catch (emailErr) {
        console.error("Failed to send completion email via emailService:", emailErr);
      }
    }

    return { success: true, recordId: record.id };
  }

  return null;
};

export default function Inspect() {
  const { inspectorName } = useLoaderData();
  const fetcher = useFetcher();
  const searchFetcher = useFetcher(); // 대체 상품 검색용
  const saveFetcher = useFetcher();

  const [orderName, setOrderName] = useState("");
  const [currentOrder, setCurrentOrder] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [message, setMessage] = useState(null);
  const barcodeRef = useRef(null);
  const orderSearchRef = useRef(null);

  // ✨ 추가: 바코드 인라인 수동 수정을 위한 상태
  const [editingBarcodeId, setEditingBarcodeId] = useState(null);
  const [tempBarcode, setTempBarcode] = useState("");

  // ✨ 추가: 카메라 바코드 스캐너 연동용 상태
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [html5QrcodeScanner, setHtml5QrcodeScanner] = useState(null);

  // html5-qrcode 스크립트 동적 로딩 (CDN)
  useEffect(() => {
    if (!window.Html5Qrcode) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/html5-qrcode";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // 카메라 스캐너 라이프사이클 제어
  useEffect(() => {
    let scanner = null;
    if (cameraModalOpen && window.Html5Qrcode) {
      scanner = new window.Html5Qrcode("camera-scanner-view");
      scanner.start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: { width: 260, height: 160 }
        },
        (decodedText) => {
          processBarcode(decodedText);
          playSound("success");
          scanner.stop().then(() => {
            setCameraModalOpen(false);
          }).catch(err => console.error(err));
        },
        (errorMessage) => {}
      ).then(() => {
        setHtml5QrcodeScanner(scanner);
      }).catch(err => {
        console.error("Camera start error:", err);
        alert("카메라 활성화에 실패했습니다. 권한 설정을 확인해 주세요.");
        setCameraModalOpen(false);
      });
    }

    return () => {
      if (scanner) {
        scanner.stop().catch(e => console.warn(e));
      }
    };
  }, [cameraModalOpen]);

  // 바코드 수동 수정 저장
  const saveBarcode = (itemId) => {
    if (!currentOrder) return;
    const updatedItems = [...currentOrder.items];
    const idx = updatedItems.findIndex(i => i.id === itemId);
    if (idx > -1) {
      updatedItems[idx].barcode = tempBarcode.trim();
      updateActiveStates({ ...currentOrder, items: updatedItems });
      setMessage({ type: "success", text: `[${updatedItems[idx].title}] 상품의 바코드가 수정되었습니다.` });
      playSound("success");
    }
    setEditingBarcodeId(null);
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  // 스캔 로그, 에러 목록, 필터 상태 관리
  const [logs, setLogs] = useState([]);
  const [errorItems, setErrorItems] = useState([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [highlightedRowId, setHighlightedRowId] = useState(null);

  // ✨ 추가: URL 검색 파라미터 연동 자동 패치
  const [searchParams] = useSearchParams();
  const [hasAutoFetched, setHasAutoFetched] = useState(false);

  // 공통 상태 업데이트 헬퍼 함수
  const updateActiveStates = (newOrder, newLogs = null, newErrors = null) => {
    setCurrentOrder(newOrder);
    if (newLogs !== null) setLogs(newLogs);
    if (newErrors !== null) setErrorItems(newErrors);
  };

  // URL 파라미터 자동 패치 Effect
  useEffect(() => {
    const paramOrderName = searchParams.get("orderName");
    if (paramOrderName && !hasAutoFetched) {
      setHasAutoFetched(true);
      setOrderName(paramOrderName);
      fetcher.submit(
        { intent: "fetch_order", orderName: paramOrderName },
        { method: "POST" }
      );
    }
  }, [searchParams, hasAutoFetched]);

  // ✨ 예외 처리 모달 관련 State
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [activeIssueItemId, setActiveIssueItemId] = useState(null);
  const [issueType, setIssueType] = useState(["REFUND"]); // ChoiceList는 배열 사용
  const [issueNote, setIssueNote] = useState("");
  const [substituteQuery, setSubstituteQuery] = useState("");
  const [selectedSubstitute, setSelectedSubstitute] = useState(null);

  // 주문 데이터를 불러왔을 때 Effect
  useEffect(() => {
    if (fetcher.data?.order) {
      const order = fetcher.data.order;
      updateActiveStates(order, [], []);
      setBarcode("");
      setMessage({ type: "success", text: `${order.name} 주문을 불러왔습니다.` });
      playSound("success");
      setTimeout(() => barcodeRef.current?.focus(), 100);
    } else if (fetcher.data?.error) {
      setMessage({ type: "error", text: fetcher.data.error });
      playSound("error");
    }
  }, [fetcher.data]);

  // 검수 데이터 저장 성공 시 Effect
  useEffect(() => {
    if (saveFetcher.data?.success) {
      setMessage({ type: "success", text: "검수 결과가 성공적으로 저장되었습니다." });
      updateActiveStates(null, [], []);
      setOrderName("");
    }
  }, [saveFetcher.data]);

  // 주문 초기 상태 자동 포커싱 Effect
  useEffect(() => {
    if (!currentOrder) {
      setTimeout(() => orderSearchRef.current?.focus(), 100);
    }
  }, [currentOrder]);

  // ✨ 추가: 마우스 클릭 후 빈 영역 선택 시 바코드 입력창 자동 재포커싱 (Hands-free 스캔 극대화)
  useEffect(() => {
    if (!currentOrder) return;
    const handleDocumentClick = (e) => {
      const interactiveTags = ["INPUT", "TEXTAREA", "BUTTON", "SELECT", "A"];
      if (
        interactiveTags.includes(e.target.tagName) || 
        e.target.closest("button") || 
        e.target.closest("a") || 
        e.target.closest("select") || 
        e.target.closest("input") || 
        e.target.closest("textarea")
      ) {
        return;
      }
      setTimeout(() => {
        barcodeRef.current?.focus();
      }, 150);
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [currentOrder]);

  // ✨ 글로벌 키보드 바코드 스캐너 리스너 (Hands-Free 스캔)
  useEffect(() => {
    if (!currentOrder) return; // 활성화된 주문이 없으면 동작하지 않음

    let buffer = "";
    let lastKeyTime = Date.now();

    const handleKeyDown = (e) => {
      const activeEl = document.activeElement;
      
      // 현재 포커스가 일반 입력 필드나 텍스트 영역(검색창, 메모창 등)에 있는 경우 전역 캡처 차단.
      // 바코드 입력창 자체에 포커스가 가 있을 때도 이중 인식을 방지하기 위해 전역 리스너는 건너뜁니다.
      const isInputFocused = activeEl && (
        activeEl.tagName === "INPUT" || 
        activeEl.tagName === "TEXTAREA" || 
        activeEl.isContentEditable
      );

      if (isInputFocused) {
        return;
      }

      const currentTime = Date.now();
      
      // 하드웨어 바코드 리더기는 연속 입력 간격이 극히 짧습니다 (보통 15ms 이하).
      // 손으로 타이핑하는 것과 구분하기 위해 입력 간격 임계값을 40ms로 설정합니다.
      const isFastKeystroke = (currentTime - lastKeyTime) < 40;
      lastKeyTime = currentTime;

      // 엔터 키가 입력되면 스캔 완료로 간주하여 수집된 버퍼를 전송합니다.
      if (e.key === "Enter") {
        if (buffer.length > 1) {
          e.preventDefault(); // 기본 Enter 동작(폼 제출 등) 방지
          const scannedCode = buffer.trim();
          processBarcode(scannedCode);
          buffer = "";
        }
        return;
      }

      // 문자 및 숫자 키만 버퍼에 기록 (컨트롤, 시프트, 알트 등 제어 키 제외)
      if (e.key.length === 1) {
        if (isFastKeystroke || buffer.length === 0) {
          buffer += e.key;
        } else {
          // 키 입력 속도가 느릴 경우 사람이 타이핑하는 것으로 간주하여 버퍼를 리셋하고 새로 시작합니다.
          buffer = e.key;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentOrder, barcodeRef, processBarcode]);

  const handleSearch = () => {
    if (!orderName.trim()) return;
    fetcher.submit({ intent: "fetch_order", orderName }, { method: "POST" });
  };

  const handleCancelActiveOrder = () => {
    if (!confirm("현재 진행 중인 주문 데이터를 초기화/삭제하시겠습니까?")) return;
    updateActiveStates(null, [], []);
    setOrderName("");
    setMessage({ type: "info", text: "검수가 취소되었습니다." });
  };

  // Web Audio API를 활용한 효과음 재생기
  function playSound(type) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === "success") {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === "warning") {
        osc.frequency.setValueAtTime(330, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      } else if (type === "error") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(180, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (e) {
      console.warn("Audio Context failed to start:", e);
    }
  };

  function processBarcode(scannedBarcode) {
    if (!currentOrder || !scannedBarcode.trim()) return;

    const rawCode = scannedBarcode.trim();

    const itemIndex = currentOrder.items.findIndex(i =>
      String(i.barcode || "") === rawCode || String(i.sku || "") === rawCode
    );

    const timestamp = new Date().toLocaleTimeString();

    if (itemIndex > -1) {
      const updatedItems = [...currentOrder.items];
      const item = updatedItems[itemIndex];

      if (item.issueType) {
        const newLog = {
          time: timestamp,
          type: "warning",
          text: `[${item.title}] 이미 문제 보고(예외 처리)가 접수된 상품입니다.`
        };
        const updatedLogs = [newLog, ...logs];
        updateActiveStates(currentOrder, updatedLogs);
        setMessage({ type: "warning", text: newLog.text });
        playSound("warning");
      } else if (item.inspectedQuantity < item.orderedQuantity) {
        item.inspectedQuantity += 1;
        const newLog = {
          time: timestamp,
          type: "success",
          text: `[${item.title}] 검수 완료 (${item.inspectedQuantity}/${item.orderedQuantity})`
        };
        const updatedLogs = [newLog, ...logs];
        const nextOrderState = { ...currentOrder, items: updatedItems };
        updateActiveStates(nextOrderState, updatedLogs);
        setMessage({ type: "success", text: newLog.text });
        playSound("success");

        highlightRow(item.id);
      } else {
        const newLog = {
          time: timestamp,
          type: "warning",
          text: `[${item.title}] 이미 모든 수량이 검수되었습니다.`
        };
        const updatedLogs = [newLog, ...logs];
        updateActiveStates(currentOrder, updatedLogs);
        setMessage({ type: "warning", text: newLog.text });
        playSound("warning");
      }
    } else {
      const newLog = {
        time: timestamp,
        type: "error",
        text: `미등록 스캔: ${rawCode}`
      };
      const updatedLogs = [newLog, ...logs];
      
      const alreadyInErrors = errorItems.some(err => err.sku === rawCode);
      const updatedErrors = alreadyInErrors 
        ? errorItems 
        : [{ name: "미등록", sku: rawCode }, ...errorItems];

      updateActiveStates(currentOrder, updatedLogs, updatedErrors);
      setMessage({ type: "error", text: newLog.text });
      playSound("error");
    }
    
    setBarcode("");
    setTimeout(() => barcodeRef.current?.focus(), 150);
  };

  function highlightRow(itemId) {
    setHighlightedRowId(itemId);
    setTimeout(() => setHighlightedRowId(null), 800);
  };

  // ✨ 수동 수량 조절 (+/-)
  const adjustQuantity = (itemId, amount) => {
    if (!currentOrder) return;
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex(i => i.id === itemId);
    if (index > -1) {
      const newQty = updatedItems[index].inspectedQuantity + amount;
      if (newQty >= 0 && newQty <= updatedItems[index].orderedQuantity) {
        updatedItems[index].inspectedQuantity = newQty;
        updateActiveStates({ ...currentOrder, items: updatedItems });
      }
    }
    setTimeout(() => barcodeRef.current?.focus(), 150);
  };

  const scanAllQuantity = (itemId) => {
    if (!currentOrder) return;
    const updatedItems = currentOrder.items.map(item => {
      if (item.id === itemId) {
        return { ...item, inspectedQuantity: item.orderedQuantity };
      }
      return item;
    });
    const updatedOrder = { ...currentOrder, items: updatedItems };
    
    const matchedItem = currentOrder.items.find(item => item.id === itemId);
    const newLog = {
      time: new Date().toLocaleTimeString(),
      type: "success",
      text: `[${matchedItem.title}] 수동 일괄 완료 (${matchedItem.orderedQuantity}/${matchedItem.orderedQuantity})`
    };
    
    updateActiveStates(updatedOrder, [newLog, ...logs]);
    setMessage({ type: "success", text: newLog.text });
    playSound("success");
    setTimeout(() => barcodeRef.current?.focus(), 150);
  };

  const markAsError = (title, sku) => {
    const timestamp = new Date().toLocaleTimeString();
    const newLog = {
      time: timestamp,
      type: "error",
      text: `오류 추가: ${title} (SKU: ${sku || "N/A"})`
    };
    
    const alreadyInErrors = errorItems.some(err => err.sku === sku);
    const updatedErrors = alreadyInErrors 
      ? errorItems 
      : [{ name: title, sku: sku || "N/A" }, ...errorItems];
      
    updateActiveStates(currentOrder, [newLog, ...logs], updatedErrors);
    setMessage({ type: "error", text: newLog.text });
    playSound("error");
    setTimeout(() => barcodeRef.current?.focus(), 150);
  };

  // ✨ 문제 보고 모달 열기
  const openIssueModal = (itemId) => {
    setActiveIssueItemId(itemId);
    const item = currentOrder.items.find(i => i.id === itemId);
    setIssueType([item.issueType || "REFUND"]);
    setIssueNote(item.issueNote || "");
    setSelectedSubstitute(item.substitutedVariantId ? { id: item.substitutedVariantId, title: item.substitutedProductTitle } : null);
    setSubstituteQuery("");
    setIssueModalOpen(true);
  };

  // ✨ 대체 상품 검색
  const handleSubstituteSearch = () => {
    if (!substituteQuery.trim()) return;
    searchFetcher.submit({ intent: "search_substitute", query: substituteQuery }, { method: "POST" });
  };

  // ✨ 예외 처리 내용 주문 데이터에 저장
  const saveIssueToOrder = () => {
    if (!currentOrder) return;
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex(i => i.id === activeIssueItemId);
    
    if (index > -1) {
      updatedItems[index].issueType = issueType[0];
      updatedItems[index].issueNote = issueNote;
      
      if (issueType[0] === "SUBSTITUTE" && selectedSubstitute) {
        updatedItems[index].substitutedVariantId = selectedSubstitute.id;
        updatedItems[index].substitutedProductTitle = `${selectedSubstitute.title}${selectedSubstitute.sku ? ` (SKU: ${selectedSubstitute.sku})` : ""}`;
      } else {
        updatedItems[index].substitutedVariantId = null;
        updatedItems[index].substitutedProductTitle = "";
      }
      
      // 예외 처리된 항목은 검수 수량을 0으로 초기화
      updatedItems[index].inspectedQuantity = 0;
      updateActiveStates({ ...currentOrder, items: updatedItems });
    }
    setIssueModalOpen(false);
    setTimeout(() => barcodeRef.current?.focus(), 150);
  };

  // ✨ 문제 보고 취소(초기화)
  const clearIssue = (itemId) => {
    if (!currentOrder) return;
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex(i => i.id === itemId);
    if (index > -1) {
      updatedItems[index].issueType = null;
      updatedItems[index].issueNote = "";
      updatedItems[index].substitutedVariantId = null;
      updatedItems[index].substitutedProductTitle = "";
      updateActiveStates({ ...currentOrder, items: updatedItems });
    }
    setTimeout(() => barcodeRef.current?.focus(), 150);
  };

  // ✨ 전체 상품 완료 처리
  const handleCompleteAll = () => {
    if (!currentOrder) return;
    const updatedItems = currentOrder.items.map(item => ({
      ...item,
      inspectedQuantity: item.orderedQuantity,
      issueType: null,
      issueNote: "",
      substitutedVariantId: null,
      substitutedProductTitle: "",
    }));
    updateActiveStates({ ...currentOrder, items: updatedItems });
    setMessage({ type: "success", text: "모든 상품의 검수 수량을 완료 처리했습니다." });
    playSound("success");
    setTimeout(() => barcodeRef.current?.focus(), 150);
  };

  const handleSave = () => {
    saveFetcher.submit(
      {
        intent: "save_inspection",
        orderId: currentOrder.id,
        orderName: currentOrder.name,
        items: JSON.stringify(currentOrder.items),
        inspectorName: inspectorName || "",
        orderEmail: currentOrder.email || "",
      },
      { method: "POST" }
    );
  };

  const filteredItems = currentOrder?.items.filter(item => {
    const isDone = item.inspectedQuantity === item.orderedQuantity;
    if (filterStatus === "done") return isDone;
    if (filterStatus === "progress") return !isDone;
    return true;
  }) || [];

  const rows = filteredItems.map(item => {
    const isHighlighted = item.id === highlightedRowId;
    const rowStyle = isHighlighted ? { backgroundColor: "#fef08a", transition: "background-color 0.3s ease" } : {};

    let statusBadge = <Badge tone="attention">대기</Badge>;
    if (item.issueType) {
      statusBadge = <Badge tone="critical">🚨 {item.issueType}</Badge>;
    } else if (item.inspectedQuantity === item.orderedQuantity) {
      statusBadge = <Badge tone="success">✅ 완료</Badge>;
    }

    return [
      <div style={rowStyle}><Thumbnail source={item.imageUrl || ""} alt={item.title} size="small" /></div>,
      <div style={rowStyle}>
        <BlockStack gap="100">
          <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
          <Text variant="bodySm" color="subdued">{item.variantTitle} | SKU: {item.sku || "N/A"}</Text>
          
          {item.issueType && (
            <div style={{ marginTop: "4px", background: "#fef2f2", padding: "6px", borderRadius: "6px", border: "1px solid #fca5a5", fontSize: "12px" }}>
              <span style={{ fontWeight: "bold", color: "#b91c1c" }}>
                문제 보고: {item.issueType === "REFUND" ? "환불" : item.issueType === "CREDIT" ? "적립" : item.issueType === "SUBSTITUTE" ? "대체" : item.issueType}
              </span>
              {item.substitutedProductTitle && <div>→ 대체: {item.substitutedProductTitle}</div>}
              {item.issueNote && <div style={{ color: "#7f1d1d", marginTop: "2px" }}>메모: {item.issueNote}</div>}
              <Button variant="plain" tone="critical" size="micro" onClick={() => clearIssue(item.id)}>예외 처리 취소</Button>
            </div>
          )}
        </BlockStack>
      </div>,
      <div style={rowStyle}>
        {editingBarcodeId === item.id ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input
              type="text"
              value={tempBarcode}
              onChange={(e) => setTempBarcode(e.target.value)}
              style={{
                width: "120px",
                padding: "4px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "13px",
                fontFamily: "monospace",
                outline: "none",
                background: "#ffffff"
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveBarcode(item.id);
                }
              }}
            />
            <Button size="micro" onClick={() => saveBarcode(item.id)}>저장</Button>
            <Button size="micro" onClick={() => setEditingBarcodeId(null)}>취소</Button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Text variant="bodyMd" as="span" style={{ fontFamily: "monospace" }}>
              {item.barcode || "N/A"}
            </Text>
            <Button
              size="micro"
              variant="plain"
              onClick={() => {
                setEditingBarcodeId(item.id);
                setTempBarcode(item.barcode || "");
              }}
            >
              수정
            </Button>
          </div>
        )}
      </div>,
      
      <div style={rowStyle}>
        <BlockStack gap="100" align="center">
          <InlineStack wrap={false} align="center" gap="200">
            <Button size="micro" onClick={() => adjustQuantity(item.id, -1)} disabled={item.inspectedQuantity === 0 || item.issueType}>-</Button>
            <Text variant="bodyLg" fontWeight="bold">{item.inspectedQuantity} / {item.orderedQuantity}</Text>
            <Button size="micro" onClick={() => adjustQuantity(item.id, 1)} disabled={item.inspectedQuantity === item.orderedQuantity || item.issueType}>+</Button>
          </InlineStack>
          <InlineStack gap="100" align="center">
            <Button size="micro" variant="secondary" tone="success" onClick={() => scanAllQuantity(item.id)} disabled={item.inspectedQuantity === item.orderedQuantity || item.issueType}>완료</Button>
            <Button size="micro" variant="secondary" tone="critical" onClick={() => markAsError(item.title, item.sku)}>오류</Button>
          </InlineStack>
        </BlockStack>
      </div>,
      
      <div style={rowStyle}>
        <BlockStack align="center" gap="200">
          {statusBadge}
          {!item.issueType && item.inspectedQuantity < item.orderedQuantity && (
            <Button size="micro" tone="critical" onClick={() => openIssueModal(item.id)}>문제 보고</Button>
          )}
        </BlockStack>
      </div>
    ];
  }) || [];

  return (
    <Page
      title="주문 검수 (Scan-to-Verify)"
      subtitle={inspectorName ? `현재 검수자: ${inspectorName}` : undefined}
      backAction={{ content: "대시보드", url: "/app" }}
    >
      <Layout>
        {/* 주문 번호 검색 카드 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="400" align="start">
                <Box grow>
                  <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
                    <TextField
                      label="주문 번호 검색 (예: #1001)"
                      value={orderName}
                      onChange={setOrderName}
                      autoComplete="off"
                      prefix={<Icon source={SearchIcon} />} 
                      inputRef={orderSearchRef}
                      disabled={!!currentOrder}
                    />
                  </form>
                </Box>
                <Box paddingBlockStart="500">
                  <Button onClick={handleSearch} loading={fetcher.state === "submitting"} disabled={!!currentOrder}>
                    불러오기
                  </Button>
                </Box>
              </InlineStack>

              {message && (
                <Banner tone={message.type === "error" ? "critical" : message.type} onDismiss={() => setMessage(null)}>
                  <p>{message.text}</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 검수 리스트 및 작업 영역 */}
        <Layout.Section>
          {currentOrder ? (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  {/* 주문 헤더 정보 */}
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">{currentOrder.name} 검수 리스트</Text>
                    {currentOrder.email && (
                      <Text variant="bodyMd" tone="subdued">이메일: {currentOrder.email}</Text>
                    )}
                  </InlineStack>

                  {/* 진행율 정보 (심플 텍스트) */}
                  <InlineStack align="space-between">
                    <Text variant="bodySm" fontWeight="bold">검수 완료 현황</Text>
                    <Text variant="bodySm" fontWeight="bold">
                      완료: {currentOrder.items.reduce((a, i) => a + i.inspectedQuantity, 0)} / {currentOrder.items.reduce((a, i) => a + i.orderedQuantity, 0)}
                    </Text>
                  </InlineStack>

                  <form onSubmit={(e) => { e.preventDefault(); processBarcode(barcode); }}>
                    <InlineStack gap="300" align="start" blockAlign="end">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="상품 바코드 스캔"
                          value={barcode}
                          onChange={setBarcode}
                          autoComplete="off"
                          prefix={<Icon source={BarcodeIcon} />} 
                          inputRef={barcodeRef}
                          helpText="상품의 바코드를 스캔하거나 우측의 +/- 버튼으로 수동 검수하세요."
                        />
                      </div>
                      <Box paddingBlockStart="400">
                        <Button 
                          icon={BarcodeIcon} 
                          onClick={() => {
                            if (!window.Html5Qrcode) {
                              alert("카메라 스캔 라이브러리가 아직 로딩 중입니다. 잠시만 대기해 주세요.");
                              return;
                            }
                            setCameraModalOpen(true);
                          }}
                        >
                          카메라 스캔
                        </Button>
                      </Box>
                    </InlineStack>
                  </form>

                  {/* 진행 필터링 */}
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingSm" as="h3">진행 중인 상품 목록</Text>
                    <InlineStack gap="100">
                      <Button pressed={filterStatus === "all"} onClick={() => setFilterStatus("all")}>전체</Button>
                      <Button pressed={filterStatus === "progress"} onClick={() => setFilterStatus("progress")}>진행중</Button>
                      <Button pressed={filterStatus === "done"} onClick={() => setFilterStatus("done")}>완료</Button>
                    </InlineStack>
                  </InlineStack>

                  <div style={{ overflowX: "auto" }}>
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                      headings={['이미지', '상품 정보', '바코드', '수량 조절 / 처리', '상태/처리']}
                      rows={rows}
                    />
                  </div>
                  <Divider />
                  
                  <InlineStack align="space-between">
                    <Button onClick={handleCancelActiveOrder}>취소</Button>
                    <InlineStack gap="200">
                      <Button onClick={handleCompleteAll} disabled={currentOrder.items.every(item => item.inspectedQuantity === item.orderedQuantity && !item.issueType)}>
                        전체 한번에 완료
                      </Button>
                      <Button primary onClick={handleSave} loading={saveFetcher.state === "submitting"}>
                        검수 데이터 최종 전송
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  <Divider />

                  {/* 스캔 로그 및 오류 목록 패널 */}
                  <Layout>
                    <Layout.Section variant="oneHalf">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="headingSm" as="h3">스캔 로그</Text>
                          <div style={{
                            maxHeight: "180px",
                            overflowY: "auto",
                            backgroundColor: "#f9fafb",
                            border: "1px solid #e5e7eb",
                            borderRadius: "6px",
                            padding: "10px",
                            fontSize: "12px",
                            fontFamily: "monospace",
                            lineHeight: "1.5"
                          }}>
                            {logs.length === 0 ? (
                              <div style={{ color: "#9ca3af", textAlign: "center" }}>스캔 기록이 없습니다.</div>
                            ) : (
                              logs.map((log, index) => {
                                let textColor = "#374151"; 
                                if (log.type === "success") textColor = "#16a34a"; 
                                if (log.type === "warning") textColor = "#d97706"; 
                                if (log.type === "error") textColor = "#dc2626"; 
                                return (
                                  <div key={index} style={{ color: textColor, marginBottom: "4px" }}>
                                    [{log.time}] {log.text}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                    
                    <Layout.Section variant="oneHalf">
                      <Card>
                        <BlockStack gap="200">
                          <Text variant="headingSm" as="h3" tone="critical">오류 상품 목록</Text>
                          <div style={{
                            maxHeight: "180px",
                            overflowY: "auto",
                            backgroundColor: "#fef2f2",
                            border: "1px solid #fee2e2",
                            borderRadius: "6px",
                            padding: "10px",
                            fontSize: "12px",
                            lineHeight: "1.5"
                          }}>
                            {errorItems.length === 0 ? (
                              <div style={{ color: "#9ca3af", textAlign: "center" }}>감지된 스캔 오류가 없습니다.</div>
                            ) : (
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr style={{ borderBottom: "1px solid #fecaca", textAlign: "left", fontWeight: "bold" }}>
                                    <th style={{ paddingBottom: "4px" }}>상품명</th>
                                    <th style={{ paddingBottom: "4px" }}>SKU / 바코드</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {errorItems.map((err, index) => (
                                    <tr key={index} style={{ borderBottom: "1px solid #fee2e2" }}>
                                      <td style={{ padding: "4px 0", color: "#991b1b" }}>{err.name}</td>
                                      <td style={{ padding: "4px 0", color: "#991b1b", fontFamily: "monospace" }}>{err.sku}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                  </Layout>
                </BlockStack>
              </Card>
            </BlockStack>
          ) : (
            <Card>
              <EmptyState
                heading="검수할 주문을 불러오세요"
                action={{ content: '주문 검색하기', onAction: () => document.querySelector('input')?.focus() }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>주문 번호를 입력하여 상품 검수를 시작할 수 있습니다.</p>
              </EmptyState>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      {/* ✨ 결품 및 예외 처리 모달 */}
      <Modal
        open={issueModalOpen}
        onClose={() => setIssueModalOpen(false)}
        title="품절 및 문제 보고"
        primaryAction={{ content: '보고 사항 저장', onAction: saveIssueToOrder }}
        secondaryActions={[{ content: '취소', onAction: () => setIssueModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              결품이나 문제가 발생한 상품의 후속 처리 방안을 선택해 주세요. (CS팀에 전달됩니다)
            </Text>
            
            <ChoiceList
              title="해결 옵션"
              choices={[
                {label: '고객에게 환불 처리 (Refund)', value: 'REFUND'},
                {label: '스토어 포인트 지급 (Credit)', value: 'CREDIT'},
                {label: '다른 상품으로 대체 발송 (Substitute)', value: 'SUBSTITUTE'},
              ]}
              selected={issueType}
              onChange={setIssueType}
            />

            {issueType[0] === "SUBSTITUTE" && (
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">대체 상품 검색</Text>
                <InlineStack gap="200">
                  <Box grow>
                    <form onSubmit={(e) => { e.preventDefault(); handleSubstituteSearch(); }}>
                      <TextField
                        value={substituteQuery}
                        onChange={setSubstituteQuery}
                        placeholder="상품명이나 바코드로 검색"
                        autoComplete="off"
                      />
                    </form>
                  </Box>
                  <Button onClick={handleSubstituteSearch} loading={searchFetcher.state === "submitting"}>검색</Button>
                </InlineStack>

                {/* 대체 상품 검색 결과 리스트 */}
                {searchFetcher.data?.results && (
                  <ResourceList
                    resourceName={{ singular: '상품', plural: '상품' }}
                    items={searchFetcher.data.results}
                    renderItem={(item) => (
                      <ResourceItem
                        id={item.id}
                        onClick={() => setSelectedSubstitute(item)}
                        media={<Avatar customer size="sm" name={item.title} />}
                      >
                        <BlockStack>
                          <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
                          <Text variant="bodySm" tone="subdued">SKU: {item.sku} | {item.price} EUR</Text>
                        </BlockStack>
                      </ResourceItem>
                    )}
                  />
                )}

                {/* 선택된 대체 상품 표시 */}
                {selectedSubstitute && (
                  <div style={{ background: "#ecfdf3", padding: "10px", borderRadius: "8px", border: "1px solid #86efac", color: "#166534" }}>
                    <strong>선택됨:</strong> {selectedSubstitute.title}
                  </div>
                )}
              </BlockStack>
            )}

            <TextField
              label="상세 사유 (선택)"
              value={issueNote}
              onChange={setIssueNote}
              multiline={2}
              placeholder="예: 파손품 발견, 전산 재고 오류 등"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
      {/* 📷 카메라 바코드 스캐너 모달 */}
      <Modal
        open={cameraModalOpen}
        onClose={() => {
          if (html5QrcodeScanner) {
            html5QrcodeScanner.stop().catch(e => console.warn(e));
            setHtml5QrcodeScanner(null);
          }
          setCameraModalOpen(false);
          setTimeout(() => barcodeRef.current?.focus(), 150);
        }}
        title="📷 카메라 바코드 스캔"
        primaryAction={{
          content: "닫기",
          onAction: () => {
            if (html5QrcodeScanner) {
              html5QrcodeScanner.stop().catch(e => console.warn(e));
              setHtml5QrcodeScanner(null);
            }
            setCameraModalOpen(false);
            setTimeout(() => barcodeRef.current?.focus(), 150);
          },
        }}
      >
        <Modal.Section>
          <BlockStack gap="400" align="center">
            <Text as="p" tone="subdued">
              기기의 카메라를 통해 바코드를 중앙 촬영 영역 안에 비춰주세요. (후면 카메라 자동 활성화)
            </Text>
            <div 
              id="camera-scanner-view" 
              style={{ 
                width: "100%", 
                maxWidth: "400px", 
                height: "280px", 
                backgroundColor: "#000000",
                borderRadius: "8px",
                overflow: "hidden"
              }}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}