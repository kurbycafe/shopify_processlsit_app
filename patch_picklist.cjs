const fs = require('fs');
let code = fs.readFileSync('app/routes/app.pick-list.jsx', 'utf8');

const chunk1_target = `  return {
    items,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0),
    counts: {
      all: countAll,
      paid: countPaid,
      pending: countPending
    },
    activeTab: selectedTab
  };
}   }))
    .sort(sortBinLocations);

  return { items, totalUnfulfilledProducts: items.length, totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0) };
}`;
const chunk1_replacement = `  return {
    items,
    totalUnfulfilledProducts: items.length,
    totalOrderedQty: items.reduce((sum, i) => sum + i.orderedQty, 0),
    counts: {
      all: countAll,
      paid: countPaid,
      pending: countPending
    },
    activeTab: selectedTab
  };
}`;
code = code.replace(chunk1_target, chunk1_replacement);

const chunk2_target = `export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty } = useLoaderData();
  const actionData = useActionData(); 
  const submit = useSubmit();`;
const chunk2_replacement = `export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty, counts, activeTab } = useLoaderData();
  const actionData = useActionData(); 
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId });
  };`;
code = code.replace(chunk2_target, chunk2_replacement);

const chunk3_target = `    submit(
      { 
        intent: "send-email", 
        clientTime: formattedTime, 
        techTime: techTime,
        orderNames: JSON.stringify(Array.from(allOrderNames))
      },
      { method: "post" }
    );`;
const chunk3_replacement = `    submit(
      { 
        intent: "send-email", 
        clientTime: formattedTime, 
        techTime: techTime,
        orderNames: JSON.stringify(Array.from(allOrderNames)),
        activeTab: activeTab
      },
      { method: "post" }
    );`;
code = code.replace(chunk3_target, chunk3_replacement);

const chunk4_target = `        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", gap: "12px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={metricCardStyle}>`;
const chunk4_replacement = `        <div className="no-print" style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px" }}>
          <button 
            onClick={() => handleTabChange("all")} 
            style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: activeTab === "all" ? "#0f172a" : "transparent", color: activeTab === "all" ? "#fff" : "#475569", fontWeight: activeTab === "all" ? "bold" : "normal", cursor: "pointer" }}
          >
            전체 ({counts?.all || 0})
          </button>
          <button 
            onClick={() => handleTabChange("paid")} 
            style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: activeTab === "paid" ? "#0f172a" : "transparent", color: activeTab === "paid" ? "#fff" : "#475569", fontWeight: activeTab === "paid" ? "bold" : "normal", cursor: "pointer" }}
          >
            결제 완료 & 미처리 ({counts?.paid || 0})
          </button>
          <button 
            onClick={() => handleTabChange("pending")} 
            style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: activeTab === "pending" ? "#0f172a" : "transparent", color: activeTab === "pending" ? "#fff" : "#475569", fontWeight: activeTab === "pending" ? "bold" : "normal", cursor: "pointer" }}
          >
            결제 보류중 & 미처리 ({counts?.pending || 0})
          </button>
        </div>

        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", gap: "12px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={metricCardStyle}>`;
code = code.replace(chunk4_target, chunk4_replacement);

fs.writeFileSync('app/routes/app.pick-list.jsx', code, 'utf8');
console.log("Replaced:", code.includes('handleTabChange'));
