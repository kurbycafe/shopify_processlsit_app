import { Card, BlockStack, Text } from "@shopify/polaris";

export function ProductivityChartCard({ chartData }) {
  const maxTotal = Math.max(5, ...chartData.map((d) => d.totalCount || 0));

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          최근 7일간 검수 생산성 및 일별 처리 현황
        </Text>

        <div className="productivity-chart-container">
          <div style={{ width: "100%", overflowX: "auto" }}>
            <svg
              viewBox="0 0 800 240"
              style={{ width: "100%", minWidth: "600px", height: "auto" }}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                const y = 20 + 170 * (1 - ratio);
                const countValue = Math.round(maxTotal * ratio);
                return (
                  <g key={idx}>
                    <line x1="50" y1={y} x2="770" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x="38" y={y + 4} fontSize="10" fill="#94a3b8" textAnchor="end">
                      {countValue}건
                    </text>
                  </g>
                );
              })}

              <line x1="50" y1="190" x2="770" y2="190" stroke="#cbd5e1" strokeWidth="1.5" />

              {chartData.map((day, dIdx) => {
                const x = 85 + dIdx * 96;
                const total = day.totalCount;

                let successHeight = 0;
                let partialHeight = 0;
                let issueHeight = 0;

                if (total > 0 && maxTotal > 0) {
                  successHeight = (day.successCount / maxTotal) * 170;
                  partialHeight = (day.partialCount / maxTotal) * 170;
                  issueHeight = (day.issueCount / maxTotal) * 170;
                }

                const issueY = 190 - issueHeight;
                const partialY = issueY - partialHeight;
                const successY = partialY - successHeight;

                return (
                  <g key={dIdx} className="chart-bar-group">
                    {total > 0 ? (
                      <>
                        {day.successCount > 0 && (
                          <rect
                            x={x}
                            y={successY}
                            width="36"
                            height={successHeight}
                            fill="#10b981"
                            rx="2"
                            className="chart-rect"
                          />
                        )}
                        {day.partialCount > 0 && (
                          <rect
                            x={x}
                            y={partialY}
                            width="36"
                            height={partialHeight}
                            fill="#f59e0b"
                            rx="2"
                            className="chart-rect"
                          />
                        )}
                        {day.issueCount > 0 && (
                          <rect
                            x={x}
                            y={issueY}
                            width="36"
                            height={issueHeight}
                            fill="#ef4444"
                            rx="2"
                            className="chart-rect"
                          />
                        )}

                        <g className="chart-tooltip">
                          <rect
                            x={x - 40}
                            y={Math.max(10, successY - 60)}
                            width="116"
                            height="52"
                            fill="#0f172a"
                            rx="6"
                            opacity="0.95"
                          />
                          <text
                            x={x + 18}
                            y={Math.max(10, successY - 60) + 16}
                            fill="#ffffff"
                            fontSize="10"
                            fontWeight="bold"
                            textAnchor="middle"
                          >
                            총 {total}건 처리
                          </text>
                          <text
                            x={x + 18}
                            y={Math.max(10, successY - 60) + 30}
                            fill="#34d399"
                            fontSize="9"
                            textAnchor="middle"
                          >
                            성공 {day.successCount} / 일부 {day.partialCount}
                          </text>
                          <text
                            x={x + 18}
                            y={Math.max(10, successY - 60) + 44}
                            fill="#f87171"
                            fontSize="9"
                            textAnchor="middle"
                          >
                            문제 {day.issueCount}건
                          </text>
                        </g>
                      </>
                    ) : (
                      <circle cx={x + 18} cy="190" r="3" fill="#e2e8f0" />
                    )}

                    <text
                      x={x + 18}
                      y="208"
                      fontSize="11"
                      fill="#64748b"
                      textAnchor="middle"
                      fontWeight="500"
                    >
                      {day.dateLabel}
                    </text>

                    <text
                      x={x + 18}
                      y="224"
                      fontSize="10"
                      fill={total > 0 ? "#334155" : "#cbd5e1"}
                      textAnchor="middle"
                      fontWeight={total > 0 ? "bold" : "normal"}
                    >
                      {total > 0 ? `${total}건` : "-"}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "24px",
              marginTop: "16px",
              fontSize: "12px",
              color: "#475569",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: "#10b981",
                  borderRadius: "2px",
                  display: "inline-block",
                }}
              />
              <span>완료 (성공)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: "#f59e0b",
                  borderRadius: "2px",
                  display: "inline-block",
                }}
              />
              <span>일부 완료</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: "#ef4444",
                  borderRadius: "2px",
                  display: "inline-block",
                }}
              />
              <span>문제 보고</span>
            </div>
          </div>
        </div>
      </BlockStack>
    </Card>
  );
}
