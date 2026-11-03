import MobileLiveSimulator from "../MobileLiveSimulator.jsx";

// "preview" tab of the app management screen (moved out of app.app-management.jsx).
export function PreviewPanel({
  activeTab,
  bannerForm,
  config,
  dealForm,
  editingBanner,
  freeShippingThreshold,
  hotDealSettings,
  shippingNoticeKo,
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "24px",
        background: "#F8FAFC",
        borderRadius: "16px",
        border: "1px solid #CBD5E1",
      }}
    >
      <MobileLiveSimulator
        config={config}
        activeTab={activeTab}
        bannerForm={bannerForm}
        editingBanner={editingBanner}
        dealForm={dealForm}
        hotDealSettings={hotDealSettings}
        shippingNoticeKo={shippingNoticeKo}
        freeShippingThreshold={freeShippingThreshold}
        standalone={true}
      />
    </div>
  );
}
