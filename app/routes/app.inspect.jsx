import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import {
  Page,
  Card,
  TextField,
  BlockStack,
  InlineStack,
  Text,
  DataTable,
  Badge,
  Thumbnail,
  Button,
  ButtonGroup,
  Banner,
  Box,
  Icon,
  Modal,
  ChoiceList,
  ResourceList,
  ResourceItem,
  ProgressBar,
} from "@shopify/polaris";
import {
  SearchIcon,
  BarcodeIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma, { ensureDatabaseSchema } from "../db.server";
import { sendQcIssueReportEmail } from "../utils/emailService.js";
import {
  playSuccessBeep,
  playErrorBuzz,
  playWarningBeep,
} from "../utils/audioFeedback.js";
import { isBarcodeOrSkuMatch } from "../utils/barcodeHelpers.js";
import StatusBadge from "../components/common/StatusBadge";
import { getInspectorName } from "../services/inspectorService.server.js";

import { readInspectionOrder, validateInspectionSubstitutes } from "../services/inspectionOrders.server.js";
import { normalizeInspectionItems, restoreSavedInspections } from "../services/inspectionValidation.js";

export { isBarcodeOrSkuMatch };

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureDatabaseSchema();
  const inspectorName = await getInspectorName(admin, session);
  return { inspectorName, shop: session.shop };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureDatabaseSchema();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "fetch_order") {
    const rawSearch = String(formData.get("orderName") || "").trim();
    if (!rawSearch) return { error: "검색할 주문번호 또는 고객 정보를 입력해 주세요." };

    // Format query for flexible lookup (#1001, 1001, email, name)
    let shopifyQuery = "";
    if (rawSearch.includes("@")) {
      shopifyQuery = `email:${rawSearch}`;
    } else {
      const cleanNum = rawSearch.replace(/^#/, "");
      shopifyQuery = `name:#${cleanNum} OR name:${cleanNum} OR name:${rawSearch}`;
    }

    let order;
    try { order = await readInspectionOrder(admin, { query: shopifyQuery }); }
    catch (error) { return { error: error.message }; }

    if (!order) return { error: `'${rawSearch}'에 해당하는 주문을 찾을 수 없습니다.` };

    // Fetch existing inspection record from local DB
    const existingRecord = await prisma.inspectionRecord.findUnique({
      where: { orderId: order.id, shop: session.shop },
      include: { items: true },
    });

    const savedItems = restoreSavedInspections(order.lineItems.edges.map(edge => edge.node), existingRecord?.items);
    const items = order.lineItems.edges.map((edge) => {
      const lineItemId = edge.node.id;
      const variantId = edge.node.variant?.id;

      const existingItem = savedItems.get(lineItemId);

      return {
        id: lineItemId,
        variantId: variantId || "N/A",
        title: edge.node.title,
        variantTitle: edge.node.variantTitle || "",
        sku: edge.node.sku || "",
        barcode: edge.node.variant?.barcode || "",
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

  // Variant substitute search
  if (intent === "search_substitute") {
    const query = String(formData.get("query") || "").trim();
    const escapedQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

      const results = variants.map((variant) => ({
        id: variant.id,
        title: `${variant.product?.title || ""} ${variant.title === "Default Title" ? "" : `(${variant.title})`}`.trim(),
        sku: variant.sku || "",
        barcode: variant.barcode || "",
        price: variant.price || "0.00",
      }));

      return { results };
    } catch (e) {
      console.error("Error searching substitutes:", e);
      return { results: [] };
    }
  }

  if (intent === "save_inspection") {
    const orderId = String(formData.get("orderId") || "");
    let order, items;
    try {
      order = await readInspectionOrder(admin, { id: orderId });
      if (!order || order.cancelledAt) return { error: "취소되었거나 조회할 수 없는 주문입니다." };
      items = normalizeInspectionItems(JSON.parse(formData.get("items") || "[]"), order.lineItems.edges.map(edge => edge.node));
      await validateInspectionSubstitutes(admin, items);
    } catch (error) { return { error: error instanceof SyntaxError ? "검수 데이터를 확인해 주세요." : error.message }; }
    const orderName = order.name;
    const orderEmail = order.email || "";
    const inspectorName = String(formData.get("inspectorName") || await getInspectorName(admin, session)).trim().slice(0,200);

    // Determine status
    let status = "SUCCESS";
    const hasIssue = items.some((item) => item.issueType !== null);
    const isPartial = items.some(
      (item) => item.inspectedQuantity < item.orderedQuantity && item.issueType === null
    );

    if (hasIssue) {
      status = "ISSUE_REPORTED";
    } else if (isPartial) {
      status = "PARTIAL";
    }

    // Transactional save / replace items
    const record = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.shop}:${orderId}`}, 0))`;
      const existing = await tx.inspectionRecord.findUnique({ where: { orderId } });
      if (existing && existing.shop !== session.shop) throw new Error("주문에 대한 권한이 없습니다.");
      if (existing) {
        await tx.inspectionItem.deleteMany({ where: { inspectionRecordId: existing.id } });
        return await tx.inspectionRecord.update({
          where: { id: existing.id },
          data: {
            orderName,
            shop: session.shop,
            status,
            inspectorName,
            completedAt: new Date(),
            items: {
              create: items.map((item) => ({
                orderLineId: item.id,
                variantId: item.variantId || "N/A",
                productTitle: item.title,
                variantTitle: item.variantTitle || "",
                sku: item.sku || null,
                barcode: item.barcode || null,
                orderedQuantity: Number(item.orderedQuantity) || 0,
                inspectedQuantity: Number(item.inspectedQuantity) || 0,
                issueType: item.issueType || null,
                issueNote: item.issueNote || null,
                substitutedVariantId: item.substitutedVariantId || null,
                substitutedProductTitle: item.substitutedProductTitle || null,
              })),
            },
          },
        });
      }

      return await tx.inspectionRecord.create({
        data: {
          orderId,
          orderName,
          shop: session.shop,
          status,
          inspectorName,
          completedAt: new Date(),
          items: {
            create: items.map((item) => ({
              orderLineId: item.id,
                variantId: item.variantId || "N/A",
              productTitle: item.title,
              variantTitle: item.variantTitle || "",
              sku: item.sku || null,
              barcode: item.barcode || null,
              orderedQuantity: Number(item.orderedQuantity) || 0,
              inspectedQuantity: Number(item.inspectedQuantity) || 0,
              issueType: item.issueType || null,
              issueNote: item.issueNote || null,
              substitutedVariantId: item.substitutedVariantId || null,
              substitutedProductTitle: item.substitutedProductTitle || null,
            })),
          },
        },
      });
    });

    // Customer email dispatch on exception issues (fixed undefined shop bug)
    if (orderEmail && orderEmail.trim() !== "" && hasIssue) {
      try {
        const issueItems = items.filter((i) => i.issueType);
        await sendQcIssueReportEmail({
          email: orderEmail,
          orderName,
          issueItems,
          shopDomain: session.shop,
        });
      } catch (emailErr) {
        console.error("Failed to send QC issue email:", emailErr.message);
      }
    }

    return { success: true, recordId: record.id };
  }

  return null;
};

export default function Inspect() {
  const { inspectorName, shop: _shop } = useLoaderData();
  const fetcher = useFetcher();
  const searchFetcher = useFetcher();
  const saveFetcher = useFetcher();

  const [orderName, setOrderName] = useState("");
  const [currentOrder, setCurrentOrder] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [message, setMessage] = useState(null);
  const barcodeRef = useRef(null);
  const orderSearchRef = useRef(null);
  const orderScanBufferRef = useRef("");
  const lastOrderKeyTimeRef = useRef(0);
  const barcodeScanBufferRef = useRef("");
  const lastBarcodeKeyTimeRef = useRef(0);

  // Barcode manual edit states
  const [editingBarcodeId, setEditingBarcodeId] = useState(null);
  const [tempBarcode, setTempBarcode] = useState("");

  // Camera scanner states
  const [cameraModalOpen, setCameraModalOpen] = useState(false);

  // Inspector identity and workstation override states
  const [currentInspector, setCurrentInspector] = useState(inspectorName || "");
  const [isInspectorModalOpen, setIsInspectorModalOpen] = useState(false);
  const [customInspectorInput, setCustomInspectorInput] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("dawayo_inspector_name");
      if (saved && saved.trim()) {
        setCurrentInspector(saved.trim());
      } else if (inspectorName) {
        setCurrentInspector(inspectorName);
      }
    }
  }, [inspectorName]);

  const handleOpenInspectorModal = () => {
    setCustomInspectorInput(currentInspector || inspectorName || "");
    setIsInspectorModalOpen(true);
  };

  const handleSaveCustomInspector = () => {
    const trimmed = customInspectorInput.trim();
    if (trimmed) {
      setCurrentInspector(trimmed);
      if (typeof window !== "undefined") {
        localStorage.setItem("dawayo_inspector_name", trimmed);
      }
    }
    setIsInspectorModalOpen(false);
  };

  const handleResetToShopifyAdmin = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("dawayo_inspector_name");
    }
    setCurrentInspector(inspectorName || "");
    setIsInspectorModalOpen(false);
  };

  // Dynamic script loading for html5-qrcode
  useEffect(() => {
    if (typeof window !== "undefined" && !window.Html5Qrcode) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/html5-qrcode";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  const [_logs, setLogs] = useState([]);
  const [highlightedRowId, setHighlightedRowId] = useState(null);
  const [searchParams] = useSearchParams();
  const [hasAutoFetched, setHasAutoFetched] = useState(false);

  // Item filter tab state: "ALL" | "REMAINING" | "COMPLETED" | "ISSUES"
  const [itemTab, setItemTab] = useState("ALL");

  // Exception / Issue modal states
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [activeIssueItemId, setActiveIssueItemId] = useState(null);
  const [issueType, setIssueType] = useState(["REFUND"]);
  const [issueNote, setIssueNote] = useState("");
  const [substituteQuery, setSubstituteQuery] = useState("");
  const [selectedSubstitute, setSelectedSubstitute] = useState(null);

  const highlightRow = (itemId) => {
    setHighlightedRowId(itemId);
    setTimeout(() => setHighlightedRowId(null), 1000);
  };

  const processBarcode = useCallback(
    (scannedBarcode) => {
      if (!currentOrder || !scannedBarcode.trim()) return;
      const rawCode = scannedBarcode.trim();

      const itemIndex = currentOrder.items.findIndex((i) =>
        isBarcodeOrSkuMatch(i, rawCode)
      );

      const timestamp = new Date().toLocaleTimeString();

      if (itemIndex > -1) {
        const updatedItems = [...currentOrder.items];
        const item = updatedItems[itemIndex];

        if (item.issueType) {
          const newLog = {
            time: timestamp,
            type: "warning",
            text: `[${item.title}] 이미 문제 보고(예외 처리)가 접수된 상품입니다.`,
          };
          setLogs((prev) => [newLog, ...prev]);
          setMessage({ type: "warning", text: newLog.text });
          playWarningBeep();
        } else if (item.inspectedQuantity < item.orderedQuantity) {
          item.inspectedQuantity += 1;
          const newLog = {
            time: timestamp,
            type: "success",
            text: `[${item.title}] 검수 완료 (${item.inspectedQuantity}/${item.orderedQuantity})`,
          };
          setLogs((prev) => [newLog, ...prev]);
          setCurrentOrder({ ...currentOrder, items: updatedItems });
          setMessage({ type: "success", text: newLog.text });
          playSuccessBeep();
          highlightRow(item.id);
        } else {
          const newLog = {
            time: timestamp,
            type: "warning",
            text: `[${item.title}] 이미 모든 수량이 검수되었습니다.`,
          };
          setLogs((prev) => [newLog, ...prev]);
          setMessage({ type: "warning", text: newLog.text });
          playWarningBeep();
        }
      } else {
        const newLog = {
          time: timestamp,
          type: "error",
          text: `미등록 바코드 스캔: ${rawCode}`,
        };
        setLogs((prev) => [newLog, ...prev]);
        setMessage({ type: "error", text: newLog.text });
        playErrorBuzz();
      }

      setBarcode("");
      setTimeout(() => barcodeRef.current?.focus(), 80);
    },
    [currentOrder]
  );

  // Initial autofocus and Hands-Free Scanner for Order Search
  useEffect(() => {
    if (currentOrder) return;

    setTimeout(() => orderSearchRef.current?.focus(), 150);

    const handleSearchKeyDown = (e) => {
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable);

      // If user is focused on an input element, do not intercept normal typing
      if (isInputFocused) {
        return;
      }

      const currentTime = Date.now();
      const timeDelta = currentTime - lastOrderKeyTimeRef.current;
      lastOrderKeyTimeRef.current = currentTime;

      // Handle Enter (Scanner commit when focus was outside input)
      if (e.key === "Enter") {
        const orderToSearch = orderScanBufferRef.current.trim() || orderName.trim();

        if (orderToSearch) {
          e.preventDefault();
          e.stopPropagation();
          fetcher.submit({ intent: "fetch_order", orderName: orderToSearch }, { method: "POST" });
          orderScanBufferRef.current = "";
          setOrderName(orderToSearch);
        } else if (orderSearchRef.current) {
          orderSearchRef.current.focus();
        }
        return;
      }

      // Handle printable characters (scanner input when focus was outside input)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (timeDelta > 200) {
          orderScanBufferRef.current = e.key;
        } else {
          orderScanBufferRef.current += e.key;
        }
        setOrderName(orderScanBufferRef.current);
      }
    };

    window.addEventListener("keydown", handleSearchKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleSearchKeyDown, true);
    };
  }, [currentOrder, orderName, fetcher]);

  // Hands-Free Global Barcode Scanner Engine for loaded order
  useEffect(() => {
    if (!currentOrder || cameraModalOpen || issueModalOpen || editingBarcodeId) {
      return;
    }

    const handleGlobalKeyDown = (e) => {
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable);

      // Do not intercept if user is typing in a modal input/textarea or editing a barcode manually
      if (isInputFocused && activeEl !== barcodeRef.current) {
        return;
      }

      // If user is focused on the barcode input:
      if (activeEl === barcodeRef.current) {
        if (e.key === "Enter") {
          const scannedCode = barcode.trim() || barcodeRef.current?.value?.trim() || "";
          if (scannedCode) {
            e.preventDefault();
            e.stopPropagation();
            processBarcode(scannedCode);
            barcodeScanBufferRef.current = "";
            setBarcode("");
          }
        }
        return;
      }

      // If focus is outside any input (hands-free scanner)
      const currentTime = Date.now();
      const timeDelta = currentTime - lastBarcodeKeyTimeRef.current;
      lastBarcodeKeyTimeRef.current = currentTime;

      // Handle Enter (Scanner commit)
      if (e.key === "Enter") {
        const scannedCode =
          barcodeScanBufferRef.current.trim() ||
          barcode.trim();

        if (scannedCode) {
          e.preventDefault();
          e.stopPropagation();
          processBarcode(scannedCode);
          barcodeScanBufferRef.current = "";
          setBarcode("");
        } else if (barcodeRef.current) {
          barcodeRef.current.focus();
        }
        return;
      }

      // Handle printable characters (scanner wedge keystrokes)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (timeDelta > 200) {
          barcodeScanBufferRef.current = e.key;
        } else {
          barcodeScanBufferRef.current += e.key;
        }
        setBarcode(barcodeScanBufferRef.current);
      }
    };

    // Attach in capture phase so barcode scan Enter never triggers background buttons
    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [currentOrder, cameraModalOpen, issueModalOpen, editingBarcodeId, processBarcode, barcode]);

  // Camera scanner lifecycle
  useEffect(() => {
    let scannerInstance = null;
    if (cameraModalOpen && typeof window !== "undefined" && window.Html5Qrcode) {
      scannerInstance = new window.Html5Qrcode("camera-scanner-view");
      scannerInstance
        .start(
          { facingMode: "environment" },
          { fps: 15, qrbox: { width: 260, height: 160 } },
          (decodedText) => {
            processBarcode(decodedText);
            scannerInstance
              .stop()
              .then(() => setCameraModalOpen(false))
              .catch((e) => console.warn(e));
          },
          () => {}
        )
        .catch((err) => {
          console.warn("Camera scanner error:", err);
          setMessage({
            type: "error",
            text: "카메라 활성화에 실패했습니다. 권한 설정을 확인하거나 바코드를 직접 입력해 주세요.",
          });
          setCameraModalOpen(false);
        });
    }

    return () => {
      if (scannerInstance && scannerInstance.isScanning) {
        scannerInstance.stop().catch((e) => console.warn(e));
      }
    };
  }, [cameraModalOpen, processBarcode]);

  // URL Auto Fetch
  useEffect(() => {
    const paramOrderName = searchParams.get("orderName");
    if (paramOrderName && !hasAutoFetched) {
      setHasAutoFetched(true);
      setOrderName(paramOrderName);
      fetcher.submit({ intent: "fetch_order", orderName: paramOrderName }, { method: "POST" });
    }
  }, [searchParams, hasAutoFetched, fetcher]);

  // Order load response
  useEffect(() => {
    if (fetcher.data?.order) {
      const order = fetcher.data.order;
      setCurrentOrder(order);
      setLogs([]);
      setBarcode("");
      setItemTab("ALL");
      setMessage({ type: "success", text: `${order.name} 주문 정보를 성공적으로 불러왔습니다.` });
      playSuccessBeep();
      setTimeout(() => barcodeRef.current?.focus(), 150);
    } else if (fetcher.data?.error) {
      setMessage({ type: "error", text: fetcher.data.error });
      playErrorBuzz();
    }
  }, [fetcher.data]);

  // Save response
  useEffect(() => {
    if (saveFetcher.data?.success) {
      setMessage({ type: "success", text: "검수 결과가 성공적으로 저장되었습니다." });
      playSuccessBeep();
      setCurrentOrder(null);
      setLogs([]);
      setOrderName("");
      setItemTab("ALL");
      setTimeout(() => orderSearchRef.current?.focus(), 150);
    } else if (saveFetcher.data?.error) {
      setMessage({ type: "error", text: saveFetcher.data.error });
      playErrorBuzz();
    }
  }, [saveFetcher.data]);

  const handleSearch = (searchQuery) => {
    const query = (typeof searchQuery === "string" ? searchQuery : orderName).trim();
    if (!query) return;
    fetcher.submit({ intent: "fetch_order", orderName: query }, { method: "POST" });
  };

  const handleCancelActiveOrder = () => {
    setCurrentOrder(null);
    setLogs([]);
    setOrderName("");
    setMessage({ type: "info", text: "검수가 취소되었습니다." });
  };

  const adjustQuantity = (itemId, amount) => {
    if (!currentOrder) return;
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex((i) => i.id === itemId);
    if (index > -1) {
      const newQty = updatedItems[index].inspectedQuantity + amount;
      if (newQty >= 0 && newQty <= updatedItems[index].orderedQuantity) {
        updatedItems[index].inspectedQuantity = newQty;
        setCurrentOrder({ ...currentOrder, items: updatedItems });
      }
    }
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  const scanAllQuantity = (itemId) => {
    if (!currentOrder) return;
    const updatedItems = currentOrder.items.map((item) => {
      if (item.id === itemId) {
        return { ...item, inspectedQuantity: item.orderedQuantity };
      }
      return item;
    });
    setCurrentOrder({ ...currentOrder, items: updatedItems });
    playSuccessBeep();
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  const openIssueModal = (itemId) => {
    setActiveIssueItemId(itemId);
    const item = currentOrder.items.find((i) => i.id === itemId);
    setIssueType([item.issueType || "REFUND"]);
    setIssueNote(item.issueNote || "");
    setSelectedSubstitute(
      item.substitutedVariantId
        ? { id: item.substitutedVariantId, title: item.substitutedProductTitle }
        : null
    );
    setSubstituteQuery("");
    setIssueModalOpen(true);
  };

  const handleSubstituteSearch = () => {
    if (!substituteQuery.trim()) return;
    searchFetcher.submit(
      { intent: "search_substitute", query: substituteQuery },
      { method: "POST" }
    );
  };

  const saveIssueToOrder = () => {
    if (!currentOrder) return;
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex((i) => i.id === activeIssueItemId);

    if (index > -1) {
      const selectedType = issueType[0];
      if (selectedType === "SUBSTITUTE" && !selectedSubstitute) {
        setMessage({ type: "error", text: "대체 상품을 선택해 주세요." });
        return;
      }

      updatedItems[index].issueType = selectedType;
      updatedItems[index].issueNote = issueNote.trim();

      if (selectedType === "SUBSTITUTE" && selectedSubstitute) {
        updatedItems[index].substitutedVariantId = selectedSubstitute.id;
        updatedItems[index].substitutedProductTitle = selectedSubstitute.title;
      } else {
        updatedItems[index].substitutedVariantId = null;
        updatedItems[index].substitutedProductTitle = "";
      }

      updatedItems[index].inspectedQuantity = 0;
      setCurrentOrder({ ...currentOrder, items: updatedItems });
    }
    setIssueModalOpen(false);
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  const clearIssue = (itemId) => {
    if (!currentOrder) return;
    const updatedItems = [...currentOrder.items];
    const index = updatedItems.findIndex((i) => i.id === itemId);
    if (index > -1) {
      updatedItems[index].issueType = null;
      updatedItems[index].issueNote = "";
      updatedItems[index].substitutedVariantId = null;
      updatedItems[index].substitutedProductTitle = "";
      setCurrentOrder({ ...currentOrder, items: updatedItems });
    }
    setTimeout(() => barcodeRef.current?.focus(), 100);
  };

  const handleCompleteAll = () => {
    if (!currentOrder) return;
    const updatedItems = currentOrder.items.map((item) => ({
      ...item,
      inspectedQuantity: item.orderedQuantity,
      issueType: null,
      issueNote: "",
      substitutedVariantId: null,
      substitutedProductTitle: "",
    }));
    setCurrentOrder({ ...currentOrder, items: updatedItems });
    playSuccessBeep();
    setMessage({ type: "success", text: "모든 상품의 검수 수량을 완료 처리했습니다." });
    setTimeout(() => barcodeRef.current?.focus(), 80);
  };

  const handleSave = () => {
    if (!currentOrder) return;
    saveFetcher.submit(
      {
        intent: "save_inspection",
        orderId: currentOrder.id,
        orderName: currentOrder.name,
        items: JSON.stringify(currentOrder.items),
        inspectorName: currentInspector || inspectorName || "",
        orderEmail: currentOrder.email || "",
      },
      { method: "POST" }
    );
  };

  // Progress metrics
  const totalOrderedCount = currentOrder
    ? currentOrder.items.reduce((sum, it) => sum + it.orderedQuantity, 0)
    : 0;
  const totalInspectedCount = currentOrder
    ? currentOrder.items.reduce((sum, it) => sum + it.inspectedQuantity, 0)
    : 0;
  const remainingCount = currentOrder
    ? currentOrder.items.filter((it) => it.inspectedQuantity < it.orderedQuantity && !it.issueType).length
    : 0;
  const completedCount = currentOrder
    ? currentOrder.items.filter((it) => it.inspectedQuantity === it.orderedQuantity && !it.issueType).length
    : 0;
  const issueCount = currentOrder
    ? currentOrder.items.filter((it) => it.issueType !== null).length
    : 0;
  const progressPercent = totalOrderedCount > 0
    ? Math.min(100, Math.round((totalInspectedCount / totalOrderedCount) * 100))
    : 0;

  const displayedItems = useMemo(() => {
    if (!currentOrder?.items) return [];
    if (itemTab === "REMAINING") {
      return currentOrder.items.filter(
        (it) => it.inspectedQuantity < it.orderedQuantity && !it.issueType
      );
    }
    if (itemTab === "COMPLETED") {
      return currentOrder.items.filter(
        (it) => it.inspectedQuantity === it.orderedQuantity && !it.issueType
      );
    }
    if (itemTab === "ISSUES") {
      return currentOrder.items.filter((it) => it.issueType !== null);
    }
    return currentOrder.items;
  }, [currentOrder, itemTab]);

  const rows = displayedItems.map((item) => {
    const isHighlighted = item.id === highlightedRowId;
    const isCompleted = item.inspectedQuantity === item.orderedQuantity;

    let statusElement = <StatusBadge status="PENDING" size="small" />;
    if (item.issueType) {
      statusElement = <StatusBadge status={item.issueType} size="small" />;
    } else if (isCompleted) {
      statusElement = <StatusBadge status="SUCCESS" size="small" />;
    } else if (item.inspectedQuantity > 0) {
      statusElement = <StatusBadge status="PARTIAL" size="small" />;
    }

    return [
      <div key={`thumb-${item.id}`} style={{ backgroundColor: isHighlighted ? "#fef08a" : "transparent" }}>
        <Thumbnail source={item.imageUrl || ""} alt={item.title} size="small" />
      </div>,
      <div key={`info-${item.id}`} style={{ backgroundColor: isHighlighted ? "#fef08a" : "transparent" }}>
        <BlockStack gap="100">
          <Text variant="bodyMd" fontWeight="bold">
            {item.title}
          </Text>
          <Text variant="bodySm" tone="subdued">
            {item.variantTitle && `${item.variantTitle} | `}SKU: {item.sku || "N/A"}
          </Text>

          {item.issueType && (
            <Box
              padding="200"
              background="bg-surface-critical-subdued"
              borderRadius="150"
              borderWidth="025"
              borderColor="border-critical"
            >
              <BlockStack gap="050">
                <Text variant="bodySm" fontWeight="bold" tone="critical">
                  예외 처리: {item.issueType === "REFUND" ? "환불" : item.issueType === "CREDIT" ? "적립금" : "대체상품"}
                </Text>
                {item.substitutedProductTitle && (
                  <Text variant="bodyXs" tone="subdued">
                    대체 상품: {item.substitutedProductTitle}
                  </Text>
                )}
                {item.issueNote && (
                  <Text variant="bodyXs" tone="subdued">
                    메모: {item.issueNote}
                  </Text>
                )}
                <div style={{ marginTop: "4px" }}>
                  <Button variant="plain" tone="critical" size="micro" onClick={() => clearIssue(item.id)}>
                    예외 취소
                  </Button>
                </div>
              </BlockStack>
            </Box>
          )}
        </BlockStack>
      </div>,
      <div key={`barcode-${item.id}`} style={{ backgroundColor: isHighlighted ? "#fef08a" : "transparent" }}>
        {editingBarcodeId === item.id ? (
          <InlineStack gap="100" blockAlign="center">
            <input
              type="text"
              value={tempBarcode}
              onChange={(e) => setTempBarcode(e.target.value)}
              style={{
                width: "120px",
                padding: "4px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: "4px",
                fontSize: "12px",
                fontFamily: "monospace",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (currentOrder) {
                    const updated = [...currentOrder.items];
                    const idx = updated.findIndex((i) => i.id === item.id);
                    if (idx > -1) {
                      updated[idx].barcode = tempBarcode.trim();
                      setCurrentOrder({ ...currentOrder, items: updated });
                    }
                  }
                  setEditingBarcodeId(null);
                }
              }}
            />
            <Button
              size="micro"
              onClick={() => {
                if (currentOrder) {
                  const updated = [...currentOrder.items];
                  const idx = updated.findIndex((i) => i.id === item.id);
                  if (idx > -1) {
                    updated[idx].barcode = tempBarcode.trim();
                    setCurrentOrder({ ...currentOrder, items: updated });
                  }
                }
                setEditingBarcodeId(null);
              }}
            >
              저장
            </Button>
            <Button size="micro" onClick={() => setEditingBarcodeId(null)}>
              취소
            </Button>
          </InlineStack>
        ) : (
          <InlineStack gap="100" blockAlign="center">
            <Text variant="bodyMd" as="span" style={{ fontFamily: "monospace" }}>
              {item.barcode || "-"}
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
          </InlineStack>
        )}
      </div>,
      <div key={`qty-${item.id}`} style={{ backgroundColor: isHighlighted ? "#fef08a" : "transparent" }}>
        <BlockStack gap="100" align="center">
          <InlineStack wrap={false} align="center" gap="150">
            <Button
              size="slim"
              onClick={() => adjustQuantity(item.id, -1)}
              disabled={item.inspectedQuantity === 0 || item.issueType !== null}
            >
              -
            </Button>
            <Text variant="bodyLg" fontWeight="bold" as="span">
              {item.inspectedQuantity} / {item.orderedQuantity}
            </Text>
            <Button
              size="slim"
              onClick={() => adjustQuantity(item.id, 1)}
              disabled={item.inspectedQuantity === item.orderedQuantity || item.issueType !== null}
            >
              +
            </Button>
          </InlineStack>
          <InlineStack gap="100" align="center">
            <Button
              size="micro"
              tone="success"
              onClick={() => scanAllQuantity(item.id)}
              disabled={item.inspectedQuantity === item.orderedQuantity || item.issueType !== null}
            >
              전체 완료
            </Button>
          </InlineStack>
        </BlockStack>
      </div>,
      <div key={`action-${item.id}`} style={{ backgroundColor: isHighlighted ? "#fef08a" : "transparent" }}>
        <BlockStack align="center" gap="100">
          {statusElement}
          {!item.issueType && item.inspectedQuantity < item.orderedQuantity && (
            <Button size="micro" tone="critical" onClick={() => openIssueModal(item.id)}>
              예외 처리
            </Button>
          )}
        </BlockStack>
      </div>,
    ];
  });

  return (
    <Page
      title="주문 검수"
      titleMetadata={
        <InlineStack gap="200" align="center">
          <Badge tone="info">
            {`검수자: ${currentInspector || inspectorName || "관리자"}`}
          </Badge>
          <Button
            variant="plain"
            size="micro"
            onClick={handleOpenInspectorModal}
          >
            검수자 변경
          </Button>
        </InlineStack>
      }
      subtitle={
        currentInspector && inspectorName && currentInspector !== inspectorName
          ? `쇼피파이 기본 계정: ${inspectorName} (작업대 지정 검수자로 검수 중)`
          : undefined
      }
      backAction={{ content: "대시보드", url: "/app" }}
    >
      <BlockStack gap="400">
        {/* 주문 검색 바 */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" align="start" blockAlign="end" wrap>
              <div className="ops-work-input">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSearch();
                  }}
                >
                  <TextField
                    label="주문 번호 또는 고객 검색 (예: #1001, 1001, 이메일)"
                    value={orderName}
                    onChange={setOrderName}
                    autoComplete="off"
                    prefix={<Icon source={SearchIcon} />}
                    inputRef={orderSearchRef}
                    disabled={!!currentOrder}
                    clearButton
                    onClearButtonClick={() => setOrderName("")}
                  />
                </form>
              </div>
              <Button
                variant="primary"
                onClick={handleSearch}
                loading={fetcher.state === "submitting"}
                disabled={!!currentOrder || !orderName.trim()}
              >
                주문 불러오기
              </Button>
              {currentOrder && (
                <Button tone="critical" onClick={handleCancelActiveOrder}>
                  검수 종료
                </Button>
              )}
            </InlineStack>

            {message && (
              <Banner
                tone={message.type === "error" ? "critical" : message.type === "warning" ? "warning" : "success"}
                onDismiss={() => setMessage(null)}
              >
                <p>{message.text}</p>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* 활성 주문 작업 영역 */}
        {currentOrder && (
          <BlockStack gap="400">
            {/* 주문 현황 및 진행도 요약 카드 */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="050">
                    <Text variant="headingMd" as="h2">
                      {currentOrder.name}
                    </Text>
                    {currentOrder.email && (
                      <Text variant="bodySm" tone="subdued">
                        고객 이메일: {currentOrder.email}
                      </Text>
                    )}
                  </BlockStack>

                  <InlineStack gap="200" blockAlign="center">
                    {issueCount > 0 && <Badge tone="critical">예외 {issueCount}건</Badge>}
                    <Badge tone={progressPercent === 100 ? "success" : "attention"}>
                      {progressPercent}% 완료
                    </Badge>
                  </InlineStack>
                </InlineStack>

                <BlockStack gap="100">
                  <InlineStack align="space-between">
                    <Text variant="bodySm" tone="subdued">
                      검수 수량
                    </Text>
                    <Text variant="bodySm" fontWeight="bold">
                      {totalInspectedCount} / {totalOrderedCount} 개
                    </Text>
                  </InlineStack>
                  <ProgressBar progress={progressPercent} tone={progressPercent === 100 ? "success" : "highlight"} />
                </BlockStack>

                <div className="ops-work-summary">
                  <BlockStack gap="100"><Text as="p" tone="subdued">남은 수량</Text><Text as="p" variant="headingLg">{Math.max(0, totalOrderedCount - totalInspectedCount)}개</Text></BlockStack>
                  <BlockStack gap="100"><Text as="p" tone="subdued">확인할 예외</Text><Text as="p" variant="headingLg" tone={issueCount ? "critical" : undefined}>{issueCount}개 품목</Text></BlockStack>
                </div>
                {/* 바코드 스캔 입력 */}
                <form className="ops-scan-zone"
                  onSubmit={(e) => {
                    e.preventDefault();
                    processBarcode(barcode);
                  }}
                >
                  <InlineStack gap="200" align="start" blockAlign="end" wrap>
                    <div className="ops-work-input">
                      <TextField
                        label="상품 바코드 또는 SKU 스캔"
                        value={barcode}
                        onChange={setBarcode}
                        autoComplete="off"
                        prefix={<Icon source={BarcodeIcon} />}
                        inputRef={barcodeRef}
                        placeholder="바코드 스캐너를 찍거나 SKU를 입력하세요"
                      />
                    </div>
                    <Button variant="primary" onClick={() => processBarcode(barcode)} disabled={!barcode.trim()}>
                      스캔 확인
                    </Button>
                    <Button onClick={() => setCameraModalOpen(true)}>
                      카메라 스캔
                    </Button>

                  </InlineStack>
                </form>
                <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
                  <Text as="p" tone="subdued">스캔 후 Enter를 누르면 수량이 반영됩니다.</Text>
                  <Button variant="plain" onClick={handleCompleteAll}>전체 일괄 완료</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* 품목 필터 탭 바 (전체 / 진행중 / 완료 / 예외) */}
            <Card padding="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <ButtonGroup segmented>
                  <Button
                    pressed={itemTab === "ALL"}
                    onClick={() => {
                      setItemTab("ALL");
                      setTimeout(() => barcodeRef.current?.focus(), 80);
                    }}
                  >
                    {`전체 (${currentOrder.items.length})`}
                  </Button>
                  <Button
                    pressed={itemTab === "REMAINING"}
                    onClick={() => {
                      setItemTab("REMAINING");
                      setTimeout(() => barcodeRef.current?.focus(), 80);
                    }}
                  >
                    {`진행중 / 남은 상품 (${remainingCount})`}
                  </Button>
                  <Button
                    pressed={itemTab === "COMPLETED"}
                    onClick={() => {
                      setItemTab("COMPLETED");
                      setTimeout(() => barcodeRef.current?.focus(), 80);
                    }}
                  >
                    {`검수 완료 (${completedCount})`}
                  </Button>
                  {issueCount > 0 && (
                    <Button
                      pressed={itemTab === "ISSUES"}
                      onClick={() => {
                        setItemTab("ISSUES");
                        setTimeout(() => barcodeRef.current?.focus(), 80);
                      }}
                    >
                      {`예외 처리 (${issueCount})`}
                    </Button>
                  )}
                </ButtonGroup>

                <Text variant="bodySm" tone="subdued">
                  {itemTab === "REMAINING"
                    ? `아직 검수되지 않은 남은 품목 ${remainingCount}개를 표시하고 있습니다.`
                    : itemTab === "COMPLETED"
                    ? `검수 완료된 품목 ${completedCount}개를 표시하고 있습니다.`
                    : itemTab === "ISSUES"
                    ? `예외 처리(환불/적립/대체)된 품목 ${issueCount}개를 표시하고 있습니다.`
                    : `전체 ${currentOrder.items.length}개 품목을 표시하고 있습니다.`}
                </Text>
              </InlineStack>
            </Card>

            {/* 품목 데이터 테이블 */}
            <Card padding="0">
              {displayedItems.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["상품", "상품 정보 및 예외", "바코드", "검수 수량", "상태"]}
                  rows={rows}
                />
              ) : (
                <Box padding="600" textAlign="center">
                  <Text variant="bodyMd" tone="subdued">
                    {itemTab === "REMAINING"
                      ? "모든 품목의 검수가 완료되었습니다."
                      : itemTab === "COMPLETED"
                      ? "아직 완료된 품목이 없습니다."
                      : itemTab === "ISSUES"
                      ? "예외 처리된 품목이 없습니다."
                      : "표시할 품목이 없습니다."}
                  </Text>
                </Box>
              )}
            </Card>

            {/* 하단 고정 액션 바 */}
            <div className="ops-action-footer">
            <Box
              padding="300"
              background="bg-surface"
              borderRadius="300"
              borderWidth="025"
              borderColor="border"
              shadow="200"
            >
              <InlineStack align="space-between" blockAlign="center" wrap gap="300">
                <Text variant="bodyMd" fontWeight="semibold">
                  총 {currentOrder.items.length}개 품목 ({totalInspectedCount}/{totalOrderedCount}개 검수 완료)
                </Text>
                <InlineStack gap="200">
                  <Button onClick={handleCancelActiveOrder}>검수 취소</Button>
                  <Button
                    variant="primary"
                    size="large"
                    onClick={handleSave}
                    loading={saveFetcher.state === "submitting"}
                  >
                    검수 완료 및 저장
                  </Button>
                </InlineStack>
              </InlineStack>
            </Box>
            </div>
          </BlockStack>
        )}
      </BlockStack>

      {/* 검수자 변경 모달 */}
      <Modal
        open={isInspectorModalOpen}
        onClose={() => setIsInspectorModalOpen(false)}
        title="검수 담당자 변경"
        primaryAction={{
          content: "저장",
          onAction: handleSaveCustomInspector,
        }}
        secondaryActions={[
          {
            content: "쇼피파이 관리자 계정으로 복원",
            onAction: handleResetToShopifyAdmin,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              현재 기기(작업대)에서 검수를 진행하는 담당자 이름을 설정할 수 있습니다. 저장 시 이 브라우저에 유지되며, 검수 완료 시 이 이름으로 기록됩니다.
            </Text>
            {inspectorName && (
              <Banner tone="info">
                <Text as="p">
                  현재 로그인된 쇼피파이 기본 계정: <strong>{inspectorName}</strong>
                </Text>
              </Banner>
            )}
            <TextField
              label="검수 담당자명"
              value={customInspectorInput}
              onChange={setCustomInspectorInput}
              autoComplete="off"
              helpText="예: 홍길동, 패킹1팀 작업자"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* 카메라 바코드 스캔 모달 */}
      <Modal
        open={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        title="카메라 바코드 스캐너"
        primaryAction={{
          content: "닫기",
          onAction: () => setCameraModalOpen(false),
        }}
      >
        <Modal.Section>
          <div style={{ textAlign: "center" }}>
            <div
              id="camera-scanner-view"
              style={{
                width: "100%",
                maxWidth: "360px",
                margin: "0 auto",
                minHeight: "240px",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            />
            <Box paddingBlockStart="200">
              <Text variant="bodySm" tone="subdued">
                카메라에 바코드 또는 QR코드를 비추면 자동으로 인식됩니다.
              </Text>
            </Box>
          </div>
        </Modal.Section>
      </Modal>

      {/* 예외 처리 및 대체상품 모달 */}
      <Modal
        open={issueModalOpen}
        onClose={() => setIssueModalOpen(false)}
        title="품목 예외 처리 (문제 보고)"
        primaryAction={{
          content: "예외 적용",
          onAction: saveIssueToOrder,
        }}
        secondaryActions={[
          {
            content: "취소",
            onAction: () => setIssueModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <ChoiceList
              title="예외 유형 선택"
              choices={[
                { label: "환불 처리 (품절 / 재고 부족)", value: "REFUND" },
                { label: "적립금 지급 (결품 보상)", value: "CREDIT" },
                { label: "대체 상품 발송", value: "SUBSTITUTE" },
              ]}
              selected={issueType}
              onChange={setIssueType}
            />

            {issueType[0] === "SUBSTITUTE" && (
              <BlockStack gap="300">
                <Text variant="bodySm" fontWeight="bold">
                  대체 상품 검색
                </Text>
                <InlineStack gap="200" blockAlign="end">
                  <div className="ops-work-input">
                    <TextField
                      label="상품명, SKU 또는 바코드"
                      value={substituteQuery}
                      onChange={setSubstituteQuery}
                      autoComplete="off"
                    />
                  </div>
                  <Button onClick={handleSubstituteSearch} loading={searchFetcher.state === "submitting"}>
                    검색
                  </Button>
                </InlineStack>

                {selectedSubstitute && (
                  <Box
                    padding="200"
                    background="bg-surface-secondary"
                    borderRadius="150"
                    borderWidth="025"
                    borderColor="border"
                  >
                    <Text variant="bodySm" fontWeight="bold">
                      선택된 대체 상품: {selectedSubstitute.title}
                    </Text>
                  </Box>
                )}

                {searchFetcher.data?.results && searchFetcher.data.results.length > 0 && (
                  <ResourceList
                    resourceName={{ singular: "대체상품", plural: "대체상품" }}
                    items={searchFetcher.data.results}
                    renderItem={(item) => (
                      <ResourceItem
                        id={item.id}
                        onClick={() => setSelectedSubstitute(item)}
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="050">
                            <Text variant="bodyMd" fontWeight="bold">
                              {item.title}
                            </Text>
                            <Text variant="bodySm" tone="subdued">
                              SKU: {item.sku || "N/A"} | 바코드: {item.barcode || "N/A"}
                            </Text>
                          </BlockStack>
                          <Text variant="bodyMd" fontWeight="semibold">
                            €{item.price}
                          </Text>
                        </InlineStack>
                      </ResourceItem>
                    )}
                  />
                )}
              </BlockStack>
            )}

            <TextField
              label="작업자 메모 / 사유"
              value={issueNote}
              onChange={setIssueNote}
              multiline={3}
              autoComplete="off"
              placeholder="예: 유통기한 임박으로 인한 환불, 500g 대체 품목 출고 등"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}