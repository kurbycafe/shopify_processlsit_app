const fs = require('fs');
let c = fs.readFileSync('app/routes/app.pick-list.jsx', 'utf8');

let o = c;
c = c.replace(/return\s*\{\s*items,\s*totalUnfulfilledProducts[\s\S]*?activeTab:\s*selectedTab\s*\}\s*;\s*\}\s*\}\s*\}\s*\)\s*\)\s*\.sort\(sortBinLocations\)\s*;\s*return\s*\{\s*items,\s*totalUnfulfilledProducts[^}]*\}\s*;\s*\}/, 
`return {
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
}`);
console.log('Chunk 1 replaced?', c !== o);
if (c === o) {
    // maybe try simpler replace for chunk 1
    console.log("Regex 1 failed. Trying simpler regex...");
    c = c.replace(/activeTab: selectedTab\s*\};\s*\}\s*\}\}\)\)\s*\.sort\(sortBinLocations\);\s*return \{ items, totalUnfulfilledProducts[^}]*\}\s*;\s*\}/, "activeTab: selectedTab\n  };\n}");
    console.log('Chunk 1 (fallback) replaced?', c !== o);
}

o = c;
c = c.replace(/export default function PickListPage\(\)\s*\{\s*const \{\s*items,\s*totalUnfulfilledProducts,\s*totalOrderedQty\s*\}\s*=\s*useLoaderData\(\);\s*const actionData\s*=\s*useActionData\(\);\s*const submit\s*=\s*useSubmit\(\);/,
`export default function PickListPage() {
  const { items, totalUnfulfilledProducts, totalOrderedQty, counts, activeTab } = useLoaderData();
  const actionData = useActionData(); 
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId });
  };`);
console.log('Chunk 2 replaced?', c !== o);

o = c;
c = c.replace(/orderNames:\s*JSON\.stringify\(Array\.from\(allOrderNames\)\)\s*\},/, 
`orderNames: JSON.stringify(Array.from(allOrderNames)),
        activeTab: activeTab
      },`);
console.log('Chunk 3 replaced?', c !== o);

o = c;
c = c.replace(/<div className="no-print" style=\{\{\s*display: "flex",\s*flexWrap: "wrap",\s*alignItems: "center",\s*justifyContent: "space-between",\s*marginBottom: "16px",\s*gap: "12px"\s*\}\}>\s*<div style=\{\{\s*display: "flex",\s*gap: "12px"\s*\}\}>\s*<div style=\{metricCardStyle\}>/,
`<div className="no-print" style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px" }}>
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
            <div style={metricCardStyle}>`);
console.log('Chunk 4 replaced?', c !== o);

fs.writeFileSync('app/routes/app.pick-list.jsx', c, 'utf8');
