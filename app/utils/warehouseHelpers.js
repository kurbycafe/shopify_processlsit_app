/**
 * Parses bin location string into warehouse category and individual shelf locations
 */
export function parseWarehouseInfo(binLocation = "") {
  const loc = (binLocation || "").trim();
  if (!loc || loc === "위치 미정" || loc === "위치 미지정" || loc === "조회중") {
    return {
      category: "NO_BIN",
      label: "위치 미지정",
      storeShelf: null,
      newShelf: null,
      isStore: false,
      isNewOnly: false,
      hasBoth: false,
    };
  }

  // 매장창고 + 신창고 결합: e.g. "A-01-02 (신창고: B-04)"
  const matchBoth = loc.match(/^(.*?)\s*\(신창고:\s*(.*?)\)$/);
  if (matchBoth) {
    return {
      category: "STORE",
      label: loc,
      storeShelf: matchBoth[1].trim(),
      newShelf: matchBoth[2].trim(),
      isStore: true,
      isNewOnly: false,
      hasBoth: true,
    };
  }

  // 신창고 전용: e.g. "*W-05 (신창고)" 또는 "*W-05"
  if (loc.startsWith("*") || loc.includes("신창고")) {
    const cleanNew = loc.replace(/^\*/, "").replace(/\(신창고\)/, "").trim();
    return {
      category: "NEW_ONLY",
      label: loc,
      storeShelf: null,
      newShelf: cleanNew,
      isStore: false,
      isNewOnly: true,
      hasBoth: false,
    };
  }

  // 기본값: 매장창고 레갈 위치 (e.g. "B-03-01")
  return {
    category: "STORE",
    label: loc,
    storeShelf: loc,
    newShelf: null,
    isStore: true,
    isNewOnly: false,
    hasBoth: false,
  };
}

/**
 * Natural ascending sort for shelf / regal numbers
 */
export function compareRegalAscending(a, b) {
  const infoA = a.whInfo || parseWarehouseInfo(a.binLocation);
  const infoB = b.whInfo || parseWarehouseInfo(b.binLocation);

  const shelfA = infoA.storeShelf || infoA.newShelf || a.binLocation || "ZZZ";
  const shelfB = infoB.storeShelf || infoB.newShelf || b.binLocation || "ZZZ";

  return shelfA.localeCompare(shelfB, undefined, { numeric: true, sensitivity: "base" });
}
