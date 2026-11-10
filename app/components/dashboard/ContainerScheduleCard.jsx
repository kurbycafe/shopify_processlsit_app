import { Card, BlockStack, Text, InlineStack, Badge, Box } from "@shopify/polaris";
import { Link, useNavigate } from "react-router";
import dayjs from "dayjs";

const MAX_CONTAINER_SCHEDULE_ITEMS = 5;

export function ContainerScheduleCard({
  upcomingContainers = [],
  calendarMonths = [],
  onSelectContainer,
}) {
  const navigate = useNavigate();
  const recentContainers = [...(upcomingContainers || [])]
    .sort(
      (a, b) =>
        String(b.eta || "").localeCompare(String(a.eta || "")) ||
        (Number(b.id) || 0) - (Number(a.id) || 0)
    )
    .slice(0, MAX_CONTAINER_SCHEDULE_ITEMS);
  const hasContainers = recentContainers.length > 0;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h2">
            컨테이너 입고 일정
          </Text>
          <Link to="/app/container-catalog" style={{ textDecoration: "none" }}>
            <Text variant="bodySm" tone="subdued">
              카탈로그 전체보기 &rarr;
            </Text>
          </Link>
        </InlineStack>

        <div className="container-dashboard-layout">
          <div className="container-table-section">
            {hasContainers ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e1e3e5", backgroundColor: "#fafafa", textAlign: "left" }}>
                      <th style={{ padding: "10px 10px", color: "#616161", fontWeight: "600" }}>
                        입고 번호
                      </th>
                      <th style={{ padding: "10px 10px", color: "#616161", fontWeight: "600" }}>
                        컨테이너 / PO
                      </th>
                      <th style={{ padding: "10px 10px", color: "#616161", fontWeight: "600" }}>
                        입고 예정일
                      </th>
                      <th style={{ padding: "10px 10px", color: "#616161", fontWeight: "600", textAlign: "right" }}>
                        상태
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentContainers.map((container) => {
                      let stateBadge = <Badge>대기</Badge>;
                      if (container.state === "done") {
                        stateBadge = <Badge>입고 완료</Badge>;
                      } else if (container.state === "assigned") {
                        stateBadge = <Badge>입고 준비</Badge>;
                      } else if (container.state === "confirmed" || container.state === "waiting") {
                        stateBadge = <Badge>입고 대기</Badge>;
                      }

                      const relativeTimeStr = dayjs(container.eta).fromNow();

                      return (
                        <tr key={container.id} style={{ borderBottom: "1px solid #f1f2f4" }}>
                          <td style={{ padding: "12px 10px", fontWeight: "600", fontFamily: "monospace" }}>
                            {container.name}
                          </td>
                          <td style={{ padding: "12px 10px" }}>
                            {container.containerRef !== "N/A" ? (
                              <span
                                onClick={() =>
                                  navigate(
                                    `/app/container-catalog?containerRef=${encodeURIComponent(
                                      container.containerRef
                                    )}`
                                  )
                                }
                                style={{
                                  color: "#303030",
                                  textDecoration: "underline",
                                  cursor: "pointer",
                                  fontWeight: "600",
                                }}
                              >
                                {container.containerRef}
                              </span>
                            ) : (
                              <span style={{ color: "#616161" }}>N/A</span>
                            )}
                          </td>
                          <td style={{ padding: "12px 10px" }}>
                            <BlockStack gap="050">
                              <Text variant="bodyMd" as="span" fontWeight="medium">
                                {container.eta}
                              </Text>
                              <Text variant="bodyXs" as="span" tone="subdued">
                                ({relativeTimeStr})
                              </Text>
                            </BlockStack>
                          </td>
                          <td style={{ padding: "12px 10px", textAlign: "right" }}>{stateBadge}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Box padding="600" textAlign="center">
                <BlockStack gap="200" inlineAlign="center">
                  <Text variant="bodyMd" tone="subdued">
                    현재 예정된 컨테이너 입고 전표가 없습니다.
                  </Text>
                  <Text variant="bodyXs" tone="subdued">
                    Odoo ERP 발주서(PO) 등록 시 자동으로 입고 일정이 동기화됩니다.
                  </Text>
                </BlockStack>
              </Box>
            )}
          </div>

          <div className="container-calendar-section">
            <div className="double-calendar-container">
              {calendarMonths.map((monthData, idx) => (
                <div key={idx} className="calendar-month-box">
                  <div className="calendar-month-title">
                    {monthData.yearLabel} {monthData.monthLabel}
                  </div>
                  <div className="calendar-weekdays">
                    {["일", "월", "화", "수", "목", "금", "토"].map((dayName) => (
                      <div key={dayName}>{dayName}</div>
                    ))}
                  </div>
                  <div className="calendar-days-grid">
                    {monthData.days.map((day, dIdx) => {
                      if (!day) {
                        return <div key={`empty-${dIdx}`} className="calendar-day-empty" />;
                      }

                      const formattedDate = typeof day === "string"
                        ? day
                        : day.formattedDate || (day.format ? day.format("YYYY-MM-DD") : String(day));
                      const dateNum = typeof day === "object" && day.dateNumber
                        ? day.dateNumber
                        : (day.date ? day.date() : dIdx + 1);

                      const matchedContainers = (upcomingContainers || []).filter(
                        (c) => c.eta === formattedDate
                      );
                      const hasEvents = matchedContainers.length > 0;

                      let highlightClass = "";
                      if (hasEvents) {
                        const states = matchedContainers.map((c) => c.state);
                        if (states.includes("assigned")) {
                          highlightClass = " state-assigned";
                        } else if (
                          states.includes("confirmed") ||
                          states.includes("waiting")
                        ) {
                          highlightClass = " state-waiting";
                        } else if (states.includes("done")) {
                          highlightClass = " state-done";
                        } else {
                          highlightClass = " state-other";
                        }
                      }

                      return (
                        <div
                          key={formattedDate}
                          className={`calendar-day${hasEvents ? " has-events" : ""}${highlightClass}`}
                          onClick={() => {
                            if (hasEvents) {
                              const firstContainer = matchedContainers[0];
                              if (firstContainer && firstContainer.containerRef !== "N/A") {
                                onSelectContainer(firstContainer.containerRef);
                              }
                            }
                          }}
                        >
                          {dateNum}
                          {hasEvents && (
                            <div className="tooltip">
                              <div
                                style={{
                                  fontWeight: "bold",
                                  borderBottom: "1px solid #475569",
                                  paddingBottom: "4px",
                                  marginBottom: "4px",
                                }}
                              >
                                {formattedDate} 입고 일정 (클릭 시 세부 품목)
                              </div>
                              {matchedContainers.map((container, cIdx) => (
                                <div key={cIdx} style={{ marginTop: cIdx > 0 ? "6px" : "0" }}>
                                  • <strong>{container.name}</strong> ({container.containerRef})
                                  <br />
                                  &nbsp;&nbsp;상태:{" "}
                                  {container.state === "done"
                                    ? "입고 완료"
                                    : container.state === "assigned"
                                    ? "입고 준비"
                                    : container.state === "confirmed" ||
                                      container.state === "waiting"
                                    ? "입고 대기"
                                    : container.state}
                                  <br />
                                  &nbsp;&nbsp;거래처: {container.supplier}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="calendar-legend-bar">
              <span className="legend-item"><span className="legend-dot state-done"></span>입고 완료</span>
              <span className="legend-item"><span className="legend-dot state-assigned"></span>입고 준비</span>
              <span className="legend-item"><span className="legend-dot state-waiting"></span>입고 대기</span>
            </div>
          </div>
        </div>
      </BlockStack>
    </Card>
  );
}
